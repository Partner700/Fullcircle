DROP FUNCTION IF EXISTS public.get_quiz_scoreboard();
CREATE OR REPLACE FUNCTION public.get_quiz_scoreboard()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  tent_house_id text,
  daily_game_score bigint,
  arena_figs bigint,
  random_quiz_score numeric,
  saturday_quiz_score numeric,
  total_score numeric,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now()) AS local_now
  ),
  release AS (
    SELECT
      local_now,
      (local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::date AS week_start,
      (
        (local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::timestamp
        + time '15:00'
      ) AS released_at
    FROM clock
  ),
  cadets AS (
    SELECT DISTINCT ON (p.id)
      p.id AS user_id,
      p.display_name,
      t.tent_house_id
    FROM public.role_assignments ra
    JOIN public.profiles p ON p.id = ra.user_id
    LEFT JOIN public.tent_members tm ON tm.user_id = p.id AND tm.role = 'cadet'
    LEFT JOIN public.tents t ON t.id = tm.tent_id
    WHERE ra.role = 'cadet'
      AND ra.status IN ('active', 'approved')
    ORDER BY p.id, tm.joined_at DESC NULLS LAST
  ),
  game_scores AS (
    SELECT
      ga.user_id,
      COALESCE(SUM(ga.score), 0)::bigint AS score
    FROM public.game_attempts ga
    CROSS JOIN release r
    WHERE ga.completed_at IS NOT NULL
      AND ga.status IN ('passed', 'failed')
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY ga.user_id
  ),
  arena_scores AS (
    SELECT
      ap.user_id,
      COALESCE(SUM(ap.score), 0)::bigint AS figs
    FROM public.arena_participants ap
    JOIN public.arena_rooms ar ON ar.id = ap.room_id
    CROSS JOIN release r
    WHERE ap.finished_at IS NOT NULL
      AND ar.status = 'completed'
      AND (ap.finished_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (ap.finished_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY ap.user_id
  ),
  quiz_scores AS (
    SELECT
      qa.user_id,
      COALESCE(SUM(CASE WHEN qs.quiz_type = 'fortune' THEN qa.talents_scored ELSE 0 END), 0)::numeric AS random_score,
      COALESCE(SUM(CASE WHEN qs.quiz_type = 'saturday' AND r.local_now >= r.released_at THEN qa.talents_scored ELSE 0 END), 0)::numeric AS saturday_score
    FROM public.quiz_attempts qa
    JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
    CROSS JOIN release r
    WHERE qa.status IN ('submitted', 'timed_out')
      AND qa.submitted_at IS NOT NULL
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY qa.user_id
  ),
  totals AS (
    SELECT
      c.user_id,
      c.display_name,
      c.tent_house_id,
      COALESCE(gs.score, 0)::bigint AS daily_game_score,
      COALESCE(ars.figs, 0)::bigint AS arena_figs,
      COALESCE(qs.random_score, 0)::numeric AS random_quiz_score,
      COALESCE(qs.saturday_score, 0)::numeric AS saturday_quiz_score,
      (
        COALESCE(gs.score, 0)::numeric
        + COALESCE(ars.figs, 0)::numeric
        + COALESCE(qs.random_score, 0)
        + COALESCE(qs.saturday_score, 0)
      )::numeric AS total_score
    FROM cadets c
    LEFT JOIN game_scores gs ON gs.user_id = c.user_id
    LEFT JOIN arena_scores ars ON ars.user_id = c.user_id
    LEFT JOIN quiz_scores qs ON qs.user_id = c.user_id
  )
  SELECT
    totals.user_id,
    totals.display_name,
    totals.tent_house_id,
    totals.daily_game_score,
    totals.arena_figs,
    totals.random_quiz_score,
    totals.saturday_quiz_score,
    totals.total_score,
    RANK() OVER (ORDER BY totals.total_score DESC, totals.display_name ASC)::integer AS rank
  FROM totals
  ORDER BY total_score DESC, display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_quiz_scoreboard() TO authenticated;
