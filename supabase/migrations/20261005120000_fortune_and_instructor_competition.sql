/*
  Fortune-quiz positions and camp-level instructor competition.

  Fortune rankings remain private until the authoritative quiz close. The
  instructor boards treat the camp's cumulative figures as the instructor's
  figures, with one instructor-only Mark per narrative and five per Resident.
*/

CREATE OR REPLACE FUNCTION public.prevent_instructor_self_resource_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.instructor_id = NEW.recipient_id THEN
    RAISE EXCEPTION 'The instructor cannot grant Denarii or relics to themself.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_instructor_self_resource_grant
  ON public.instructor_resource_grants;
CREATE TRIGGER prevent_instructor_self_resource_grant
BEFORE INSERT OR UPDATE OF instructor_id, recipient_id
ON public.instructor_resource_grants
FOR EACH ROW EXECUTE FUNCTION public.prevent_instructor_self_resource_grant();

REVOKE ALL ON FUNCTION public.prevent_instructor_self_resource_grant()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_fortune_quiz_rankings_by_role(
  p_quiz_session_id uuid,
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
STABLE
SET search_path = ''
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
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
  WHERE session.id = p_quiz_session_id
    AND session.quiz_type = 'fortune'
    AND statement_timestamp() >= session.live_closes_at;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      attempt.id AS attempt_id,
      attempt.user_id,
      profile.display_name,
      profile.avatar_url,
      count(question.id)::integer AS question_count,
      count(question.id) FILTER (
        WHERE public.quiz_answer_is_correct(response.answer, question.question_payload)
      )::integer AS correct_count,
      coalesce(attempt.talents_scored, 0)::integer AS figs_earned,
      coalesce((
        SELECT sum(entry.amount)::integer
        FROM public.denarii_ledger_entries entry
        WHERE entry.user_id = attempt.user_id
          AND entry.source_type = 'fortune_quiz_reward'
          AND entry.source_reference = attempt.id::text
      ), 0)::integer AS denarii_award,
      attempt.submitted_at AS answered_at
    FROM public.quiz_attempts attempt
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
    JOIN public.generated_questions question
      ON question.quiz_session_id = attempt.quiz_session_id
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
      AND response.question_id = question.id
    WHERE attempt.quiz_session_id = v_session.id
      AND attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.question_responses answered
        WHERE answered.quiz_attempt_id = attempt.id
      )
    GROUP BY
      attempt.id,
      attempt.user_id,
      profile.display_name,
      profile.avatar_url,
      attempt.talents_scored,
      attempt.submitted_at
  ), ranked AS (
    SELECT
      scored.*,
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
    v_session.live_closes_at,
    v_session.live_closes_at + interval '7 days'
  FROM ranked
  ORDER BY ranked.placement;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fortune_quiz_rankings_by_role(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fortune_quiz_rankings_by_role(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_instructor_competitive_boards()
RETURNS TABLE (
  board_key text,
  subject_id uuid,
  row_data jsonb,
  current_value numeric,
  current_rank integer,
  previous_value numeric,
  previous_rank integer,
  movement integer,
  is_new_record boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', statement_timestamp())::date;
  v_midnight timestamptz := v_today::timestamp AT TIME ZONE 'Africa/Douala';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view instructor competition boards.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH instructors AS MATERIALIZED (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      profile.display_name,
      profile.avatar_url
    FROM public.role_assignments assignment
    JOIN public.profiles profile ON profile.id = assignment.user_id
    WHERE assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), members AS MATERIALIZED (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      profile.created_at AS resident_since
    FROM public.role_assignments assignment
    JOIN public.profiles profile ON profile.id = assignment.user_id
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), components AS MATERIALIZED (
    SELECT component.*
    FROM public.get_member_mark_components() component
  ), camp_totals AS MATERIALIZED (
    SELECT
      (SELECT count(*)::numeric FROM public.daily_narratives) AS narratives,
      (SELECT count(*)::numeric FROM public.daily_narratives narrative
        WHERE narrative.created_at < v_midnight) AS previous_narratives,
      (SELECT count(*)::numeric FROM members) AS residents,
      (SELECT count(*)::numeric FROM members member
        WHERE member.resident_since < v_midnight) AS previous_residents,
      coalesce((
        SELECT sum(component.wallet_denarii)::numeric
        FROM components component
      ), 0)::numeric AS total_denarii,
      coalesce((
        SELECT sum(entry.amount)::numeric
        FROM public.denarii_ledger_entries entry
        JOIN members member ON member.user_id = entry.user_id
        WHERE entry.created_at < v_midnight
      ), 0)::numeric AS previous_denarii,
      coalesce((
        SELECT sum(component.total_figs)::numeric
        FROM components component
      ), 0)::numeric AS total_figs,
      coalesce((
        SELECT sum(public.get_user_lifetime_figs(member.user_id, v_midnight))::numeric
        FROM members member
      ), 0)::numeric AS previous_figs,
      coalesce((
        SELECT sum(component.marks)::numeric
        FROM components component
      ), 0)::numeric AS member_marks,
      coalesce((
        SELECT sum(public.calculate_normalized_marks(
          public.get_lifetime_qualifying_streak_days(member.user_id, v_today)::numeric,
          public.get_qualifying_denarii_total(member.user_id, v_midnight)::numeric,
          coalesce((
            SELECT count(*)::numeric
            FROM public.arena_rooms room
            WHERE room.winner_id = member.user_id
              AND room.status = 'completed'
              AND room.completed_at < v_midnight
          ), 0),
          public.get_user_lifetime_figs(member.user_id, v_midnight)::numeric
        ))::numeric
        FROM members member
      ), 0)::numeric AS previous_member_marks
  ), complete_totals AS (
    SELECT
      camp.*,
      (camp.member_marks + camp.narratives + camp.residents * 5)::numeric AS marks,
      (
        camp.previous_member_marks
        + camp.previous_narratives
        + camp.previous_residents * 5
      )::numeric AS previous_marks
    FROM camp_totals camp
  ), metric_rows AS (
    SELECT
      instructor.user_id,
      instructor.display_name,
      instructor.avatar_url,
      totals.*,
      metric.board_key,
      metric.current_value,
      metric.previous_value
    FROM instructors instructor
    CROSS JOIN complete_totals totals
    CROSS JOIN LATERAL (VALUES
      ('instructor_narratives'::text, totals.narratives, totals.previous_narratives),
      ('instructor_residents'::text, totals.residents, totals.previous_residents),
      ('instructor_marks'::text, totals.marks, totals.previous_marks),
      ('instructor_denarii'::text, totals.total_denarii, totals.previous_denarii),
      ('instructor_figs'::text, totals.total_figs, totals.previous_figs)
    ) metric(board_key, current_value, previous_value)
  ), ranked AS (
    SELECT
      metric.*,
      rank() OVER (
        PARTITION BY metric.board_key ORDER BY metric.current_value DESC
      )::integer AS current_position,
      rank() OVER (
        PARTITION BY metric.board_key ORDER BY metric.previous_value DESC
      )::integer AS previous_position
    FROM metric_rows metric
  )
  SELECT
    ranked.board_key,
    ranked.user_id,
    jsonb_build_object(
      'user_id', ranked.user_id,
      'display_name', ranked.display_name,
      'avatar_url', ranked.avatar_url,
      'narratives', ranked.narratives,
      'residents', ranked.residents,
      'marks', ranked.marks,
      'total_denarii', ranked.total_denarii,
      'total_figs', ranked.total_figs,
      'rank', ranked.current_position
    ),
    ranked.current_value,
    ranked.current_position,
    ranked.previous_value,
    ranked.previous_position,
    CASE
      WHEN ranked.current_value > ranked.previous_value THEN 1
      WHEN ranked.current_value < ranked.previous_value THEN -1
      WHEN ranked.current_position < ranked.previous_position THEN 1
      WHEN ranked.current_position > ranked.previous_position THEN -1
      ELSE 0
    END::integer,
    ranked.current_value > ranked.previous_value
  FROM ranked
  ORDER BY ranked.board_key, ranked.current_position, ranked.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_instructor_competitive_boards()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_competitive_boards()
  TO authenticated, service_role;
