-- Journey uses the existing 2-4 player fixtures, series, rewards and witness flow.
ALTER TABLE public.arena_tournaments
  ADD COLUMN journey_character_slug text REFERENCES public.arena_journey_characters(slug);
ALTER TABLE public.arena_tournaments DROP CONSTRAINT arena_tournaments_game_type_check;
ALTER TABLE public.arena_tournaments ADD CONSTRAINT arena_tournaments_game_type_check
  CHECK (game_type IN ('standard', 'ludo', 'journey'));
ALTER TABLE public.arena_tournaments ADD CONSTRAINT arena_tournaments_journey_character_check
  CHECK ((game_type = 'journey' AND journey_character_slug IS NOT NULL)
    OR (game_type <> 'journey' AND journey_character_slug IS NULL));

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

-- Keep the old signature for Classic/Ludo clients during the rollout.
CREATE OR REPLACE FUNCTION public.create_instructor_arena_tournament_lineups(
  p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamptz[],
  p_has_group_stage boolean, p_game_players jsonb, p_bracket_size integer
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.create_instructor_arena_tournament_lineups($1,$2,$3,$4,$5,$6,$7,NULL);
$$;
REVOKE ALL ON FUNCTION public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_arena_tournaments()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to view tournaments.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', tournament.id, 'title', tournament.title, 'game_type', tournament.game_type,
    'journey_character_slug', tournament.journey_character_slug,
    'journey_character_name', (SELECT character.display_name FROM public.arena_journey_characters character WHERE character.slug = tournament.journey_character_slug),
    'status', tournament.status, 'created_by', tournament.created_by,
    'has_group_stage', tournament.has_group_stage,
    'bracket_size', power(2, tournament.knockout_rounds)::integer * CASE WHEN tournament.has_group_stage THEN 2 ELSE 1 END,
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
      'third_player_id', game.third_player_id, 'fourth_player_id', game.fourth_player_id,
      'player_ids', public.arena_tournament_players(game),
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

CREATE OR REPLACE FUNCTION public.advance_scheduled_arena_series()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_round public.arena_match_series_rounds%ROWTYPE;
  v_series public.arena_match_series%ROWTYPE;
  v_count integer;
  v_next_number integer;
  v_next_room uuid;
  v_top uuid;
  v_top_score integer;
  v_ties integer;
  v_base_name text;
  v_name text;
  v_game_type text;
  v_character_suffix text;
BEGIN
  IF NEW.status = 'playing' AND OLD.status = 'waiting' THEN
    SELECT round.* INTO v_round
    FROM public.arena_match_series_rounds round WHERE round.room_id = NEW.id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants participant
      WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL;
    IF v_count BETWEEN 2 AND 4 THEN
      UPDATE public.arena_match_series series
      SET player_ids = (SELECT array_agg(participant.user_id ORDER BY participant.joined_at)
        FROM public.arena_participants participant
        WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL),
        required_rounds = CASE WHEN v_count = 4 THEN 3 ELSE 2 END
      WHERE series.id = v_round.series_id AND v_round.round_number = 1;
    END IF;
    SELECT * INTO v_series FROM public.arena_match_series WHERE id = v_round.series_id;
    IF v_round.round_number <= v_series.required_rounds THEN
      v_base_name := regexp_replace(NEW.room_name,
        '\s*\(Round [0-9]+ of [0-9]+\)|\s*\(Rematch [0-9]+\)', '', 'gi');
      v_game_type := CASE WHEN v_base_name ILIKE '%[arena:journey]%' THEN 'journey'
        WHEN v_base_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END;
      v_character_suffix := CASE WHEN v_game_type = 'journey' THEN
        ' [character:' || substring(v_base_name FROM '\[character:([a-z0-9-]+)\]') || ']' ELSE '' END;
      v_base_name := regexp_replace(v_base_name, '\s*\[(arena:(standard|ludo|journey)|character:[a-z0-9-]+)\]', '', 'gi');
      NEW.room_name := left(v_base_name, 60) || ' (Round ' || v_round.round_number ||
        ' of ' || v_series.required_rounds || ') [arena:' || v_game_type || ']' || v_character_suffix;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' OR OLD.status <> 'playing' THEN RETURN NEW; END IF;
  SELECT round.* INTO v_round
  FROM public.arena_match_series_rounds round WHERE round.room_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO v_series FROM public.arena_match_series
    WHERE id = v_round.series_id FOR UPDATE;
  IF v_series.completed_at IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.arena_match_series_scores(room_id, user_id, correct_count, score)
  SELECT NEW.id, participant.user_id,
    greatest(coalesce(participant.correct_count, 0), 0),
    greatest(coalesce(participant.score, 0), 0)
  FROM public.arena_participants participant WHERE participant.room_id = NEW.id
  ON CONFLICT (room_id, user_id) DO NOTHING;
  UPDATE public.arena_match_series_rounds
  SET leg_winner_id = NEW.winner_id, completed_at = now()
  WHERE room_id = NEW.id;

  IF NEW.completion_reason = 'forfeit' THEN
    UPDATE public.arena_match_series
    SET winner_id = NEW.winner_id, completed_at = now() WHERE id = v_series.id;
    PERFORM public.set_arena_series_final_totals(v_series.id, NEW.id);
    RETURN NEW;
  END IF;

  IF v_round.round_number >= v_series.required_rounds THEN
    SELECT summed.user_id, summed.total INTO v_top, v_top_score
    FROM (
      SELECT score.user_id, sum(score.correct_count)::integer AS total
      FROM public.arena_match_series_scores score
      JOIN public.arena_match_series_rounds round ON round.room_id = score.room_id
      WHERE round.series_id = v_series.id
      GROUP BY score.user_id
    ) summed
    ORDER BY summed.total DESC, summed.user_id LIMIT 1;
    SELECT count(*) INTO v_ties FROM (
      SELECT score.user_id
      FROM public.arena_match_series_scores score
      JOIN public.arena_match_series_rounds round ON round.room_id = score.room_id
      WHERE round.series_id = v_series.id
      GROUP BY score.user_id HAVING sum(score.correct_count) = v_top_score
    ) tied;
    IF v_ties = 1 THEN
      NEW.winner_id := v_top;
      UPDATE public.arena_match_series
      SET winner_id = v_top, completed_at = now() WHERE id = v_series.id;
      PERFORM public.set_arena_series_final_totals(v_series.id, NEW.id);
      RETURN NEW;
    END IF;
  END IF;

  v_next_number := v_round.round_number + 1;
  v_game_type := CASE WHEN OLD.room_name ILIKE '%[arena:journey]%' THEN 'journey'
    WHEN OLD.room_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END;
  v_character_suffix := CASE WHEN v_game_type = 'journey' THEN
    ' [character:' || substring(OLD.room_name FROM '\[character:([a-z0-9-]+)\]') || ']' ELSE '' END;
  v_base_name := regexp_replace(OLD.room_name,
    '\s*\(Round [0-9]+ of [0-9]+\)|\s*\(Rematch [0-9]+\)', '', 'gi');
  v_base_name := regexp_replace(v_base_name, '\s*\[(arena:(standard|ludo|journey)|character:[a-z0-9-]+)\]', '', 'gi');
  v_name := left(v_base_name, 60) || CASE
    WHEN v_next_number > v_series.required_rounds THEN
      ' (Rematch ' || (v_next_number - v_series.required_rounds) || ')'
    ELSE ' (Round ' || v_next_number || ' of ' || v_series.required_rounds || ')'
  END || ' [arena:' || v_game_type || ']' || v_character_suffix;
  INSERT INTO public.arena_rooms (
    creator_id, room_name, stake_amount, max_players, status,
    tagged_user_ids, game_call_fee, narrative_date, game_type
  ) VALUES (
    OLD.creator_id, v_name, 0, cardinality(v_series.player_ids), 'waiting',
    v_series.player_ids, 0, OLD.narrative_date, OLD.game_type
  ) RETURNING id INTO v_next_room;
  INSERT INTO public.arena_match_series_rounds(room_id, series_id, round_number)
  VALUES (v_next_room, v_series.id, v_next_number);
  UPDATE public.arena_match_series SET current_room_id = v_next_room WHERE id = v_series.id;
  UPDATE public.arena_tournament_games SET room_id = v_next_room WHERE room_id = OLD.id;

  FOREACH v_top IN ARRAY v_series.player_ids LOOP
    INSERT INTO public.arena_participants(room_id, user_id, stake_paid)
    VALUES (v_next_room, v_top, true);
  END LOOP;
  INSERT INTO public.arena_viewers(room_id, user_id, joined_at, last_seen_at)
  SELECT v_next_room, viewer.user_id, viewer.joined_at, now()
  FROM public.arena_viewers viewer
  WHERE viewer.room_id = OLD.id AND viewer.last_seen_at > now() - interval '2 minutes'
  ON CONFLICT (room_id, user_id) DO NOTHING;
  INSERT INTO public.arena_guest_witnesses(room_id, guest_key_hash, last_seen_at)
  SELECT v_next_room, guest.guest_key_hash, now()
  FROM public.arena_guest_witnesses guest
  WHERE guest.room_id = OLD.id AND guest.last_seen_at > now() - interval '2 minutes'
  ON CONFLICT (room_id, guest_key_hash) DO NOTHING;

  UPDATE public.arena_rooms SET status = 'playing', started_at = now()
  WHERE id = v_next_room;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (v_next_room, v_series.scheduled_by, now(), v_series.player_ids);
  NEW.winner_id := NULL;
  NEW.restarted_as_room_id := v_next_room;
  NEW.completion_reason := CASE WHEN v_round.round_number >= v_series.required_rounds
    THEN 'draw' ELSE 'round' END;
  FOREACH v_top IN ARRAY v_series.player_ids LOOP
    PERFORM public.notify_user(v_top, v_series.scheduled_by, 'arena',
      CASE WHEN NEW.completion_reason = 'draw' THEN 'Arena rematch' ELSE 'Next Arena round' END,
      'Your match continues in ' || v_name || '.', 'arena',
      jsonb_build_object('room_id', v_next_room, 'previous_room_id', OLD.id));
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_scheduled_arena_series() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION journey_private.sync_journey_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_player jsonb;
BEGIN
  IF TG_TABLE_NAME = 'arena_participants' THEN
    -- Final series totals must not be replaced by the last leg's Journey points.
    IF EXISTS (SELECT 1 FROM public.arena_match_series series
      WHERE series.current_room_id = NEW.room_id AND series.completed_at IS NOT NULL) THEN
      RETURN NEW;
    END IF;
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.room_id AND player->>'id' = NEW.user_id::text;
    IF v_player ? 'score' THEN NEW.score := greatest(0, (v_player->>'score')::integer); END IF;
  ELSE
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.id AND player->>'id' = '00000000-0000-0000-0000-000000000000';
    IF v_player ? 'score' THEN NEW.machine_score := greatest(0, (v_player->>'score')::integer); END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION journey_private.sync_journey_points() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION journey_private.add_journey_scores(p_room_id uuid, p_players jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(player || CASE
    WHEN saved.value ? 'score' AND series.completed_at IS NOT NULL AND participant.user_id IS NOT NULL
      THEN jsonb_build_object('score', greatest(0, participant.score), 'correct_count', participant.correct_count)
    WHEN saved.value ? 'score' THEN jsonb_build_object('score', greatest(0, (saved.value->>'score')::integer),
      'correct_count', (saved.value->>'correctAnswers')::integer)
    ELSE '{}'::jsonb END ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(p_players) WITH ORDINALITY entry(player, ordinal)
  LEFT JOIN public.arena_journey_games game ON game.room_id = p_room_id
  LEFT JOIN public.arena_match_series series ON series.current_room_id = p_room_id
  LEFT JOIN public.arena_participants participant ON participant.room_id = p_room_id
    AND participant.user_id::text = player->>'user_id'
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(game.state->'game'->'players')
    WHERE value->>'id' = player->>'user_id') saved ON true;
$$;
REVOKE ALL ON FUNCTION journey_private.add_journey_scores(uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN result IS NULL THEN NULL ELSE result
    || jsonb_build_object('players', journey_private.add_journey_scores(p_room_id, result->'players'))
    || CASE WHEN result->>'room_name' ILIKE '%[arena:journey]%'
      THEN jsonb_build_object('game_type', 'journey') ELSE '{}'::jsonb END
    || CASE WHEN result->>'room_name' ILIKE '%[arena:journey]%'
      AND game.state->'game'->>'winnerId' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.arena_match_series_rounds round WHERE round.room_id = p_room_id)
      THEN jsonb_build_object('winner_id', game.state->'game'->>'winnerId')
      ELSE '{}'::jsonb END END
  FROM (SELECT journey_private.get_public_arena_final_scorecard(p_room_id) result) data
  LEFT JOIN public.arena_journey_games game ON game.room_id = p_room_id;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_final_scorecard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_final_scorecard(uuid) TO anon, authenticated;
