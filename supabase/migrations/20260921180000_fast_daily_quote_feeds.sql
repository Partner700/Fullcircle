/*
  Daily quote feeds are page content, not a place to recompute the economy for
  every resident. Read the already-maintained streak and board snapshots only
  for people whose quotes are actually being returned.
*/

CREATE INDEX IF NOT EXISTS streakboard_snapshots_user_latest_idx
  ON public.streakboard_snapshots (user_id, snapshot_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS challenge_board_snapshots_subject_latest_idx
  ON public.challenge_board_daily_snapshots
    (subject_id, board_key, snapshot_date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS daily_records_quote_feed_idx
  ON public.daily_records (record_date DESC, meditation_submitted_at DESC)
  WHERE meditation_submitted = true AND daily_quote IS NOT NULL;

CREATE INDEX IF NOT EXISTS daily_quote_reactions_quote_idx
  ON public.daily_quote_reactions (quote_user_id, quote_record_date);

CREATE INDEX IF NOT EXISTS daily_quote_comments_quote_idx
  ON public.daily_quote_comments (quote_user_id, quote_record_date);

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
  )
  SELECT
    candidate.record_date,
    candidate.daily_quote,
    candidate.user_id,
    profile.display_name,
    profile.avatar_url,
    COALESCE(streak.current_streak, 0)::integer,
    COALESCE(figs.current_value, 0)::integer,
    COALESCE(rhude.current_value, 0)::integer,
    COALESCE(active_role.role, 'cadet')::text,
    active_tent.tent_house_id,
    active_tent.tent_name
  FROM candidates candidate
  JOIN public.profiles profile ON profile.id = candidate.user_id
  LEFT JOIN LATERAL (
    SELECT snapshot.current_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = candidate.user_id
    ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  ) streak ON true
  LEFT JOIN LATERAL (
    SELECT snapshot.current_value
    FROM public.challenge_board_daily_snapshots snapshot
    WHERE snapshot.subject_id = candidate.user_id
      AND snapshot.board_key = 'figs'
    ORDER BY snapshot.snapshot_date DESC, snapshot.updated_at DESC
    LIMIT 1
  ) figs ON true
  LEFT JOIN LATERAL (
    SELECT snapshot.current_value
    FROM public.challenge_board_daily_snapshots snapshot
    WHERE snapshot.subject_id = candidate.user_id
      AND snapshot.board_key = 'rhude'
    ORDER BY snapshot.snapshot_date DESC, snapshot.updated_at DESC
    LIMIT 1
  ) rhude ON true
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

CREATE OR REPLACE FUNCTION public.get_public_daily_quotes(
  p_record_date date,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'record_date', quote.record_date,
        'daily_quote', quote.daily_quote,
        'user_id', quote.user_id,
        'display_name', quote.display_name,
        'avatar_url', quote.avatar_url,
        'current_streak', COALESCE(streak.current_streak, 0),
        'has_public_meditation', quote.has_public_meditation
      )
      ORDER BY quote.meditation_submitted_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      record.record_date,
      record.daily_quote,
      record.user_id,
      profile.display_name,
      profile.avatar_url,
      (
        record.meditation_public
        AND NULLIF(btrim(record.meditation_text), '') IS NOT NULL
      ) AS has_public_meditation,
      record.meditation_submitted_at
    FROM public.daily_records record
    JOIN public.profiles profile ON profile.id = record.user_id
    WHERE record.record_date = p_record_date
      AND record.meditation_submitted = true
      AND NULLIF(btrim(record.daily_quote), '') IS NOT NULL
    ORDER BY record.meditation_submitted_at DESC NULLS LAST
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30)
  ) quote
  LEFT JOIN LATERAL (
    SELECT snapshot.current_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = quote.user_id
    ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  ) streak ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_daily_quotes(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_daily_quotes(date, integer)
  TO anon, authenticated, service_role;

