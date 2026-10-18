-- Questions and answer keys remain private; only an instructor may review them.
CREATE OR REPLACE FUNCTION public.list_ready_arena_journey_characters()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'slug', character.slug, 'displayName', character.display_name,
    'narrativeBeats', character.narrative_beats
  ) ORDER BY character.display_name), '[]'::jsonb)
  FROM public.arena_journey_characters character
  WHERE character.ready;
$$;
REVOKE ALL ON FUNCTION public.list_ready_arena_journey_characters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_ready_arena_journey_characters() TO anon, authenticated;

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
    ), '[]'::jsonb) END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_journey_matchup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_journey_matchup(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_arena_journey_review_characters()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can review Biblical Journey questions.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'slug', character.slug, 'displayName', character.display_name, 'ready', character.ready
  ) ORDER BY character.display_name), '[]'::jsonb) INTO v_result
  FROM public.arena_journey_characters character;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_arena_journey_review_characters() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_arena_journey_review_characters() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_arena_journey_review_page(
  p_slug text, p_stage integer DEFAULT NULL, p_status text DEFAULT 'pending',
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can review Biblical Journey questions.' USING ERRCODE = '42501';
  END IF;
  IF (p_stage IS NOT NULL AND p_stage NOT BETWEEN 1 AND 5)
    OR p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'all')
    OR p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid question review filter.';
  END IF;

  SELECT jsonb_build_object(
    'character', jsonb_build_object(
      'slug', character.slug, 'displayName', character.display_name,
      'narrativeBeats', character.narrative_beats, 'ready', character.ready
    ),
    'counts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'stage', stage.number,
      'pending', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'pending'),
      'approved', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'approved'),
      'rejected', (SELECT count(*) FROM public.arena_journey_questions q WHERE q.character_slug = p_slug AND q.question_stage = stage.number AND q.review_status = 'rejected')
    ) ORDER BY stage.number), '[]'::jsonb) FROM generate_series(1, 5) stage(number)),
    'total', (SELECT count(*) FROM public.arena_journey_questions q
      WHERE q.character_slug = p_slug AND (p_stage IS NULL OR q.question_stage = p_stage)
        AND (p_status = 'all' OR q.review_status = p_status)),
    'questions', (SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.question_stage, page.source_number, page.id), '[]'::jsonb)
      FROM (SELECT q.id, q.question_stage, q.question_type, q.question_text, q.options,
        q.correct_answer, q.accepted_answers, q.explanation, q.source_reference,
        q.source_number, q.source_kind, q.source_question_page, q.source_answer_page,
        q.answer_key_text, q.review_status, q.review_note
        FROM public.arena_journey_questions q
        WHERE q.character_slug = p_slug AND (p_stage IS NULL OR q.question_stage = p_stage)
          AND (p_status = 'all' OR q.review_status = p_status)
        ORDER BY q.question_stage, q.source_number, q.id
        OFFSET p_offset LIMIT p_limit) page)
  ) INTO v_result
  FROM public.arena_journey_characters character WHERE character.slug = p_slug;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Biblical Journey character not found.'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_arena_journey_review_page(text, integer, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_journey_review_page(text, integer, text, integer, integer)
  TO authenticated;

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
    RAISE EXCEPTION 'Only an active instructor can review Biblical Journey questions.' USING ERRCODE = '42501';
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
      RAISE EXCEPTION 'Question % needs a checked answer, citation, and choices.', v_question.id;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.arena_journey_questions existing
      WHERE existing.character_slug = v_question.character_slug
        AND existing.id <> v_question.id AND existing.review_status = 'approved'
        AND md5(lower(btrim(existing.question_text))) = md5(lower(btrim(v_question.question_text)))
    ) INTO v_duplicate;
    UPDATE public.arena_journey_questions
      SET review_status = CASE WHEN p_status = 'approved' AND v_duplicate THEN 'rejected' ELSE p_status END,
        reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = CASE WHEN p_status = 'approved' AND v_duplicate
          THEN 'Exact duplicate of an approved question.' ELSE nullif(btrim(coalesce(p_note, '')), '') END
      WHERE id = v_question.id;
    UPDATE public.arena_journey_characters SET ready = false, updated_at = now()
      WHERE slug = v_question.character_slug;
    v_updated := v_updated + 1;
    IF p_status = 'approved' AND NOT v_duplicate THEN v_approved := v_approved + 1;
    ELSE v_rejected := v_rejected + 1; END IF;
  END LOOP;
  IF v_updated <> (SELECT count(DISTINCT chosen.question_id) FROM unnest(p_question_ids) AS chosen(question_id)) THEN
    RAISE EXCEPTION 'One or more selected questions were not found.';
  END IF;
  RETURN jsonb_build_object('reviewed', v_updated, 'approved', v_approved, 'rejected', v_rejected);
END;
$$;
REVOKE ALL ON FUNCTION public.review_arena_journey_question_batch(uuid[], text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_arena_journey_question_batch(uuid[], text, text)
  TO authenticated;
