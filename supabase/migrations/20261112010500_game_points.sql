-- Game points are derived from server-recorded results, including historical wins.
CREATE FUNCTION public.get_game_points(p_game text DEFAULT NULL, p_players uuid[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH wins AS (
    SELECT DISTINCT a.user_id, 'daily_game' AS game, a.narrative_date::text || ':' || a.level AS result_id,
      CASE WHEN a.level <= 2 THEN 3 WHEN a.level <= 5 THEN 5 ELSE 7 END AS points
    FROM public.game_attempts a
    WHERE a.status = 'passed' AND a.mode <> 'practice'
    UNION ALL
    SELECT DISTINCT p.user_id, 'puzzle_trivia', p.difficulty || ':' || p.level,
      CASE p.difficulty WHEN 'easy' THEN 3 WHEN 'hard' THEN 7 ELSE 5 END
    FROM scripture_games.puzzle_runs p WHERE p.completed_at IS NOT NULL
    UNION ALL
    SELECT DISTINCT s.user_id, 'story_mode', s.level_slug, 5
    FROM public.story_mode_attempts s WHERE s.status = 'completed'
    UNION ALL
    SELECT CASE WHEN leg.room_id IS NULL THEN r.winner_id ELSE leg.leg_winner_id END,
      CASE
        WHEN prelude.room_id IS NOT NULL THEN 'prelude'
        WHEN journey.room_id IS NOT NULL THEN 'journey'
        WHEN ludo.room_id IS NOT NULL THEN 'ludo'
        ELSE 'standard'
      END,
      r.id::text,
      CASE
        WHEN r.play_mode IS DISTINCT FROM 'machine' THEN 10
        WHEN prelude.difficulty = 'easy' THEN 3
        WHEN prelude.difficulty = 'hard' THEN 7
        WHEN r.room_name ILIKE '%[difficulty:easy]%' THEN 3
        WHEN r.room_name ILIKE '%[difficulty:hard]%' THEN 7
        ELSE 5
      END
    FROM public.arena_rooms r
    LEFT JOIN public.arena_match_series_rounds leg ON leg.room_id = r.id
    LEFT JOIN scripture_games.prelude_games prelude ON prelude.room_id = r.id
    LEFT JOIN public.arena_journey_games journey ON journey.room_id = r.id
    LEFT JOIN public.arena_ludo_games ludo ON ludo.room_id = r.id
    WHERE r.status = 'completed' AND (r.winner_id IS NOT NULL OR leg.leg_winner_id IS NOT NULL)
  ), totals AS (
    SELECT user_id, game, sum(points) AS points
    FROM wins WHERE user_id IS NOT NULL
    GROUP BY GROUPING SETS ((user_id, game), (user_id))
  ), leaders AS (
    SELECT p.id AS user_id, p.display_name, p.avatar_url, p.player_number, t.points
    FROM totals t JOIN public.profiles p ON p.id = t.user_id
    WHERE t.game IS NOT DISTINCT FROM p_game
    ORDER BY t.points DESC, p.id
    LIMIT (CASE WHEN p_game IS NULL THEN 3 ELSE 1 END)
  )
  SELECT CASE WHEN auth.uid() IS NOT NULL THEN jsonb_build_object(
    'leaders', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.points DESC, l.user_id) FROM leaders l), '[]'::jsonb),
    'totals', coalesce((SELECT jsonb_object_agg(t.user_id, t.points) FROM totals t
                        WHERE t.game IS NULL AND t.user_id = ANY(p_players[1:12])), '{}'::jsonb)
  ) END;
$$;

REVOKE ALL ON FUNCTION public.get_game_points(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_points(text, uuid[]) TO authenticated;
