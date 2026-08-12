/*
# Arena forfeit settlement and fast hard-question pacing

- Forfeit settlement is safe to retry and still notifies the winner.
- Standard Arena timing is now 12s / 9s / 6s through stored decks.
- Machine difficulty changes machine accuracy, not question softness.
*/

CREATE OR REPLACE FUNCTION public.settle_standard_arena_forfeit(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_remaining_count integer;
  v_winner uuid;
  v_winner_name text;
  v_total_stake integer;
  v_participant record;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.room_name ILIKE '%[arena:ludo]%' THEN RETURN; END IF;
  IF v_room.status NOT IN ('playing', 'completed') THEN RETURN; END IF;

  SELECT count(*), (array_agg(user_id ORDER BY joined_at))[1]
  INTO v_remaining_count, v_winner
  FROM public.arena_participants
  WHERE room_id = p_room_id AND forfeited_at IS NULL;

  IF v_room.status = 'playing' AND v_remaining_count > 1 THEN RETURN; END IF;
  IF v_room.play_mode = 'machine' THEN v_winner := NULL; END IF;

  SELECT count(*) INTO v_remaining_count FROM public.arena_participants WHERE room_id = p_room_id;
  v_total_stake := COALESCE(v_room.stake_amount, 0) * GREATEST(v_remaining_count, 1) * 10;

  IF v_winner IS NOT NULL AND v_total_stake > 0 AND NOT EXISTS (
    SELECT 1 FROM public.denarii_ledger_entries
    WHERE source_type = 'arena_reward' AND source_reference = p_room_id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
    VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena tenfold winner reward after forfeiture for ' || v_room.room_name);
  END IF;

  SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;

  UPDATE public.arena_rooms
  SET status = 'completed',
      winner_id = v_winner,
      completed_at = COALESCE(completed_at, now()),
      completion_reason = 'forfeit'
  WHERE id = p_room_id;

  FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_notifications notification
      WHERE notification.recipient_id = v_participant.user_id
        AND notification.notification_type = 'arena'
        AND notification.action_key = 'arena'
        AND notification.metadata ->> 'room_id' = p_room_id::text
        AND notification.metadata ->> 'completion_reason' = 'forfeit'
    ) THEN
      PERFORM public.notify_user(
        v_participant.user_id,
        v_winner,
        'arena',
        CASE WHEN v_participant.user_id = v_winner THEN 'You won by forfeit' ELSE 'Arena match ended' END,
        CASE WHEN v_winner IS NULL THEN 'The match ended by forfeiture.'
          WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
          ELSE COALESCE(v_winner_name, 'The remaining player') || ' won "' || v_room.room_name || '" after a forfeiture.' END,
        'arena',
        jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'completion_reason', 'forfeit', 'reward_amount', CASE WHEN v_winner IS NULL THEN 0 ELSE v_total_stake END)
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_arena_trivia_answer(
  p_room_id uuid,
  p_user_id uuid,
  p_question_index integer,
  p_answer text
)
RETURNS TABLE(
  is_correct boolean,
  figs_earned integer,
  total_figs integer,
  correct_count integer,
  machine_question_index integer,
  machine_answer text,
  machine_correct boolean,
  machine_figs integer,
  machine_total_figs integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_questions jsonb;
  v_question jsonb;
  v_correct text;
  v_is_correct boolean;
  v_figs integer;
  v_expected_index integer;
  v_expected_user uuid;
  v_participant_count integer;
  v_machine_question jsonb;
  v_machine_correct boolean;
  v_machine_answer text;
  v_machine_figs integer := 0;
  v_machine_accuracy numeric;
  v_existing public.arena_trivia_responses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only submit an Arena answer as yourself.';
  END IF;

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Arena game is not active.';
  END IF;
  IF v_room.room_name ILIKE '%[arena:ludo]%' THEN
    RAISE EXCEPTION 'Road Home answers are handled by its authoritative game engine.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id = p_user_id AND forfeited_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You are not an active participant in this Arena room.';
  END IF;

  SELECT * INTO v_existing
  FROM public.arena_trivia_responses
  WHERE room_id = p_room_id AND user_id = p_user_id AND question_index = p_question_index;
  IF FOUND THEN
    RETURN QUERY
    SELECT v_existing.is_correct, v_existing.figs_earned,
      COALESCE(sum(response.figs_earned), 0)::integer,
      count(*) FILTER (WHERE response.is_correct)::integer,
      NULL::integer, NULL::text, NULL::boolean, 0,
      COALESCE((SELECT sum(machine.figs_earned) FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id), 0)::integer
    FROM public.arena_trivia_responses response
    WHERE response.room_id = p_room_id AND response.user_id = p_user_id;
    RETURN;
  END IF;

  SELECT deck.questions INTO v_questions
  FROM public.arena_question_decks deck
  WHERE deck.room_id = p_room_id;
  IF v_questions IS NULL THEN
    RAISE EXCEPTION 'Arena question deck is unavailable.';
  END IF;

  IF v_room.play_mode = 'machine' THEN
    SELECT count(*) * 2 INTO v_expected_index
    FROM public.arena_trivia_responses
    WHERE room_id = p_room_id AND user_id = p_user_id;
    IF p_question_index <> v_expected_index THEN
      RAISE EXCEPTION 'That is not your current Arena question.';
    END IF;
  ELSE
    SELECT count(*) INTO v_expected_index
    FROM public.arena_trivia_responses
    WHERE room_id = p_room_id;
    IF p_question_index <> v_expected_index THEN
      RAISE EXCEPTION 'That Arena turn has already moved.';
    END IF;
    SELECT count(*) INTO v_participant_count
    FROM public.arena_participants
    WHERE room_id = p_room_id AND forfeited_at IS NULL;
    SELECT participant.user_id INTO v_expected_user
    FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL
    ORDER BY participant.joined_at, participant.user_id
    OFFSET (p_question_index % GREATEST(v_participant_count, 1)) LIMIT 1;
    IF v_expected_user IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'It is another player''s turn.';
    END IF;
  END IF;

  v_question := v_questions -> p_question_index;
  IF v_question IS NULL OR trim(COALESCE(v_question ->> 'correct_answer', '')) = '' THEN
    RAISE EXCEPTION 'This Arena question is unavailable.';
  END IF;
  v_correct := v_question ->> 'correct_answer';
  v_is_correct := public.normalise_arena_answer(p_answer) = public.normalise_arena_answer(v_correct);
  v_figs := CASE WHEN v_is_correct THEN CASE WHEN COALESCE((v_question ->> 'is_bonus')::boolean, false) THEN 2 ELSE 1 END ELSE 0 END;

  INSERT INTO public.arena_trivia_responses (room_id, user_id, question_index, submitted_answer, is_correct, figs_earned)
  VALUES (p_room_id, p_user_id, p_question_index, COALESCE(p_answer, ''), v_is_correct, v_figs);

  machine_question_index := NULL;
  machine_answer := NULL;
  machine_correct := NULL;
  machine_figs := 0;

  IF v_room.play_mode = 'machine' AND p_question_index + 1 < jsonb_array_length(v_questions) THEN
    machine_question_index := p_question_index + 1;
    v_machine_question := v_questions -> machine_question_index;
    v_machine_accuracy := CASE
      WHEN v_room.room_name ILIKE '%[difficulty:easy]%' THEN 0.35
      WHEN v_room.room_name ILIKE '%[difficulty:hard]%' THEN 0.82
      ELSE 0.58
    END;
    v_machine_correct := random() < v_machine_accuracy;
    IF v_machine_correct THEN
      v_machine_answer := v_machine_question ->> 'correct_answer';
    ELSE
      SELECT option INTO v_machine_answer
      FROM jsonb_array_elements_text(COALESCE(v_machine_question -> 'options', '[]'::jsonb)) AS options(option)
      WHERE public.normalise_arena_answer(option) <> public.normalise_arena_answer(v_machine_question ->> 'correct_answer')
      ORDER BY random() LIMIT 1;
      v_machine_answer := COALESCE(v_machine_answer, 'No answer');
    END IF;
    v_machine_figs := CASE WHEN v_machine_correct THEN CASE WHEN COALESCE((v_machine_question ->> 'is_bonus')::boolean, false) THEN 2 ELSE 1 END ELSE 0 END;
    INSERT INTO public.arena_machine_trivia_responses (room_id, question_index, submitted_answer, is_correct, figs_earned)
    VALUES (p_room_id, machine_question_index, v_machine_answer, v_machine_correct, v_machine_figs)
    ON CONFLICT (room_id, question_index) DO NOTHING;
    SELECT response.submitted_answer, response.is_correct, response.figs_earned
    INTO machine_answer, machine_correct, machine_figs
    FROM public.arena_machine_trivia_responses response
    WHERE response.room_id = p_room_id AND response.question_index = machine_question_index;
  END IF;

  RETURN QUERY
  SELECT v_is_correct, v_figs,
    COALESCE(sum(response.figs_earned), 0)::integer,
    count(*) FILTER (WHERE response.is_correct)::integer,
    machine_question_index, machine_answer, machine_correct, machine_figs,
    COALESCE((SELECT sum(machine.figs_earned) FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id), 0)::integer
  FROM public.arena_trivia_responses response
  WHERE response.room_id = p_room_id AND response.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_standard_arena_forfeit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_arena_trivia_answer(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_arena_trivia_answer(uuid, uuid, integer, text) TO authenticated;
