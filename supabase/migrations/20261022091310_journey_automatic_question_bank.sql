-- Reuse the existing format validator privately; instructor uploads now activate in one step.
CREATE SCHEMA journey_private;
REVOKE ALL ON SCHEMA journey_private FROM PUBLIC, anon, authenticated;

ALTER TABLE public.arena_journey_questions ADD COLUMN bank_order bigint GENERATED ALWAYS AS IDENTITY;

ALTER FUNCTION public.append_arena_journey_question_set(text, text, jsonb) SET SCHEMA journey_private;
ALTER FUNCTION public.set_arena_journey_question_retired(uuid, boolean) SET SCHEMA journey_private;
ALTER FUNCTION public.review_arena_journey_question_batch(uuid[], text, text) SET SCHEMA journey_private;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA journey_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION journey_private.require_instructor()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments a WHERE a.user_id = auth.uid()
      AND a.role = 'instructor' AND a.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active instructor can change Journey questions.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION journey_private.refresh_bank(p_slug text, p_activate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_count integer; v_ready boolean;
BEGIN
  PERFORM 1 FROM public.arena_journey_characters WHERE slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a Journey character.'; END IF;
  WITH ranked AS (
    SELECT id, ntile(5) OVER (ORDER BY
      CASE difficulty_tag WHEN 'easy' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END, bank_order) AS stage
    FROM public.arena_journey_questions
    WHERE character_slug = p_slug AND review_status = 'approved' AND retired_at IS NULL
  )
  UPDATE public.arena_journey_questions q SET question_stage = ranked.stage
  FROM ranked WHERE q.id = ranked.id AND q.question_stage <> ranked.stage;
  SELECT count(DISTINCT regexp_replace(lower(btrim(question_text)), '\s+', ' ', 'g')) INTO v_count
  FROM public.arena_journey_questions
  WHERE character_slug = p_slug AND review_status = 'approved' AND retired_at IS NULL;
  UPDATE public.arena_journey_characters
  SET ready = v_count >= 200 AND (ready OR p_activate), updated_at = now()
  WHERE slug = p_slug RETURNING ready INTO v_ready;
  RETURN jsonb_build_object('active', v_count, 'ready', v_ready, 'minimum', 200);
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA journey_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.append_arena_journey_question_set(p_slug text, p_set_name text, p_questions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item jsonb; v_result jsonb; v_bank jsonb; v_key text; v_name text;
  v_inserted integer := 0; v_skipped integer := 0; v_invalid integer := 0;
BEGIN
  PERFORM journey_private.require_instructor();
  v_name := coalesce(nullif(btrim(p_set_name), ''), 'Upload ' || to_char(current_date, 'YYYY-MM-DD'));
  IF length(v_name) NOT BETWEEN 2 AND 80 OR p_questions IS NULL
    OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'Choose a question set in the JSON format.';
  END IF;
  IF jsonb_array_length(p_questions) NOT BETWEEN 1 AND 300 OR octet_length(p_questions::text) > 2000000 THEN
    RAISE EXCEPTION 'Import 1 to 300 questions in a file smaller than 2 MB.';
  END IF;
  PERFORM 1 FROM public.arena_journey_characters WHERE slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a Journey character.'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_questions) LOOP
    BEGIN
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_item->'question') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_item->'correct_answer') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_item->'reference') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_item->'type') IS DISTINCT FROM 'string'
        OR (v_item->'explanation' IS NOT NULL AND v_item->'explanation' <> 'null'::jsonb
          AND jsonb_typeof(v_item->'explanation') <> 'string') THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_key := regexp_replace(lower(btrim(v_item->>'question')), '\s+', ' ', 'g');
      IF EXISTS (SELECT 1 FROM public.arena_journey_questions q WHERE q.character_slug = p_slug
        AND regexp_replace(lower(btrim(q.question_text)), '\s+', ' ', 'g') = v_key) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      -- Stage is assigned by the bank, never a requirement on the uploaded JSON.
      v_result := journey_private.append_arena_journey_question_set(p_slug, v_name,
        jsonb_build_array(v_item || jsonb_build_object('stage', 1)));
      IF (v_result->>'imported')::integer = 1 THEN
        UPDATE public.arena_journey_questions q
        SET review_status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
          review_note = 'Instructor upload'
        WHERE q.character_slug = p_slug AND q.created_by = auth.uid() AND q.review_status = 'pending'
          AND regexp_replace(lower(btrim(q.question_text)), '\s+', ' ', 'g') = v_key;
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0001' OR data_exception OR integrity_constraint_violation THEN
      -- A faulty row must not roll back the usable questions in the same upload.
      v_invalid := v_invalid + 1;
    END;
  END LOOP;
  v_bank := journey_private.refresh_bank(p_slug, v_inserted > 0);
  RETURN v_bank || jsonb_build_object('imported', v_inserted, 'skipped', v_skipped, 'invalid', v_invalid);
END;
$$;
REVOKE ALL ON FUNCTION public.append_arena_journey_question_set(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_arena_journey_question_set(text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_arena_journey_character_ready(p_slug text, p_ready boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bank jsonb;
BEGIN
  PERFORM journey_private.require_instructor();
  IF p_ready IS NULL THEN RAISE EXCEPTION 'Choose pause or make playable.'; END IF;
  v_bank := journey_private.refresh_bank(p_slug, p_ready);
  IF p_ready AND (v_bank->>'active')::integer < 200 THEN
    RAISE EXCEPTION 'This character needs % more active questions.', 200 - (v_bank->>'active')::integer;
  END IF;
  UPDATE public.arena_journey_characters SET ready = p_ready, updated_at = now() WHERE slug = p_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_journey_character_ready(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_journey_character_ready(text, boolean) TO authenticated;

CREATE FUNCTION public.set_arena_journey_question_retired(p_question_id uuid, p_retired boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_slug text;
BEGIN
  PERFORM journey_private.require_instructor();
  SELECT c.slug INTO v_slug FROM public.arena_journey_characters c
  JOIN public.arena_journey_questions q ON q.character_slug = c.slug
  WHERE q.id = p_question_id FOR UPDATE OF c;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Journey question not found.'; END IF;
  PERFORM journey_private.set_arena_journey_question_retired(p_question_id, p_retired);
  PERFORM journey_private.refresh_bank(v_slug, NOT p_retired);
END;
$$;
REVOKE ALL ON FUNCTION public.set_arena_journey_question_retired(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arena_journey_question_retired(uuid, boolean) TO authenticated;

CREATE FUNCTION public.review_arena_journey_question_batch(p_question_ids uuid[], p_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_slug text;
BEGIN
  PERFORM journey_private.require_instructor();
  PERFORM c.slug FROM public.arena_journey_characters c
  WHERE c.slug IN (SELECT q.character_slug FROM public.arena_journey_questions q WHERE q.id = ANY(p_question_ids))
  ORDER BY c.slug FOR UPDATE;
  v_result := journey_private.review_arena_journey_question_batch(p_question_ids, p_status, p_note);
  FOR v_slug IN SELECT DISTINCT character_slug FROM public.arena_journey_questions WHERE id = ANY(p_question_ids) LOOP
    PERFORM journey_private.refresh_bank(v_slug, p_status = 'approved');
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.review_arena_journey_question_batch(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_arena_journey_question_batch(uuid[], text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
