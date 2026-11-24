-- Let the scheduling instructor adjust unstarted fixtures after qualifiers advance.
-- A round is updated in one transaction so players can be swapped between games.
CREATE OR REPLACE FUNCTION public.set_arena_tournament_game_players(
  p_tournament_id uuid, p_changes jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tournament public.arena_tournaments%ROWTYPE;
  v_game public.arena_tournament_games%ROWTYPE;
  v_room public.arena_rooms%ROWTYPE;
  v_change jsonb;
  v_game_id uuid;
  v_left uuid;
  v_right uuid;
  v_old_players uuid[];
  v_changed_games uuid[] := ARRAY[]::uuid[];
  v_player uuid;
BEGIN
  SELECT * INTO v_tournament FROM public.arena_tournaments
  WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() <> v_tournament.created_by
     OR NOT EXISTS (
       SELECT 1 FROM public.role_assignments assignment
       WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
         AND assignment.status IN ('active', 'approved')
     ) THEN
    RAISE EXCEPTION 'Only the scheduling instructor can change tournament players.';
  END IF;
  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'This tournament is closed.';
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 48 THEN
    RAISE EXCEPTION 'Choose at least one match to update.';
  END IF;

  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF jsonb_typeof(v_change->'player_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_change->'player_ids') <> 2 THEN
      RAISE EXCEPTION 'Choose two players for each match.';
    END IF;
    v_game_id := (v_change->>'game_id')::uuid;
    v_left := (v_change->'player_ids'->>0)::uuid;
    v_right := (v_change->'player_ids'->>1)::uuid;
    IF v_game_id IS NULL OR v_left IS NULL OR v_right IS NULL OR v_left = v_right
       OR v_game_id = ANY(v_changed_games) THEN
      RAISE EXCEPTION 'Choose two different players for each match.';
    END IF;
    v_changed_games := array_append(v_changed_games, v_game_id);
    SELECT * INTO v_game FROM public.arena_tournament_games
    WHERE id = v_game_id AND tournament_id = p_tournament_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That tournament match could not be found.'; END IF;
    IF v_game.winner_id IS NOT NULL OR v_game.left_player_id IS NULL
       OR v_game.right_player_id IS NULL OR v_game.room_id IS NULL THEN
      RAISE EXCEPTION 'Wait for both players to reach this match before changing it.';
    END IF;
    IF v_left <> ALL(v_tournament.player_ids) OR v_right <> ALL(v_tournament.player_ids) THEN
      RAISE EXCEPTION 'Choose players from this tournament.';
    END IF;
    IF v_game.round_number = 0 AND (
      v_left <> ALL(v_tournament.player_ids[(v_game.group_number - 1) * 4 + 1:v_game.group_number * 4])
      OR v_right <> ALL(v_tournament.player_ids[(v_game.group_number - 1) * 4 + 1:v_game.group_number * 4])
    ) THEN
      RAISE EXCEPTION 'Choose players from this group.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[v_left, v_right]) chosen(id)
      WHERE NOT (
        EXISTS (SELECT 1 FROM public.role_assignments assignment
          WHERE assignment.user_id = chosen.id AND assignment.role IN ('cadet', 'sentry')
            AND assignment.status IN ('active', 'approved'))
        OR EXISTS (SELECT 1 FROM public.tents tent WHERE tent.sentry_id = chosen.id)
        OR EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = chosen.id
          AND member.role IN ('cadet', 'sentry'))
      )
    ) THEN RAISE EXCEPTION 'Every selected player must be an active cadet or sentry.'; END IF;

    SELECT * INTO v_room FROM public.arena_rooms WHERE id = v_game.room_id FOR UPDATE;
    IF v_room.status <> 'waiting' OR v_room.expires_at <= now()
       OR EXISTS (SELECT 1 FROM public.arena_participants participant
         WHERE participant.room_id = v_game.room_id) THEN
      RAISE EXCEPTION 'This match has already begun or a player has entered its room.';
    END IF;
    IF v_left = v_game.left_player_id AND v_right = v_game.right_player_id THEN
      CONTINUE;
    END IF;

    v_old_players := ARRAY[v_game.left_player_id, v_game.right_player_id];
    UPDATE public.arena_tournament_games
    SET left_player_id = v_left, right_player_id = v_right WHERE id = v_game.id;
    UPDATE public.arena_rooms
    SET creator_id = v_left, tagged_user_ids = ARRAY[v_left, v_right]
    WHERE id = v_game.room_id;
    UPDATE public.arena_scheduled_matches
    SET player_ids = ARRAY[v_left, v_right] WHERE room_id = v_game.room_id;

    FOREACH v_player IN ARRAY v_old_players LOOP
      IF v_player <> ALL(ARRAY[v_left, v_right]) THEN
        PERFORM public.notify_user(v_player, auth.uid(), 'arena', 'Tournament lineup changed',
          'You are no longer selected for ' || v_room.room_name || '.', 'arena',
          jsonb_build_object('room_id', v_room.id, 'tournament_id', p_tournament_id));
      END IF;
    END LOOP;
    FOREACH v_player IN ARRAY ARRAY[v_left, v_right] LOOP
      IF v_player <> ALL(v_old_players) THEN
        PERFORM public.notify_user(v_player, auth.uid(), 'arena', 'Tournament match scheduled',
          'You were selected for ' || v_room.room_name || '.', 'arena',
          jsonb_build_object('room_id', v_room.id, 'tournament_id', p_tournament_id,
            'starts_at', (SELECT scheduled.starts_at FROM public.arena_scheduled_matches scheduled
              WHERE scheduled.room_id = v_room.id)));
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.arena_tournament_games game
    WHERE game.id = ANY(v_changed_games) AND game.round_number > 0
      AND EXISTS (
        SELECT 1 FROM public.arena_tournament_games other
        WHERE other.tournament_id = p_tournament_id AND other.round_number = game.round_number
          AND other.id <> game.id AND (
            game.left_player_id IN (other.left_player_id, other.right_player_id)
            OR game.right_player_id IN (other.left_player_id, other.right_player_id)
          )
      )
  ) THEN
    RAISE EXCEPTION 'A player can only be in one match per knockout round.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arena_tournament_games game
    WHERE game.id = ANY(v_changed_games) AND game.round_number = 0
      AND EXISTS (
        SELECT 1 FROM public.arena_tournament_games other
        WHERE other.tournament_id = p_tournament_id AND other.round_number = 0
          AND other.group_number = game.group_number AND other.id <> game.id
          AND LEAST(game.left_player_id, game.right_player_id)
            = LEAST(other.left_player_id, other.right_player_id)
          AND GREATEST(game.left_player_id, game.right_player_id)
            = GREATEST(other.left_player_id, other.right_player_id)
      )
  ) THEN
    RAISE EXCEPTION 'Each pair of group players can meet only once.';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_tournament_game_players(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_tournament_game_players(uuid, jsonb) TO authenticated;
