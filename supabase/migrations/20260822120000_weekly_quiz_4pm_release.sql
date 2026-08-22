/* Seal Saturday quiz scores and rewards until 4:00 PM Africa/Douala, then
   release a private participant result and settle denarii atomically. */

CREATE TABLE IF NOT EXISTS public.weekly_quiz_result_releases (
  attempt_id uuid PRIMARY KEY REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_session_id uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  correct_count integer NOT NULL CHECK (correct_count >= 0),
  question_count integer NOT NULL CHECK (question_count > 0),
  figs_earned integer NOT NULL CHECK (figs_earned >= 0),
  perfect boolean NOT NULL DEFAULT false,
  denarii_award integer NOT NULL CHECK (denarii_award >= 0),
  release_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, quiz_session_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_quiz_result_releases_due
  ON public.weekly_quiz_result_releases(release_at)
  WHERE released_at IS NULL;

ALTER TABLE public.weekly_quiz_result_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.weekly_quiz_result_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.weekly_quiz_result_releases TO service_role;

CREATE OR REPLACE FUNCTION public.release_due_weekly_quiz_results(
  p_attempt_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending public.weekly_quiz_result_releases%ROWTYPE;
  v_released integer := 0;
BEGIN
  FOR v_pending IN
    SELECT pending.*
    FROM public.weekly_quiz_result_releases pending
    WHERE pending.released_at IS NULL
      AND pending.release_at <= now()
      AND (p_attempt_id IS NULL OR pending.attempt_id = p_attempt_id)
    ORDER BY pending.release_at, pending.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.quiz_attempts
    SET talents_scored = v_pending.figs_earned
    WHERE id = v_pending.attempt_id
      AND user_id = v_pending.user_id
      AND status IN ('submitted', 'timed_out');

    IF FOUND THEN
      IF v_pending.denarii_award > 0
        AND NOT EXISTS (
          SELECT 1
          FROM public.denarii_ledger_entries entry
          WHERE entry.user_id = v_pending.user_id
            AND entry.source_type = 'quiz_reward'
            AND entry.source_reference = v_pending.attempt_id::text
        ) THEN
        INSERT INTO public.denarii_ledger_entries(
          user_id, amount, source_type, source_reference, description
        ) VALUES (
          v_pending.user_id,
          v_pending.denarii_award,
          'quiz_reward',
          v_pending.attempt_id::text,
          (CASE WHEN v_pending.perfect
            THEN 'Perfect weekly quiz score'
            ELSE v_pending.correct_count || '/' || v_pending.question_count || ' correct'
          END) || ' · ' || v_pending.figs_earned || ' figs · released at 4:00 PM'
        );
      END IF;

      UPDATE public.weekly_quiz_result_releases
      SET released_at = now()
      WHERE attempt_id = v_pending.attempt_id;
      v_released := v_released + 1;
    END IF;
  END LOOP;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_due_weekly_quiz_results(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_due_weekly_quiz_results(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt_secure(
  p_attempt_id uuid,
  p_status text DEFAULT 'submitted',
  p_use_goliath boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_figs integer := 0;
  v_reward integer := 0;
  v_perfect boolean := false;
  v_source_type text;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_day_type text;
  v_release_at timestamptz;
  v_results_released boolean := true;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_status NOT IN ('submitted', 'timed_out') THEN RAISE EXCEPTION 'Invalid completion status.'; END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz attempt not found.'; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  IF v_session.quiz_type = 'saturday' THEN
    v_release_at := (v_session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala';
    v_results_released := now() >= v_release_at;
  END IF;

  IF v_attempt.status IN ('submitted', 'timed_out') THEN
    IF v_session.quiz_type = 'saturday' AND v_results_released THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'attempt', to_jsonb(v_attempt),
      'already_submitted', true,
      'results_released', v_results_released,
      'release_at', v_release_at
    );
  END IF;
  IF v_attempt.status <> 'in_progress' THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE public.quiz_answer_is_correct(response.answer, question.question_payload)
    )::integer,
    coalesce(sum(CASE
      WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
        AND NOT coalesce(response.assisted_by_relic, false)
      THEN CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END
      ELSE 0
    END), 0)::integer
  INTO v_question_count, v_correct_count, v_figs
  FROM public.generated_questions question
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id
    AND response.quiz_attempt_id = v_attempt.id
  WHERE question.quiz_session_id = v_attempt.quiz_session_id;
  IF v_question_count = 0 THEN RAISE EXCEPTION 'This quiz has no questions.'; END IF;

  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory
    FROM public.relic_inventory
    WHERE user_id = v_user_id
      AND relic_type_id = v_relic.id
      AND quantity > 0
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;

    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, quiz_attempt_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_attempt.id, v_relic.id, 'perfect_quiz');
    v_correct_count := v_question_count;
    v_figs := 0;
  END IF;

  v_perfect := v_correct_count = v_question_count;
  v_reward := CASE
    WHEN v_perfect THEN coalesce(v_session.reward_perfect, 6000)
    WHEN v_correct_count > 0 THEN coalesce(v_session.reward_partial, 1000)
    ELSE 0
  END;
  v_source_type := CASE
    WHEN v_session.quiz_type = 'fortune' THEN 'fortune_quiz_reward'
    ELSE 'quiz_reward'
  END;

  UPDATE public.quiz_attempts
  SET status = p_status,
      talents_scored = CASE WHEN v_session.quiz_type = 'saturday' THEN 0 ELSE v_figs END,
      highest_question_reached = greatest(highest_question_reached, v_question_count),
      submitted_at = now(),
      relics_used = CASE WHEN p_use_goliath
        THEN coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('slug', 'sword-goliath', 'used_at', now())
        )
        ELSE relics_used
      END
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_session.quiz_type = 'saturday' THEN
    INSERT INTO public.weekly_quiz_result_releases(
      attempt_id, user_id, quiz_session_id, correct_count, question_count,
      figs_earned, perfect, denarii_award, release_at
    ) VALUES (
      v_attempt.id, v_user_id, v_session.id, v_correct_count, v_question_count,
      v_figs, v_perfect, v_reward, v_release_at
    )
    ON CONFLICT (attempt_id) DO UPDATE
      SET correct_count = EXCLUDED.correct_count,
          question_count = EXCLUDED.question_count,
          figs_earned = EXCLUDED.figs_earned,
          perfect = EXCLUDED.perfect,
          denarii_award = EXCLUDED.denarii_award,
          release_at = EXCLUDED.release_at,
          released_at = NULL;

    IF v_results_released THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    END IF;
  ELSIF v_reward > 0 AND NOT EXISTS (
    SELECT 1
    FROM public.denarii_ledger_entries
    WHERE user_id = v_user_id
      AND source_type = v_source_type
      AND source_reference = v_attempt.id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries(
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id,
      v_reward,
      v_source_type,
      v_attempt.id::text,
      (CASE WHEN v_perfect
        THEN 'Perfect quiz score'
        ELSE v_correct_count || '/' || v_question_count || ' correct'
      END) || ' · ' || v_figs || ' figs'
    );
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM v_session.session_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_session.session_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  INSERT INTO public.daily_records(user_id, record_date, day_type, quiz_attempt_id, streak_valid)
  VALUES (
    v_user_id,
    v_session.session_date,
    v_day_type,
    v_attempt.id,
    CASE WHEN v_day_type = 'saturday' THEN true ELSE NULL END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE
    SET quiz_attempt_id = EXCLUDED.quiz_attempt_id,
        streak_valid = CASE
          WHEN EXCLUDED.day_type = 'saturday' THEN true
          ELSE public.daily_records.streak_valid
        END;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'attempt', to_jsonb(v_attempt),
    'results_released', v_results_released,
    'release_at', v_release_at,
    'correct_count', CASE WHEN v_results_released THEN v_correct_count ELSE NULL END,
    'question_count', CASE WHEN v_results_released THEN v_question_count ELSE NULL END,
    'figs', CASE WHEN v_results_released THEN v_figs ELSE NULL END,
    'perfect', CASE WHEN v_results_released THEN v_perfect ELSE NULL END,
    'denarii_awarded', CASE WHEN v_results_released THEN v_reward ELSE NULL END
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_attempt_secure(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt_secure(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_weekly_quiz_result(p_quiz_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_pending public.weekly_quiz_result_releases%ROWTYPE;
  v_release_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id;
  IF NOT FOUND OR v_session.quiz_type <> 'saturday' THEN RETURN NULL; END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id
    AND quiz_session_id = p_quiz_session_id;
  IF NOT FOUND OR v_attempt.status NOT IN ('submitted', 'timed_out') THEN RETURN NULL; END IF;

  v_release_at := (v_session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala';
  IF now() < v_release_at THEN
    RETURN jsonb_build_object('released', false, 'release_at', v_release_at);
  END IF;

  PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
  SELECT * INTO v_pending
  FROM public.weekly_quiz_result_releases
  WHERE attempt_id = v_attempt.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'released', v_pending.released_at IS NOT NULL,
    'release_at', v_pending.release_at,
    'released_at', v_pending.released_at,
    'correct_count', v_pending.correct_count,
    'question_count', v_pending.question_count,
    'figs_earned', v_pending.figs_earned,
    'perfect', v_pending.perfect,
    'denarii_awarded', v_pending.denarii_award
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_weekly_quiz_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_weekly_quiz_result(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_quiz_attempt(p_quiz_session_id uuid)
RETURNS public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_release_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id
    AND quiz_session_id = p_quiz_session_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id;

  IF coalesce(v_session.quiz_type, 'saturday') = 'saturday'
    AND v_attempt.status IN ('submitted', 'timed_out') THEN
    v_release_at := (v_session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala';
    IF now() >= v_release_at THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    ELSE
      v_attempt.talents_scored := 0;
    END IF;
  END IF;

  RETURN v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_quiz_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_quiz_attempt(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_quiz_questions_for_play(p_quiz_session_id uuid)
RETURNS TABLE (
  id uuid,
  quiz_session_id uuid,
  question_index integer,
  source_narrative_date date,
  difficulty_tag text,
  mechanic_type text,
  recycled_from_game boolean,
  question_payload jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.quiz_sessions%ROWTYPE;
  v_can_see_answers boolean := false;
  v_is_participant boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE quiz_sessions.id = p_quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  v_is_participant := EXISTS (
    SELECT 1
    FROM public.role_assignments role
    WHERE role.user_id = v_user_id
      AND role.role IN ('cadet', 'sentry')
      AND role.status IN ('active', 'approved')
  );
  IF NOT v_is_participant AND NOT public.is_instructor(v_user_id) THEN
    RAISE EXCEPTION 'This account cannot access quiz questions.';
  END IF;

  v_can_see_answers := public.is_instructor(v_user_id) OR EXISTS (
    SELECT 1
    FROM public.quiz_attempts attempt
    WHERE attempt.user_id = v_user_id
      AND attempt.quiz_session_id = p_quiz_session_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (
        v_session.quiz_type <> 'saturday'
        OR timezone('Africa/Douala', now()) >= v_session.session_date::timestamp + time '16:00'
      )
  );

  RETURN QUERY
  SELECT
    question.id,
    question.quiz_session_id,
    question.question_index,
    question.source_narrative_date,
    question.difficulty_tag,
    question.mechanic_type,
    question.recycled_from_game,
    CASE WHEN v_can_see_answers THEN question.question_payload ELSE
      question.question_payload - ARRAY[
        'correct_answer', 'accepted_answers', 'explanation', 'reference',
        'answer', 'solution', 'correct_order', 'blanks', 'pairs',
        'sort_items', 'grid_items', 'answer_key'
      ]::text[]
    END,
    question.created_at
  FROM public.generated_questions question
  WHERE question.quiz_session_id = p_quiz_session_id
  ORDER BY question.question_index;
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_questions_for_play(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions_for_play(uuid) TO authenticated;

DROP POLICY IF EXISTS "read_quiz_attempts" ON public.quiz_attempts;
CREATE POLICY "read_quiz_attempts"
ON public.quiz_attempts FOR SELECT TO authenticated
USING (
  public.is_instructor(auth.uid())
  OR (
    user_id = auth.uid()
    AND (
      status IN ('not_started', 'in_progress')
      OR EXISTS (
        SELECT 1
        FROM public.quiz_sessions session
        WHERE session.id = quiz_attempts.quiz_session_id
          AND (
            coalesce(session.quiz_type, 'saturday') <> 'saturday'
            OR timezone('Africa/Douala', now()) >= session.session_date::timestamp + time '16:00'
          )
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.clear_pending_weekly_quiz_result_on_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IN ('submitted', 'timed_out', 'forfeited') THEN
    DELETE FROM public.weekly_quiz_result_releases WHERE attempt_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_pending_weekly_quiz_result_on_reopen ON public.quiz_attempts;
CREATE TRIGGER trg_clear_pending_weekly_quiz_result_on_reopen
AFTER UPDATE OF status ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.clear_pending_weekly_quiz_result_on_reopen();

REVOKE ALL ON FUNCTION public.clear_pending_weekly_quiz_result_on_reopen() FROM PUBLIC, anon, authenticated;

-- Capture any answers submitted earlier today before this migration arrived.
WITH candidates AS (
  SELECT
    attempt.id AS attempt_id,
    attempt.user_id,
    session.id AS quiz_session_id,
    session.reward_perfect,
    session.reward_partial,
    (session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala' AS release_at,
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(attempt.relics_used, '[]'::jsonb)) used
      WHERE used->>'slug' = 'sword-goliath'
    ) AS used_goliath
  FROM public.quiz_attempts attempt
  JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
  WHERE session.quiz_type = 'saturday'
    AND session.session_date = timezone('Africa/Douala', now())::date
    AND attempt.status IN ('submitted', 'timed_out')
    AND now() < (session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala'
), scored AS (
  SELECT
    candidate.attempt_id,
    candidate.user_id,
    candidate.quiz_session_id,
    candidate.release_at,
    candidate.reward_perfect,
    candidate.reward_partial,
    count(question.id)::integer AS question_count,
    CASE WHEN candidate.used_goliath THEN count(question.id)::integer ELSE
      count(question.id) FILTER (
        WHERE public.quiz_answer_is_correct(response.answer, question.question_payload)
      )::integer
    END AS correct_count,
    CASE WHEN candidate.used_goliath THEN 0 ELSE
      coalesce(sum(CASE
        WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
          AND NOT coalesce(response.assisted_by_relic, false)
        THEN CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END
        ELSE 0
      END), 0)::integer
    END AS figs_earned
  FROM candidates candidate
  JOIN public.generated_questions question
    ON question.quiz_session_id = candidate.quiz_session_id
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id
    AND response.quiz_attempt_id = candidate.attempt_id
  GROUP BY
    candidate.attempt_id, candidate.user_id, candidate.quiz_session_id,
    candidate.release_at, candidate.reward_perfect, candidate.reward_partial,
    candidate.used_goliath
), prepared AS (
  SELECT
    scored.*,
    scored.correct_count = scored.question_count AS perfect,
    CASE
      WHEN scored.correct_count = scored.question_count THEN coalesce(scored.reward_perfect, 6000)
      WHEN scored.correct_count > 0 THEN coalesce(scored.reward_partial, 1000)
      ELSE 0
    END::integer AS denarii_award
  FROM scored
  WHERE scored.question_count > 0
)
INSERT INTO public.weekly_quiz_result_releases(
  attempt_id, user_id, quiz_session_id, correct_count, question_count,
  figs_earned, perfect, denarii_award, release_at
)
SELECT
  attempt_id, user_id, quiz_session_id, correct_count, question_count,
  figs_earned, perfect, denarii_award, release_at
FROM prepared
ON CONFLICT (attempt_id) DO UPDATE
SET correct_count = EXCLUDED.correct_count,
    question_count = EXCLUDED.question_count,
    figs_earned = EXCLUDED.figs_earned,
    perfect = EXCLUDED.perfect,
    denarii_award = EXCLUDED.denarii_award,
    release_at = EXCLUDED.release_at,
    released_at = NULL;

DELETE FROM public.denarii_ledger_entries entry
USING public.weekly_quiz_result_releases pending
WHERE pending.attempt_id::text = entry.source_reference
  AND pending.user_id = entry.user_id
  AND pending.released_at IS NULL
  AND entry.source_type = 'quiz_reward';

UPDATE public.quiz_attempts attempt
SET talents_scored = 0
FROM public.weekly_quiz_result_releases pending
WHERE pending.attempt_id = attempt.id
  AND pending.released_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-weekly-quiz-results')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-weekly-quiz-results');
    -- Supabase cron uses UTC. 15:00 UTC is 4:00 PM in Africa/Douala.
    PERFORM cron.schedule(
      'full-circle-weekly-quiz-results',
      '*/5 15 * * 6',
      $job$SELECT public.release_due_weekly_quiz_results();$job$
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
  NULL;
END;
$$;

-- Also settle immediately when a migration is applied after the release time.
SELECT public.release_due_weekly_quiz_results();
