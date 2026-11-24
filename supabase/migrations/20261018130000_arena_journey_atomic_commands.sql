-- A Journey command, its answer, and its Arena result must commit together.
CREATE TABLE public.arena_journey_commands (
  room_id uuid NOT NULL REFERENCES public.arena_journey_games(room_id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  state_version integer NOT NULL CHECK (state_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, command_id)
);

CREATE INDEX arena_journey_commands_recent_idx
  ON public.arena_journey_commands (room_id, created_at DESC);
ALTER TABLE public.arena_journey_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_journey_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.arena_journey_commands TO service_role;

CREATE OR REPLACE FUNCTION public.initialize_arena_journey_game(
  p_room_id uuid, p_character_slug text, p_state jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_state jsonb;
  v_expected_players integer;
  v_state_players integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Journey initialization is server-only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing'
    OR v_room.room_name !~* '\[arena:journey\]'
    OR v_room.play_mode = 'machine' THEN
    RAISE EXCEPTION 'This is not an active human Journey match.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_journey_characters character
    WHERE character.slug = p_character_slug AND character.ready
  ) THEN
    RAISE EXCEPTION 'This Biblical Journey character is not ready.';
  END IF;
  IF p_state->>'characterSlug' IS DISTINCT FROM p_character_slug
    OR p_state->'game'->>'status' IS DISTINCT FROM 'playing'
    OR (p_state->'game'->>'version')::integer IS DISTINCT FROM 0
    OR p_state->'currentQuestion'->>'id' IS NULL THEN
    RAISE EXCEPTION 'Invalid initial Journey state.';
  END IF;
  SELECT count(*) INTO v_expected_players FROM public.arena_participants
    WHERE room_id = p_room_id AND forfeited_at IS NULL;
  SELECT count(*) INTO v_state_players FROM jsonb_array_elements(p_state->'game'->'players');
  IF v_expected_players NOT BETWEEN 2 AND 4 OR v_state_players <> v_expected_players
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_state->'game'->'players') player
      WHERE NOT EXISTS (
        SELECT 1 FROM public.arena_participants participant
        WHERE participant.room_id = p_room_id
          AND participant.user_id::text = player->>'id'
          AND participant.forfeited_at IS NULL
      )
    ) THEN
    RAISE EXCEPTION 'Journey players do not match the Arena room.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_journey_questions question
    WHERE question.id::text = p_state->'currentQuestion'->>'id'
      AND question.character_slug = p_character_slug
      AND question.review_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'The starting question is not approved.';
  END IF;
  INSERT INTO public.arena_journey_games (
    room_id, character_slug, state, version, current_question_id
  ) VALUES (
    p_room_id, p_character_slug, p_state, 0,
    (p_state->'currentQuestion'->>'id')::uuid
  ) ON CONFLICT (room_id) DO NOTHING;
  SELECT game.state INTO v_state FROM public.arena_journey_games game
    WHERE game.room_id = p_room_id;
  RETURN v_state;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_arena_journey_game(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_arena_journey_game(uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.commit_arena_journey_command(
  p_room_id uuid, p_expected_version integer, p_next_state jsonb,
  p_command_id uuid, p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_game public.arena_journey_games%ROWTYPE;
  v_player jsonb;
  v_winner_id uuid;
  v_actual_winner uuid;
  v_next_room uuid;
  v_winner_name text;
  v_reward integer;
  v_count integer;
  v_question_id uuid;
  v_participant record;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Journey commands are server-only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT * INTO v_game FROM public.arena_journey_games WHERE room_id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL OR v_game.room_id IS NULL
    OR v_room.room_name !~* '\[arena:journey\]' THEN
    RAISE EXCEPTION 'Journey room not found.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arena_journey_commands command
    WHERE command.room_id = p_room_id AND command.command_id = p_command_id
  ) THEN
    RETURN jsonb_build_object('duplicate', true, 'state', v_game.state);
  END IF;
  IF v_room.status <> 'playing' OR v_game.version <> p_expected_version THEN
    RAISE EXCEPTION 'The Journey match advanced on another device.' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id AND participant.user_id = p_actor_id
      AND participant.forfeited_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Only an active player may advance a Journey match.' USING ERRCODE = '42501';
  END IF;
  IF p_next_state->>'characterSlug' IS DISTINCT FROM v_game.character_slug
    OR (p_next_state->'game'->>'version')::integer IS DISTINCT FROM p_expected_version + 1
    OR p_next_state->'game'->>'status' NOT IN ('playing', 'finished')
    OR jsonb_array_length(p_next_state->'game'->'players')
      IS DISTINCT FROM jsonb_array_length(v_game.state->'game'->'players') THEN
    RAISE EXCEPTION 'Invalid Journey state transition.';
  END IF;
  v_question_id := nullif(p_next_state->'currentQuestion'->>'id', '')::uuid;
  IF v_question_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.arena_journey_questions question
    WHERE question.id = v_question_id
      AND question.character_slug = v_game.character_slug
      AND question.review_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'The next Journey question is not approved.';
  END IF;

  UPDATE public.arena_journey_games
  SET state = p_next_state, version = p_expected_version + 1,
      turn_number = p_expected_version + 1, current_question_id = v_question_id,
      recent_action_id = p_command_id, updated_at = now()
  WHERE room_id = p_room_id;
  INSERT INTO public.arena_journey_commands
    (room_id, command_id, actor_id, state_version)
  VALUES (p_room_id, p_command_id, p_actor_id, p_expected_version + 1);

  FOR v_player IN SELECT value FROM jsonb_array_elements(p_next_state->'game'->'players') LOOP
    UPDATE public.arena_participants participant
    SET score = greatest(0, (v_player->>'correctAnswers')::integer),
        correct_count = greatest(0, (v_player->>'correctAnswers')::integer),
        finished_at = CASE WHEN p_next_state->'game'->>'status' = 'finished'
          THEN now() ELSE participant.finished_at END
    WHERE participant.room_id = p_room_id
      AND participant.user_id::text = v_player->>'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'Journey score refers to an unknown player.'; END IF;
  END LOOP;

  IF p_next_state->'game'->>'status' = 'finished' THEN
    v_winner_id := (p_next_state->'game'->>'winnerId')::uuid;
    IF v_winner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.arena_participants participant
      WHERE participant.room_id = p_room_id AND participant.user_id = v_winner_id
    ) THEN
      RAISE EXCEPTION 'Journey winner is not an Arena participant.';
    END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_reward := greatest(coalesce(v_room.stake_amount, 0), 0) * greatest(v_count, 1) * 10;
    IF v_reward > 0 THEN
      INSERT INTO public.denarii_ledger_entries
        (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner_id, v_reward, 'arena_reward', p_room_id::text,
        'Biblical Journey tenfold winner reward for ' || v_room.room_name);
    END IF;
    UPDATE public.arena_rooms
    SET status = 'completed', winner_id = v_winner_id,
        completed_at = now(), completion_reason = 'finished'
    WHERE id = p_room_id
    RETURNING winner_id, restarted_as_room_id INTO v_actual_winner, v_next_room;
    IF v_next_room IS NULL THEN
      SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_actual_winner;
      FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
        PERFORM public.notify_user(v_participant.user_id, v_actual_winner,
          'arena', CASE WHEN v_participant.user_id = v_actual_winner
            THEN 'You won the Arena' ELSE 'Arena game finished' END,
          CASE WHEN v_participant.user_id = v_actual_winner
            THEN 'You won "' || v_room.room_name || '" and received ' || v_reward::text || ' denarii.'
            ELSE coalesce(v_winner_name, 'A player') || ' won "' || v_room.room_name || '".' END,
          'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed',
            'winner_id', v_actual_winner, 'reward_amount', v_reward));
      END LOOP;
    END IF;
  END IF;
  RETURN jsonb_build_object('duplicate', false, 'state', p_next_state);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_arena_journey_command(uuid, integer, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_arena_journey_command(uuid, integer, jsonb, uuid, uuid)
  TO service_role;
