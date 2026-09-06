/*
  Keep weekly quiz competition separate for Cadets and Sentries. Cadets may
  request only the Cadet division; Sentries and Instructors may view both.
*/

CREATE OR REPLACE FUNCTION public.get_latest_weekly_quiz_rankings_by_role(
  p_quiz_session_id uuid DEFAULT NULL,
  p_competitor_role text DEFAULT 'cadet'
)
RETURNS TABLE (
  quiz_session_id uuid,
  quiz_title text,
  session_date date,
  user_id uuid,
  display_name text,
  avatar_url text,
  correct_count integer,
  question_count integer,
  figs_earned integer,
  denarii_award integer,
  answered_at timestamptz,
  placement integer,
  ranking_released_at timestamptz,
  slide_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_ranking_release timestamptz;
  v_slide_expiry timestamptz;
  v_viewer_role text;
  v_competitor_role text := lower(btrim(coalesce(p_competitor_role, 'cadet')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT assignment.role::text
  INTO v_viewer_role
  FROM public.role_assignments assignment
  WHERE assignment.user_id = auth.uid()
    AND assignment.status IN ('active', 'approved')
  ORDER BY
    CASE assignment.role::text WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
    assignment.start_date DESC NULLS LAST,
    assignment.created_at DESC
  LIMIT 1;

  IF v_viewer_role NOT IN ('cadet', 'sentry', 'instructor') THEN
    RAISE EXCEPTION 'An active Full Circle role is required.';
  END IF;
  IF v_competitor_role NOT IN ('cadet', 'sentry') THEN
    RAISE EXCEPTION 'Quiz division must be cadet or sentry.';
  END IF;
  IF v_viewer_role = 'cadet' AND v_competitor_role <> 'cadet' THEN
    RAISE EXCEPTION 'Cadets can only view Cadet quiz rankings.' USING ERRCODE = '42501';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.quiz_sessions session
  WHERE coalesce(session.quiz_type, 'saturday') = 'saturday'
    AND (p_quiz_session_id IS NULL OR session.id = p_quiz_session_id)
    AND EXISTS (
      SELECT 1
      FROM public.weekly_quiz_result_releases pending
      WHERE pending.quiz_session_id = session.id
        AND pending.release_at <= statement_timestamp()
    )
  ORDER BY session.session_date DESC, session.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT min(pending.release_at)
  INTO v_ranking_release
  FROM public.weekly_quiz_result_releases pending
  WHERE pending.quiz_session_id = v_session.id;
  v_slide_expiry := v_ranking_release + interval '24 hours';

  IF p_quiz_session_id IS NULL AND statement_timestamp() >= v_slide_expiry THEN
    RETURN;
  END IF;

  PERFORM public.release_due_weekly_quiz_results(NULL);

  RETURN QUERY
  WITH scored AS (
    SELECT
      attempt.id AS attempt_id,
      attempt.user_id,
      profile.display_name,
      profile.avatar_url,
      release.correct_count,
      release.question_count,
      release.figs_earned,
      release.denarii_award,
      attempt.submitted_at AS answered_at
    FROM public.quiz_attempts attempt
    JOIN public.weekly_quiz_result_releases release
      ON release.attempt_id = attempt.id
      AND release.released_at IS NOT NULL
    JOIN public.profiles profile ON profile.id = attempt.user_id
    JOIN LATERAL (
      SELECT assignment.role::text AS role
      FROM public.role_assignments assignment
      WHERE assignment.user_id = attempt.user_id
        AND assignment.status IN ('active', 'approved')
      ORDER BY
        CASE assignment.role::text WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
        assignment.start_date DESC NULLS LAST,
        assignment.created_at DESC
      LIMIT 1
    ) competitor ON competitor.role = v_competitor_role
    WHERE attempt.quiz_session_id = v_session.id
      AND attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.question_responses response
        WHERE response.quiz_attempt_id = attempt.id
      )
  ), ranked AS (
    SELECT scored.*,
      row_number() OVER (
        ORDER BY scored.correct_count DESC, scored.figs_earned DESC,
          scored.answered_at ASC, scored.user_id ASC
      )::integer AS placement
    FROM scored
  )
  SELECT
    v_session.id,
    v_session.title,
    v_session.session_date,
    ranked.user_id,
    coalesce(nullif(btrim(ranked.display_name), ''), 'Full Circle member'),
    ranked.avatar_url,
    ranked.correct_count,
    ranked.question_count,
    ranked.figs_earned,
    ranked.denarii_award,
    ranked.answered_at,
    ranked.placement,
    v_ranking_release,
    v_slide_expiry
  FROM ranked
  ORDER BY ranked.placement;
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_weekly_quiz_rankings_by_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_weekly_quiz_rankings_by_role(uuid, text) TO authenticated, service_role;

-- Preserve the original one-argument API for installed clients, but make its
-- default division role-aware so it can no longer expose a mixed ranking.
CREATE OR REPLACE FUNCTION public.get_latest_weekly_quiz_rankings(
  p_quiz_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  quiz_session_id uuid,
  quiz_title text,
  session_date date,
  user_id uuid,
  display_name text,
  avatar_url text,
  correct_count integer,
  question_count integer,
  figs_earned integer,
  denarii_award integer,
  answered_at timestamptz,
  placement integer,
  ranking_released_at timestamptz,
  slide_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_viewer_role text;
  v_default_division text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT assignment.role::text
  INTO v_viewer_role
  FROM public.role_assignments assignment
  WHERE assignment.user_id = auth.uid()
    AND assignment.status IN ('active', 'approved')
  ORDER BY
    CASE assignment.role::text WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
    assignment.start_date DESC NULLS LAST,
    assignment.created_at DESC
  LIMIT 1;

  v_default_division := CASE WHEN v_viewer_role = 'sentry' THEN 'sentry' ELSE 'cadet' END;

  RETURN QUERY
  SELECT result.*
  FROM public.get_latest_weekly_quiz_rankings_by_role(
    p_quiz_session_id,
    v_default_division
  ) result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) TO authenticated, service_role;
