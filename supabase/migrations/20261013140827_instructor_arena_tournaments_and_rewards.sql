-- Instructor knockout brackets and one-time scheduled-match awards.
CREATE TABLE public.arena_tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 50),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  game_type text NOT NULL CHECK (game_type IN ('standard', 'ludo')),
  player_ids uuid[] NOT NULL CHECK (cardinality(player_ids) IN (4, 8)),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'playing', 'completed', 'cancelled')),
  champion_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE public.arena_tournament_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.arena_tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  match_number integer NOT NULL CHECK (match_number BETWEEN 1 AND 4),
  planned_at timestamptz NOT NULL,
  left_player_id uuid REFERENCES public.profiles(id),
  right_player_id uuid REFERENCES public.profiles(id),
  left_source_id uuid REFERENCES public.arena_tournament_games(id),
  right_source_id uuid REFERENCES public.arena_tournament_games(id),
  room_id uuid UNIQUE REFERENCES public.arena_rooms(id),
  winner_id uuid REFERENCES public.profiles(id),
  UNIQUE (tournament_id, round_number, match_number),
  CHECK (left_player_id IS NULL OR right_player_id IS NULL OR left_player_id <> right_player_id)
);
CREATE INDEX arena_tournament_games_tournament_idx
  ON public.arena_tournament_games(tournament_id, round_number, match_number);

ALTER TABLE public.arena_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_tournament_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_tournaments, public.arena_tournament_games FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX arena_scheduled_award_once
  ON public.denarii_ledger_entries(user_id, source_type, source_reference)
  WHERE source_type = 'arena_reward' AND source_reference LIKE 'scheduled:%';

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
  v_name := v_tournament.title || ' - Round ' || v_game.round_number::text ||
    ' Match ' || v_game.match_number::text || ' [arena:' || v_tournament.game_type || ']';
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
  p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamptz[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
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
  IF v_count NOT IN (4, 8) OR coalesce(cardinality(p_game_times), 0) <> v_count - 1 THEN
    RAISE EXCEPTION 'Select four or eight players and schedule every match.';
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

  INSERT INTO public.arena_tournaments(title, created_by, game_type, player_ids)
  VALUES (btrim(p_title), auth.uid(), p_game_type, p_player_ids)
  RETURNING id INTO v_tournament_id;

  v_round_count := CASE WHEN v_count = 4 THEN 2 ELSE 3 END;
  v_match_count := v_count / 2;
  FOR v_round IN 1..v_round_count LOOP
    FOR v_slot IN 1..v_match_count LOOP
      v_index := v_offset + v_slot;
      v_left_source := NULL;
      v_right_source := NULL;
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
        CASE WHEN v_round = 1 THEN p_player_ids[v_slot * 2 - 1] ELSE NULL END,
        CASE WHEN v_round = 1 THEN p_player_ids[v_slot * 2] ELSE NULL END,
        v_left_source, v_right_source
      ) RETURNING id INTO v_game_id;
      IF v_round = 1 THEN PERFORM public.create_arena_tournament_room(v_game_id); END IF;
    END LOOP;
    v_offset := v_offset + v_match_count;
    v_match_count := v_match_count / 2;
  END LOOP;
  RETURN v_tournament_id;
END;
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
  IF auth.uid() IS NULL OR auth.uid() <> v_tournament.created_by OR v_tournament.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only the scheduling instructor can reschedule this game.';
  END IF;
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.tournament_id <> v_tournament_id THEN
    RAISE EXCEPTION 'Tournament game not found.';
  END IF;
  IF v_game.left_player_id IS NULL OR v_game.right_player_id IS NULL OR v_game.winner_id IS NOT NULL THEN
    RAISE EXCEPTION 'This game is not ready for a replay.';
  END IF;
  SELECT status INTO v_room_status FROM public.arena_rooms WHERE id = v_game.room_id;
  IF v_game.room_id IS NOT NULL AND v_room_status NOT IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Only an ended game without a winner can be rescheduled.';
  END IF;
  IF p_starts_at < now() + interval '2 minutes' OR p_starts_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a time between two minutes and 90 days from now.';
  END IF;
  UPDATE public.arena_tournament_games SET planned_at = p_starts_at, room_id = NULL WHERE id = p_game_id;
  RETURN public.create_arena_tournament_room(p_game_id);
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_arena_tournament_game(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_arena_tournament_game(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_instructor_arena_tournament(p_tournament_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tournament public.arena_tournaments%ROWTYPE;
BEGIN
  SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = p_tournament_id;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() <> v_tournament.created_by THEN
    RAISE EXCEPTION 'Only the scheduling instructor can cancel this tournament.';
  END IF;
  IF v_tournament.status <> 'scheduled' THEN
    RAISE EXCEPTION 'A tournament cannot be cancelled after play starts.';
  END IF;
  UPDATE public.arena_rooms SET status = 'cancelled', completed_at = now(), closed_at = now()
  WHERE id IN (SELECT room_id FROM public.arena_tournament_games WHERE tournament_id = p_tournament_id)
    AND status = 'waiting';
  UPDATE public.arena_tournaments SET status = 'cancelled'
  WHERE id = p_tournament_id AND status = 'scheduled';
  IF NOT FOUND THEN RAISE EXCEPTION 'A tournament cannot be cancelled after play starts.'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_instructor_arena_tournament(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_instructor_arena_tournament(uuid) TO authenticated;

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
    IF v_game.round_number = CASE WHEN cardinality(v_tournament.player_ids) = 4 THEN 2 ELSE 3 END THEN
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
DROP TRIGGER IF EXISTS settle_instructor_arena_match_awards_after_status ON public.arena_rooms;
CREATE TRIGGER settle_instructor_arena_match_awards_after_status
AFTER UPDATE OF status ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.settle_instructor_arena_match_awards();
