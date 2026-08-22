/* Make quiz launch/deletion authoritative, reduce signed-in startup requests,
   and preserve the two streak corrections verified for this release. */

CREATE OR REPLACE FUNCTION public.get_my_app_bootstrap()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    ELSE jsonb_build_object(
      'profile', (
        SELECT to_jsonb(profile)
        FROM public.profiles profile
        WHERE profile.id = auth.uid()
      ),
      'role_assignment', (
        SELECT to_jsonb(assignment) || jsonb_build_object(
          'id', coalesce(to_jsonb(assignment)->>'id', 'role-' || assignment.user_id::text)
        )
        FROM public.role_assignments assignment
        WHERE assignment.user_id = auth.uid()
          AND assignment.status IN ('active', 'approved')
        ORDER BY
          CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
          CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
          assignment.start_date DESC NULLS LAST
        LIMIT 1
      )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.get_my_app_bootstrap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_bootstrap() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_current_quiz_session()
RETURNS public.quiz_sessions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT session
  FROM public.quiz_sessions session
  ORDER BY
    CASE
      WHEN session.status <> 'scheduled'
        AND now() < session.live_closes_at THEN 0
      WHEN session.status = 'scheduled'
        AND session.session_date >= timezone('Africa/Douala', now())::date THEN 1
      ELSE 2
    END,
    CASE WHEN session.status <> 'scheduled' THEN session.live_opens_at END DESC NULLS LAST,
    session.session_date DESC,
    session.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_quiz_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_quiz_session() TO authenticated;

ALTER TABLE public.quiz_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_sessions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.launch_quiz_session(p_quiz_session_id uuid)
RETURNS public.quiz_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_question_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can launch a quiz.';
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  SELECT count(*)::integer INTO v_question_count
  FROM public.generated_questions
  WHERE quiz_session_id = p_quiz_session_id;
  IF v_question_count = 0 THEN
    RAISE EXCEPTION 'Add at least one playable question before launch.';
  END IF;
  IF v_session.live_closes_at <= now() THEN
    RAISE EXCEPTION 'This quiz schedule has already ended. Choose a new start time.';
  END IF;

  UPDATE public.quiz_sessions
  SET countdown_opens_at = least(now(), live_opens_at),
      status = CASE WHEN now() >= live_opens_at THEN 'live' ELSE 'countdown' END
  WHERE id = p_quiz_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.launch_quiz_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.launch_quiz_session(uuid) TO authenticated;

/* Keep direct RPC callers behind the same launch boundary as the interface. */
CREATE OR REPLACE FUNCTION public.start_quiz_attempt(p_quiz_session_id uuid)
RETURNS public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.quiz_sessions%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_question_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments role
    WHERE role.user_id = v_user_id
      AND role.role IN ('cadet', 'sentry')
      AND role.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only cadets and sentries can take this quiz.';
  END IF;

  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = p_quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;
  IF v_session.status = 'scheduled' THEN
    RAISE EXCEPTION 'The instructor has not launched this quiz yet.';
  END IF;

  SELECT count(*) INTO v_question_count
  FROM public.generated_questions
  WHERE quiz_session_id = p_quiz_session_id;
  IF v_question_count = 0 THEN
    RAISE EXCEPTION 'This quiz has no questions and cannot be started.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.generated_questions question
    WHERE question.quiz_session_id = p_quiz_session_id
      AND coalesce(question.question_payload->>'type', question.mechanic_type, '')
        NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'spot_error', 'standard_text', 'scriptorium', 'order_sequence')
  ) THEN
    RAISE EXCEPTION 'This quiz contains a question type that is not ready for reliable play. Ask the instructor to edit it before launch.';
  END IF;
  IF now() < v_session.live_opens_at OR now() >= v_session.live_closes_at THEN
    RAISE EXCEPTION 'This quiz is not currently open.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id AND quiz_session_id = p_quiz_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempt.status IN ('submitted', 'timed_out', 'forfeited') THEN
      RAISE EXCEPTION 'This attempt has already ended.';
    END IF;
    UPDATE public.quiz_attempts
    SET status = 'in_progress', highest_question_reached = greatest(highest_question_reached, 1)
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  ELSE
    INSERT INTO public.quiz_attempts(user_id, quiz_session_id, status, highest_question_reached)
    VALUES (v_user_id, p_quiz_session_id, 'in_progress', 1)
    RETURNING * INTO v_attempt;
  END IF;

  RETURN v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.start_quiz_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_quiz_attempt(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_quiz_session_cascade(p_quiz_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_attempt_ids uuid[] := ARRAY[]::uuid[];
  v_attempt_count integer := 0;
  v_ledger_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can delete a quiz.';
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  SELECT coalesce(array_agg(attempt.id), ARRAY[]::uuid[]), count(*)::integer
  INTO v_attempt_ids, v_attempt_count
  FROM public.quiz_attempts attempt
  WHERE attempt.quiz_session_id = p_quiz_session_id;

  IF cardinality(v_attempt_ids) > 0 THEN
    UPDATE public.daily_records record
    SET quiz_attempt_id = NULL,
        streak_valid = CASE WHEN record.day_type = 'saturday' THEN false ELSE record.streak_valid END
    WHERE record.quiz_attempt_id = ANY(v_attempt_ids);

    DELETE FROM public.denarii_ledger_entries entry
    WHERE entry.source_type IN ('quiz_reward', 'fortune_quiz_reward')
      AND EXISTS (
        SELECT 1 FROM unnest(v_attempt_ids) attempt_id
        WHERE entry.source_reference = attempt_id::text
      );
    GET DIAGNOSTICS v_ledger_count = ROW_COUNT;
  END IF;

  DELETE FROM public.user_notifications notification
  WHERE notification.metadata->>'quiz_session_id' = p_quiz_session_id::text;

  DELETE FROM public.quiz_sessions WHERE id = p_quiz_session_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'quiz_session_id', p_quiz_session_id,
    'attempts_deleted', v_attempt_count,
    'reward_entries_reversed', v_ledger_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_quiz_session_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quiz_session_cascade(uuid) TO authenticated;

/* Vedette's verified current value is 25. Anchor it today so older zero/one
   snapshots cannot supersede it on another person's view. */
INSERT INTO public.streak_manual_adjustments(
  user_id, effective_date, current_streak, longest_streak, reason
)
SELECT
  profile.id,
  timezone('Africa/Douala', now())::date,
  greatest(25, coalesce(adjustment.current_streak, 0), coalesce(strict.current_streak, 0)),
  greatest(25, coalesce(adjustment.longest_streak, 0), coalesce(strict.longest_streak, 0)),
  'Preserved verified Vedette 25-day streak after an erroneous one-day recalculation'
FROM public.profiles profile
LEFT JOIN public.streak_manual_adjustments adjustment ON adjustment.user_id = profile.id
LEFT JOIN LATERAL public.compute_strict_streak(profile.id) strict ON true
WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g')
  IN ('vedette', 'sentinelvedette')
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = greatest(public.streak_manual_adjustments.current_streak, EXCLUDED.current_streak),
    longest_streak = greatest(public.streak_manual_adjustments.longest_streak, EXCLUDED.longest_streak),
    reason = EXCLUDED.reason;

/* Courage completed yesterday but the day was omitted from the visible chain.
   Resume from the latest positive published state and preserve any stronger
   live/manual value already present when this migration runs. */
WITH target AS (
  SELECT profile.id
  FROM public.profiles profile
  WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
    AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
), repaired AS (
  SELECT
    target.id AS user_id,
    timezone('Africa/Douala', now())::date AS effective_date,
    greatest(
      coalesce(strict.current_streak, 0),
      coalesce(adjustment.current_streak, 0),
      coalesce(snapshot.current_streak, 0) + CASE
        WHEN public.streak_requirement_met(target.id, timezone('Africa/Douala', now())::date - 1)
          AND (snapshot.snapshot_date IS NULL OR snapshot.snapshot_date < timezone('Africa/Douala', now())::date - 1)
        THEN 1 ELSE 0 END,
      CASE WHEN public.streak_requirement_met(target.id, timezone('Africa/Douala', now())::date - 1) THEN 1 ELSE 0 END
    )::integer AS current_streak,
    greatest(
      coalesce(strict.longest_streak, 0),
      coalesce(adjustment.longest_streak, 0),
      coalesce(snapshot.longest_streak, 0),
      coalesce(snapshot.current_streak, 0) + CASE
        WHEN public.streak_requirement_met(target.id, timezone('Africa/Douala', now())::date - 1)
          AND (snapshot.snapshot_date IS NULL OR snapshot.snapshot_date < timezone('Africa/Douala', now())::date - 1)
        THEN 1 ELSE 0 END
    )::integer AS longest_streak
  FROM target
  LEFT JOIN public.streak_manual_adjustments adjustment ON adjustment.user_id = target.id
  LEFT JOIN LATERAL public.compute_strict_streak(target.id) strict ON true
  LEFT JOIN LATERAL (
    SELECT published.snapshot_date, published.current_streak, published.longest_streak
    FROM public.streakboard_snapshots published
    WHERE published.user_id = target.id
      AND published.snapshot_date < timezone('Africa/Douala', now())::date
      AND coalesce(published.current_streak, 0) > 0
    ORDER BY published.snapshot_date DESC, published.created_at DESC
    LIMIT 1
  ) snapshot ON true
)
INSERT INTO public.streak_manual_adjustments(
  user_id, effective_date, current_streak, longest_streak, reason
)
SELECT
  repaired.user_id,
  repaired.effective_date,
  repaired.current_streak,
  greatest(repaired.longest_streak, repaired.current_streak),
  'Restored Courage Webnjoh streak after a completed day was omitted'
FROM repaired
WHERE repaired.current_streak > 0
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = greatest(public.streak_manual_adjustments.current_streak, EXCLUDED.current_streak),
    longest_streak = greatest(public.streak_manual_adjustments.longest_streak, EXCLUDED.longest_streak),
    reason = EXCLUDED.reason;

INSERT INTO public.streakboard_snapshots(snapshot_date, user_id, current_streak, longest_streak)
SELECT
  adjustment.effective_date,
  adjustment.user_id,
  adjustment.current_streak,
  adjustment.longest_streak
FROM public.streak_manual_adjustments adjustment
JOIN public.profiles profile ON profile.id = adjustment.user_id
WHERE (
    regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g')
      IN ('vedette', 'sentinelvedette')
    OR (
      regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
      AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.streakboard_snapshots existing
    WHERE existing.user_id = adjustment.user_id
      AND existing.snapshot_date = adjustment.effective_date
      AND existing.current_streak = adjustment.current_streak
      AND existing.longest_streak = adjustment.longest_streak
  );
