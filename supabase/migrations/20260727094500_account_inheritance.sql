/*
# Account inheritance before deletion

Preserves a departing user's game resources before their Auth account is
deleted. Private messages and payment contact details are intentionally not
transferred to the heir.
*/

CREATE TABLE IF NOT EXISTS public.account_inheritances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departing_user_id uuid NOT NULL UNIQUE,
  departing_display_name text NOT NULL,
  heir_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_account_inheritances_heir
  ON public.account_inheritances (heir_user_id, created_at DESC);

ALTER TABLE public.account_inheritances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heirs_read_account_inheritances"
  ON public.account_inheritances;
CREATE POLICY "heirs_read_account_inheritances"
  ON public.account_inheritances
  FOR SELECT
  TO authenticated
  USING (
    heir_user_id = auth.uid()
    OR public.is_instructor(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.prepare_account_inheritance(
  p_account_id uuid,
  p_heir_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.profiles%ROWTYPE;
  v_heir public.profiles%ROWTYPE;
  v_source_role text;
  v_existing public.account_inheritances%ROWTYPE;
  v_inheritance_id uuid;
  v_balance bigint := 0;
  v_current_streak integer := 0;
  v_longest_streak integer := 0;
  v_game_figs bigint := 0;
  v_quiz_figs numeric := 0;
  v_arena_figs bigint := 0;
  v_awards integer := 0;
  v_relics integer := 0;
  v_snapshot jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Account inheritance can only be prepared by the account service.';
  END IF;

  IF p_account_id IS NULL OR p_heir_id IS NULL OR p_account_id = p_heir_id THEN
    RAISE EXCEPTION 'Choose a different active user as the heir.';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.account_inheritances
  WHERE departing_user_id = p_account_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'inheritance_id', v_existing.id,
      'heir_id', v_existing.heir_user_id,
      'status', v_existing.status,
      'snapshot', v_existing.snapshot
    );
  END IF;

  SELECT *
  INTO v_source
  FROM public.profiles
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The account to delete no longer exists.';
  END IF;

  SELECT *
  INTO v_heir
  FROM public.profiles
  WHERE id = p_heir_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The nominated heir no longer exists.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments
    WHERE user_id = p_heir_id
      AND status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'The nominated heir must have an active account.';
  END IF;

  SELECT role
  INTO v_source_role
  FROM public.role_assignments
  WHERE user_id = p_account_id
    AND status IN ('active', 'approved')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_source_role = 'instructor'
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_assignments
      WHERE user_id = p_heir_id
        AND role = 'sentry'
        AND status IN ('active', 'approved')
    )
  THEN
    RAISE EXCEPTION 'An instructor must nominate an active sentry as heir.';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_balance
  FROM public.denarii_ledger_entries
  WHERE user_id = p_account_id;

  SELECT
    COALESCE(current_streak, 0),
    COALESCE(longest_streak, 0)
  INTO v_current_streak, v_longest_streak
  FROM public.compute_strict_streak(p_account_id)
  LIMIT 1;

  SELECT COALESCE(SUM(score), 0)
  INTO v_game_figs
  FROM public.game_attempts
  WHERE user_id = p_account_id;

  SELECT COALESCE(SUM(talents_scored), 0)
  INTO v_quiz_figs
  FROM public.quiz_attempts
  WHERE user_id = p_account_id
    AND status IN ('submitted', 'timed_out');

  SELECT COALESCE(SUM(score), 0)
  INTO v_arena_figs
  FROM public.arena_participants
  WHERE user_id = p_account_id;

  SELECT COUNT(*)
  INTO v_awards
  FROM public.awards
  WHERE user_id = p_account_id;

  SELECT COALESCE(SUM(quantity), 0)
  INTO v_relics
  FROM public.relic_inventory
  WHERE user_id = p_account_id;

  v_snapshot := jsonb_build_object(
    'denarii', v_balance,
    'current_streak', v_current_streak,
    'longest_streak', v_longest_streak,
    'game_figs', v_game_figs,
    'quiz_figs', v_quiz_figs,
    'arena_figs', v_arena_figs,
    'awards', v_awards,
    'relics', v_relics,
    'source_role', v_source_role
  );

  INSERT INTO public.account_inheritances (
    departing_user_id,
    departing_display_name,
    heir_user_id,
    snapshot
  )
  VALUES (
    p_account_id,
    v_source.display_name,
    p_heir_id,
    v_snapshot
  )
  RETURNING id INTO v_inheritance_id;

  -- Preserve the full spendable balance without exposing financial history.
  IF v_balance <> 0 THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id,
      amount,
      source_type,
      source_reference,
      description
    )
    VALUES (
      p_heir_id,
      v_balance::integer,
      'admin_adjustment',
      'inheritance:' || v_inheritance_id::text,
      'Inherited from ' || v_source.display_name
    );
  END IF;

  -- Relic quantities merge when both accounts already own the same relic.
  INSERT INTO public.relic_inventory (
    user_id,
    relic_type_id,
    quantity,
    source_description
  )
  SELECT
    p_heir_id,
    relic_type_id,
    SUM(quantity)::integer,
    'Inherited from ' || v_source.display_name
  FROM public.relic_inventory
  WHERE user_id = p_account_id
  GROUP BY relic_type_id
  ON CONFLICT (user_id, relic_type_id)
  DO UPDATE SET
    quantity = public.relic_inventory.quantity + EXCLUDED.quantity,
    source_description = EXCLUDED.source_description;

  DELETE FROM public.relic_inventory
  WHERE user_id = p_account_id;

  -- Keep every distinct award, merging duplicate monthly award records.
  INSERT INTO public.awards (
    award_month,
    user_id,
    award_type,
    title,
    description,
    metric_value,
    award_target_type,
    award_target_id,
    created_at
  )
  SELECT
    award_month,
    p_heir_id,
    award_type,
    title,
    description,
    metric_value,
    award_target_type,
    CASE WHEN award_target_id = p_account_id THEN p_heir_id ELSE award_target_id END,
    created_at
  FROM public.awards
  WHERE user_id = p_account_id
  ON CONFLICT (award_month, user_id, award_type)
  DO UPDATE SET
    metric_value = GREATEST(
      COALESCE(public.awards.metric_value, 0),
      COALESCE(EXCLUDED.metric_value, 0)
    ),
    description = COALESCE(public.awards.description, EXCLUDED.description);

  DELETE FROM public.awards
  WHERE user_id = p_account_id;

  -- Preserve streak history and daily work. If both users have the same day,
  -- the completed/present version wins and authored text fills blank fields.
  UPDATE public.daily_records
  SET attendance_marked_by = NULL
  WHERE attendance_marked_by = p_account_id;

  INSERT INTO public.daily_records (
    user_id,
    record_date,
    day_type,
    attendance_status,
    attendance_marked_at,
    attendance_marked_by,
    meditation_submitted,
    meditation_submitted_at,
    meditation_text,
    quiz_attempt_id,
    streak_valid,
    created_at,
    best_verse,
    daily_quote,
    attendance_late
  )
  SELECT
    p_heir_id,
    record_date,
    day_type,
    attendance_status,
    attendance_marked_at,
    attendance_marked_by,
    meditation_submitted,
    meditation_submitted_at,
    meditation_text,
    quiz_attempt_id,
    streak_valid,
    created_at,
    best_verse,
    daily_quote,
    attendance_late
  FROM public.daily_records
  WHERE user_id = p_account_id
  ON CONFLICT (user_id, record_date)
  DO UPDATE SET
    attendance_status = CASE
      WHEN public.daily_records.attendance_status = 'present'
        OR EXCLUDED.attendance_status = 'present' THEN 'present'
      WHEN public.daily_records.attendance_status = 'absent'
        OR EXCLUDED.attendance_status = 'absent' THEN 'absent'
      ELSE 'unmarked'
    END,
    attendance_marked_at = COALESCE(
      public.daily_records.attendance_marked_at,
      EXCLUDED.attendance_marked_at
    ),
    meditation_submitted = COALESCE(public.daily_records.meditation_submitted, false)
      OR COALESCE(EXCLUDED.meditation_submitted, false),
    meditation_submitted_at = COALESCE(
      public.daily_records.meditation_submitted_at,
      EXCLUDED.meditation_submitted_at
    ),
    meditation_text = COALESCE(
      NULLIF(public.daily_records.meditation_text, ''),
      EXCLUDED.meditation_text
    ),
    quiz_attempt_id = COALESCE(
      public.daily_records.quiz_attempt_id,
      EXCLUDED.quiz_attempt_id
    ),
    streak_valid = COALESCE(public.daily_records.streak_valid, false)
      OR COALESCE(EXCLUDED.streak_valid, false),
    best_verse = COALESCE(
      NULLIF(public.daily_records.best_verse, ''),
      EXCLUDED.best_verse
    ),
    daily_quote = COALESCE(
      NULLIF(public.daily_records.daily_quote, ''),
      EXCLUDED.daily_quote
    ),
    attendance_late = COALESCE(public.daily_records.attendance_late, false)
      AND COALESCE(EXCLUDED.attendance_late, false);

  DELETE FROM public.daily_records
  WHERE user_id = p_account_id;

  -- Daily games have no per-user uniqueness constraint, so all attempts move.
  UPDATE public.game_attempts
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  -- Quiz attempts in a shared session merge their figs; otherwise the entire
  -- answer sheet and attempt move to the heir.
  UPDATE public.quiz_attempts heir_attempt
  SET
    talents_scored = COALESCE(heir_attempt.talents_scored, 0)
      + COALESCE(source_attempt.talents_scored, 0),
    highest_question_reached = GREATEST(
      COALESCE(heir_attempt.highest_question_reached, 0),
      COALESCE(source_attempt.highest_question_reached, 0)
    ),
    relics_used = COALESCE(heir_attempt.relics_used, '[]'::jsonb)
      || COALESCE(source_attempt.relics_used, '[]'::jsonb),
    submitted_at = GREATEST(
      heir_attempt.submitted_at,
      source_attempt.submitted_at
    )
  FROM public.quiz_attempts source_attempt
  WHERE heir_attempt.user_id = p_heir_id
    AND source_attempt.user_id = p_account_id
    AND heir_attempt.quiz_session_id = source_attempt.quiz_session_id;

  UPDATE public.daily_records daily
  SET quiz_attempt_id = heir_attempt.id
  FROM public.quiz_attempts source_attempt
  JOIN public.quiz_attempts heir_attempt
    ON heir_attempt.user_id = p_heir_id
   AND heir_attempt.quiz_session_id = source_attempt.quiz_session_id
  WHERE source_attempt.user_id = p_account_id
    AND daily.quiz_attempt_id = source_attempt.id;

  DELETE FROM public.quiz_attempts source_attempt
  WHERE source_attempt.user_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.quiz_attempts heir_attempt
      WHERE heir_attempt.user_id = p_heir_id
        AND heir_attempt.quiz_session_id = source_attempt.quiz_session_id
    );

  UPDATE public.quiz_attempts
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  UPDATE public.relic_usage_log
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  -- Arena figs merge when both users played in the same room.
  UPDATE public.arena_participants heir_participant
  SET
    score = heir_participant.score + source_participant.score,
    correct_count = heir_participant.correct_count + source_participant.correct_count,
    stake_paid = heir_participant.stake_paid OR source_participant.stake_paid,
    finished_at = GREATEST(
      heir_participant.finished_at,
      source_participant.finished_at
    )
  FROM public.arena_participants source_participant
  WHERE heir_participant.user_id = p_heir_id
    AND source_participant.user_id = p_account_id
    AND heir_participant.room_id = source_participant.room_id;

  DELETE FROM public.arena_participants source_participant
  WHERE source_participant.user_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.arena_participants heir_participant
      WHERE heir_participant.user_id = p_heir_id
        AND heir_participant.room_id = source_participant.room_id
    );

  UPDATE public.arena_participants
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  UPDATE public.arena_rooms
  SET
    creator_id = CASE WHEN creator_id = p_account_id THEN p_heir_id ELSE creator_id END,
    winner_id = CASE WHEN winner_id = p_account_id THEN p_heir_id ELSE winner_id END,
    closed_by = CASE WHEN closed_by = p_account_id THEN p_heir_id ELSE closed_by END,
    tagged_user_ids = array_replace(tagged_user_ids, p_account_id, p_heir_id)
  WHERE creator_id = p_account_id
    OR winner_id = p_account_id
    OR closed_by = p_account_id
    OR p_account_id = ANY(COALESCE(tagged_user_ids, '{}'::uuid[]));

  DELETE FROM public.arena_room_invites source_invite
  WHERE source_invite.invitee_id = p_account_id
    AND EXISTS (
      SELECT 1
      FROM public.arena_room_invites heir_invite
      WHERE heir_invite.room_id = source_invite.room_id
        AND heir_invite.invitee_id = p_heir_id
    );

  UPDATE public.arena_room_invites
  SET
    invitee_id = CASE WHEN invitee_id = p_account_id THEN p_heir_id ELSE invitee_id END,
    inviter_id = CASE WHEN inviter_id = p_account_id THEN p_heir_id ELSE inviter_id END
  WHERE invitee_id = p_account_id
    OR inviter_id = p_account_id;

  UPDATE public.streak_freezers
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  UPDATE public.streakboard_snapshots
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  UPDATE public.leaderboard_weekly_snapshots
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  UPDATE public.denarii_purchases
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  -- Resolve challenge-day conflicts before transferring submission history.
  UPDATE public.challenge_submissions heir_submission
  SET
    status = CASE
      WHEN source_submission.status = 'approved' THEN 'approved'
      ELSE heir_submission.status
    END,
    proof_text = COALESCE(
      NULLIF(heir_submission.proof_text, ''),
      source_submission.proof_text
    )
  FROM public.challenge_submissions source_submission
  WHERE heir_submission.user_id = p_heir_id
    AND source_submission.user_id = p_account_id
    AND heir_submission.narrative_date = source_submission.narrative_date
    AND heir_submission.status IN ('pending', 'approved')
    AND source_submission.status IN ('pending', 'approved');

  UPDATE public.challenge_submissions source_submission
  SET
    status = 'rejected',
    rejection_reason = COALESCE(
      source_submission.rejection_reason,
      'Merged into the nominated heir account.'
    )
  WHERE source_submission.user_id = p_account_id
    AND source_submission.status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1
      FROM public.challenge_submissions heir_submission
      WHERE heir_submission.user_id = p_heir_id
        AND heir_submission.narrative_date = source_submission.narrative_date
        AND heir_submission.status IN ('pending', 'approved')
    );

  UPDATE public.challenge_submissions
  SET user_id = p_heir_id
  WHERE user_id = p_account_id;

  -- Keep the strongest subscription period on the heir.
  IF EXISTS (
    SELECT 1 FROM public.subscriptions WHERE user_id = p_heir_id
  ) THEN
    UPDATE public.subscriptions heir_subscription
    SET
      status = CASE
        WHEN heir_subscription.status = 'active'
          OR source_subscription.status = 'active' THEN 'active'
        WHEN heir_subscription.status = 'trial'
          OR source_subscription.status = 'trial' THEN 'trial'
        ELSE heir_subscription.status
      END,
      trial_started_at = LEAST(
        heir_subscription.trial_started_at,
        source_subscription.trial_started_at
      ),
      trial_ends_at = GREATEST(
        heir_subscription.trial_ends_at,
        source_subscription.trial_ends_at
      ),
      current_period_end = GREATEST(
        heir_subscription.current_period_end,
        source_subscription.current_period_end
      ),
      updated_at = now()
    FROM public.subscriptions source_subscription
    WHERE heir_subscription.user_id = p_heir_id
      AND source_subscription.user_id = p_account_id;

    DELETE FROM public.subscriptions
    WHERE user_id = p_account_id;
  ELSE
    UPDATE public.subscriptions
    SET user_id = p_heir_id
    WHERE user_id = p_account_id;
  END IF;

  -- An instructor's nominated sentry becomes the new instructor so the
  -- platform is never left without an owner.
  IF v_source_role = 'instructor' THEN
    PERFORM public.promote_to_instructor(p_heir_id, p_account_id);
  END IF;

  -- Remove or detach governance references that would block Auth deletion.
  UPDATE public.tents
  SET sentry_id = NULL
  WHERE sentry_id = p_account_id;

  UPDATE public.role_assignments
  SET approver_id = NULL
  WHERE approver_id = p_account_id;

  UPDATE public.sentry_matricules
  SET created_by = NULL
  WHERE created_by = p_account_id;

  PERFORM public.notify_user(
    p_heir_id,
    p_account_id,
    'account_inheritance',
    'Account inheritance received',
    'You inherited the game resources of ' || v_source.display_name || '.',
    'settings',
    jsonb_build_object('inheritance_id', v_inheritance_id)
  );

  RETURN jsonb_build_object(
    'inheritance_id', v_inheritance_id,
    'heir_id', p_heir_id,
    'status', 'prepared',
    'snapshot', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_account_inheritance(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_account_inheritance(uuid, uuid)
  TO service_role;

GRANT SELECT ON public.account_inheritances TO authenticated;

