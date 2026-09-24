/*
  Audited restoration for an account that was deleted through the inheritance
  protocol. The original Auth UUID must be recreated before this function is
  called. Aggregate values that were merged without row provenance are restored
  through explicit adjustments rather than fabricated gameplay records.
*/

CREATE TABLE IF NOT EXISTS public.account_inheritance_restorations (
  inheritance_id uuid PRIMARY KEY
    REFERENCES public.account_inheritances(id) ON DELETE RESTRICT,
  original_user_id uuid NOT NULL,
  restored_user_id uuid NOT NULL UNIQUE
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  restored_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  restoration_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  restored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.account_fig_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount <> 0),
  source_reference text NOT NULL,
  description text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_reference)
);

CREATE INDEX IF NOT EXISTS account_fig_adjustments_user_effective_idx
  ON public.account_fig_adjustments(user_id, effective_at);

ALTER TABLE public.account_inheritance_restorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_fig_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_inheritance_restorations
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.account_fig_adjustments
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_inheritance_restorations TO service_role;
GRANT ALL ON public.account_fig_adjustments TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_lifetime_figs(
  p_user_id uuid,
  p_before timestamptz DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH quiz_attempt_figs AS (
    SELECT
      attempt.id,
      attempt.user_id,
      attempt.submitted_at,
      coalesce(
        attempt.talents_scored::numeric,
        sum(
          CASE
            WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
              AND NOT coalesce(response.assisted_by_relic, false)
            THEN CASE
              WHEN question.difficulty_tag = 'hard' THEN 5
              WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
              ELSE 1
            END
            ELSE 0
          END
        )::numeric,
        0
      ) AS figs
    FROM public.quiz_attempts attempt
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
    LEFT JOIN public.generated_questions question
      ON question.id = response.question_id
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (p_before IS NULL OR attempt.submitted_at < p_before)
    GROUP BY attempt.id, attempt.user_id, attempt.submitted_at, attempt.talents_scored
  ), fig_sources AS (
    SELECT coalesce(sum(attempt.score), 0)::numeric AS figs
    FROM public.game_attempts attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
      AND (p_before IS NULL OR attempt.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(participant.score), 0)::numeric
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.user_id = p_user_id
      AND participant.finished_at IS NOT NULL
      AND room.status = 'completed'
      AND (p_before IS NULL OR participant.finished_at < p_before)
      AND (p_before IS NULL OR room.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(quiz.figs), 0)::numeric
    FROM quiz_attempt_figs quiz

    UNION ALL

    SELECT coalesce(sum(story.figs), 0)::numeric
    FROM public.story_mode_fig_entries story
    WHERE story.user_id = p_user_id
      AND (p_before IS NULL OR story.earned_at < p_before)

    UNION ALL

    SELECT coalesce(sum(adjustment.amount), 0)::numeric
    FROM public.account_fig_adjustments adjustment
    WHERE adjustment.user_id = p_user_id
      AND (p_before IS NULL OR adjustment.effective_at < p_before)
  )
  SELECT coalesce(sum(source.figs), 0)::numeric
  FROM fig_sources source;
$$;

REVOKE ALL ON FUNCTION public.get_user_lifetime_figs(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_lifetime_figs(uuid, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.restore_completed_account_inheritance(
  p_inheritance_id uuid,
  p_restored_email text DEFAULT NULL,
  p_original_created_at timestamptz DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inheritance public.account_inheritances%ROWTYPE;
  v_existing public.account_inheritance_restorations%ROWTYPE;
  v_auth_email text;
  v_role text;
  v_denarii integer := 0;
  v_figs numeric := 0;
  v_current integer := 0;
  v_longest integer := 0;
  v_ledger_id uuid;
  v_ledger_owner uuid;
  v_ledger_moved boolean := false;
  v_heir_balance bigint := 0;
  v_baseline_date date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Account restoration can only be performed by the account service.';
  END IF;

  SELECT inheritance.*
  INTO v_inheritance
  FROM public.account_inheritances inheritance
  WHERE inheritance.id = p_inheritance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account inheritance record not found.';
  END IF;
  IF v_inheritance.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed inheritance can be restored.';
  END IF;

  SELECT restoration.*
  INTO v_existing
  FROM public.account_inheritance_restorations restoration
  WHERE restoration.inheritance_id = p_inheritance_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_restored',
      'user_id', v_existing.restored_user_id,
      'snapshot', v_existing.restored_snapshot,
      'restored_at', v_existing.restored_at
    );
  END IF;

  SELECT auth_user.email
  INTO v_auth_email
  FROM auth.users auth_user
  WHERE auth_user.id = v_inheritance.departing_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Recreate the original Auth UUID before restoring its app data.';
  END IF;
  IF NULLIF(btrim(p_restored_email), '') IS NOT NULL
     AND lower(v_auth_email) <> lower(btrim(p_restored_email)) THEN
    RAISE EXCEPTION 'The recreated Auth email does not match the requested recovery email.';
  END IF;

  INSERT INTO public.profiles(id, display_name, email, avatar_url, created_at)
  VALUES (
    v_inheritance.departing_user_id,
    v_inheritance.departing_display_name,
    v_auth_email,
    NULLIF(btrim(p_avatar_url), ''),
    coalesce(p_original_created_at, v_inheritance.created_at)
  )
  ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      avatar_url = coalesce(EXCLUDED.avatar_url, public.profiles.avatar_url),
      created_at = least(public.profiles.created_at, EXCLUDED.created_at);

  v_role := CASE v_inheritance.snapshot ->> 'source_role'
    WHEN 'instructor' THEN 'instructor'
    WHEN 'sentry' THEN 'sentry'
    ELSE 'cadet'
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_inheritance.departing_user_id
      AND assignment.status IN ('active', 'approved')
  ) THEN
    INSERT INTO public.role_assignments(user_id, role, status, start_date)
    VALUES (
      v_inheritance.departing_user_id,
      v_role,
      'active',
      coalesce(p_original_created_at::date, v_inheritance.created_at::date)
    );
  END IF;

  INSERT INTO public.subscriptions(user_id, status, trial_started_at, trial_ends_at)
  VALUES (
    v_inheritance.departing_user_id,
    'trial',
    now(),
    now() + interval '31 days'
  )
  ON CONFLICT (user_id) DO NOTHING;

  v_denarii := coalesce((v_inheritance.snapshot ->> 'denarii')::integer, 0);
  IF v_denarii <> 0 THEN
    SELECT entry.id, entry.user_id
    INTO v_ledger_id, v_ledger_owner
    FROM public.denarii_ledger_entries entry
    WHERE entry.source_reference = 'inheritance:' || p_inheritance_id::text
      AND entry.source_type = 'admin_adjustment'
    ORDER BY entry.created_at, entry.id
    LIMIT 1
    FOR UPDATE;

    SELECT coalesce(sum(entry.amount), 0)
    INTO v_heir_balance
    FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = v_inheritance.heir_user_id;

    IF v_ledger_id IS NOT NULL
       AND (
         v_ledger_owner = v_inheritance.departing_user_id
         OR v_heir_balance >= v_denarii
       ) THEN
      UPDATE public.denarii_ledger_entries
      SET user_id = v_inheritance.departing_user_id,
          description = 'Restored with ' || v_inheritance.departing_display_name || '''s account'
      WHERE id = v_ledger_id;
      v_ledger_moved := true;
    ELSE
      INSERT INTO public.denarii_ledger_entries(
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_inheritance.departing_user_id,
        v_denarii,
        'admin_adjustment',
        'inheritance:' || p_inheritance_id::text,
        'Restored preserved account balance'
      );
    END IF;
  END IF;

  v_figs := coalesce((v_inheritance.snapshot ->> 'game_figs')::numeric, 0)
    + coalesce((v_inheritance.snapshot ->> 'quiz_figs')::numeric, 0)
    + coalesce((v_inheritance.snapshot ->> 'arena_figs')::numeric, 0);

  IF v_figs <> 0 THEN
    INSERT INTO public.account_fig_adjustments(
      user_id, amount, source_reference, description, effective_at
    ) VALUES (
      v_inheritance.departing_user_id,
      v_figs,
      'inheritance:' || p_inheritance_id::text || ':restored',
      'Restored preserved lifetime Figs',
      v_inheritance.created_at
    )
    ON CONFLICT (user_id, source_reference) DO NOTHING;

    INSERT INTO public.account_fig_adjustments(
      user_id, amount, source_reference, description, effective_at
    ) VALUES (
      v_inheritance.heir_user_id,
      -v_figs,
      'inheritance:' || p_inheritance_id::text || ':returned',
      'Returned Figs to restored account',
      v_inheritance.created_at
    )
    ON CONFLICT (user_id, source_reference) DO NOTHING;
  END IF;

  v_current := greatest(
    coalesce((v_inheritance.snapshot ->> 'current_streak')::integer, 0),
    0
  );
  v_longest := greatest(
    coalesce((v_inheritance.snapshot ->> 'longest_streak')::integer, 0),
    v_current
  );
  v_baseline_date := (v_inheritance.created_at AT TIME ZONE 'Africa/Douala')::date;

  INSERT INTO public.streak_manual_adjustments AS adjustment(
    user_id, effective_date, current_streak, longest_streak, reason, created_at
  ) VALUES (
    v_inheritance.departing_user_id,
    v_baseline_date,
    v_current,
    v_longest,
    'Restored from completed account inheritance ' || p_inheritance_id::text,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET effective_date = EXCLUDED.effective_date,
      current_streak = EXCLUDED.current_streak,
      longest_streak = greatest(adjustment.longest_streak, EXCLUDED.longest_streak),
      reason = EXCLUDED.reason,
      created_at = now();

  INSERT INTO public.streak_forward_baselines AS baseline(
    user_id, baseline_date, current_streak, longest_streak,
    consecutive_inactive, cumulative_inactive, captured_at
  ) VALUES (
    v_inheritance.departing_user_id,
    v_baseline_date,
    v_current,
    v_longest,
    0,
    0,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET baseline_date = EXCLUDED.baseline_date,
      current_streak = EXCLUDED.current_streak,
      longest_streak = greatest(baseline.longest_streak, EXCLUDED.longest_streak),
      captured_at = now();

  PERFORM public.refresh_user_streak_snapshot(v_inheritance.departing_user_id);

  INSERT INTO public.account_inheritance_restorations(
    inheritance_id,
    original_user_id,
    restored_user_id,
    restored_snapshot,
    restoration_notes
  ) VALUES (
    p_inheritance_id,
    v_inheritance.departing_user_id,
    v_inheritance.departing_user_id,
    v_inheritance.snapshot,
    jsonb_build_object(
      'denarii_ledger_moved', v_ledger_moved,
      'previous_ledger_owner', v_ledger_owner,
      'heir_balance_before_restoration', v_heir_balance,
      'aggregate_figs_adjusted', v_figs,
      'source', 'owner-authorized account recovery'
    )
  );

  RETURN jsonb_build_object(
    'status', 'restored',
    'user_id', v_inheritance.departing_user_id,
    'display_name', v_inheritance.departing_display_name,
    'denarii', v_denarii,
    'figs', v_figs,
    'current_streak', v_current,
    'longest_streak', v_longest,
    'role', v_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_completed_account_inheritance(
  uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_completed_account_inheritance(
  uuid, text, timestamptz, text
) TO service_role;
