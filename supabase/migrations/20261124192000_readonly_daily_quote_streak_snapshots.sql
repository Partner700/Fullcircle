-- Avoid recomputing/writing dozens of streak-day rows per visible quote every time a reader refreshes the quote feed.
CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 100)
 RETURNS TABLE(record_date date, daily_quote text, user_id uuid, display_name text, avatar_url text, current_streak integer, total_figs integer, rhudes integer, role text, tent_house_id text, tent_name text, released_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH clock AS (
    SELECT
      timezone('Africa/Douala', now())::date AS today,
      extract(isodow FROM timezone('Africa/Douala', now()))::integer AS iso_day,
      date_trunc('week', timezone('Africa/Douala', now()))::date AS week_start
  ),
  candidates AS MATERIALIZED (
    SELECT
      record.record_date,
      record.daily_quote,
      record.user_id,
      record.meditation_submitted_at,
      clock.iso_day
    FROM public.daily_records record
    CROSS JOIN clock
    WHERE record.meditation_submitted = true AND camp_management.can_view_member_streak(record.user_id)
      AND NULLIF(btrim(record.daily_quote), '') IS NOT NULL
      AND (
        (clock.iso_day IN (6, 7) AND record.record_date BETWEEN clock.week_start AND clock.today)
        OR (clock.iso_day NOT IN (6, 7) AND record.record_date = clock.today)
      )
  ),
  candidate_users AS MATERIALIZED (
    SELECT DISTINCT candidate.user_id
    FROM candidates candidate
  ),
  author_totals AS MATERIALIZED (
    SELECT
      author.user_id,
      COALESCE(public.get_user_lifetime_figs(author.user_id, NULL), 0)::integer AS total_figs,
      (
        SELECT count(*)::integer
        FROM public.arena_rooms room
        WHERE room.winner_id = author.user_id
          AND room.status = 'completed'
      ) AS rhudes
    FROM candidate_users author
  )
  SELECT
    candidate.record_date,
    candidate.daily_quote,
    candidate.user_id,
    profile.display_name,
    profile.avatar_url,
    COALESCE(streak.current_streak, 0)::integer,
    COALESCE(author_totals.total_figs, 0)::integer,
    COALESCE(author_totals.rhudes, 0)::integer,
    COALESCE(active_role.role, 'cadet')::text,
    active_tent.tent_house_id,
    active_tent.tent_name,
    candidate.meditation_submitted_at
  FROM candidates candidate
  JOIN public.profiles profile ON profile.id = candidate.user_id
  LEFT JOIN author_totals ON author_totals.user_id = candidate.user_id
  -- The quote feed must be read-only: computing a fresh authoritative streak
  -- per author here writes many historical state rows on every feed request.
  -- A participant's streak remains calculated authoritatively by existing
  -- meditation and streak actions.
  LEFT JOIN LATERAL (
    SELECT current_streak
    FROM public.streak_forward_daily_states state
    WHERE state.user_id = candidate.user_id
      AND state.record_date <= timezone('Africa/Douala', now())::date
    ORDER BY state.record_date DESC
    LIMIT 1
  ) streak ON true
  LEFT JOIN LATERAL (
    SELECT assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.user_id = candidate.user_id
      AND assignment.status IN ('active', 'approved')
    ORDER BY
      CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
      CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
      assignment.start_date DESC NULLS LAST,
      assignment.created_at DESC
    LIMIT 1
  ) active_role ON true
  LEFT JOIN LATERAL (
    SELECT tent.tent_house_id, tent.name AS tent_name
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    WHERE member.user_id = candidate.user_id
    ORDER BY member.joined_at DESC
    LIMIT 1
  ) active_tent ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS reaction_count
    FROM public.daily_quote_reactions reaction
    WHERE reaction.quote_user_id = candidate.user_id
      AND reaction.quote_record_date = candidate.record_date
  ) reactions ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS comment_count
    FROM public.daily_quote_comments comment
    WHERE comment.quote_user_id = candidate.user_id
      AND comment.quote_record_date = candidate.record_date
  ) comments ON true
  ORDER BY
    CASE WHEN candidate.iso_day IN (6, 7)
      THEN COALESCE(reactions.reaction_count, 0) + COALESCE(comments.comment_count, 0)
    END DESC,
    CASE WHEN candidate.iso_day IN (6, 7) THEN candidate.record_date END DESC,
    candidate.meditation_submitted_at DESC NULLS LAST,
    profile.display_name ASC
  LIMIT CASE
    WHEN (SELECT iso_day FROM clock) IN (6, 7) THEN 3
    ELSE LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250)
  END;
$function$
;
