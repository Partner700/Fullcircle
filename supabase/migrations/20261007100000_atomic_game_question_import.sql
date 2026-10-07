/*
  Save a validated external Daily Game question set in one database
  transaction. The previous browser-side bulk insert depended on table RLS
  for every row, which made the whole import fail opaquely when an instructor
  session or shared role helper was being refreshed.
*/

CREATE OR REPLACE FUNCTION public.import_custom_game_questions(p_questions jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_question text;
  v_question_type text;
  v_correct_answer text;
  v_options jsonb;
  v_accepted_answers jsonb;
  v_narrative_date date;
  v_narrative_title text;
  v_narrative_theme text;
  v_level integer;
  v_round integer;
  v_round_timer integer;
  v_passage_timer integer;
  v_difficulty text;
  v_question_index integer;
  v_inserted integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can import game questions.'
      USING ERRCODE = '42501';
  END IF;

  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'The validated question set is not an array.';
  END IF;
  IF jsonb_array_length(p_questions) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Import between 1 and 300 questions at a time.';
  END IF;
  IF octet_length(p_questions::text) > 2000000 THEN
    RAISE EXCEPTION 'The validated question set is larger than 2 MB.';
  END IF;

  -- Serialize every import because the Daily Game bank and its indexes are shared.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('custom-question-import', 0)
  );

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_questions) WITH ORDINALITY AS item(value, position)
    ORDER BY item.position
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Every imported question must be a JSON object.';
    END IF;

    v_question := btrim(coalesce(v_item->>'question_text', ''));
    v_question_type := btrim(coalesce(v_item->>'question_type', ''));
    v_correct_answer := btrim(coalesce(v_item->>'correct_answer', ''));
    v_level := nullif(v_item->>'game_level', '')::integer;
    v_round := nullif(v_item->>'game_round', '')::integer;
    v_narrative_date := nullif(v_item->>'narrative_date', '')::date;
    v_round_timer := coalesce(nullif(v_item->>'round_timer_seconds', '')::integer, 60);
    v_passage_timer := coalesce(nullif(v_item->>'passage_display_seconds', '')::integer, 30);
    v_difficulty := lower(btrim(coalesce(v_item->>'difficulty_tag', 'moderate')));
    v_options := v_item->'options';
    v_accepted_answers := v_item->'accepted_answers';
    IF v_accepted_answers IS NULL OR v_accepted_answers = 'null'::jsonb THEN
      v_accepted_answers := '[]'::jsonb;
    END IF;

    IF v_question = '' OR length(v_question) > 4000 THEN
      RAISE EXCEPTION 'Every question needs text no longer than 4000 characters.';
    END IF;
    IF v_correct_answer = '' OR length(v_correct_answer) > 2000 THEN
      RAISE EXCEPTION 'Question "%" needs a valid correct answer.', left(v_question, 120);
    END IF;
    IF v_question_type NOT IN (
      'multiple_choice', 'true_false', 'standard_text', 'comprehension',
      'cloze', 'matching', 'scriptorium', 'order_sequence', 'category_sort'
    ) THEN
      RAISE EXCEPTION 'Question "%" uses an unsupported Daily Game type.', left(v_question, 120);
    END IF;
    IF v_level IS NULL OR v_round IS NULL
       OR v_level NOT BETWEEN 1 AND 7 OR v_round NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'Question "%" needs a level from 1 to 7 and a round from 1 to 3.', left(v_question, 120);
    END IF;
    IF v_narrative_date IS NULL THEN
      RAISE EXCEPTION 'Question "%" needs a Narrative Day.', left(v_question, 120);
    END IF;
    IF v_round_timer NOT BETWEEN 5 AND 3600 OR v_passage_timer NOT BETWEEN 5 AND 600 THEN
      RAISE EXCEPTION 'Question "%" has a timer outside the supported range.', left(v_question, 120);
    END IF;
    IF v_difficulty NOT IN ('easy', 'moderate', 'hard') THEN
      RAISE EXCEPTION 'Question "%" has an unsupported difficulty.', left(v_question, 120);
    END IF;

    IF v_options IS NULL OR v_options = 'null'::jsonb THEN
      v_options := NULL;
    ELSIF jsonb_typeof(v_options) <> 'array' THEN
      RAISE EXCEPTION 'Question "%" has invalid answer options.', left(v_question, 120);
    ELSIF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_options) option(value)
      WHERE jsonb_typeof(option.value) <> 'string'
    ) THEN
      RAISE EXCEPTION 'Question "%" has a non-text answer option.', left(v_question, 120);
    END IF;
    IF jsonb_typeof(v_accepted_answers) <> 'array' THEN
      RAISE EXCEPTION 'Question "%" has invalid accepted answers.', left(v_question, 120);
    ELSIF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_accepted_answers) answer(value)
      WHERE jsonb_typeof(answer.value) <> 'string'
    ) THEN
      RAISE EXCEPTION 'Question "%" has a non-text accepted answer.', left(v_question, 120);
    END IF;

    IF v_question_type IN ('multiple_choice', 'comprehension') THEN
      IF v_options IS NULL OR jsonb_array_length(v_options) <> 4 THEN
        RAISE EXCEPTION 'Question "%" needs exactly four answer options.', left(v_question, 120);
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_options) option(value)
        WHERE lower(btrim(option.value)) = lower(v_correct_answer)
      ) THEN
        RAISE EXCEPTION 'The correct answer for "%" must match one option.', left(v_question, 120);
      END IF;
    END IF;

    SELECT narrative.title, narrative.theme
    INTO v_narrative_title, v_narrative_theme
    FROM public.daily_narratives narrative
    WHERE narrative.narrative_date = v_narrative_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No published Daily Reading exists for %.', v_narrative_date;
    END IF;

    -- A retry after a slow connection is safe: existing prompts are skipped.
    IF EXISTS (
      SELECT 1
      FROM public.custom_questions existing
      WHERE existing.narrative_date = v_narrative_date
        AND existing.game_level = v_level
        AND coalesce(existing.game_round, 1) = v_round
        AND lower(regexp_replace(btrim(existing.question_text), '\s+', ' ', 'g'))
          = lower(regexp_replace(v_question, '\s+', ' ', 'g'))
    ) THEN
      CONTINUE;
    END IF;

    SELECT coalesce(max(existing.question_index) + 1, 0)
    INTO v_question_index
    FROM public.custom_questions existing
    WHERE existing.narrative_date = v_narrative_date
      AND existing.game_level = v_level
      AND coalesce(existing.game_round, 1) = v_round;

    INSERT INTO public.custom_questions (
      instructor_id,
      quiz_session_id,
      game_level,
      narrative_date,
      narrative_title,
      narrative_theme,
      game_round,
      round_timer_seconds,
      passage_display_seconds,
      is_bonus,
      use_for_quiz,
      generated_from_packet,
      packet_section,
      question_text,
      question_type,
      options,
      correct_answer,
      accepted_answers,
      explanation,
      scripture_reference,
      passage,
      difficulty_tag,
      question_index,
      is_approved
    ) VALUES (
      v_user_id,
      NULL,
      v_level,
      v_narrative_date,
      v_narrative_title,
      v_narrative_theme,
      v_round,
      v_round_timer,
      v_passage_timer,
      coalesce((v_item->>'is_bonus')::boolean, false),
      coalesce((v_item->>'use_for_quiz')::boolean, false),
      false,
      'external import',
      v_question,
      v_question_type,
      v_options,
      v_correct_answer,
      v_accepted_answers,
      nullif(btrim(coalesce(v_item->>'explanation', '')), ''),
      nullif(btrim(coalesce(v_item->>'scripture_reference', '')), ''),
      nullif(btrim(coalesce(v_item->>'passage', '')), ''),
      v_difficulty,
      v_question_index,
      true
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.import_custom_game_questions(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_custom_game_questions(jsonb) TO authenticated;

COMMENT ON FUNCTION public.import_custom_game_questions(jsonb) IS
  'Atomically imports a validated Daily Game question set for the active instructor.';

NOTIFY pgrst, 'reload schema';
