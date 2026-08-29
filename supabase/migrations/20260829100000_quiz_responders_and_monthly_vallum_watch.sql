/*
  Quiz participation visibility and instructor monthly award watches.

  Quiz responders expose public identity metadata only. Scores, responses, and
  rewards remain private until the existing result-release workflow opens them.
*/

CREATE OR REPLACE FUNCTION public.get_quiz_responders(p_quiz_session_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  answered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.quiz_sessions session
    WHERE session.id = p_quiz_session_id
  ) THEN
    RAISE EXCEPTION 'Quiz session not found.';
  END IF;

  RETURN QUERY
  WITH completed AS (
    SELECT DISTINCT ON (attempt.user_id)
      attempt.user_id,
      attempt.submitted_at
    FROM public.quiz_attempts attempt
    WHERE attempt.quiz_session_id = p_quiz_session_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.question_responses response
        WHERE response.quiz_attempt_id = attempt.id
      )
    ORDER BY attempt.user_id, attempt.submitted_at DESC
  )
  SELECT
    completed.user_id,
    COALESCE(NULLIF(btrim(profile.display_name), ''), 'Full Circle member'),
    profile.avatar_url,
    completed.submitted_at
  FROM completed
  JOIN public.profiles profile ON profile.id = completed.user_id
  ORDER BY completed.submitted_at ASC, profile.display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_responders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_responders(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_monthly_vallum_watch(p_month date DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  marks numeric,
  punctual_actions bigint,
  insights_written bigint,
  comments_written bigint,
  reactions_given bigint,
  monthly_figs numeric,
  monthly_rhudes bigint,
  activity_points bigint,
  rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_month_start date := date_trunc(
    'month',
    COALESCE(p_month, timezone('Africa/Douala', now())::date)
  )::date;
  v_month_end date;
BEGIN
  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_caller
      AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Instructor access required.';
  END IF;

  v_month_end := (v_month_start + interval '1 month')::date;

  RETURN QUERY
  WITH latest_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role,
      assignment.status
    FROM public.role_assignments assignment
    WHERE assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), cadets AS (
    SELECT profile.id AS user_id, profile.display_name, profile.avatar_url
    FROM latest_roles role
    JOIN public.profiles profile ON profile.id = role.user_id
    WHERE role.role = 'cadet'
  ), live_marks AS (
    SELECT board.user_id, board.marks
    FROM public.get_marks_board_live() board
  ), punctuality AS (
    SELECT
      record.user_id,
      (
        count(*) FILTER (
          WHERE record.attendance_status = 'present'
            AND COALESCE(record.attendance_late, false) = false
        )
        + count(*) FILTER (
          WHERE record.meditation_submitted = true
            AND record.meditation_submitted_at IS NOT NULL
            AND (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
        )
      )::bigint AS punctual_actions
    FROM public.daily_records record
    WHERE record.record_date >= v_month_start
      AND record.record_date < v_month_end
    GROUP BY record.user_id
  ), insights AS (
    SELECT insight.user_id, count(*)::bigint AS insights_written
    FROM public.scripture_verse_insights insight
    WHERE (insight.created_at AT TIME ZONE 'Africa/Douala')::date >= v_month_start
      AND (insight.created_at AT TIME ZONE 'Africa/Douala')::date < v_month_end
    GROUP BY insight.user_id
  ), authored_comments AS (
    SELECT comment.commenter_user_id AS user_id, comment.created_at
    FROM public.daily_quote_comments comment
    UNION ALL
    SELECT comment.commenter_user_id, comment.created_at
    FROM public.daily_verse_comments comment
    UNION ALL
    SELECT comment.user_id, comment.created_at
    FROM public.scripture_insight_comments comment
  ), comments AS (
    SELECT comment.user_id, count(*)::bigint AS comments_written
    FROM authored_comments comment
    WHERE (comment.created_at AT TIME ZONE 'Africa/Douala')::date >= v_month_start
      AND (comment.created_at AT TIME ZONE 'Africa/Douala')::date < v_month_end
    GROUP BY comment.user_id
  ), authored_reactions AS (
    SELECT reaction.reactor_user_id AS user_id, reaction.created_at
    FROM public.daily_quote_reactions reaction
    UNION ALL
    SELECT reaction.reactor_user_id, reaction.created_at
    FROM public.daily_verse_reactions reaction
    UNION ALL
    SELECT reaction.reactor_user_id, reaction.created_at
    FROM public.scripture_insight_reactions reaction
  ), reactions AS (
    SELECT reaction.user_id, count(*)::bigint AS reactions_given
    FROM authored_reactions reaction
    WHERE (reaction.created_at AT TIME ZONE 'Africa/Douala')::date >= v_month_start
      AND (reaction.created_at AT TIME ZONE 'Africa/Douala')::date < v_month_end
    GROUP BY reaction.user_id
  ), quiz_figs AS (
    SELECT
      attempt.user_id,
      COALESCE(sum(attempt.talents_scored), 0)::numeric AS monthly_figs
    FROM public.quiz_attempts attempt
    WHERE attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at >= (v_month_start::timestamp AT TIME ZONE 'Africa/Douala')
      AND attempt.submitted_at < (v_month_end::timestamp AT TIME ZONE 'Africa/Douala')
    GROUP BY attempt.user_id
  ), arena_rhudes AS (
    SELECT room.winner_id AS user_id, count(*)::bigint AS monthly_rhudes
    FROM public.arena_rooms room
    WHERE room.status = 'completed'
      AND room.winner_id IS NOT NULL
      AND room.completed_at >= (v_month_start::timestamp AT TIME ZONE 'Africa/Douala')
      AND room.completed_at < (v_month_end::timestamp AT TIME ZONE 'Africa/Douala')
    GROUP BY room.winner_id
  ), measured AS (
    SELECT
      cadet.user_id,
      COALESCE(NULLIF(btrim(cadet.display_name), ''), 'Cadet') AS display_name,
      cadet.avatar_url,
      COALESCE(live_marks.marks, 0)::numeric AS marks,
      COALESCE(punctuality.punctual_actions, 0)::bigint AS punctual_actions,
      COALESCE(insights.insights_written, 0)::bigint AS insights_written,
      COALESCE(comments.comments_written, 0)::bigint AS comments_written,
      COALESCE(reactions.reactions_given, 0)::bigint AS reactions_given,
      COALESCE(quiz_figs.monthly_figs, 0)::numeric AS monthly_figs,
      COALESCE(arena_rhudes.monthly_rhudes, 0)::bigint AS monthly_rhudes,
      (
        COALESCE(punctuality.punctual_actions, 0) * 3
        + COALESCE(insights.insights_written, 0) * 5
        + COALESCE(comments.comments_written, 0) * 2
        + COALESCE(reactions.reactions_given, 0)
      )::bigint AS activity_points
    FROM cadets cadet
    LEFT JOIN live_marks ON live_marks.user_id = cadet.user_id
    LEFT JOIN punctuality ON punctuality.user_id = cadet.user_id
    LEFT JOIN insights ON insights.user_id = cadet.user_id
    LEFT JOIN comments ON comments.user_id = cadet.user_id
    LEFT JOIN reactions ON reactions.user_id = cadet.user_id
    LEFT JOIN quiz_figs ON quiz_figs.user_id = cadet.user_id
    LEFT JOIN arena_rhudes ON arena_rhudes.user_id = cadet.user_id
  )
  SELECT
    measured.user_id,
    measured.display_name,
    measured.avatar_url,
    measured.marks,
    measured.punctual_actions,
    measured.insights_written,
    measured.comments_written,
    measured.reactions_given,
    measured.monthly_figs,
    measured.monthly_rhudes,
    measured.activity_points,
    row_number() OVER (
      ORDER BY measured.activity_points DESC, measured.marks DESC, measured.display_name ASC
    )::integer AS rank
  FROM measured
  WHERE measured.activity_points > 0
     OR measured.marks > 0
     OR measured.monthly_figs > 0
     OR measured.monthly_rhudes > 0
  ORDER BY 12 ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_monthly_vallum_watch(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_vallum_watch(date) TO authenticated, service_role;
