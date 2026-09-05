/*
  Keep quiz day additive and publish an authoritative weekly quiz ranking at
  10:00 PM Africa/Douala. The ranking remains available for exactly 24 hours,
  which gives the welcome carousel a one-day podium without exposing scores
  before the requested release time.
*/

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
STABLE
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_ranking_release timestamptz;
  v_slide_expiry timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.quiz_sessions session
  WHERE coalesce(session.quiz_type, 'saturday') = 'saturday'
    AND (p_quiz_session_id IS NULL OR session.id = p_quiz_session_id)
    AND statement_timestamp() >= (session.session_date + time '22:00') AT TIME ZONE 'Africa/Douala'
    AND (
      p_quiz_session_id IS NOT NULL
      OR statement_timestamp() < ((session.session_date + time '22:00') AT TIME ZONE 'Africa/Douala') + interval '24 hours'
    )
  ORDER BY session.session_date DESC, session.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_ranking_release := (v_session.session_date + time '22:00') AT TIME ZONE 'Africa/Douala';
  v_slide_expiry := v_ranking_release + interval '24 hours';

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
    WHERE attempt.quiz_session_id = v_session.id
      AND attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.question_responses response
        WHERE response.quiz_attempt_id = attempt.id
      )
  ), ranked AS (
    SELECT
      scored.*,
      row_number() OVER (
        ORDER BY
          scored.correct_count DESC,
          scored.figs_earned DESC,
          scored.answered_at ASC,
          scored.user_id ASC
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

REVOKE ALL ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) TO authenticated, service_role;
