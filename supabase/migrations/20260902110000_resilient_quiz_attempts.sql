/* Keep quiz attempts alive through phone sleep, app switching, temporary
   connectivity loss, and inaccurate device clocks. */

CREATE OR REPLACE FUNCTION public.get_my_quiz_runtime_state(
  p_quiz_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.quiz_sessions%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_attempt_found boolean := false;
  v_lazarus_active boolean := false;
  v_server_now timestamptz := clock_timestamp();
  v_effective_closes_at timestamptz;
  v_lazarus_opens_at timestamptz;
  v_lazarus_closes_at timestamptz;
  v_can_play boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz session not found.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id
    AND quiz_session_id = p_quiz_session_id;
  v_attempt_found := FOUND;

  IF v_attempt_found THEN
    v_lazarus_active := EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(v_attempt.relics_used, '[]'::jsonb)) used
      WHERE used->>'slug' = 'lazarus-coin'
    );
  END IF;

  v_lazarus_opens_at := v_session.session_date::timestamp AT TIME ZONE 'Africa/Douala';
  v_lazarus_closes_at := (v_session.session_date + time '14:45') AT TIME ZONE 'Africa/Douala';
  v_effective_closes_at := CASE
    WHEN v_session.quiz_type = 'saturday' AND v_lazarus_active
      THEN greatest(v_session.live_closes_at, v_lazarus_closes_at)
    ELSE v_session.live_closes_at
  END;

  v_can_play := v_attempt_found
    AND v_attempt.status = 'in_progress'
    AND v_session.status <> 'scheduled'
    AND (
      (
        v_server_now >= v_session.live_opens_at
        AND v_server_now < v_session.live_closes_at
      )
      OR (
        v_session.quiz_type = 'saturday'
        AND v_lazarus_active
        AND v_server_now >= v_lazarus_opens_at
        AND v_server_now < v_lazarus_closes_at
      )
    );

  RETURN jsonb_build_object(
    'server_now', v_server_now,
    'effective_closes_at', v_effective_closes_at,
    'can_play', v_can_play,
    'attempt', CASE WHEN v_attempt_found THEN to_jsonb(v_attempt) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_quiz_runtime_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_quiz_runtime_state(uuid) TO authenticated;

/* A client may display a timer, but only the database clock may end it. */
CREATE OR REPLACE FUNCTION public.prevent_early_quiz_timeout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_effective_closes_at timestamptz;
  v_lazarus_active boolean := false;
BEGIN
  IF NEW.status <> 'timed_out' OR OLD.status <> 'in_progress' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = NEW.quiz_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz session not found.';
  END IF;

  v_lazarus_active := EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(NEW.relics_used, '[]'::jsonb)) used
    WHERE used->>'slug' = 'lazarus-coin'
  );
  v_effective_closes_at := CASE
    WHEN v_session.quiz_type = 'saturday' AND v_lazarus_active
      THEN greatest(
        v_session.live_closes_at,
        (v_session.session_date + time '14:45') AT TIME ZONE 'Africa/Douala'
      )
    ELSE v_session.live_closes_at
  END;

  IF clock_timestamp() < v_effective_closes_at THEN
    RAISE EXCEPTION 'Quiz time is still running. Your attempt remains open.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_early_quiz_timeout ON public.quiz_attempts;
CREATE TRIGGER trg_prevent_early_quiz_timeout
BEFORE UPDATE OF status ON public.quiz_attempts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_early_quiz_timeout();

REVOKE ALL ON FUNCTION public.prevent_early_quiz_timeout() FROM PUBLIC, anon, authenticated;

/* Older bundles called this RPC when the browser merely hid the page. Keep
   the signature for compatibility, but refuse to destroy an active attempt. */
CREATE OR REPLACE FUNCTION public.forfeit_quiz_attempt(p_attempt_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.quiz_attempts
    WHERE id = p_attempt_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Quiz attempt not found.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.quiz_attempts
    WHERE id = p_attempt_id
      AND user_id = auth.uid()
      AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Backgrounding the app does not forfeit a quiz attempt.';
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.forfeit_quiz_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forfeit_quiz_attempt(uuid) TO authenticated;

/* Reopen attempts that a legacy client ended while server time is still
   available. This is idempotent and also clears any premature settlement. */
CREATE TEMP TABLE quiz_attempts_to_resume ON COMMIT DROP AS
SELECT
  attempt.id AS attempt_id,
  attempt.user_id,
  session.id AS quiz_session_id,
  CASE
    WHEN session.quiz_type = 'saturday'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(attempt.relics_used, '[]'::jsonb)) used
        WHERE used->>'slug' = 'lazarus-coin'
      )
      THEN greatest(
        session.live_closes_at,
        (session.session_date + time '14:45') AT TIME ZONE 'Africa/Douala'
      )
    ELSE session.live_closes_at
  END AS effective_closes_at
FROM public.quiz_attempts attempt
JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
WHERE attempt.status IN ('forfeited', 'timed_out');

DELETE FROM public.denarii_ledger_entries entry
USING quiz_attempts_to_resume candidate
WHERE candidate.attempt_id::text = entry.source_reference
  AND candidate.user_id = entry.user_id
  AND candidate.effective_closes_at > clock_timestamp()
  AND entry.source_type IN ('quiz_reward', 'fortune_quiz_reward');

DELETE FROM public.weekly_quiz_result_releases pending
USING quiz_attempts_to_resume candidate
WHERE pending.attempt_id = candidate.attempt_id
  AND candidate.effective_closes_at > clock_timestamp();

UPDATE public.quiz_attempts attempt
SET status = 'in_progress',
    talents_scored = 0,
    submitted_at = NULL,
    forfeited_at = NULL
FROM quiz_attempts_to_resume candidate
WHERE attempt.id = candidate.attempt_id
  AND candidate.effective_closes_at > clock_timestamp();

/* Every forfeiture in the current client was automatic. Recover closed
   attempts from the latest Saturday quiz using only answers already saved. */
CREATE TEMP TABLE quiz_false_forfeit_recovery ON COMMIT DROP AS
WITH latest_quiz_day AS (
  SELECT max(session.session_date) AS session_date
  FROM public.quiz_sessions session
  WHERE session.quiz_type = 'saturday'
    AND session.session_date <= timezone('Africa/Douala', clock_timestamp())::date
), candidates AS (
  SELECT
    attempt.id AS attempt_id,
    attempt.user_id,
    session.id AS quiz_session_id,
    session.session_date,
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
  JOIN latest_quiz_day latest ON latest.session_date = session.session_date
  WHERE session.quiz_type = 'saturday'
    AND attempt.status = 'forfeited'
    AND clock_timestamp() >= greatest(
      session.live_closes_at,
      CASE WHEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(attempt.relics_used, '[]'::jsonb)) used
        WHERE used->>'slug' = 'lazarus-coin'
      ) THEN (session.session_date + time '14:45') AT TIME ZONE 'Africa/Douala'
      ELSE session.live_closes_at END
    )
), scored AS (
  SELECT
    candidate.attempt_id,
    candidate.user_id,
    candidate.quiz_session_id,
    candidate.session_date,
    candidate.release_at,
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
    END AS figs_earned,
    candidate.reward_perfect,
    candidate.reward_partial
  FROM candidates candidate
  JOIN public.generated_questions question
    ON question.quiz_session_id = candidate.quiz_session_id
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id
    AND response.quiz_attempt_id = candidate.attempt_id
  GROUP BY
    candidate.attempt_id,
    candidate.user_id,
    candidate.quiz_session_id,
    candidate.session_date,
    candidate.release_at,
    candidate.used_goliath,
    candidate.reward_perfect,
    candidate.reward_partial
)
SELECT
  scored.*,
  scored.correct_count = scored.question_count AS perfect,
  CASE
    WHEN scored.correct_count = scored.question_count THEN coalesce(scored.reward_perfect, 6000)
    WHEN scored.correct_count > 0 THEN coalesce(scored.reward_partial, 1000)
    ELSE 0
  END::integer AS denarii_award
FROM scored
WHERE scored.question_count > 0;

UPDATE public.quiz_attempts attempt
SET status = 'timed_out',
    talents_scored = 0,
    highest_question_reached = greatest(attempt.highest_question_reached, recovery.question_count),
    submitted_at = coalesce(attempt.submitted_at, attempt.forfeited_at, clock_timestamp()),
    forfeited_at = NULL
FROM quiz_false_forfeit_recovery recovery
WHERE attempt.id = recovery.attempt_id;

INSERT INTO public.weekly_quiz_result_releases(
  attempt_id, user_id, quiz_session_id, correct_count, question_count,
  figs_earned, perfect, denarii_award, release_at
)
SELECT
  attempt_id, user_id, quiz_session_id, correct_count, question_count,
  figs_earned, perfect, denarii_award, release_at
FROM quiz_false_forfeit_recovery
ON CONFLICT (attempt_id) DO UPDATE
SET correct_count = EXCLUDED.correct_count,
    question_count = EXCLUDED.question_count,
    figs_earned = EXCLUDED.figs_earned,
    perfect = EXCLUDED.perfect,
    denarii_award = EXCLUDED.denarii_award,
    release_at = EXCLUDED.release_at,
    released_at = NULL;

INSERT INTO public.daily_records(
  user_id, record_date, day_type, quiz_attempt_id, streak_valid
)
SELECT user_id, session_date, 'saturday', attempt_id, true
FROM quiz_false_forfeit_recovery
ON CONFLICT (user_id, record_date) DO UPDATE
SET quiz_attempt_id = EXCLUDED.quiz_attempt_id,
    streak_valid = true;

SELECT public.release_due_weekly_quiz_results();

DO $$
DECLARE
  recovered record;
BEGIN
  FOR recovered IN
    SELECT DISTINCT user_id FROM quiz_false_forfeit_recovery
  LOOP
    PERFORM public.refresh_user_streak_snapshot(recovered.user_id);
  END LOOP;
END;
$$;
