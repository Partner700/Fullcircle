/*
  Keep challenge boards responsive for everyone, especially sentries.
  This reads the same published snapshots maintained by the authoritative
  streak lifecycle instead of recalculating a complete streak history per row.
*/

CREATE OR REPLACE FUNCTION public.get_fast_streakboard_for_role(p_role text)
RETURNS TABLE(
  id uuid,
  snapshot_date date,
  user_id uuid,
  role text,
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_people AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.role = p_role
      AND assignment.status IN ('active', 'approved')
      AND p_role IN ('cadet', 'sentry')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ),
  latest_snapshot AS (
    SELECT DISTINCT ON (snapshot.user_id)
      snapshot.user_id,
      snapshot.snapshot_date,
      snapshot.tent_id,
      snapshot.tent_house_id,
      snapshot.volume,
      snapshot.consistency,
      snapshot.improvement,
      snapshot.current_streak,
      snapshot.longest_streak
    FROM public.streakboard_snapshots snapshot
    JOIN active_people person ON person.user_id = snapshot.user_id
    ORDER BY snapshot.user_id, snapshot.snapshot_date DESC, snapshot.created_at DESC, snapshot.id DESC
  ),
  valid_days AS (
    SELECT record.user_id, count(*)::integer AS volume
    FROM public.daily_records record
    JOIN active_people person ON person.user_id = record.user_id
    WHERE coalesce(record.streak_valid, false)
    GROUP BY record.user_id
  ),
  current_tents AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      member.tent_id,
      tent.tent_house_id
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    JOIN active_people person ON person.user_id = member.user_id
    WHERE member.role = p_role
    ORDER BY member.user_id, member.joined_at DESC NULLS LAST
  ),
  scored AS (
    SELECT
      person.user_id,
      person.role,
      coalesce(tent.tent_id, snapshot.tent_id) AS tent_id,
      coalesce(tent.tent_house_id, snapshot.tent_house_id) AS tent_house_id,
      coalesce(days.volume, snapshot.volume, 0)::integer AS volume,
      coalesce(snapshot.consistency, snapshot.current_streak, 0)::integer AS consistency,
      coalesce(snapshot.improvement, 0)::numeric AS improvement,
      coalesce(snapshot.current_streak, 0)::integer AS current_streak,
      greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))::integer AS longest_streak,
      coalesce(snapshot.snapshot_date, timezone('Africa/Douala', now())::date) AS snapshot_date,
      profile.display_name,
      profile.avatar_url
    FROM active_people person
    JOIN public.profiles profile ON profile.id = person.user_id
    LEFT JOIN latest_snapshot snapshot ON snapshot.user_id = person.user_id
    LEFT JOIN valid_days days ON days.user_id = person.user_id
    LEFT JOIN current_tents tent ON tent.user_id = person.user_id
  )
  SELECT
    gen_random_uuid(),
    scored.snapshot_date,
    scored.user_id,
    scored.role,
    scored.tent_id,
    scored.tent_house_id,
    scored.volume,
    scored.consistency,
    scored.improvement,
    scored.current_streak,
    scored.longest_streak,
    0::integer,
    0::integer,
    rank() OVER (ORDER BY scored.current_streak DESC, scored.longest_streak DESC, scored.volume DESC, scored.display_name ASC)::integer,
    jsonb_build_object('display_name', scored.display_name, 'avatar_url', scored.avatar_url)
  FROM scored
  ORDER BY rank, scored.display_name;
$$;

REVOKE ALL ON FUNCTION public.get_fast_streakboard_for_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fast_streakboard_for_role(text) TO authenticated, service_role;
