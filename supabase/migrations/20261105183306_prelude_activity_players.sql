-- Prelude activity uses started rounds, never waiting room signups.
-- Extend the existing authenticated public-profile feed, preserving its auth guard.
CREATE OR REPLACE FUNCTION public.get_game_activity_players(
  p_activity_date date DEFAULT timezone('Africa/Douala', now())::date
)
RETURNS TABLE (
  activity text,
  user_id uuid,
  display_name text,
  avatar_url text,
  played_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  RETURN QUERY
  WITH daily_events AS (
    SELECT
      run.user_id,
      coalesce(run.completed_at, response.last_response_at, run.started_at) AS played_at
    FROM public.daily_game_runs run
    LEFT JOIN LATERAL (
      SELECT max(answer.created_at) AS last_response_at
      FROM public.daily_game_responses answer
      WHERE answer.run_id = run.id
    ) response ON true
    WHERE (run.status = 'completed' OR response.last_response_at IS NOT NULL)

    UNION ALL

    SELECT
      attempt.user_id,
      coalesce(attempt.completed_at, attempt.created_at) AS played_at
    FROM public.game_attempts attempt
    WHERE attempt.status IN ('passed', 'failed')
  ),
  daily_players AS (
    SELECT event.user_id, max(event.played_at) AS played_at
    FROM daily_events event
    WHERE timezone('Africa/Douala', event.played_at)::date = p_activity_date
    GROUP BY event.user_id
  ),
  arena_players AS (
    SELECT
      participant.user_id,
      max(coalesce(participant.finished_at, room.completed_at, room.started_at, participant.joined_at)) AS played_at
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE room.status IN ('playing', 'completed')
      AND timezone(
        'Africa/Douala',
        coalesce(participant.finished_at, room.completed_at, room.started_at, participant.joined_at)
      )::date = p_activity_date
    GROUP BY participant.user_id
  )
  SELECT
    'daily_game'::text,
    profile.id,
    profile.display_name,
    profile.avatar_url,
    daily.played_at
  FROM daily_players daily
  JOIN public.profiles profile ON profile.id = daily.user_id

  UNION ALL

  SELECT
    'arena'::text,
    profile.id,
    profile.display_name,
    profile.avatar_url,
    arena.played_at
  FROM arena_players arena
  JOIN public.profiles profile ON profile.id = arena.user_id

  UNION ALL

  SELECT 'puzzle_trivia'::text, profile.id, profile.display_name,
    profile.avatar_url, puzzle.played_at
  FROM public.puzzle_trivia_activity puzzle
  JOIN public.profiles profile ON profile.id = puzzle.user_id
  WHERE puzzle.activity_date = p_activity_date

  UNION ALL

  SELECT 'prelude'::text, profile.id, profile.display_name,
    profile.avatar_url, prelude.played_at
  FROM (
    SELECT participant.user_id,
      max(coalesce(participant.finished_at, room.completed_at, room.started_at)) AS played_at
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE room.room_name LIKE '%[arena:prelude]%'
      AND room.started_at IS NOT NULL
      AND room.status IN ('playing', 'completed')
      AND timezone('Africa/Douala',
        coalesce(participant.finished_at, room.completed_at, room.started_at)
      )::date = p_activity_date
    GROUP BY participant.user_id
  ) prelude
  JOIN public.profiles profile ON profile.id = prelude.user_id

  ORDER BY 5 DESC, 3 ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_game_activity_players(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_activity_players(date) TO authenticated, service_role;

