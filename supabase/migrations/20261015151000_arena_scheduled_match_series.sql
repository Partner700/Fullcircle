-- Scheduled human matches play independent legs. A fixture advances, pays its
-- winner, and promotes a tournament player only after the aggregate is clear.
CREATE TABLE public.arena_match_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_room_id uuid NOT NULL UNIQUE REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  current_room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  scheduled_by uuid NOT NULL REFERENCES public.profiles(id),
  player_ids uuid[] NOT NULL,
  required_rounds integer NOT NULL CHECK (required_rounds IN (2, 3)),
  winner_id uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.arena_match_series_rounds (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES public.arena_match_series(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  leg_winner_id uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  UNIQUE (series_id, round_number)
);
CREATE TABLE public.arena_match_series_scores (
  room_id uuid NOT NULL REFERENCES public.arena_match_series_rounds(room_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  correct_count integer NOT NULL CHECK (correct_count >= 0),
  score integer NOT NULL CHECK (score >= 0),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX arena_match_series_rounds_series_idx
  ON public.arena_match_series_rounds(series_id, round_number);

ALTER TABLE public.arena_match_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_match_series_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_match_series_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_match_series, public.arena_match_series_rounds,
  public.arena_match_series_scores FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.arena_match_series, public.arena_match_series_rounds,
  public.arena_match_series_scores TO service_role;

CREATE OR REPLACE FUNCTION public.register_scheduled_arena_series()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_series_id uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = NEW.room_id;
  v_count := cardinality(NEW.player_ids);
  IF v_room.status <> 'waiting' OR v_room.play_mode = 'machine'
    OR v_count NOT BETWEEN 2 AND 4 THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.arena_match_series (
    initial_room_id, current_room_id, scheduled_by, player_ids, required_rounds
  ) VALUES (
    NEW.room_id, NEW.room_id, NEW.scheduled_by, NEW.player_ids,
    CASE WHEN v_count = 4 THEN 3 ELSE 2 END
  ) ON CONFLICT (initial_room_id) DO NOTHING
  RETURNING id INTO v_series_id;
  IF v_series_id IS NOT NULL THEN
    INSERT INTO public.arena_match_series_rounds(room_id, series_id, round_number)
    VALUES (NEW.room_id, v_series_id, 1);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.register_scheduled_arena_series() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS register_scheduled_arena_series_after_insert ON public.arena_scheduled_matches;
CREATE TRIGGER register_scheduled_arena_series_after_insert
AFTER INSERT ON public.arena_scheduled_matches FOR EACH ROW
EXECUTE FUNCTION public.register_scheduled_arena_series();

-- Existing matches already in play finish under their original rules.
-- Only matches waiting to start adopt the new series.
INSERT INTO public.arena_match_series (
  initial_room_id, current_room_id, scheduled_by, player_ids, required_rounds
)
SELECT room.id, room.id, scheduled.scheduled_by, scheduled.player_ids,
  CASE WHEN cardinality(scheduled.player_ids) = 4 THEN 3 ELSE 2 END
FROM public.arena_scheduled_matches scheduled
JOIN public.arena_rooms room ON room.id = scheduled.room_id
WHERE room.status = 'waiting' AND room.play_mode <> 'machine'
  AND cardinality(scheduled.player_ids) BETWEEN 2 AND 4
ON CONFLICT (initial_room_id) DO NOTHING;
INSERT INTO public.arena_match_series_rounds(room_id, series_id, round_number)
SELECT series.initial_room_id, series.id, 1
FROM public.arena_match_series series
ON CONFLICT (room_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_arena_series_final_totals(
  p_series_id uuid, p_room_id uuid
)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.arena_participants participant
  SET correct_count = totals.correct_count,
      score = totals.score
  FROM (
    SELECT scored.user_id,
      sum(scored.correct_count)::integer AS correct_count,
      sum(scored.score)::integer AS score
    FROM public.arena_match_series_scores scored
    JOIN public.arena_match_series_rounds round ON round.room_id = scored.room_id
    WHERE round.series_id = p_series_id
    GROUP BY scored.user_id
  ) totals
  WHERE participant.room_id = p_room_id AND participant.user_id = totals.user_id;
$$;
REVOKE ALL ON FUNCTION public.set_arena_series_final_totals(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

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
      v_game_type := CASE WHEN v_base_name ILIKE '%[arena:ludo]%'
        THEN 'ludo' ELSE 'standard' END;
      v_base_name := regexp_replace(v_base_name, '\s*\[arena:(standard|ludo)\]', '', 'gi');
      NEW.room_name := left(v_base_name, 60) || ' (Round ' || v_round.round_number ||
        ' of ' || v_series.required_rounds || ') [arena:' || v_game_type || ']';
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
  v_game_type := CASE WHEN OLD.room_name ILIKE '%[arena:ludo]%'
    THEN 'ludo' ELSE 'standard' END;
  v_base_name := regexp_replace(OLD.room_name,
    '\s*\(Round [0-9]+ of [0-9]+\)|\s*\(Rematch [0-9]+\)', '', 'gi');
  v_base_name := regexp_replace(v_base_name, '\s*\[arena:(standard|ludo)\]', '', 'gi');
  v_name := left(v_base_name, 60) || CASE
    WHEN v_next_number > v_series.required_rounds THEN
      ' (Rematch ' || (v_next_number - v_series.required_rounds) || ')'
    ELSE ' (Round ' || v_next_number || ' of ' || v_series.required_rounds || ')'
  END || ' [arena:' || v_game_type || ']';
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
DROP TRIGGER IF EXISTS advance_scheduled_arena_series_before_update ON public.arena_rooms;
CREATE TRIGGER advance_scheduled_arena_series_before_update
BEFORE UPDATE OF status ON public.arena_rooms FOR EACH ROW
EXECUTE FUNCTION public.advance_scheduled_arena_series();

-- The standard trivia function validates all answers and stores each player's
-- server-computed score. The series trigger may replace a leg winner with the
-- aggregate winner or start another leg before notifications are sent.
CREATE OR REPLACE FUNCTION public.finish_arena_game(
  p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_winner uuid;
  v_actual_winner uuid;
  v_next_room uuid;
  v_winner_name text;
  v_total_stake integer;
  v_count integer;
  v_participant record;
  v_score integer;
  v_correct_count integer;
  v_machine_score integer;
  v_total_questions integer;
  v_answered_questions integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only finish Arena games as yourself.';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Arena game is not active.';
  END IF;
  IF v_room.room_name ILIKE '%[arena:ludo]%' THEN
    RAISE EXCEPTION 'Road Home matches are settled by the authoritative game server.';
  END IF;
  SELECT jsonb_array_length(deck.questions) INTO v_total_questions
  FROM public.arena_question_decks deck WHERE deck.room_id = p_room_id;
  IF coalesce(v_total_questions, 0) = 0 THEN
    RAISE EXCEPTION 'Arena question deck is unavailable.';
  END IF;
  SELECT
    (SELECT count(*) FROM public.arena_trivia_responses response WHERE response.room_id = p_room_id)
    + (SELECT count(*) FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id)
  INTO v_answered_questions;
  IF v_answered_questions < v_total_questions THEN
    RAISE EXCEPTION 'The Arena match still has unanswered questions.';
  END IF;
  SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
  INTO v_score, v_correct_count
  FROM public.arena_trivia_responses
  WHERE room_id = p_room_id AND user_id = p_user_id;
  UPDATE public.arena_participants
  SET score = v_score, correct_count = v_correct_count, finished_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id AND forfeited_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active participant in this Arena room.';
  END IF;
  IF v_room.play_mode = 'machine' OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND finished_at IS NULL AND forfeited_at IS NULL
  ) THEN
    IF v_room.play_mode = 'machine' THEN
      SELECT coalesce(sum(figs_earned), 0) INTO v_machine_score
      FROM public.arena_machine_trivia_responses WHERE room_id = p_room_id;
      v_winner := CASE WHEN v_score > v_machine_score THEN p_user_id ELSE NULL END;
      UPDATE public.arena_rooms SET machine_score = v_machine_score WHERE id = p_room_id;
    ELSE
      SELECT user_id INTO v_winner FROM public.arena_participants
      WHERE room_id = p_room_id AND forfeited_at IS NULL
      ORDER BY score DESC, correct_count DESC, finished_at ASC LIMIT 1;
    END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_total_stake := coalesce(v_room.stake_amount, 0) * v_count * 10;
    IF v_winner IS NOT NULL AND v_total_stake > 0 THEN
      INSERT INTO public.denarii_ledger_entries (
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_winner, v_total_stake, 'arena_reward', p_room_id::text,
        'Arena tenfold winner reward for ' || v_room.room_name
      );
    END IF;
    UPDATE public.arena_rooms
    SET status = 'completed', winner_id = v_winner, completed_at = now(),
        completion_reason = 'finished'
    WHERE id = p_room_id
    RETURNING winner_id, restarted_as_room_id INTO v_actual_winner, v_next_room;
    IF v_next_room IS NOT NULL THEN RETURN; END IF;
    SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_actual_winner;
    FOR v_participant IN
      SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id
    LOOP
      PERFORM public.notify_user(v_participant.user_id, v_actual_winner,
        'arena', CASE WHEN v_participant.user_id = v_actual_winner
          THEN 'You won the Arena' ELSE 'Arena game finished' END,
        CASE
          WHEN v_actual_winner IS NULL THEN 'The Machine won "' || v_room.room_name || '".'
          WHEN v_participant.user_id = v_actual_winner AND v_total_stake > 0
            THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
          WHEN v_participant.user_id = v_actual_winner
            THEN 'You won "' || v_room.room_name || '".'
          ELSE coalesce(v_winner_name, 'A player') || ' won "' || v_room.room_name || '".'
        END,
        'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed',
          'winner_id', v_actual_winner,
          'reward_amount', CASE WHEN v_actual_winner IS NULL THEN 0 ELSE v_total_stake END));
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_successor(p_room_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_current uuid := p_room_id;
  v_next uuid;
  v_steps integer := 0;
BEGIN
  LOOP
    SELECT room.restarted_as_room_id INTO v_next
    FROM public.arena_rooms room
    WHERE room.id = v_current AND room.status = 'completed'
      AND room.completion_reason IN ('round', 'draw');
    IF v_next IS NULL OR v_steps >= 32 THEN EXIT; END IF;
    v_current := v_next;
    v_steps := v_steps + 1;
  END LOOP;
  RETURN CASE WHEN v_current = p_room_id THEN NULL ELSE v_current END;
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_successor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_successor(uuid)
  TO anon, authenticated;
