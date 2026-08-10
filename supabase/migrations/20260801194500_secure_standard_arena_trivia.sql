-- Standard Arena scores must be derived from submitted answers, never from a browser value.
CREATE TABLE IF NOT EXISTS public.arena_trivia_responses (
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  submitted_answer text NOT NULL DEFAULT '',
  is_correct boolean NOT NULL,
  figs_earned integer NOT NULL DEFAULT 0 CHECK (figs_earned >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id, question_index)
);

ALTER TABLE public.arena_trivia_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_trivia_responses FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalise_arena_answer(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(trim(coalesce(p_value, ''))), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.submit_arena_trivia_answer(
  p_room_id uuid,
  p_user_id uuid,
  p_question_index integer,
  p_answer text
)
RETURNS TABLE(is_correct boolean, figs_earned integer, total_figs integer, correct_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_question jsonb;
  v_correct text;
  v_is_correct boolean;
  v_figs integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only submit an arena answer as yourself.';
  END IF;

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Arena game is not active.';
  END IF;
  IF v_room.room_name ILIKE '%[arena:ludo]%' THEN
    RAISE EXCEPTION 'Road Home answers are handled by its authoritative game engine.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'You are not a participant in this arena room.';
  END IF;

  v_question := coalesce(v_room.question_set, '[]'::jsonb) -> p_question_index;
  IF v_question IS NULL OR coalesce(v_question ->> 'correct_answer', '') = '' THEN
    RAISE EXCEPTION 'This arena question is unavailable.';
  END IF;
  v_correct := v_question ->> 'correct_answer';
  v_is_correct := public.normalise_arena_answer(p_answer) = public.normalise_arena_answer(v_correct);
  v_figs := CASE
    WHEN v_is_correct THEN CASE WHEN coalesce((v_question ->> 'is_bonus')::boolean, false) THEN 2 ELSE 1 END
    ELSE 0
  END;

  INSERT INTO public.arena_trivia_responses (room_id, user_id, question_index, submitted_answer, is_correct, figs_earned)
  VALUES (p_room_id, p_user_id, p_question_index, coalesce(p_answer, ''), v_is_correct, v_figs)
  ON CONFLICT (room_id, user_id, question_index) DO NOTHING;

  RETURN QUERY
  SELECT response.is_correct, response.figs_earned, totals.total_figs, totals.correct_count
  FROM public.arena_trivia_responses response
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(all_responses.figs_earned), 0)::integer AS total_figs,
      count(*) FILTER (WHERE all_responses.is_correct)::integer AS correct_count
    FROM public.arena_trivia_responses all_responses
    WHERE all_responses.room_id = p_room_id AND all_responses.user_id = p_user_id
  ) totals
  WHERE response.room_id = p_room_id AND response.user_id = p_user_id AND response.question_index = p_question_index;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE; v_winner uuid; v_winner_name text; v_total_stake integer; v_count integer; v_participant record;
  v_score integer; v_correct_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only finish arena games as yourself.'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN RAISE EXCEPTION 'Arena game is not active.'; END IF;

  IF v_room.room_name NOT ILIKE '%[arena:ludo]%' THEN
    SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
    INTO v_score, v_correct_count
    FROM public.arena_trivia_responses
    WHERE room_id = p_room_id AND user_id = p_user_id;
  ELSE
    v_score := greatest(0, coalesce(p_score, 0));
    v_correct_count := greatest(0, coalesce(p_correct_count, 0));
  END IF;

  UPDATE public.arena_participants SET score = v_score, correct_count = v_correct_count, finished_at = now() WHERE room_id = p_room_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not a participant in this arena room.'; END IF;
  IF v_room.play_mode = 'machine' OR NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND finished_at IS NULL) THEN
    IF v_room.play_mode = 'machine' THEN
      v_winner := CASE WHEN v_score >= COALESCE(v_room.machine_score, 10) THEN p_user_id ELSE NULL END;
    ELSE
      SELECT user_id INTO v_winner FROM public.arena_participants WHERE room_id = p_room_id ORDER BY score DESC, correct_count DESC, finished_at ASC LIMIT 1;
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
      PERFORM public.notify_user(v_participant.user_id, v_winner, 'arena', CASE WHEN v_participant.user_id = v_winner THEN 'You won the arena' ELSE 'Arena game finished' END,
        CASE WHEN v_winner IS NULL THEN 'The Machine won "' || v_room.room_name || '".' WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.' ELSE COALESCE(v_winner_name, 'A cadet') || ' won "' || v_room.room_name || '".' END,
        'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'reward_amount', CASE WHEN v_winner IS NULL THEN 0 ELSE v_total_stake END));
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_arena_trivia_answer(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer) TO authenticated;
