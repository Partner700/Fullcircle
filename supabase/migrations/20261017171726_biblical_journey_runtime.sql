-- Isolated Biblical Journey data. Existing Standard Trivia and Ludo rooms are untouched.
CREATE TABLE public.arena_journey_characters (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 80),
  narrative_beats jsonb NOT NULL CHECK (jsonb_typeof(narrative_beats) = 'array' AND jsonb_array_length(narrative_beats) = 7),
  ready boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.arena_journey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_slug text NOT NULL REFERENCES public.arena_journey_characters(slug) ON DELETE CASCADE,
  question_stage smallint NOT NULL CHECK (question_stage BETWEEN 1 AND 5),
  question_type text NOT NULL CHECK (question_type IN ('true_false', 'multiple_choice', 'odd_one', 'fill_blank', 'order_sequence')),
  question_text text NOT NULL CHECK (length(btrim(question_text)) BETWEEN 5 AND 4000),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  correct_answer text NOT NULL CHECK (length(btrim(correct_answer)) BETWEEN 1 AND 2000),
  accepted_answers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(accepted_answers) = 'array'),
  explanation text,
  source_reference text,
  difficulty_tag text NOT NULL DEFAULT 'moderate' CHECK (difficulty_tag IN ('easy', 'moderate', 'hard')),
  source_number integer CHECK (source_number > 0),
  source_kind text NOT NULL CHECK (source_kind IN ('supplied-pdf', 'authored-web-checked-supplement')),
  source_question_page integer CHECK (source_question_page > 0),
  source_answer_page integer CHECK (source_answer_page > 0),
  answer_key_text text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX arena_journey_question_source_unique
  ON public.arena_journey_questions (character_slug, source_number) WHERE source_number IS NOT NULL;
CREATE UNIQUE INDEX arena_journey_approved_prompt_unique
  ON public.arena_journey_questions (character_slug, md5(lower(btrim(question_text)))) WHERE review_status = 'approved';
CREATE INDEX arena_journey_question_stage_idx
  ON public.arena_journey_questions (character_slug, question_stage, review_status);

CREATE TABLE public.arena_journey_games (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  character_slug text NOT NULL REFERENCES public.arena_journey_characters(slug),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  turn_number integer NOT NULL DEFAULT 0 CHECK (turn_number >= 0),
  current_question_id uuid REFERENCES public.arena_journey_questions(id),
  pending_die smallint CHECK (pending_die BETWEEN 1 AND 6),
  recent_action_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.arena_journey_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_journey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_journey_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_journey_characters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.arena_journey_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.arena_journey_games FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arena_journey_characters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arena_journey_questions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arena_journey_games TO service_role;

CREATE OR REPLACE FUNCTION public.import_arena_journey_questions(
  p_character_slug text,
  p_character_name text,
  p_narrative_beats jsonb,
  p_questions jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_inserted integer := 0;
  v_type text;
  v_options jsonb;
  v_answer text;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can import Biblical Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF p_character_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$'
    OR length(btrim(coalesce(p_character_name, ''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Give the character a valid name and short slug.';
  END IF;
  IF jsonb_typeof(p_narrative_beats) <> 'array' OR jsonb_array_length(p_narrative_beats) <> 7
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_narrative_beats) beat(value)
      WHERE jsonb_typeof(beat.value) <> 'string' OR length(btrim(beat.value #>> '{}')) NOT BETWEEN 2 AND 120
    ) THEN
    RAISE EXCEPTION 'Provide seven accurate narrative beat labels for this character.';
  END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) NOT BETWEEN 1 AND 300
    OR octet_length(p_questions::text) > 2000000 THEN
    RAISE EXCEPTION 'Import 1 to 300 questions in a set smaller than 2 MB.';
  END IF;

  INSERT INTO public.arena_journey_characters (slug, display_name, narrative_beats, created_by)
  VALUES (p_character_slug, btrim(p_character_name), p_narrative_beats, v_user_id)
  ON CONFLICT (slug) DO UPDATE
    SET display_name = EXCLUDED.display_name, narrative_beats = EXCLUDED.narrative_beats,
        ready = false, updated_at = now();

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_questions) AS source(value) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Every Biblical Journey question must be an object.';
    END IF;
    v_type := btrim(coalesce(v_item->>'type', ''));
    v_options := coalesce(v_item->'options', '[]'::jsonb);
    v_answer := btrim(coalesce(v_item->>'correct_answer', ''));
    IF v_type NOT IN ('true_false', 'multiple_choice', 'odd_one', 'fill_blank', 'order_sequence')
      OR (v_item->>'stage')::integer NOT BETWEEN 1 AND 5
      OR coalesce(v_item->>'source_kind', '') NOT IN ('supplied-pdf', 'authored-web-checked-supplement')
      OR length(btrim(coalesce(v_item->>'question', ''))) NOT BETWEEN 5 AND 4000
      OR length(v_answer) NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(v_options) <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_options) choice(value) WHERE jsonb_typeof(choice.value) <> 'string')
      OR jsonb_typeof(coalesce(v_item->'accepted_answers', '[]'::jsonb)) <> 'array'
      OR coalesce(v_item->>'difficulty_tag', 'moderate') NOT IN ('easy', 'moderate', 'hard') THEN
      RAISE EXCEPTION 'A Biblical Journey question has invalid stage, type, answer, or options.';
    END IF;
    IF v_type IN ('multiple_choice', 'odd_one', 'order_sequence')
      AND jsonb_array_length(v_options) < 2 THEN
      RAISE EXCEPTION 'Option-based questions need at least two choices.';
    END IF;
    INSERT INTO public.arena_journey_questions (
      character_slug, question_stage, question_type, question_text, options,
      correct_answer, accepted_answers, explanation, source_reference, difficulty_tag,
      source_number, source_kind, source_question_page, source_answer_page, answer_key_text, created_by
    ) VALUES (
      p_character_slug, (v_item->>'stage')::smallint, v_type, btrim(v_item->>'question'), v_options,
      v_answer, coalesce(v_item->'accepted_answers', '[]'::jsonb),
      nullif(btrim(coalesce(v_item->>'explanation', '')), ''),
      nullif(btrim(coalesce(v_item->>'reference', '')), ''), coalesce(v_item->>'difficulty_tag', 'moderate'),
      nullif(v_item->>'source_number', '')::integer,
      v_item->>'source_kind',
      nullif(v_item->>'source_question_page', '')::integer,
      nullif(v_item->>'source_answer_page', '')::integer,
      nullif(btrim(coalesce(v_item->>'answer_key_text', '')), ''), v_user_id
    ) ON CONFLICT DO NOTHING;
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.import_arena_journey_questions(text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_arena_journey_questions(text, text, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_arena_journey_character_ready(p_slug text, p_ready boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can activate a character.' USING ERRCODE = '42501';
  END IF;
  IF p_ready AND EXISTS (
    SELECT 1 FROM generate_series(1, 5) AS stage(number)
    WHERE (SELECT count(*) FROM public.arena_journey_questions question
      WHERE question.character_slug = p_slug AND question.question_stage = stage.number
        AND question.review_status = 'approved') < 10
  ) THEN
    RAISE EXCEPTION 'Each of the five question stages needs at least ten distinct questions.';
  END IF;
  UPDATE public.arena_journey_characters SET ready = p_ready, updated_at = now() WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'That character has not been imported.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_journey_character_ready(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_journey_character_ready(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_arena_journey_question(
  p_question_id uuid, p_status text, p_note text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_question public.arena_journey_questions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can review Biblical Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Review status must be pending, approved, or rejected.';
  END IF;
  SELECT * INTO v_question FROM public.arena_journey_questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not found.'; END IF;
  IF p_status = 'approved' AND (
    v_question.source_reference IS NULL
    OR v_question.correct_answer IS NULL
    OR (v_question.question_type IN ('multiple_choice', 'odd_one', 'order_sequence')
      AND jsonb_array_length(v_question.options) < 3)
  ) THEN
    RAISE EXCEPTION 'A question needs a checked answer, citation, and choices before approval.';
  END IF;
  UPDATE public.arena_journey_questions
    SET review_status = p_status,
        reviewed_by = CASE WHEN p_status = 'pending' THEN NULL ELSE auth.uid() END,
        reviewed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END,
        review_note = nullif(btrim(coalesce(p_note, '')), '')
    WHERE id = p_question_id;
  UPDATE public.arena_journey_characters SET ready = false, updated_at = now()
    WHERE slug = v_question.character_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.review_arena_journey_question(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_arena_journey_question(uuid, text, text) TO authenticated;
