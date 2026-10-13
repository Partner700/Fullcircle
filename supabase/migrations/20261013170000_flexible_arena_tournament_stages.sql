-- Extend the already-installed tournament schema without replaying its original migration.
ALTER TABLE public.arena_tournaments
  DROP CONSTRAINT IF EXISTS arena_tournaments_player_ids_check,
  DROP CONSTRAINT IF EXISTS arena_tournaments_knockout_rounds_check,
  DROP CONSTRAINT IF EXISTS arena_tournaments_player_count_check,
  ADD COLUMN IF NOT EXISTS has_group_stage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS knockout_rounds integer;

UPDATE public.arena_tournaments
SET knockout_rounds = CASE cardinality(player_ids)
  WHEN 2 THEN 1 WHEN 4 THEN 2 WHEN 8 THEN 3 WHEN 16 THEN 4 END;

ALTER TABLE public.arena_tournaments
  ALTER COLUMN knockout_rounds SET NOT NULL,
  ADD CONSTRAINT arena_tournaments_knockout_rounds_check
    CHECK (knockout_rounds BETWEEN 1 AND 4),
  ADD CONSTRAINT arena_tournaments_player_count_check
    CHECK ((has_group_stage AND cardinality(player_ids) IN (8, 16, 32))
      OR (NOT has_group_stage AND cardinality(player_ids) IN (2, 4, 8, 16)));

ALTER TABLE public.arena_tournament_games
  DROP CONSTRAINT IF EXISTS arena_tournament_games_round_number_check,
  DROP CONSTRAINT IF EXISTS arena_tournament_games_match_number_check,
  DROP CONSTRAINT IF EXISTS arena_tournament_games_group_number_check,
  DROP CONSTRAINT IF EXISTS arena_tournament_games_group_round_check,
  ADD COLUMN IF NOT EXISTS group_number integer,
  ADD CONSTRAINT arena_tournament_games_round_number_check
    CHECK (round_number BETWEEN 0 AND 4),
  ADD CONSTRAINT arena_tournament_games_match_number_check
    CHECK (match_number BETWEEN 1 AND 48),
  ADD CONSTRAINT arena_tournament_games_group_number_check
    CHECK (group_number BETWEEN 1 AND 8),
  ADD CONSTRAINT arena_tournament_games_group_round_check
    CHECK ((round_number = 0 AND group_number IS NOT NULL)
      OR (round_number > 0 AND group_number IS NULL));

CREATE OR REPLACE FUNCTION public.create_arena_tournament_room(p_game_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_room_id uuid;
  v_starts_at timestamptz;
  v_name text;
  v_player uuid;
BEGIN
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.room_id IS NOT NULL OR v_game.left_player_id IS NULL
     OR v_game.right_player_id IS NULL OR v_game.left_player_id = v_game.right_player_id THEN
    RAISE EXCEPTION 'The tournament match is not ready.';
  END IF;
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_game.tournament_id;
  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'The tournament is closed.';
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
    v_game.left_player_id, v_name, 0, 2, 'waiting',
    ARRAY[v_game.left_player_id, v_game.right_player_id], 0, v_starts_at + interval '2 hours'
  ) RETURNING id INTO v_room_id;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (v_room_id, v_tournament.created_by, v_starts_at,
    ARRAY[v_game.left_player_id, v_game.right_player_id]);
  UPDATE public.arena_tournament_games SET room_id = v_room_id WHERE id = p_game_id;
  FOREACH v_player IN ARRAY ARRAY[v_game.left_player_id, v_game.right_player_id] LOOP
    PERFORM public.notify_user(v_player, v_tournament.created_by, 'arena', 'Tournament match scheduled',
      'You were selected for ' || v_name || '.', 'arena',
      jsonb_build_object('room_id', v_room_id, 'tournament_id', v_tournament.id, 'starts_at', v_starts_at));
  END LOOP;
  RETURN v_room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_arena_tournament_room(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_instructor_arena_tournament(
  p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamptz[], p_has_group_stage boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_group_count integer := 0;
  v_group integer;
  v_pair integer;
  v_pair_left integer[] := ARRAY[1, 1, 1, 2, 2, 3];
  v_pair_right integer[] := ARRAY[2, 3, 4, 3, 4, 4];
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
        INSERT INTO public.arena_tournament_games (
          tournament_id, round_number, match_number, group_number, planned_at,
          left_player_id, right_player_id
        ) VALUES (
          v_tournament_id, 0, v_index, v_group, p_game_times[v_index],
          p_player_ids[(v_group - 1) * 4 + v_pair_left[v_pair]],
          p_player_ids[(v_group - 1) * 4 + v_pair_right[v_pair]]
        ) RETURNING id INTO v_game_id;
        PERFORM public.create_arena_tournament_room(v_game_id);
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
      INSERT INTO public.arena_tournament_games (
        tournament_id, round_number, match_number, planned_at,
        left_player_id, right_player_id, left_source_id, right_source_id
      ) VALUES (
        v_tournament_id, v_round, v_slot, p_game_times[v_index],
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN p_player_ids[v_slot * 2 - 1] ELSE NULL END,
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN p_player_ids[v_slot * 2] ELSE NULL END,
        v_left_source, v_right_source
      ) RETURNING id INTO v_game_id;
      IF v_round = 1 AND NOT p_has_group_stage THEN PERFORM public.create_arena_tournament_room(v_game_id); END IF;
    END LOOP;
    v_offset := v_offset + v_match_count;
    v_match_count := v_match_count / 2;
  END LOOP;
  RETURN v_tournament_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_instructor_arena_tournament(text, text, uuid[], timestamptz[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_instructor_arena_tournament(text, text, uuid[], timestamptz[], boolean) TO authenticated;

-- Keep previously built clients able to schedule the original knockout format.
CREATE OR REPLACE FUNCTION public.create_instructor_arena_tournament(
  p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamptz[]
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.create_instructor_arena_tournament($1, $2, $3, $4, false);
$$;
REVOKE ALL ON FUNCTION public.create_instructor_arena_tournament(text, text, uuid[], timestamptz[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_instructor_arena_tournament(text, text, uuid[], timestamptz[]) TO authenticated;

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
      'left_player_id', game.left_player_id, 'right_player_id', game.right_player_id,
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

CREATE OR REPLACE FUNCTION public.settle_instructor_arena_match_awards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_schedule public.arena_scheduled_matches%ROWTYPE;
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_next public.arena_tournament_games%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_house_id text;
  v_total integer;
  v_recipient record;
  v_match_name text;
  v_group integer;
  v_qualifiers uuid[];
  v_first_match integer;
  v_second_match integer;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO v_schedule FROM public.arena_scheduled_matches WHERE room_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.status = 'playing' AND OLD.status = 'waiting' THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    SELECT participant.user_id, 1000, 'arena_reward', 'scheduled:play:' || NEW.id::text,
      'Instructor scheduled match participation: ' || NEW.room_name
    FROM public.arena_participants participant
    WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL
      AND participant.user_id = ANY(v_schedule.player_ids)
    ON CONFLICT DO NOTHING;
    UPDATE public.arena_tournaments SET status = 'playing'
    WHERE id = (SELECT game.tournament_id FROM public.arena_tournament_games game WHERE game.room_id = NEW.id)
      AND status = 'scheduled';
  END IF;

  IF NEW.status <> 'completed' OR OLD.status <> 'playing' THEN RETURN NEW; END IF;
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE room_id = NEW.id;
  IF FOUND THEN
    SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_game.tournament_id FOR UPDATE;
  END IF;
  IF NEW.winner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = NEW.id AND participant.user_id = NEW.winner_id
      AND NEW.winner_id = ANY(v_schedule.player_ids)
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
  VALUES (NEW.winner_id, 5000, 'arena_reward', 'scheduled:win:' || NEW.id::text,
    'Instructor scheduled match winner: ' || NEW.room_name)
  ON CONFLICT DO NOTHING;
  v_total := 6000;

  IF v_game.id IS NOT NULL THEN
    UPDATE public.arena_tournament_games SET winner_id = NEW.winner_id WHERE id = v_game.id;
    IF v_game.round_number = 0 THEN
      v_group := v_game.group_number;
      IF NOT EXISTS (
        SELECT 1 FROM public.arena_tournament_games game
        WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group
          AND game.winner_id IS NULL
      ) THEN
        SELECT array_agg(standing.id ORDER BY standing.wins DESC,
          standing.answers DESC, standing.points DESC, standing.seed)
        INTO v_qualifiers
        FROM (
          SELECT selected.id, selected.seed,
            (SELECT count(*) FROM public.arena_tournament_games game
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group
                AND game.winner_id = selected.id) AS wins,
            (SELECT coalesce(sum(participant.correct_count), 0)
              FROM public.arena_tournament_games game
              JOIN public.arena_participants participant
                ON participant.room_id = game.room_id AND participant.user_id = selected.id
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group) AS answers,
            (SELECT coalesce(sum(participant.score), 0)
              FROM public.arena_tournament_games game
              JOIN public.arena_participants participant
                ON participant.room_id = game.room_id AND participant.user_id = selected.id
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group) AS points
          FROM unnest(v_tournament.player_ids) WITH ORDINALITY selected(id, seed)
          WHERE selected.seed BETWEEN (v_group - 1) * 4 + 1 AND v_group * 4
          ORDER BY wins DESC, answers DESC, points DESC, selected.seed
          LIMIT 2
        ) standing;
        v_first_match := ((v_group - 1) / 2) * 2 + 1;
        v_second_match := v_first_match + 1;
        IF v_group % 2 = 1 THEN
          UPDATE public.arena_tournament_games SET left_player_id = v_qualifiers[1]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_first_match;
          UPDATE public.arena_tournament_games SET right_player_id = v_qualifiers[2]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_second_match;
        ELSE
          UPDATE public.arena_tournament_games SET right_player_id = v_qualifiers[2]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_first_match;
          UPDATE public.arena_tournament_games SET left_player_id = v_qualifiers[1]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_second_match;
        END IF;
        FOR v_next IN SELECT * FROM public.arena_tournament_games game
          WHERE game.tournament_id = v_tournament.id AND game.round_number = 1
            AND game.match_number IN (v_first_match, v_second_match)
        LOOP
          IF v_next.left_player_id IS NOT NULL AND v_next.right_player_id IS NOT NULL
            AND v_next.room_id IS NULL THEN
            PERFORM public.create_arena_tournament_room(v_next.id);
          END IF;
        END LOOP;
      END IF;
    ELSIF v_game.round_number = v_tournament.knockout_rounds THEN
      INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
      VALUES (NEW.winner_id, 25000, 'arena_reward', 'scheduled:champion:' || v_tournament.id::text,
        'Arena tournament champion: ' || v_tournament.title)
      ON CONFLICT DO NOTHING;
      v_total := 31000;
      UPDATE public.arena_tournaments
      SET status = 'completed', champion_id = NEW.winner_id, completed_at = now()
      WHERE id = v_tournament.id;
    ELSE
      SELECT * INTO v_next FROM public.arena_tournament_games
      WHERE left_source_id = v_game.id OR right_source_id = v_game.id FOR UPDATE;
      IF FOUND THEN
        IF v_next.left_source_id = v_game.id THEN
          UPDATE public.arena_tournament_games SET left_player_id = NEW.winner_id WHERE id = v_next.id;
        ELSE
          UPDATE public.arena_tournament_games SET right_player_id = NEW.winner_id WHERE id = v_next.id;
        END IF;
        SELECT * INTO v_next FROM public.arena_tournament_games WHERE id = v_next.id;
        IF v_next.left_player_id IS NOT NULL AND v_next.right_player_id IS NOT NULL AND v_next.room_id IS NULL THEN
          PERFORM public.create_arena_tournament_room(v_next.id);
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.winner_id;
  SELECT tent.tent_house_id INTO v_house_id FROM public.tents tent
  WHERE tent.sentry_id = NEW.winner_id OR EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.tent_id = tent.id AND member.user_id = NEW.winner_id
  ) ORDER BY CASE WHEN tent.sentry_id = NEW.winner_id THEN 0 ELSE 1 END LIMIT 1;
  v_match_name := regexp_replace(NEW.room_name, '\s*\[arena:(standard|ludo)\]', '', 'gi');
  FOR v_recipient IN SELECT id FROM public.profiles LOOP
    PERFORM public.notify_user(v_recipient.id, NEW.winner_id, 'arena_scheduled_result',
      CASE WHEN v_total = 31000 THEN 'Tournament champion' ELSE 'Scheduled match result' END,
      coalesce(v_profile.display_name, 'A player') || ' won ' || v_total::text ||
        ' Denarii in ' || v_match_name || '.',
      'arena', jsonb_build_object(
        'room_id', NEW.id, 'tournament_id', v_game.tournament_id,
        'winner_id', NEW.winner_id, 'winner_name', v_profile.display_name,
        'winner_avatar_url', v_profile.avatar_url, 'winner_tent_house_id', v_house_id,
        'winner_amount', v_total));
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_instructor_arena_match_awards() FROM PUBLIC, anon, authenticated;
