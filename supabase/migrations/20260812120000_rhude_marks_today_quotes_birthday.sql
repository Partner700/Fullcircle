/*
# Rhudes, marks, and today-only quote feed

- One Rhude equals one Arena victory.
- Marks combine denarii, figs, streak, and Rhudes using the same weighted spirit
  as the tent board: denarii + figs*100 + streak*1000 + rhudes*5000.
- The dashboard quote feed only returns today's meditation quotes.
*/

DROP FUNCTION IF EXISTS public.get_daily_quote_feed(integer);

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now())::date AS today
  )
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  CROSS JOIN clock c
  WHERE dr.meditation_submitted = true
    AND dr.record_date = c.today
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.meditation_submitted_at DESC NULLS LAST, p.display_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_rhude_board_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text,
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  rhudes bigint,
  latest_victory_at timestamptz,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id,
      CASE assignment.role WHEN 'sentry' THEN 1 ELSE 2 END,
      assignment.created_at DESC NULLS LAST
  ),
  latest_tent AS (
    SELECT DISTINCT ON (tm.user_id)
      tm.user_id,
      tm.tent_id,
      t.name AS tent_name,
      t.tent_house_id
    FROM public.tent_members tm
    LEFT JOIN public.tents t ON t.id = tm.tent_id
    ORDER BY tm.user_id, tm.joined_at DESC NULLS LAST
  ),
  victories AS (
    SELECT
      room.winner_id AS user_id,
      COUNT(*)::bigint AS rhudes,
      MAX(room.completed_at) AS latest_victory_at
    FROM public.arena_rooms room
    WHERE room.status = 'completed'
      AND room.winner_id IS NOT NULL
    GROUP BY room.winner_id
  ),
  rows AS (
    SELECT
      ar.user_id,
      p.display_name,
      p.avatar_url,
      ar.role,
      lt.tent_id,
      lt.tent_name,
      lt.tent_house_id,
      COALESCE(v.rhudes, 0)::bigint AS rhudes,
      v.latest_victory_at
    FROM active_roles ar
    JOIN public.profiles p ON p.id = ar.user_id
    LEFT JOIN latest_tent lt ON lt.user_id = ar.user_id
    LEFT JOIN victories v ON v.user_id = ar.user_id
  )
  SELECT
    rows.*,
    RANK() OVER (ORDER BY rows.rhudes DESC, rows.latest_victory_at ASC NULLS LAST, rows.display_name ASC)::integer AS rank
  FROM rows
  WHERE rows.rhudes > 0
  ORDER BY rank ASC, rows.display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_rhude_board_live() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_marks_board_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text,
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  total_denarii bigint,
  total_figs numeric,
  current_streak integer,
  rhudes bigint,
  marks numeric,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id,
      CASE assignment.role WHEN 'sentry' THEN 1 ELSE 2 END,
      assignment.created_at DESC NULLS LAST
  ),
  latest_tent AS (
    SELECT DISTINCT ON (tm.user_id)
      tm.user_id,
      tm.tent_id,
      t.name AS tent_name,
      t.tent_house_id
    FROM public.tent_members tm
    LEFT JOIN public.tents t ON t.id = tm.tent_id
    ORDER BY tm.user_id, tm.joined_at DESC NULLS LAST
  ),
  fig_totals AS (
    SELECT user_id, SUM(figs)::numeric AS total_figs
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
  rhude_totals AS (
    SELECT
      room.winner_id AS user_id,
      COUNT(*)::bigint AS rhudes
    FROM public.arena_rooms room
    WHERE room.status = 'completed'
      AND room.winner_id IS NOT NULL
    GROUP BY room.winner_id
  ),
  rows AS (
    SELECT
      ar.user_id,
      p.display_name,
      p.avatar_url,
      ar.role,
      lt.tent_id,
      lt.tent_name,
      lt.tent_house_id,
      public.get_user_denarii_total(ar.user_id)::bigint AS total_denarii,
      COALESCE(ft.total_figs, 0)::numeric AS total_figs,
      COALESCE((SELECT current_streak FROM public.compute_strict_streak(ar.user_id) LIMIT 1), 0)::integer AS current_streak,
      COALESCE(rt.rhudes, 0)::bigint AS rhudes
    FROM active_roles ar
    JOIN public.profiles p ON p.id = ar.user_id
    LEFT JOIN latest_tent lt ON lt.user_id = ar.user_id
    LEFT JOIN fig_totals ft ON ft.user_id = ar.user_id
    LEFT JOIN rhude_totals rt ON rt.user_id = ar.user_id
  ),
  scored AS (
    SELECT
      rows.*,
      (
        COALESCE(rows.total_denarii, 0)::numeric
        + COALESCE(rows.total_figs, 0)::numeric * 100
        + COALESCE(rows.current_streak, 0)::numeric * 1000
        + COALESCE(rows.rhudes, 0)::numeric * 5000
      )::numeric AS marks
    FROM rows
  )
  SELECT
    scored.*,
    RANK() OVER (ORDER BY scored.marks DESC, scored.rhudes DESC, scored.total_figs DESC, scored.display_name ASC)::integer AS rank
  FROM scored
  WHERE scored.marks > 0
  ORDER BY rank ASC, scored.display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_marks_board_live() TO authenticated;
