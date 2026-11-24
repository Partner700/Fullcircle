-- Keep automatic qualifiers separate from the instructor's explicit per-match choices.
ALTER TABLE public.arena_tournament_games
  ADD COLUMN IF NOT EXISTS left_override_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS right_override_id uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.arena_tournament_lineup_issue(p_tournament_id uuid, p_game_ids uuid[] DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tournament public.arena_tournaments%ROWTYPE;
  v_game record;
BEGIN
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = p_tournament_id;
  FOR v_game IN SELECT game.*, coalesce(game.left_override_id, game.left_player_id) AS chosen_left,
    coalesce(game.right_override_id, game.right_player_id) AS chosen_right
    FROM public.arena_tournament_games game WHERE tournament_id = p_tournament_id
      AND (p_game_ids IS NULL OR game.id = ANY(p_game_ids)) LOOP
    IF (v_game.round_number = 0 OR (v_game.round_number = 1 AND NOT v_tournament.has_group_stage))
       AND (v_game.chosen_left IS NULL OR v_game.chosen_right IS NULL) THEN
      RETURN 'Choose both players for every first-round match.';
    END IF;
    IF v_game.chosen_left = v_game.chosen_right THEN RETURN 'Choose two different players for each match.'; END IF;
    IF v_game.chosen_left <> ALL(v_tournament.player_ids) OR v_game.chosen_right <> ALL(v_tournament.player_ids) THEN
      RETURN 'Choose players from this tournament.';
    END IF;
    IF v_game.round_number = 0 AND (
      v_game.chosen_left <> ALL(v_tournament.player_ids[(v_game.group_number - 1) * 4 + 1:v_game.group_number * 4])
      OR v_game.chosen_right <> ALL(v_tournament.player_ids[(v_game.group_number - 1) * 4 + 1:v_game.group_number * 4])
    ) THEN RETURN 'Choose players from this group.'; END IF;
    IF EXISTS (SELECT 1 FROM public.arena_tournament_games other
      WHERE other.tournament_id = p_tournament_id AND other.id <> v_game.id
        AND other.round_number = v_game.round_number AND (
          (v_game.round_number > 0 AND (
            v_game.chosen_left IN (coalesce(other.left_override_id, other.left_player_id), coalesce(other.right_override_id, other.right_player_id))
            OR v_game.chosen_right IN (coalesce(other.left_override_id, other.left_player_id), coalesce(other.right_override_id, other.right_player_id))))
          OR (v_game.round_number = 0 AND other.group_number = v_game.group_number
            AND LEAST(v_game.chosen_left, v_game.chosen_right)
              = LEAST(coalesce(other.left_override_id, other.left_player_id), coalesce(other.right_override_id, other.right_player_id))
            AND GREATEST(v_game.chosen_left, v_game.chosen_right)
              = GREATEST(coalesce(other.left_override_id, other.left_player_id), coalesce(other.right_override_id, other.right_player_id)))
        )) THEN
      RETURN CASE WHEN v_game.round_number = 0 THEN 'Each pair of group players can meet only once.'
        ELSE 'A player can only be in one match per knockout round.' END;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.arena_tournament_lineup_issue(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_arena_tournament_room(p_game_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_room_id uuid;
  v_starts_at timestamptz;
  v_name text;
  v_player uuid;
  v_left uuid;
  v_right uuid;
BEGIN
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.room_id IS NOT NULL OR v_game.left_player_id IS NULL
     OR v_game.right_player_id IS NULL THEN
    RAISE EXCEPTION 'The tournament match is not ready.';
  END IF;
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_game.tournament_id;
  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'The tournament is closed.';
  END IF;
  v_left := coalesce(v_game.left_override_id, v_game.left_player_id);
  v_right := coalesce(v_game.right_override_id, v_game.right_player_id);
  -- A manual future choice must not prevent a preceding match from finishing.
  IF public.arena_tournament_lineup_issue(v_tournament.id, ARRAY[v_game.id]) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  v_starts_at := greatest(v_game.planned_at, now() + interval '1 minute');
  v_name := v_tournament.title || CASE WHEN v_game.round_number = 0 THEN
    ' - Group ' || chr(64 + v_game.group_number) || ' Game ' || (((v_game.match_number - 1) % 6) + 1)::text
    ELSE ' - ' || CASE v_tournament.knockout_rounds - v_game.round_number
      WHEN 0 THEN 'Final' WHEN 1 THEN 'Semi-final' WHEN 2 THEN 'Quarter-final'
      ELSE 'Round of 16' END || ' ' || v_game.match_number::text END ||
    ' [arena:' || v_tournament.game_type || ']';
  INSERT INTO public.arena_rooms (
    creator_id, room_name, stake_amount, max_players, status,
    tagged_user_ids, game_call_fee, expires_at
  ) VALUES (
    v_left, v_name, 0, 2, 'waiting',
    ARRAY[v_left, v_right], 0, v_starts_at + interval '2 hours'
  ) RETURNING id INTO v_room_id;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (v_room_id, v_tournament.created_by, v_starts_at,
    ARRAY[v_left, v_right]);
  UPDATE public.arena_tournament_games SET room_id = v_room_id WHERE id = p_game_id;
  FOREACH v_player IN ARRAY ARRAY[v_left, v_right] LOOP
    PERFORM public.notify_user(v_player, v_tournament.created_by, 'arena', 'Tournament match scheduled',
      'You were selected for ' || v_name || '.', 'arena',
      jsonb_build_object('room_id', v_room_id, 'tournament_id', v_tournament.id, 'starts_at', v_starts_at));
  END LOOP;
  RETURN v_room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_arena_tournament_room(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_instructor_arena_tournament_with_fixtures(
  p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamptz[], p_has_group_stage boolean, p_game_players jsonb
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
  IF p_game_type NOT IN ('standard', 'ludo') THEN RAISE EXCEPTION 'Choose an Arena game.'; END IF;
  IF char_length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 50 THEN
    RAISE EXCEPTION 'Give the tournament a name of 3 to 50 characters.';
  END IF;
  v_count := coalesce(cardinality(p_player_ids), 0);
  IF p_has_group_stage IS NULL OR
    (p_has_group_stage AND v_count NOT IN (8, 16, 32)) OR
    (NOT p_has_group_stage AND v_count NOT IN (2, 4, 8, 16)) THEN
    RAISE EXCEPTION 'Choose a supported tournament start and number of players.';
  END IF;
  IF p_has_group_stage THEN
    v_group_count := v_count / 4;
    v_round_count := CASE v_count WHEN 8 THEN 2 WHEN 16 THEN 3 ELSE 4 END;
    v_expected_games := v_group_count * 6 + (v_count / 2 - 1);
  ELSE
    v_round_count := CASE v_count WHEN 2 THEN 1 WHEN 4 THEN 2 WHEN 8 THEN 3 ELSE 4 END;
    v_expected_games := v_count - 1;
  END IF;
  IF jsonb_typeof(p_game_players) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_game_players) <> v_expected_games THEN
    RAISE EXCEPTION 'Choose the participants for each match.';
  END IF;
  FOR v_choices IN SELECT value FROM jsonb_array_elements(p_game_players) LOOP
    IF jsonb_typeof(v_choices) IS DISTINCT FROM 'array' OR jsonb_array_length(v_choices) <> 2 THEN
      RAISE EXCEPTION 'Choose two player slots for every match.';
    END IF;
  END LOOP;
  IF coalesce(cardinality(p_game_times), 0) <> v_expected_games THEN
    RAISE EXCEPTION 'Schedule a date and time for every tournament match.';
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
    WHERE planned.at_time IS NULL OR planned.at_time < now() + interval '2 minutes'
      OR planned.at_time > now() + interval '90 days'
  ) THEN RAISE EXCEPTION 'Schedule every game between two minutes and 90 days from now.'; END IF;

  INSERT INTO public.arena_tournaments(title, created_by, game_type, player_ids, has_group_stage, knockout_rounds)
  VALUES (btrim(p_title), auth.uid(), p_game_type, p_player_ids, p_has_group_stage, v_round_count)
  RETURNING id INTO v_tournament_id;

  IF p_has_group_stage THEN
    FOR v_group IN 1..v_group_count LOOP
      FOR v_pair IN 1..6 LOOP
        v_index := (v_group - 1) * 6 + v_pair;
        v_choices := p_game_players->(v_index - 1);
        INSERT INTO public.arena_tournament_games (
          tournament_id, round_number, match_number, group_number, planned_at,
          left_player_id, right_player_id
        ) VALUES (
          v_tournament_id, 0, v_index, v_group, p_game_times[v_index],
          (v_choices->>0)::uuid, (v_choices->>1)::uuid
        ) RETURNING id INTO v_game_id;
      END LOOP;
    END LOOP;
    v_offset := v_group_count * 6;
    SELECT max(scheduled.at_time) INTO v_group_end
    FROM unnest(p_game_times[1:v_offset]) scheduled(at_time);
  END IF;
  v_match_count := CASE WHEN p_has_group_stage THEN v_count / 4 ELSE v_count / 2 END;
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
        left_player_id, right_player_id, left_source_id, right_source_id, left_override_id, right_override_id
      ) VALUES (
        v_tournament_id, v_round, v_slot, p_game_times[v_index],
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN (v_choices->>0)::uuid ELSE NULL END,
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN (v_choices->>1)::uuid ELSE NULL END,
        v_left_source, v_right_source,
        CASE WHEN v_round > 1 OR p_has_group_stage THEN (v_choices->>0)::uuid ELSE NULL END,
        CASE WHEN v_round > 1 OR p_has_group_stage THEN (v_choices->>1)::uuid ELSE NULL END
      ) RETURNING id INTO v_game_id;
    END LOOP;
    v_offset := v_offset + v_match_count;
    v_match_count := v_match_count / 2;
  END LOOP;
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
REVOKE ALL ON FUNCTION public.create_instructor_arena_tournament_with_fixtures(text, text, uuid[], timestamptz[], boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_instructor_arena_tournament_with_fixtures(text, text, uuid[], timestamptz[], boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_arena_tournaments()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to view tournaments.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', tournament.id, 'title', tournament.title, 'game_type', tournament.game_type,
    'status', tournament.status, 'created_by', tournament.created_by,
    'has_group_stage', tournament.has_group_stage,
    'champion_id', tournament.champion_id,
    'players', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', profile.id, 'display_name', profile.display_name, 'avatar_url', profile.avatar_url)
      ORDER BY selected.ordinal), '[]'::jsonb)
      FROM unnest(tournament.player_ids) WITH ORDINALITY selected(id, ordinal)
      JOIN public.profiles profile ON profile.id = selected.id),
    'games', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', game.id, 'round_number', game.round_number, 'match_number', game.match_number,
      'planned_at', game.planned_at, 'room_id', game.room_id,
      'room_status', room.status, 'starts_at', scheduled.starts_at,
      'left_player_id', coalesce(game.left_override_id, game.left_player_id),
      'right_player_id', coalesce(game.right_override_id, game.right_player_id),
      'automatic_left_player_id', game.left_player_id, 'automatic_right_player_id', game.right_player_id,
      'left_override_id', game.left_override_id, 'right_override_id', game.right_override_id,
      'can_edit_players', tournament.created_by = auth.uid() AND tournament.status NOT IN ('completed', 'cancelled')
        AND EXISTS (SELECT 1 FROM public.role_assignments assignment WHERE assignment.user_id = auth.uid()
          AND assignment.role = 'instructor' AND assignment.status IN ('active', 'approved'))
        AND game.winner_id IS NULL AND (game.room_id IS NULL OR (room.status = 'waiting' AND room.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM public.arena_participants participant WHERE participant.room_id = game.room_id))),
      'winner_id', game.winner_id) ORDER BY game.round_number, game.match_number), '[]'::jsonb)
      FROM public.arena_tournament_games game
      LEFT JOIN public.arena_rooms room ON room.id = game.room_id
      LEFT JOIN public.arena_scheduled_matches scheduled ON scheduled.room_id = game.room_id
      WHERE game.tournament_id = tournament.id)
  ) ORDER BY tournament.created_at DESC)
  FROM (SELECT * FROM public.arena_tournaments ORDER BY created_at DESC LIMIT 12) tournament), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_arena_tournaments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_tournaments() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_arena_tournament_game_players(p_tournament_id uuid, p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  v_issue text;
BEGIN
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = p_tournament_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() <> v_tournament.created_by
     OR NOT EXISTS (SELECT 1 FROM public.role_assignments assignment
       WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
         AND assignment.status IN ('active', 'approved')) THEN
    RAISE EXCEPTION 'Only the scheduling instructor can change tournament players.';
  END IF;
  IF v_tournament.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This tournament is closed.'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 63 THEN
    RAISE EXCEPTION 'Choose at least one match to update.';
  END IF;

  -- Apply the whole draft before checking it, so swapping two matches is atomic.
  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF jsonb_typeof(v_change->'player_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_change->'player_ids') <> 2 THEN
      RAISE EXCEPTION 'Choose two player slots for each match.';
    END IF;
    v_game_id := (v_change->>'game_id')::uuid;
    v_left := (v_change->'player_ids'->>0)::uuid;
    v_right := (v_change->'player_ids'->>1)::uuid;
    IF v_game_id IS NULL OR v_game_id = ANY(v_changed_games) THEN
      RAISE EXCEPTION 'Choose each match only once.';
    END IF;
    SELECT * INTO v_game FROM public.arena_tournament_games
      WHERE id = v_game_id AND tournament_id = p_tournament_id FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'That tournament match could not be found.'; END IF;
    IF v_game.winner_id IS NOT NULL THEN RAISE EXCEPTION 'This match has already finished.'; END IF;
    IF v_game.room_id IS NOT NULL THEN
      SELECT * INTO v_room FROM public.arena_rooms WHERE id = v_game.room_id FOR UPDATE NOWAIT;
      IF v_room.status <> 'waiting' OR v_room.expires_at <= now()
         OR EXISTS (SELECT 1 FROM public.arena_participants participant WHERE participant.room_id = v_game.room_id) THEN
        RAISE EXCEPTION 'This match has already begun or a player has entered its room.';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY[v_left, v_right]) chosen(id)
      WHERE chosen.id IS NOT NULL AND NOT (
        EXISTS (SELECT 1 FROM public.role_assignments assignment WHERE assignment.user_id = chosen.id
          AND assignment.role IN ('cadet', 'sentry') AND assignment.status IN ('active', 'approved'))
        OR EXISTS (SELECT 1 FROM public.tents tent WHERE tent.sentry_id = chosen.id)
        OR EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = chosen.id AND member.role IN ('cadet', 'sentry'))
      )) THEN RAISE EXCEPTION 'Every selected player must be an active cadet or sentry.'; END IF;
    UPDATE public.arena_tournament_games SET left_override_id = v_left, right_override_id = v_right WHERE id = v_game.id;
    v_changed_games := array_append(v_changed_games, v_game.id);
  END LOOP;

  v_issue := public.arena_tournament_lineup_issue(p_tournament_id, v_changed_games);
  IF v_issue IS NOT NULL THEN RAISE EXCEPTION '%', v_issue; END IF;

  FOR v_game IN SELECT * FROM public.arena_tournament_games WHERE id = ANY(v_changed_games) LOOP
    v_left := coalesce(v_game.left_override_id, v_game.left_player_id);
    v_right := coalesce(v_game.right_override_id, v_game.right_player_id);
    IF v_game.room_id IS NULL THEN
      -- Choosing players early never bypasses the preceding matches.
      IF v_game.left_player_id IS NOT NULL AND v_game.right_player_id IS NOT NULL THEN
        PERFORM public.create_arena_tournament_room(v_game.id);
      END IF;
      CONTINUE;
    END IF;
    SELECT * INTO v_room FROM public.arena_rooms WHERE id = v_game.room_id;
    SELECT player_ids INTO v_old_players FROM public.arena_scheduled_matches WHERE room_id = v_game.room_id;
    UPDATE public.arena_rooms SET creator_id = v_left, tagged_user_ids = ARRAY[v_left, v_right] WHERE id = v_game.room_id;
    UPDATE public.arena_scheduled_matches SET player_ids = ARRAY[v_left, v_right] WHERE room_id = v_game.room_id;
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
            'starts_at', (SELECT starts_at FROM public.arena_scheduled_matches WHERE room_id = v_room.id)));
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'This match is being updated. Please try saving again.';
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_tournament_game_players(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_tournament_game_players(uuid, jsonb) TO authenticated;

-- Serialize joining with lineup edits, then recheck the current reservation.
CREATE OR REPLACE FUNCTION public.enforce_instructor_arena_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_match public.arena_scheduled_matches%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.arena_scheduled_matches WHERE room_id = NEW.room_id) THEN
    PERFORM 1 FROM public.arena_rooms WHERE id = NEW.room_id FOR UPDATE;
    SELECT * INTO v_match FROM public.arena_scheduled_matches WHERE room_id = NEW.room_id;
    IF NEW.user_id <> ALL(v_match.player_ids) THEN
      RAISE EXCEPTION 'This match is reserved for its selected players.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_instructor_arena_reservation() FROM PUBLIC, anon, authenticated;
