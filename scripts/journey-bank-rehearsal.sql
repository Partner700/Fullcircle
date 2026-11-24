-- Run only inside the release installer's forced-rollback transaction.
DO $$
DECLARE
  v_instructor uuid;
  v_slug text := 'import-check-' || substr(md5(random()::text), 1, 12);
  v_set jsonb; v_one jsonb; v_result jsonb; v_id uuid; v_other uuid;
BEGIN
  IF current_setting('fullcircle.journey_rehearsal', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This test requires the rollback rehearsal.';
  END IF;
  SELECT a.user_id INTO v_instructor FROM public.role_assignments a
  WHERE a.role = 'instructor' AND a.status IN ('active', 'approved') LIMIT 1;
  IF v_instructor IS NULL THEN RAISE EXCEPTION 'An active instructor is needed to check the import.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_instructor::text, true);
  INSERT INTO public.arena_journey_characters(slug, display_name, narrative_beats)
  VALUES (v_slug, 'Import check', '["One","Two","Three","Four","Five","Six","Seven"]');
  SELECT jsonb_agg(jsonb_build_object('type', 'multiple_choice', 'question', 'Import test question ' || n,
    'options', jsonb_build_array('First', 'Second', 'Third'), 'correct_answer', 'First',
    'reference', 'Test reference', 'difficulty_tag', CASE WHEN n <= 80 THEN 'hard' ELSE 'easy' END)
    ORDER BY n) INTO v_set FROM generate_series(1, 199) AS numbers(n);
  v_result := public.append_arena_journey_question_set(v_slug, '', v_set);
  IF (v_result->>'imported')::integer <> 199 OR (v_result->>'active')::integer <> 199
    OR (v_result->>'ready')::boolean THEN RAISE EXCEPTION '199-question check failed: %', v_result; END IF;
  v_one := (v_set->0) || jsonb_build_object('question', 'Import test question 200', 'stage', 999);
  v_result := public.append_arena_journey_question_set(v_slug, 'Second set', jsonb_build_array(v_one));
  IF (v_result->>'active')::integer <> 200 OR NOT (v_result->>'ready')::boolean THEN
    RAISE EXCEPTION 'Exactly 200 questions did not unlock the character: %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.arena_journey_questions WHERE character_slug = v_slug
    AND review_status = 'pending') <> 0 THEN RAISE EXCEPTION 'Upload was left pending.'; END IF;
  IF (SELECT count(*) FROM (SELECT question_stage FROM public.arena_journey_questions
    WHERE character_slug = v_slug GROUP BY question_stage HAVING count(*) = 40) bands) <> 5 THEN
    RAISE EXCEPTION 'Automatic stage assignment did not produce five bands of forty.';
  END IF;
  v_result := public.append_arena_journey_question_set(v_slug, 'Duplicates', jsonb_build_array(
    v_one, v_one || jsonb_build_object('question', '  IMPORT   test question 200  ')));
  IF (v_result->>'imported')::integer <> 0 OR (v_result->>'skipped')::integer <> 2
    OR (v_result->>'active')::integer <> 200 THEN RAISE EXCEPTION 'Duplicate check failed.'; END IF;
  v_result := public.append_arena_journey_question_set(v_slug, 'Mixed set', jsonb_build_array(
    v_one || jsonb_build_object('question', 'Import test invalid', 'correct_answer', 'No matching choice'),
    v_one || jsonb_build_object('question', 'Import test question 201')));
  IF (v_result->>'imported')::integer <> 1 OR (v_result->>'invalid')::integer <> 1
    OR (v_result->>'active')::integer <> 201 THEN RAISE EXCEPTION 'Partial import check failed: %', v_result; END IF;
  SELECT id INTO v_id FROM public.arena_journey_questions WHERE character_slug = v_slug AND question_text = 'Import test question 200';
  SELECT id INTO v_other FROM public.arena_journey_questions WHERE character_slug = v_slug AND question_text = 'Import test question 201';
  PERFORM public.set_arena_journey_question_retired(v_id, true);
  IF NOT (SELECT ready FROM public.arena_journey_characters WHERE slug = v_slug) THEN
    RAISE EXCEPTION '200-question bank stopped being playable.';
  END IF;
  PERFORM public.set_arena_journey_question_retired(v_other, true);
  IF (SELECT ready FROM public.arena_journey_characters WHERE slug = v_slug) THEN
    RAISE EXCEPTION '199-question bank remained playable.';
  END IF;
  PERFORM public.set_arena_journey_question_retired(v_id, false);
  IF NOT (SELECT ready FROM public.arena_journey_characters WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Restoring the 200th question did not unlock the bank.';
  END IF;
  PERFORM public.set_arena_journey_character_ready(v_slug, false);
  v_result := public.append_arena_journey_question_set(v_slug, 'Retry', jsonb_build_array(v_one));
  IF (v_result->>'ready')::boolean THEN RAISE EXCEPTION 'A duplicate retry undid the instructor pause.'; END IF;
  PERFORM public.set_arena_journey_character_ready(v_slug, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.append_arena_journey_question_set(v_slug, 'Unauthorized', jsonb_build_array(v_one));
    RAISE EXCEPTION 'An anonymous import was accepted.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
  BEGIN
    PERFORM public.set_arena_journey_character_ready(v_slug, true);
    RAISE EXCEPTION 'A non-instructor could activate a character.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_schema_privilege('authenticated', 'journey_private', 'USAGE')
    OR has_function_privilege('authenticated', 'journey_private.refresh_bank(text,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.append_arena_journey_question_set(text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Journey bank permissions are too broad.';
  END IF;
  RAISE NOTICE 'PASS: 199/200 boundary, balanced stages, duplicates, partial imports, retirement, pause and instructor-only permissions.';
END;
$$;
