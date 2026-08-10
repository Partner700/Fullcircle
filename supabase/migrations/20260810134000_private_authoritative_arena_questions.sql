-- Keep Arena answer keys off client-readable room rows and enforce turn order.
CREATE TABLE IF NOT EXISTS public.arena_question_decks (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.arena_machine_trivia_responses (
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  submitted_answer text NOT NULL DEFAULT '',
  is_correct boolean NOT NULL,
  figs_earned integer NOT NULL DEFAULT 0 CHECK (figs_earned >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, question_index)
);

ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS question_generation_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS question_generation_claimed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.arena_question_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_machine_trivia_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_question_decks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.arena_machine_trivia_responses FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sanitise_arena_questions(p_questions jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      item - ARRAY[
        'correct_answer', 'correctAnswer', 'answer', 'accepted_answers',
        'explanation', 'answer_key', 'solution'
      ]::text[]
      ORDER BY ordinal
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb)) WITH ORDINALITY AS source(item, ordinal);
$$;

-- Preserve deployed live decks before removing their answer keys from public rows.
INSERT INTO public.arena_question_decks (room_id, questions)
SELECT room.id, room.question_set
FROM public.arena_rooms room
WHERE jsonb_typeof(room.question_set) = 'array'
  AND jsonb_array_length(room.question_set) > 0
ON CONFLICT (room_id) DO NOTHING;

UPDATE public.arena_rooms
SET question_set = public.sanitise_arena_questions(question_set)
WHERE jsonb_typeof(question_set) = 'array'
  AND jsonb_array_length(question_set) > 0;

CREATE OR REPLACE FUNCTION public.claim_arena_question_generation(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Arena generation claims are service-only.';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Arena room is not available.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id
      AND participant.user_id = p_user_id
      AND participant.forfeited_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Only an active participant can prepare this Arena match.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arena_question_decks WHERE room_id = p_room_id) THEN
    RETURN false;
  END IF;
  IF v_room.question_generation_claimed_at IS NOT NULL
    AND v_room.question_generation_claimed_at > now() - interval '2 minutes' THEN
    RETURN false;
  END IF;
  UPDATE public.arena_rooms
  SET question_generation_claimed_at = now(), question_generation_claimed_by = p_user_id
  WHERE id = p_room_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_arena_question_deck(p_room_id uuid, p_questions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_public_questions jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Arena question storage is service-only.';
  END IF;
  IF jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'Arena questions must be an array.';
  END IF;
  v_count := jsonb_array_length(p_questions);
  IF v_count < 19 OR v_count > 240 THEN
    RAISE EXCEPTION 'Arena deck must contain between 19 and 240 questions.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_questions) AS questions(question)
    WHERE trim(COALESCE(question ->> 'question', '')) = ''
      OR trim(COALESCE(question ->> 'correct_answer', '')) = ''
  ) THEN
    RAISE EXCEPTION 'Every Arena question needs a prompt and answer.';
  END IF;

  INSERT INTO public.arena_question_decks (room_id, questions, updated_at)
  VALUES (p_room_id, p_questions, now())
  ON CONFLICT (room_id) DO UPDATE
    SET questions = EXCLUDED.questions, updated_at = now();

  v_public_questions := public.sanitise_arena_questions(p_questions);
  UPDATE public.arena_rooms
  SET question_set = v_public_questions,
      question_generated_at = now(),
      question_generation_claimed_at = NULL,
      question_generation_claimed_by = NULL
  WHERE id = p_room_id AND status IN ('waiting', 'playing');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Arena room is no longer available.';
  END IF;
  RETURN v_public_questions;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_arena_question_generation(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Arena generation claims are service-only.';
  END IF;
  UPDATE public.arena_rooms
  SET question_generation_claimed_at = NULL, question_generation_claimed_by = NULL
  WHERE id = p_room_id AND question_generation_claimed_by = p_user_id;
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
      WHEN v_room.room_name ILIKE '%[difficulty:easy]%' THEN 0.45
      WHEN v_room.room_name ILIKE '%[difficulty:hard]%' THEN 0.90
      ELSE 0.68
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

-- Machine results come from server-scored turns instead of a browser target.
CREATE OR REPLACE FUNCTION public.finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE; v_winner uuid; v_winner_name text; v_total_stake integer; v_count integer; v_participant record;
  v_score integer; v_correct_count integer; v_machine_score integer; v_total_questions integer; v_answered_questions integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only finish Arena games as yourself.'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN RAISE EXCEPTION 'Arena game is not active.'; END IF;

  IF v_room.room_name ILIKE '%[arena:ludo]%' THEN
    RAISE EXCEPTION 'Road Home matches are settled by the authoritative game server.';
  END IF;

  SELECT jsonb_array_length(deck.questions) INTO v_total_questions
  FROM public.arena_question_decks deck
  WHERE deck.room_id = p_room_id;
  IF COALESCE(v_total_questions, 0) = 0 THEN
    RAISE EXCEPTION 'Arena question deck is unavailable.';
  END IF;

  SELECT
    (SELECT count(*) FROM public.arena_trivia_responses response WHERE response.room_id = p_room_id)
    + (SELECT count(*) FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id)
  INTO v_answered_questions;
  IF v_answered_questions < v_total_questions THEN
    RAISE EXCEPTION 'The Arena match still has unanswered questions.';
  END IF;

  SELECT COALESCE(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
  INTO v_score, v_correct_count
  FROM public.arena_trivia_responses
  WHERE room_id = p_room_id AND user_id = p_user_id;

  UPDATE public.arena_participants SET score = v_score, correct_count = v_correct_count, finished_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id AND forfeited_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active participant in this Arena room.'; END IF;

  IF v_room.play_mode = 'machine' OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND finished_at IS NULL AND forfeited_at IS NULL
  ) THEN
    IF v_room.play_mode = 'machine' THEN
      SELECT COALESCE(sum(figs_earned), 0) INTO v_machine_score
      FROM public.arena_machine_trivia_responses WHERE room_id = p_room_id;
      v_winner := CASE WHEN v_score > v_machine_score THEN p_user_id ELSE NULL END;
      UPDATE public.arena_rooms SET machine_score = v_machine_score WHERE id = p_room_id;
    ELSE
      SELECT user_id INTO v_winner FROM public.arena_participants
      WHERE room_id = p_room_id AND forfeited_at IS NULL
      ORDER BY score DESC, correct_count DESC, finished_at ASC LIMIT 1;
    END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_total_stake := COALESCE(v_room.stake_amount, 0) * v_count * 10;
    IF v_winner IS NOT NULL AND v_total_stake > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena tenfold winner reward for ' || v_room.room_name);
    END IF;
    SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;
    UPDATE public.arena_rooms SET status = 'completed', winner_id = v_winner, completed_at = now() WHERE id = p_room_id;
    FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
      PERFORM public.notify_user(v_participant.user_id, v_winner, 'arena', CASE WHEN v_participant.user_id = v_winner THEN 'You won the Arena' ELSE 'Arena game finished' END,
        CASE WHEN v_winner IS NULL THEN 'The Machine won "' || v_room.room_name || '".' WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.' ELSE COALESCE(v_winner_name, 'A player') || ' won "' || v_room.room_name || '".' END,
        'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'reward_amount', CASE WHEN v_winner IS NULL THEN 0 ELSE v_total_stake END));
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_arena_question_generation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_arena_question_deck(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_arena_question_generation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_arena_question_generation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_arena_question_deck(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_arena_question_generation(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.prepare_arena_question_set(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_arena_trivia_answer(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_arena_trivia_answer(uuid, uuid, integer, text) TO authenticated;
