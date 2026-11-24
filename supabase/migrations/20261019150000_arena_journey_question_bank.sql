-- Keep every imported set and retire questions without deleting historical matches.
ALTER TABLE public.arena_journey_questions
  ADD COLUMN question_set_name text NOT NULL DEFAULT 'Original questions'
    CHECK (length(btrim(question_set_name)) BETWEEN 2 AND 80),
  ADD COLUMN retired_at timestamptz;
ALTER TABLE public.arena_journey_questions
  DROP CONSTRAINT arena_journey_questions_source_kind_check;
ALTER TABLE public.arena_journey_questions
  ADD CONSTRAINT arena_journey_questions_source_kind_check
    CHECK (source_kind IN ('supplied-pdf', 'authored-web-checked-supplement', 'instructor-upload'));
DROP INDEX public.arena_journey_approved_prompt_unique;
CREATE UNIQUE INDEX arena_journey_approved_prompt_unique
  ON public.arena_journey_questions (character_slug, md5(lower(btrim(question_text))))
  WHERE review_status = 'approved' AND retired_at IS NULL;
CREATE INDEX arena_journey_question_bank_idx
  ON public.arena_journey_questions (character_slug, question_set_name, question_stage, review_status, retired_at);

CREATE OR REPLACE FUNCTION public.get_arena_journey_active_question_pool(p_slug text)
RETURNS TABLE(id uuid, question_stage smallint)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT pool.id, pool.question_stage
  FROM (
    SELECT question.id, question.question_stage,
      row_number() OVER (PARTITION BY question.question_stage ORDER BY random()) AS stage_rank
    FROM public.arena_journey_questions question
    WHERE question.character_slug = p_slug AND question.review_status = 'approved'
      AND question.retired_at IS NULL
  ) pool
  WHERE pool.stage_rank <= 60;
$$;
REVOKE ALL ON FUNCTION public.get_arena_journey_active_question_pool(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arena_journey_active_question_pool(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_arena_journey_bank_page(
  p_slug text, p_stage integer DEFAULT NULL, p_status text DEFAULT 'pending',
  p_set_name text DEFAULT NULL, p_offset integer DEFAULT 0, p_limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can view Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF (p_stage IS NOT NULL AND p_stage NOT BETWEEN 1 AND 5)
    OR p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'discontinued', 'all')
    OR p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR length(coalesce(p_set_name, '')) > 80 THEN
    RAISE EXCEPTION 'Invalid Journey question filter.';
  END IF;
  SELECT jsonb_build_object(
    'character', jsonb_build_object('slug', character.slug,
      'displayName', character.display_name, 'narrativeBeats', character.narrative_beats,
      'ready', character.ready),
    'sets', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', named.question_set_name,
      'total', named.total) ORDER BY named.question_set_name), '[]'::jsonb)
      FROM (SELECT question_set_name, count(*) AS total FROM public.arena_journey_questions
        WHERE character_slug = p_slug GROUP BY question_set_name) named),
    'counts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'stage', stage.number,
      'pending', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'pending'),
      'approved', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'approved' AND q.retired_at IS NULL),
      'rejected', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'rejected'),
      'discontinued', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'approved' AND q.retired_at IS NOT NULL)
    ) ORDER BY stage.number), '[]'::jsonb) FROM generate_series(1, 5) stage(number)),
    'total', (SELECT count(*) FROM public.arena_journey_questions q
      WHERE q.character_slug = p_slug AND (p_stage IS NULL OR q.question_stage = p_stage)
        AND (p_set_name IS NULL OR q.question_set_name = p_set_name)
        AND (p_status = 'all'
          OR p_status = 'approved' AND q.review_status = 'approved' AND q.retired_at IS NULL
          OR p_status = 'discontinued' AND q.review_status = 'approved' AND q.retired_at IS NOT NULL
          OR p_status IN ('pending', 'rejected') AND q.review_status = p_status)),
    'questions', (SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.question_stage,
      page.source_number, page.id), '[]'::jsonb)
      FROM (SELECT q.id, q.question_stage, q.question_type, q.question_text, q.options,
        q.correct_answer, q.accepted_answers, q.explanation, q.source_reference,
        q.source_number, q.source_kind, q.source_question_page, q.source_answer_page,
        q.answer_key_text, q.review_status, q.review_note, q.question_set_name, q.retired_at
        FROM public.arena_journey_questions q
        WHERE q.character_slug = p_slug AND (p_stage IS NULL OR q.question_stage = p_stage)
          AND (p_set_name IS NULL OR q.question_set_name = p_set_name)
          AND (p_status = 'all'
            OR p_status = 'approved' AND q.review_status = 'approved' AND q.retired_at IS NULL
            OR p_status = 'discontinued' AND q.review_status = 'approved' AND q.retired_at IS NOT NULL
            OR p_status IN ('pending', 'rejected') AND q.review_status = p_status)
        ORDER BY q.question_stage, q.source_number, q.id OFFSET p_offset LIMIT p_limit) page)
  ) INTO v_result
  FROM public.arena_journey_characters character WHERE character.slug = p_slug;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Journey volume not found.'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_arena_journey_bank_page(text, integer, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_journey_bank_page(text, integer, text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.append_arena_journey_question_set(
  p_slug text, p_set_name text, p_questions jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item jsonb;
  v_type text;
  v_options jsonb;
  v_answer text;
  v_question text;
  v_inserted integer := 0;
  v_skipped integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can add Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_set_name, ''))) NOT BETWEEN 2 AND 80
    OR p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array'
    OR jsonb_array_length(p_questions) NOT BETWEEN 1 AND 300
    OR octet_length(p_questions::text) > 2000000 THEN
    RAISE EXCEPTION 'Name the set and upload 1 to 300 questions (under 2 MB).';
  END IF;
  PERFORM 1 FROM public.arena_journey_characters WHERE slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an imported Biblical Journey volume.'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_questions) source(value) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN RAISE EXCEPTION 'Each question must be an object.'; END IF;
    v_type := btrim(coalesce(v_item->>'type', ''));
    v_question := btrim(coalesce(v_item->>'question', ''));
    v_answer := btrim(coalesce(v_item->>'correct_answer', ''));
    v_options := coalesce(v_item->'options', '[]'::jsonb);
    IF (v_item->>'stage') !~ '^[1-5]$'
      OR v_type NOT IN ('true_false', 'multiple_choice', 'odd_one', 'fill_blank', 'order_sequence')
      OR length(v_question) NOT BETWEEN 5 AND 4000
      OR length(v_answer) NOT BETWEEN 1 AND 2000
      OR length(btrim(coalesce(v_item->>'reference', ''))) < 3
      OR jsonb_typeof(v_options) <> 'array'
      OR jsonb_array_length(v_options) > 8
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_options) option(value)
        WHERE jsonb_typeof(option.value) <> 'string' OR length(btrim(option.value #>> '{}')) NOT BETWEEN 1 AND 500)
      OR jsonb_typeof(coalesce(v_item->'accepted_answers', '[]'::jsonb)) <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_item->'accepted_answers', '[]'::jsonb)) alias(value)
        WHERE jsonb_typeof(alias.value) <> 'string')
      OR coalesce(v_item->>'difficulty_tag', 'moderate') NOT IN ('easy', 'moderate', 'hard') THEN
      RAISE EXCEPTION 'A question needs a valid stage, type, prompt, answer, options, and Scripture reference.';
    END IF;
    IF v_type IN ('multiple_choice', 'odd_one') AND
      (jsonb_array_length(v_options) NOT BETWEEN 3 AND 6 OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_options) option(value)
        WHERE lower(btrim(option.value)) = lower(v_answer)
      )) THEN
      RAISE EXCEPTION 'Multiple-choice answers must exactly match one of 3 to 6 options.';
    END IF;
    IF v_type = 'true_false' AND (lower(v_answer) NOT IN ('true', 'false') OR jsonb_array_length(v_options) <> 0) THEN
      RAISE EXCEPTION 'True/false answers must be true or false without options.';
    END IF;
    IF v_type = 'order_sequence' AND (
      jsonb_array_length(v_options) NOT BETWEEN 3 AND 8
      OR array_length(regexp_split_to_array(upper(v_answer), '\s+'), 1) <> jsonb_array_length(v_options)
      OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(upper(v_answer), '\s+')) label(value)
        WHERE label.value !~ '^[A-H]$'
          OR ascii(label.value) - ascii('A') >= jsonb_array_length(v_options))
      OR (SELECT count(DISTINCT label.value) FROM unnest(regexp_split_to_array(upper(v_answer), '\s+')) label(value))
        <> jsonb_array_length(v_options)) THEN
      RAISE EXCEPTION 'Sequence answers must name each option once, for example A C B.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.arena_journey_questions existing
      WHERE existing.character_slug = p_slug AND lower(btrim(existing.question_text)) = lower(v_question)
        AND existing.review_status <> 'rejected') THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.arena_journey_questions (
      character_slug, question_set_name, question_stage, question_type, question_text, options,
      correct_answer, accepted_answers, explanation, source_reference, difficulty_tag, source_kind, created_by
    ) VALUES (
      p_slug, btrim(p_set_name), (v_item->>'stage')::smallint, v_type, v_question, v_options,
      v_answer, coalesce(v_item->'accepted_answers', '[]'::jsonb),
      nullif(btrim(coalesce(v_item->>'explanation', '')), ''), btrim(v_item->>'reference'),
      coalesce(v_item->>'difficulty_tag', 'moderate'), 'instructor-upload', auth.uid()
    );
    v_inserted := v_inserted + 1;
  END LOOP;
  RETURN jsonb_build_object('imported', v_inserted, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.append_arena_journey_question_set(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_arena_journey_question_set(text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_arena_journey_question_retired(p_question_id uuid, p_retired boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_slug text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can discontinue Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF p_retired IS NULL THEN RAISE EXCEPTION 'Choose discontinue or restore.'; END IF;
  IF NOT p_retired AND EXISTS (
    SELECT 1 FROM public.arena_journey_questions restoring
    JOIN public.arena_journey_questions active
      ON active.character_slug = restoring.character_slug AND active.id <> restoring.id
        AND active.review_status = 'approved' AND active.retired_at IS NULL
        AND md5(lower(btrim(active.question_text))) = md5(lower(btrim(restoring.question_text)))
    WHERE restoring.id = p_question_id
  ) THEN RAISE EXCEPTION 'An active question already has this prompt.'; END IF;
  UPDATE public.arena_journey_questions
  SET retired_at = CASE WHEN p_retired THEN now() ELSE NULL END
  WHERE id = p_question_id AND review_status = 'approved' RETURNING character_slug INTO v_slug;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Journey question not found.'; END IF;
  UPDATE public.arena_journey_characters character
  SET ready = false, updated_at = now()
  WHERE character.slug = v_slug AND character.ready AND EXISTS (
    SELECT 1 FROM generate_series(1, 5) stage(number)
    WHERE (SELECT count(*) FROM public.arena_journey_questions question
      WHERE question.character_slug = v_slug AND question.question_stage = stage.number
        AND question.review_status = 'approved' AND question.retired_at IS NULL) < 10
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_journey_question_retired(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_journey_question_retired(uuid, boolean) TO authenticated;

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
    SELECT 1 FROM generate_series(1, 5) stage(number)
    WHERE (SELECT count(*) FROM public.arena_journey_questions question
      WHERE question.character_slug = p_slug AND question.question_stage = stage.number
        AND question.review_status = 'approved' AND question.retired_at IS NULL) < 10
  ) THEN
    RAISE EXCEPTION 'Each stage needs at least ten active approved questions.';
  END IF;
  UPDATE public.arena_journey_characters SET ready = p_ready, updated_at = now() WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'That character has not been imported.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_journey_character_ready(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_journey_character_ready(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_arena_journey_question_batch(
  p_question_ids uuid[], p_status text, p_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_question public.arena_journey_questions%ROWTYPE;
  v_updated integer := 0;
  v_approved integer := 0;
  v_rejected integer := 0;
  v_duplicate boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can review Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected')
    OR coalesce(array_length(p_question_ids, 1), 0) NOT BETWEEN 1 AND 25
    OR length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION 'Select 1 to 25 questions and a valid decision.';
  END IF;
  FOR v_question IN SELECT * FROM public.arena_journey_questions
    WHERE id = ANY(p_question_ids) ORDER BY source_number NULLS LAST, id FOR UPDATE LOOP
    IF p_status = 'approved' AND (
      v_question.source_reference IS NULL
      OR length(btrim(v_question.correct_answer)) = 0
      OR (v_question.question_type IN ('multiple_choice', 'odd_one', 'order_sequence')
        AND jsonb_array_length(v_question.options) < 3)
    ) THEN
      RAISE EXCEPTION 'Question % needs a checked answer, Scripture reference, and choices.', v_question.id;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.arena_journey_questions existing
      WHERE existing.character_slug = v_question.character_slug
        AND existing.id <> v_question.id AND existing.review_status = 'approved'
        AND existing.retired_at IS NULL
        AND md5(lower(btrim(existing.question_text))) = md5(lower(btrim(v_question.question_text)))
    ) INTO v_duplicate;
    UPDATE public.arena_journey_questions
    SET review_status = CASE WHEN p_status = 'approved' AND v_duplicate THEN 'rejected' ELSE p_status END,
      reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = CASE WHEN p_status = 'approved' AND v_duplicate
        THEN 'Exact duplicate of an active question.' ELSE nullif(btrim(coalesce(p_note, '')), '') END
    WHERE id = v_question.id;
    UPDATE public.arena_journey_characters character
    SET ready = false, updated_at = now()
    WHERE character.slug = v_question.character_slug AND character.ready AND EXISTS (
      SELECT 1 FROM generate_series(1, 5) stage(number)
      WHERE (SELECT count(*) FROM public.arena_journey_questions question
        WHERE question.character_slug = v_question.character_slug
          AND question.question_stage = stage.number
          AND question.review_status = 'approved' AND question.retired_at IS NULL) < 10
    );
    v_updated := v_updated + 1;
    IF p_status = 'approved' AND NOT v_duplicate THEN v_approved := v_approved + 1;
    ELSE v_rejected := v_rejected + 1; END IF;
  END LOOP;
  IF v_updated <> (SELECT count(DISTINCT chosen.question_id)
    FROM unnest(p_question_ids) chosen(question_id)) THEN
    RAISE EXCEPTION 'One or more selected questions were not found.';
  END IF;
  RETURN jsonb_build_object('reviewed', v_updated, 'approved', v_approved, 'rejected', v_rejected);
END;
$$;
REVOKE ALL ON FUNCTION public.review_arena_journey_question_batch(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_arena_journey_question_batch(uuid[], text, text) TO authenticated;

-- Superseded instructor RPCs reset a playable character on every import or edit.
REVOKE EXECUTE ON FUNCTION public.import_arena_journey_questions(text, text, jsonb, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.review_arena_journey_question(uuid, text, text) FROM authenticated;
