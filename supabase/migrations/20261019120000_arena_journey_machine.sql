-- Machine Journey is isolated from human Journey and the existing trivia engine.
CREATE OR REPLACE FUNCTION public.prepare_machine_journey_room()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.play_mode = 'machine' AND NEW.room_name ~* '\[arena:journey\]' THEN
    NEW.machine_score := 0;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_machine_journey_room_insert
BEFORE INSERT ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.prepare_machine_journey_room();

CREATE OR REPLACE FUNCTION public.initialize_machine_arena_journey_game(
  p_room_id uuid, p_character_slug text, p_state jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_human_id uuid;
  v_state jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Journey initialization is server-only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' OR v_room.play_mode IS DISTINCT FROM 'machine'
    OR v_room.room_name !~* '\[arena:journey\]' THEN
    RAISE EXCEPTION 'This is not an active machine Journey match.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_journey_characters
    WHERE slug = p_character_slug AND ready) THEN
    RAISE EXCEPTION 'This Biblical Journey character is not ready.';
  END IF;
  SELECT participant.user_id INTO v_human_id
  FROM public.arena_participants participant
  WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL;
  IF v_human_id IS NULL OR v_human_id <> v_room.creator_id
    OR (SELECT count(*) FROM public.arena_participants participant
      WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL) <> 1
    OR p_state->>'characterSlug' IS DISTINCT FROM p_character_slug
    OR p_state->'game'->>'status' IS DISTINCT FROM 'playing'
    OR (p_state->'game'->>'version')::integer IS DISTINCT FROM 0
    OR (p_state->'game'->>'turnIndex')::integer IS DISTINCT FROM 0
    OR coalesce(jsonb_array_length(p_state->'game'->'players'), -1) <> 2
    OR p_state->'game'->'players'->0->>'id' IS DISTINCT FROM v_human_id::text
    OR p_state->'game'->'players'->1->>'id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'
    OR p_state->>'currentQuestionPlayerId' IS DISTINCT FROM v_human_id::text THEN
    RAISE EXCEPTION 'Machine Journey players do not match the Arena room.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_journey_questions question
    WHERE question.id::text = p_state->'currentQuestion'->>'id'
      AND question.character_slug = p_character_slug
      AND question.review_status = 'approved') THEN
    RAISE EXCEPTION 'The starting question is not approved.';
  END IF;
  INSERT INTO public.arena_journey_games
    (room_id, character_slug, state, version, current_question_id)
  VALUES (p_room_id, p_character_slug, p_state, 0,
    (p_state->'currentQuestion'->>'id')::uuid)
  ON CONFLICT (room_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.arena_rooms SET machine_score = 0 WHERE id = p_room_id;
  END IF;
  SELECT game.state INTO v_state FROM public.arena_journey_games game
  WHERE game.room_id = p_room_id;
  RETURN v_state;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_machine_arena_journey_game(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_machine_arena_journey_game(uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.commit_machine_arena_journey_command(
  p_room_id uuid, p_expected_version integer, p_next_state jsonb,
  p_command_id uuid, p_actor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_game public.arena_journey_games%ROWTYPE;
  v_human_id uuid;
  v_human_score integer;
  v_machine_score integer;
  v_winner_id uuid;
  v_reward integer;
  v_question_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Journey commands are server-only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT * INTO v_game FROM public.arena_journey_games WHERE room_id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL OR v_game.room_id IS NULL OR v_room.play_mode IS DISTINCT FROM 'machine'
    OR v_room.room_name !~* '\[arena:journey\]' THEN
    RAISE EXCEPTION 'Machine Journey room not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arena_journey_commands command
    WHERE command.room_id = p_room_id AND command.command_id = p_command_id) THEN
    RETURN jsonb_build_object('duplicate', true, 'state', v_game.state);
  END IF;
  IF v_room.status <> 'playing' OR v_game.version <> p_expected_version THEN
    RAISE EXCEPTION 'The Journey match advanced on another device.' USING ERRCODE = '40001';
  END IF;
  SELECT participant.user_id INTO v_human_id FROM public.arena_participants participant
  WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL;
  IF v_human_id IS NULL OR p_actor_id IS DISTINCT FROM v_human_id
    OR (SELECT count(*) FROM public.arena_participants participant
      WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Only the active player may advance a machine Journey match.' USING ERRCODE = '42501';
  END IF;
  IF p_next_state->>'characterSlug' IS DISTINCT FROM v_game.character_slug
    OR (p_next_state->'game'->>'version')::integer IS DISTINCT FROM p_expected_version + 1
    OR coalesce(p_next_state->'game'->>'status', '') NOT IN ('playing', 'finished')
    OR coalesce(jsonb_array_length(p_next_state->'game'->'players'), -1) <> 2
    OR p_next_state->'game'->'players'->0->>'id' IS DISTINCT FROM v_human_id::text
    OR p_next_state->'game'->'players'->1->>'id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Invalid machine Journey state transition.';
  END IF;
  v_human_score := (p_next_state->'game'->'players'->0->>'correctAnswers')::integer;
  v_machine_score := (p_next_state->'game'->'players'->1->>'correctAnswers')::integer;
  IF v_human_score IS NULL OR v_machine_score IS NULL
    OR v_human_score < 0 OR v_machine_score < 0 THEN
    RAISE EXCEPTION 'Invalid machine Journey score.';
  END IF;
  v_question_id := nullif(p_next_state->'currentQuestion'->>'id', '')::uuid;
  IF v_question_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.arena_journey_questions question
    WHERE question.id = v_question_id AND question.character_slug = v_game.character_slug
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
  UPDATE public.arena_participants participant
  SET score = v_human_score, correct_count = v_human_score,
    finished_at = CASE WHEN p_next_state->'game'->>'status' = 'finished'
      THEN now() ELSE participant.finished_at END
  WHERE participant.room_id = p_room_id AND participant.user_id = v_human_id;
  UPDATE public.arena_rooms SET machine_score = v_machine_score WHERE id = p_room_id;

  IF p_next_state->'game'->>'status' = 'finished' THEN
    IF coalesce(p_next_state->'game'->>'winnerId', '') NOT IN
      (v_human_id::text, '00000000-0000-0000-0000-000000000000') THEN
      RAISE EXCEPTION 'Machine Journey winner does not match this room.';
    END IF;
    v_winner_id := CASE WHEN p_next_state->'game'->>'winnerId' = v_human_id::text
      THEN v_human_id ELSE NULL END;
    v_reward := greatest(coalesce(v_room.stake_amount, 0), 0) * 10;
    IF v_winner_id IS NOT NULL AND v_reward > 0 THEN
      INSERT INTO public.denarii_ledger_entries
        (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner_id, v_reward, 'arena_reward', p_room_id::text,
        'Biblical Journey tenfold winner reward for ' || v_room.room_name);
    END IF;
    UPDATE public.arena_rooms SET status = 'completed', winner_id = v_winner_id,
      completed_at = now(), completion_reason = 'finished'
    WHERE id = p_room_id;
    PERFORM public.notify_user(v_human_id, v_winner_id, 'arena',
      CASE WHEN v_winner_id IS NULL THEN 'Arena game finished' ELSE 'You won the Arena' END,
      CASE WHEN v_winner_id IS NULL THEN 'The Scribe won "' || v_room.room_name || '".'
        ELSE 'You won "' || v_room.room_name || '" and received ' || v_reward::text || ' denarii.' END,
      'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed',
        'winner_id', v_winner_id,
        'reward_amount', CASE WHEN v_winner_id IS NULL THEN 0 ELSE v_reward END));
  END IF;
  RETURN jsonb_build_object('duplicate', false, 'state', p_next_state);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_machine_arena_journey_command(uuid, integer, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_machine_arena_journey_command(uuid, integer, jsonb, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_arena_journey_matchup(p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.get_public_arena_room(p_room_id) IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.arena_rooms room
      WHERE room.id = p_room_id AND room.room_name ILIKE '%[arena:journey]%')
    THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', profile.id, 'display_name', profile.display_name,
        'avatar_url', profile.avatar_url, 'tent_house_id', membership.tent_house_id,
        'correct_count', coalesce(participant.correct_count, 0)
      ) ORDER BY participant.joined_at)
      FROM public.arena_participants participant
      JOIN public.profiles profile ON profile.id = participant.user_id
      LEFT JOIN LATERAL (
        SELECT tent.tent_house_id FROM public.tents tent
        WHERE tent.sentry_id = profile.id OR EXISTS (
          SELECT 1 FROM public.tent_members member
          WHERE member.tent_id = tent.id AND member.user_id = profile.id
        ) ORDER BY CASE WHEN tent.sentry_id = profile.id THEN 0 ELSE 1 END,
          tent.created_at DESC LIMIT 1
      ) membership ON true
      WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL
    ), '[]'::jsonb) || CASE WHEN room.play_mode = 'machine' THEN jsonb_build_array(
      jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000',
        'display_name', 'The Scribe', 'avatar_url', NULL, 'tent_house_id', NULL,
        'correct_count', greatest(coalesce(room.machine_score, 0), 0))
    ) ELSE '[]'::jsonb END END
  FROM public.arena_rooms room WHERE room.id = p_room_id;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_journey_matchup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_journey_matchup(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room public.arena_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id AND status = 'completed';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_room.id, 'room_name', v_room.room_name,
    'winner_id', v_room.winner_id,
    'game_type', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END,
    'completed_at', v_room.completed_at,
    'players', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'display_name', profile.display_name, 'avatar_url', profile.avatar_url,
        'tent_id', membership.id, 'tent_house_id', membership.tent_house_id, 'tent_name', membership.name,
        'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:journey]%' THEN coalesce(p.correct_count, 0)
          WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
            greatest(p.correct_count, coalesce((SELECT (player -> 'stats' ->> 'correct')::integer
              FROM public.arena_ludo_public_states state,
                jsonb_array_elements(state.public_state -> 'players') player
              WHERE state.room_id = p_room_id AND player ->> 'id' = p.user_id::text LIMIT 1), 0))
          ELSE greatest(p.correct_count, (SELECT count(*)::integer FROM public.arena_trivia_responses answer
            WHERE answer.room_id = p_room_id AND answer.user_id = p.user_id AND answer.is_correct)) END
      ) ORDER BY p.joined_at)
      FROM public.arena_participants p JOIN public.profiles profile ON profile.id = p.user_id
      LEFT JOIN LATERAL (
        SELECT tent.id, tent.name, tent.tent_house_id FROM public.tents tent
        WHERE tent.sentry_id = p.user_id OR EXISTS (
          SELECT 1 FROM public.tent_members member WHERE member.tent_id = tent.id AND member.user_id = p.user_id)
        ORDER BY CASE WHEN tent.sentry_id = p.user_id THEN 0 ELSE 1 END, tent.created_at DESC LIMIT 1
      ) membership ON true
      WHERE p.room_id = p_room_id
    ), '[]'::jsonb) || CASE WHEN v_room.play_mode = 'machine' THEN jsonb_build_array(
      jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000',
        'display_name', 'The Scribe', 'avatar_url', NULL, 'tent_id', NULL, 'tent_house_id', NULL, 'tent_name', NULL,
        'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:journey]%' THEN coalesce(v_room.machine_score, 0)
          WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
            coalesce((SELECT (player -> 'stats' ->> 'correct')::integer
              FROM public.arena_ludo_public_states state,
                jsonb_array_elements(state.public_state -> 'players') player
              WHERE state.room_id = p_room_id AND player ->> 'isBot' = 'true' LIMIT 1), 0)
          ELSE (SELECT count(*) FROM public.arena_machine_trivia_responses answer
            WHERE answer.room_id = p_room_id AND answer.is_correct) END)
    ) ELSE '[]'::jsonb END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_final_scorecard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_final_scorecard(uuid) TO anon, authenticated;
