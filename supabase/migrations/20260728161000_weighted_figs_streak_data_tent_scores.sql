/*
# Weighted figs, fuller streak board data, and tent positioning

- Quiz figs are weighted by question difficulty: easy = 1, moderate/medium = 3, hard = 5.
- Streak board exposes current, longest, valid days, consecutive missed days, and cumulative missed days.
*/

DROP FUNCTION IF EXISTS public.get_streakboard_live();
CREATE OR REPLACE FUNCTION public.get_streakboard_live()
RETURNS TABLE(
  id uuid,
  snapshot_date date,
  user_id uuid,
  tent_id uuid,
  tent_house_id text,
  volume integer,
  consistency integer,
  improvement numeric,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer,
  rank integer,
  profiles jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_cadets AS (
    SELECT DISTINCT ON (ra.user_id) ra.user_id
    FROM public.role_assignments ra
    WHERE ra.role = 'cadet'
      AND ra.status IN ('active', 'approved')
    ORDER BY ra.user_id, ra.created_at DESC
  ),
  member_tents AS (
    SELECT DISTINCT ON (tm.user_id)
      tm.user_id,
      tm.tent_id,
      t.tent_house_id
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    WHERE tm.role = 'cadet'
    ORDER BY tm.user_id, tm.joined_at DESC NULLS LAST
  ),
  scored AS (
    SELECT
      ac.user_id,
      mt.tent_id,
      mt.tent_house_id,
      COALESCE((
        SELECT count(*)::integer
        FROM public.daily_records dr
        WHERE dr.user_id = ac.user_id
          AND COALESCE(dr.streak_valid, false) = true
      ), 0) AS volume,
      COALESCE(st.current_streak, 0)::integer AS current_streak,
      GREATEST(
        COALESCE(st.longest_streak, 0)::integer,
        COALESCE((
          SELECT count(*)::integer
          FROM public.daily_records dr
          WHERE dr.user_id = ac.user_id
            AND COALESCE(dr.streak_valid, false) = true
        ), 0)
      ) AS longest_streak,
      COALESCE(st.consecutive_inactive, 0)::integer AS consecutive_inactive,
      COALESCE(st.cumulative_inactive, 0)::integer AS cumulative_inactive,
      p.display_name,
      p.avatar_url
    FROM active_cadets ac
    JOIN public.profiles p ON p.id = ac.user_id
    LEFT JOIN member_tents mt ON mt.user_id = ac.user_id
    LEFT JOIN LATERAL public.compute_strict_streak(ac.user_id) st ON true
  )
  SELECT
    gen_random_uuid() AS id,
    timezone('Africa/Douala', now())::date AS snapshot_date,
    scored.user_id,
    scored.tent_id,
    scored.tent_house_id,
    scored.volume,
    scored.longest_streak AS consistency,
    0::numeric AS improvement,
    scored.current_streak,
    scored.longest_streak,
    scored.consecutive_inactive,
    scored.cumulative_inactive,
    rank() OVER (
      ORDER BY scored.current_streak DESC, scored.longest_streak DESC, scored.volume DESC, scored.display_name ASC
    )::integer AS rank,
    jsonb_build_object(
      'display_name', scored.display_name,
      'avatar_url', scored.avatar_url
    ) AS profiles
  FROM scored
  ORDER BY rank, scored.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_streakboard_live() TO authenticated;

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
      ((local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::timestamp + time '15:00') AS released_at
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
    SELECT ga.user_id, COALESCE(SUM(ga.score), 0)::bigint AS score
    FROM public.game_attempts ga
    CROSS JOIN release r
    WHERE ga.completed_at IS NOT NULL
      AND ga.status IN ('passed', 'failed')
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY ga.user_id
  ),
  arena_scores AS (
    SELECT ap.user_id, COALESCE(SUM(ap.score), 0)::bigint AS figs
    FROM public.arena_participants ap
    JOIN public.arena_rooms ar ON ar.id = ap.room_id
    CROSS JOIN release r
    WHERE ap.finished_at IS NOT NULL
      AND ar.status = 'completed'
      AND (ap.finished_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (ap.finished_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY ap.user_id
  ),
  weighted_quiz_responses AS (
    SELECT
      qa.user_id,
      qs.quiz_type,
      r.local_now,
      r.released_at,
      CASE
        WHEN gq.difficulty_tag = 'hard' THEN 5
        WHEN gq.difficulty_tag IN ('moderate', 'medium') THEN 3
        ELSE 1
      END::numeric AS figs
    FROM public.quiz_attempts qa
    JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
    JOIN public.question_responses qr ON qr.quiz_attempt_id = qa.id
    JOIN public.generated_questions gq ON gq.id = qr.question_id
    CROSS JOIN release r
    WHERE qa.status IN ('submitted', 'timed_out')
      AND qa.submitted_at IS NOT NULL
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
      AND qr.answer = gq.question_payload->'correct_answer'
  ),
  quiz_scores AS (
    SELECT
      user_id,
      COALESCE(SUM(CASE WHEN quiz_type = 'fortune' THEN figs ELSE 0 END), 0)::numeric AS random_score,
      COALESCE(SUM(CASE WHEN quiz_type = 'saturday' AND local_now >= released_at THEN figs ELSE 0 END), 0)::numeric AS saturday_score
    FROM weighted_quiz_responses
    GROUP BY user_id
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
      (COALESCE(gs.score, 0)::numeric + COALESCE(ars.figs, 0)::numeric + COALESCE(qs.random_score, 0) + COALESCE(qs.saturday_score, 0))::numeric AS total_score
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

DROP FUNCTION IF EXISTS public.get_tent_leaderboard();
CREATE OR REPLACE FUNCTION public.get_tent_leaderboard()
RETURNS TABLE (
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  tent_profile_image_url text,
  sentry_names text[],
  cadet_count bigint,
  total_denarii bigint,
  total_streak bigint,
  total_figs numeric,
  combined_score numeric,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tent_people AS (
    SELECT
      t.id AS tent_id,
      t.name AS tent_name,
      t.tent_house_id,
      t.profile_image_url AS tent_profile_image_url,
      tm.user_id,
      tm.role,
      p.display_name
    FROM public.tents t
    LEFT JOIN public.tent_members tm ON tm.tent_id = t.id
    LEFT JOIN public.profiles p ON p.id = tm.user_id
  ),
  cadet_figs AS (
    SELECT user_id, SUM(figs)::numeric AS figs
    FROM (
      SELECT ga.user_id, COALESCE(SUM(ga.score), 0)::numeric AS figs
      FROM public.game_attempts ga
      WHERE ga.completed_at IS NOT NULL
        AND ga.status IN ('passed', 'failed')
      GROUP BY ga.user_id
      UNION ALL
      SELECT ap.user_id, COALESCE(SUM(ap.score), 0)::numeric AS figs
      FROM public.arena_participants ap
      JOIN public.arena_rooms ar ON ar.id = ap.room_id
      WHERE ap.finished_at IS NOT NULL
        AND ar.status = 'completed'
      GROUP BY ap.user_id
      UNION ALL
      SELECT qa.user_id,
        COALESCE(SUM(CASE
          WHEN gq.difficulty_tag = 'hard' THEN 5
          WHEN gq.difficulty_tag IN ('moderate', 'medium') THEN 3
          ELSE 1
        END), 0)::numeric AS figs
      FROM public.quiz_attempts qa
      JOIN public.question_responses qr ON qr.quiz_attempt_id = qa.id
      JOIN public.generated_questions gq ON gq.id = qr.question_id
      WHERE qa.status IN ('submitted', 'timed_out')
        AND qr.answer = gq.question_payload->'correct_answer'
      GROUP BY qa.user_id
    ) all_figs
    GROUP BY user_id
  ),
  cadet_scores AS (
    SELECT
      tp.tent_id,
      COALESCE(SUM(CASE WHEN tp.role = 'cadet' THEN public.get_user_denarii_total(tp.user_id) ELSE 0 END), 0)::bigint AS total_denarii,
      COALESCE(SUM(CASE WHEN tp.role = 'cadet' THEN COALESCE((SELECT current_streak FROM public.compute_strict_streak(tp.user_id) LIMIT 1), 0) ELSE 0 END), 0)::bigint AS total_streak,
      COALESCE(SUM(CASE WHEN tp.role = 'cadet' THEN COALESCE(cf.figs, 0) ELSE 0 END), 0)::numeric AS total_figs,
      COUNT(*) FILTER (WHERE tp.role = 'cadet')::bigint AS cadet_count,
      ARRAY_REMOVE(ARRAY_AGG(tp.display_name ORDER BY tp.display_name) FILTER (WHERE tp.role = 'sentry'), NULL) AS sentry_names
    FROM tent_people tp
    LEFT JOIN cadet_figs cf ON cf.user_id = tp.user_id
    GROUP BY tp.tent_id
  ),
  rows AS (
    SELECT DISTINCT
      tp.tent_id,
      tp.tent_name,
      tp.tent_house_id,
      tp.tent_profile_image_url,
      COALESCE(cs.sentry_names, ARRAY[]::text[]) AS sentry_names,
      COALESCE(cs.cadet_count, 0) AS cadet_count,
      COALESCE(cs.total_denarii, 0) AS total_denarii,
      COALESCE(cs.total_streak, 0) AS total_streak,
      COALESCE(cs.total_figs, 0) AS total_figs,
      (COALESCE(cs.total_denarii, 0)::numeric + COALESCE(cs.total_streak, 0)::numeric * 1000 + COALESCE(cs.total_figs, 0)::numeric * 100)::numeric AS combined_score
    FROM tent_people tp
    LEFT JOIN cadet_scores cs ON cs.tent_id = tp.tent_id
    WHERE tp.tent_id IS NOT NULL
  )
  SELECT
    rows.*,
    RANK() OVER (ORDER BY rows.combined_score DESC, rows.total_figs DESC, rows.total_streak DESC, rows.tent_name ASC) AS rank
  FROM rows
  ORDER BY rank ASC, rows.tent_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_tent_leaderboard() TO authenticated;
