-- Only explicitly dated games create rooms. Existing dated fixtures are unchanged.
ALTER TABLE public.arena_tournament_games ALTER COLUMN planned_at DROP NOT NULL;

-- Check all known ancestors, including across undated rounds and group qualifiers.
-- Internal helper: callable only by the existing privileged scheduling functions.
CREATE OR REPLACE FUNCTION public.arena_tournament_times_valid(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH RECURSIVE edges AS (
    SELECT game.id AS child, source.id AS parent
    FROM public.arena_tournament_games game
    JOIN public.arena_tournament_games source ON source.tournament_id = game.tournament_id
      AND (source.id IN (game.left_source_id, game.right_source_id)
        OR (game.round_number = 1 AND source.round_number = 0))
    WHERE game.tournament_id = p_tournament_id
  ), ancestors(child, parent) AS (
    SELECT child, parent FROM edges
    UNION
    SELECT ancestor.child, edge.parent FROM ancestors ancestor JOIN edges edge ON edge.child = ancestor.parent
  )
  SELECT NOT EXISTS (
    SELECT 1 FROM ancestors ancestor
    JOIN public.arena_tournament_games child ON child.id = ancestor.child
    JOIN public.arena_tournament_games parent ON parent.id = ancestor.parent
    WHERE child.planned_at < parent.planned_at + interval '20 minutes'
  );
$$;
REVOKE ALL ON FUNCTION public.arena_tournament_times_valid(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_instructor_arena_tournament_lineups(
  p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamptz[], p_has_group_stage boolean, p_game_players jsonb, p_bracket_size integer,
  p_journey_character_slug text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_group_count integer := 0;
  v_group integer;
  v_pair integer;
  v_choices jsonb;
  v_group_end timestamptz;
  v_expected_games integer;
  v_round integer;
  v_round_count integer;
  v_match_count integer;
  v_offset integer := 0;
  v_slot integer;
  v_index integer;
  v_left_source uuid;
  v_right_source uuid;
  v_left_time timestamptz;
  v_right_time timestamptz;
  v_game_id uuid;
  v_tournament_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'Only the instructor can schedule a tournament.'; END IF;
  IF p_game_type IS NULL OR p_game_type NOT IN ('standard', 'ludo', 'journey') THEN RAISE EXCEPTION 'Choose an Arena game.'; END IF;
  IF char_length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 50 THEN
    RAISE EXCEPTION 'Give the tournament a name of 3 to 50 characters.';
  END IF;
  IF p_game_type = 'journey' THEN
    IF p_title ~* '\[(arena|character):' THEN
      RAISE EXCEPTION 'Choose a tournament name without game tags.';
    END IF;
    PERFORM 1 FROM public.arena_journey_characters
    WHERE slug = p_journey_character_slug AND ready FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose a playable Journey narrative.'; END IF;
  ELSIF p_journey_character_slug IS NOT NULL THEN
    RAISE EXCEPTION 'A Journey narrative is only used for Journey Trivia.';
  END IF;
  v_count := coalesce(cardinality(p_player_ids), 0);
  IF p_has_group_stage IS NULL OR
    p_bracket_size IS NULL OR
    (p_has_group_stage AND (p_bracket_size NOT IN (8, 16, 32) OR v_count <> p_bracket_size)) OR
    (NOT p_has_group_stage AND (p_bracket_size NOT IN (2, 4, 8, 16)
      OR v_count < p_bracket_size OR v_count > 4 * (p_bracket_size - 1))) THEN
    RAISE EXCEPTION 'Choose a supported tournament start and number of players.';
  END IF;
  IF p_has_group_stage THEN
    v_group_count := p_bracket_size / 4;
    v_round_count := CASE p_bracket_size WHEN 8 THEN 2 WHEN 16 THEN 3 ELSE 4 END;
    v_expected_games := v_group_count * 6 + (p_bracket_size / 2 - 1);
  ELSE
    v_round_count := CASE p_bracket_size WHEN 2 THEN 1 WHEN 4 THEN 2 WHEN 8 THEN 3 ELSE 4 END;
    v_expected_games := p_bracket_size - 1;
  END IF;
  IF jsonb_typeof(p_game_players) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_game_players) <> v_expected_games THEN
    RAISE EXCEPTION 'Choose the participants for each match.';
  END IF;
  FOR v_choices IN SELECT value FROM jsonb_array_elements(p_game_players) LOOP
    IF jsonb_typeof(v_choices) IS DISTINCT FROM 'array' OR jsonb_array_length(v_choices) NOT BETWEEN 2 AND 4 THEN
      RAISE EXCEPTION 'Choose 2 to 4 player slots for every match.';
    END IF;
  END LOOP;
  IF coalesce(cardinality(p_game_times), 0) <> v_expected_games THEN
    RAISE EXCEPTION 'Provide one schedule entry per tournament match; use null for games to schedule later.';
  END IF;
  IF (SELECT count(DISTINCT chosen.id) FROM unnest(p_player_ids) chosen(id)) <> v_count THEN
    RAISE EXCEPTION 'Select each player only once.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_player_ids) chosen(id) WHERE chosen.id IS NULL OR NOT (
      EXISTS (SELECT 1 FROM public.role_assignments assignment
        WHERE assignment.user_id = chosen.id AND assignment.role IN ('cadet', 'sentry')
          AND assignment.status IN ('active', 'approved'))
      OR EXISTS (SELECT 1 FROM public.tents tent WHERE tent.sentry_id = chosen.id)
      OR EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = chosen.id
        AND member.role IN ('cadet', 'sentry'))
    )
  ) THEN RAISE EXCEPTION 'Every entrant must be an active cadet or sentry.'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_game_times) planned(at_time)
    WHERE planned.at_time IS NOT NULL AND (NOT isfinite(planned.at_time)
      OR planned.at_time < now() + interval '2 minutes'
      OR planned.at_time > now() + interval '90 days')
  ) THEN RAISE EXCEPTION 'Schedule selected games between two minutes and 90 days from now.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM unnest(p_game_times) planned(at_time) WHERE at_time IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose a date and time for at least one selected game.';
  END IF;

  INSERT INTO public.arena_tournaments(title, created_by, game_type, player_ids, has_group_stage, knockout_rounds, journey_character_slug)
  VALUES (btrim(p_title), auth.uid(), p_game_type, p_player_ids, p_has_group_stage, v_round_count, p_journey_character_slug)
  RETURNING id INTO v_tournament_id;

  IF p_has_group_stage THEN
    FOR v_group IN 1..v_group_count LOOP
      FOR v_pair IN 1..6 LOOP
        v_index := (v_group - 1) * 6 + v_pair;
        v_choices := p_game_players->(v_index - 1);
        INSERT INTO public.arena_tournament_games (
          tournament_id, round_number, match_number, group_number, planned_at,
          left_player_id, right_player_id, third_player_id, fourth_player_id
        ) VALUES (
          v_tournament_id, 0, v_index, v_group, p_game_times[v_index],
          (v_choices->>0)::uuid, (v_choices->>1)::uuid, (v_choices->>2)::uuid, (v_choices->>3)::uuid
        ) RETURNING id INTO v_game_id;
      END LOOP;
    END LOOP;
    v_offset := v_group_count * 6;
    SELECT max(scheduled.at_time) INTO v_group_end
    FROM unnest(p_game_times[1:v_offset]) scheduled(at_time);
  END IF;
  v_match_count := CASE WHEN p_has_group_stage THEN p_bracket_size / 4 ELSE p_bracket_size / 2 END;
  FOR v_round IN 1..v_round_count LOOP
    FOR v_slot IN 1..v_match_count LOOP
      v_index := v_offset + v_slot;
      v_left_source := NULL;
      v_right_source := NULL;
      IF v_round = 1 AND p_has_group_stage AND
        p_game_times[v_index] < v_group_end + interval '20 minutes' THEN
        RAISE EXCEPTION 'Allow at least 20 minutes after the group stage for knockout matches.';
      END IF;
      IF v_round > 1 THEN
        SELECT id, planned_at INTO v_left_source, v_left_time
        FROM public.arena_tournament_games
        WHERE tournament_id = v_tournament_id AND round_number = v_round - 1
          AND match_number = v_slot * 2 - 1;
        SELECT id, planned_at INTO v_right_source, v_right_time
        FROM public.arena_tournament_games
        WHERE tournament_id = v_tournament_id AND round_number = v_round - 1
          AND match_number = v_slot * 2;
        IF p_game_times[v_index] < greatest(v_left_time, v_right_time) + interval '20 minutes' THEN
          RAISE EXCEPTION 'Allow at least 20 minutes after both preceding games for the next round.';
        END IF;
      END IF;
      v_choices := p_game_players->(v_index - 1);
      INSERT INTO public.arena_tournament_games (
        tournament_id, round_number, match_number, planned_at,
        left_player_id, right_player_id, left_source_id, right_source_id, left_override_id, right_override_id, third_player_id, fourth_player_id
      ) VALUES (
        v_tournament_id, v_round, v_slot, p_game_times[v_index],
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN (v_choices->>0)::uuid ELSE NULL END,
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN (v_choices->>1)::uuid ELSE NULL END,
        v_left_source, v_right_source,
        CASE WHEN v_round > 1 OR p_has_group_stage THEN (v_choices->>0)::uuid ELSE NULL END,
        CASE WHEN v_round > 1 OR p_has_group_stage THEN (v_choices->>1)::uuid ELSE NULL END,
        (v_choices->>2)::uuid, (v_choices->>3)::uuid
      ) RETURNING id INTO v_game_id;
    END LOOP;
    v_offset := v_offset + v_match_count;
    v_match_count := v_match_count / 2;
  END LOOP;
  IF NOT public.arena_tournament_times_valid(v_tournament_id) THEN
    RAISE EXCEPTION 'Allow at least 20 minutes after preceding scheduled games.';
  END IF;
  IF public.arena_tournament_lineup_issue(v_tournament_id) IS NOT NULL THEN
    RAISE EXCEPTION '%', public.arena_tournament_lineup_issue(v_tournament_id);
  END IF;
  FOR v_game_id IN SELECT id FROM public.arena_tournament_games
    WHERE tournament_id = v_tournament_id AND round_number = CASE WHEN p_has_group_stage THEN 0 ELSE 1 END
    ORDER BY match_number LOOP
    PERFORM public.create_arena_tournament_room(v_game_id);
  END LOOP;
  RETURN v_tournament_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_arena_tournament_room(p_game_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_room_id uuid;
  v_starts_at timestamptz;
  v_name text;
  v_player uuid;
  v_players uuid[];
BEGIN
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.room_id IS NOT NULL OR v_game.left_player_id IS NULL
     OR v_game.right_player_id IS NULL THEN
    RAISE EXCEPTION 'The tournament match is not ready.';
  END IF;
  -- An undated fixture stays in the bracket without creating a room or notifications.
  IF v_game.planned_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_game.tournament_id;
  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'The tournament is closed.';
  END IF;
  v_players := public.arena_tournament_players(v_game);
  -- A manual future choice must not prevent a preceding match from finishing.
  IF cardinality(v_players) NOT BETWEEN 2 AND 4
     OR public.arena_tournament_lineup_issue(v_tournament.id, ARRAY[v_game.id]) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  v_starts_at := greatest(v_game.planned_at, now() + interval '1 minute');
  v_name := v_tournament.title || CASE WHEN v_game.round_number = 0 THEN
    ' - Group ' || chr(64 + v_game.group_number) || ' Game ' || (((v_game.match_number - 1) % 6) + 1)::text
    ELSE ' - ' || CASE v_tournament.knockout_rounds - v_game.round_number
      WHEN 0 THEN 'Final' WHEN 1 THEN 'Semi-final' WHEN 2 THEN 'Quarter-final'
      ELSE 'Round of 16' END || ' ' || v_game.match_number::text END ||
    ' [arena:' || v_tournament.game_type || ']'
    || CASE WHEN v_tournament.game_type = 'journey' THEN ' [character:' || v_tournament.journey_character_slug || ']' ELSE '' END;
  INSERT INTO public.arena_rooms (
    creator_id, room_name, stake_amount, max_players, status,
    tagged_user_ids, game_call_fee, expires_at
  ) VALUES (
    v_players[1], v_name, 0, cardinality(v_players), 'waiting',
    v_players, 0, v_starts_at + interval '2 hours'
  ) RETURNING id INTO v_room_id;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (v_room_id, v_tournament.created_by, v_starts_at,
    v_players);
  UPDATE public.arena_tournament_games SET room_id = v_room_id WHERE id = p_game_id;
  FOREACH v_player IN ARRAY v_players LOOP
    PERFORM public.notify_user(v_player, v_tournament.created_by, 'arena', 'Tournament match scheduled',
      'You were selected for ' || v_name || '.', 'arena',
      jsonb_build_object('room_id', v_room_id, 'tournament_id', v_tournament.id, 'starts_at', v_starts_at));
  END LOOP;
  RETURN v_room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_arena_tournament_room(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_arena_tournament_game(p_game_id uuid, p_starts_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_tournament_id uuid;
  v_room_status text;
BEGIN
  SELECT tournament_id INTO v_tournament_id FROM public.arena_tournament_games WHERE id = p_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament game not found.'; END IF;
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF auth.uid() IS NULL OR auth.uid() <> v_tournament.created_by OR v_tournament.status IN ('completed', 'cancelled')
     OR NOT EXISTS (SELECT 1 FROM public.role_assignments WHERE user_id = auth.uid()
       AND role = 'instructor' AND status IN ('active', 'approved')) THEN
    RAISE EXCEPTION 'Only the scheduling instructor can reschedule this game.';
  END IF;
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.tournament_id <> v_tournament_id THEN
    RAISE EXCEPTION 'Tournament game not found.';
  END IF;
  IF v_game.winner_id IS NOT NULL THEN
    RAISE EXCEPTION 'This game is not ready for a replay.';
  END IF;
  SELECT status INTO v_room_status FROM public.arena_rooms WHERE id = v_game.room_id;
  IF v_game.room_id IS NOT NULL AND v_room_status NOT IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Only an ended game without a winner can be rescheduled.';
  END IF;
  IF p_starts_at IS NULL OR NOT isfinite(p_starts_at) OR p_starts_at < now() + interval '2 minutes' OR p_starts_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a time between two minutes and 90 days from now.';
  END IF;
  UPDATE public.arena_tournament_games SET planned_at = p_starts_at, room_id = NULL WHERE id = p_game_id;
  IF NOT public.arena_tournament_times_valid(v_tournament_id) THEN
    RAISE EXCEPTION 'Allow at least 20 minutes after preceding scheduled games.';
  END IF;
  IF v_game.left_player_id IS NOT NULL AND v_game.right_player_id IS NOT NULL THEN
    RETURN public.create_arena_tournament_room(p_game_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_arena_tournament_game(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_arena_tournament_game(uuid, timestamptz) TO authenticated;

