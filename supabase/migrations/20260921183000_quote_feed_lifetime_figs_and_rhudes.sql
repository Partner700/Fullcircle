/*
  Quote cards show lifetime economy totals. Board snapshots are useful for
  movement arrows, but may represent an older board run. Resolve only the
  authors in the visible feed against the canonical lifetime Fig calculation
  and completed Arena victories.
*/

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 100)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text,
  current_streak integer,
  total_figs integer,
  rhudes integer,
  role text,
  tent_house_id text,
  tent_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
    WHERE record.meditation_submitted = true
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
    active_tent.tent_name
  FROM candidates candidate
  JOIN public.profiles profile ON profile.id = candidate.user_id
  LEFT JOIN author_totals ON author_totals.user_id = candidate.user_id
  LEFT JOIN LATERAL (
    SELECT snapshot.current_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = candidate.user_id
    ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
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
$$;

REVOKE ALL ON FUNCTION public.get_daily_quote_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer)
  TO authenticated, service_role;
