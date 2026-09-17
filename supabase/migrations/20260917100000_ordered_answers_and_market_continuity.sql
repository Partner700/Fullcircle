/* Make ordered answers separator-safe across Daily Games and Weekly Quizzes.
   Clients submit compact pipe-delimited answers while imported questions may
   contain spaces around those separators. Compare the ordered items, not the
   incidental formatting of the stored string. */

CREATE OR REPLACE FUNCTION public.normalize_order_sequence_answer(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH pieces AS (
    SELECT
      item.ordinality,
      lower(regexp_replace(btrim(item.value), E'\\s+', ' ', 'g')) AS value
    FROM unnest(
      CASE
        WHEN strpos(coalesce(p_value, ''), '|') > 0
          THEN string_to_array(coalesce(p_value, ''), '|')
        ELSE regexp_split_to_array(coalesce(p_value, ''), E'\\s*,\\s*')
      END
    ) WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT coalesce(
    string_agg(pieces.value, '|' ORDER BY pieces.ordinality)
      FILTER (WHERE pieces.value <> ''),
    ''
  )
  FROM pieces;
$$;

REVOKE ALL ON FUNCTION public.normalize_order_sequence_answer(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.daily_game_answer_is_correct(p_answer text, p_question_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question public.custom_questions%ROWTYPE;
  v_type text;
  v_expected text;
  v_item text;
  v_parts text[];
  v_expected_parts text[] := '{}'::text[];
BEGIN
  SELECT * INTO v_question FROM public.custom_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_type := public.daily_game_question_type(v_question.question_type);
  v_expected := v_question.correct_answer;
  IF v_type IN ('matching', 'category_sort') THEN
    FOR v_item IN SELECT jsonb_array_elements_text(coalesce(v_question.options, '[]'::jsonb))
    LOOP
      v_parts := string_to_array(replace(v_item, chr(8212), '|'), '|');
      IF cardinality(v_parts) >= 2 THEN
        v_expected_parts := array_append(
          v_expected_parts,
          CASE WHEN v_type = 'category_sort'
            THEN btrim(v_parts[1]) || ':' || btrim(v_parts[2])
            ELSE btrim(v_parts[2]) END
        );
      END IF;
    END LOOP;
    v_expected := array_to_string(v_expected_parts, '|');
  END IF;

  IF v_type = 'order_sequence' THEN
    RETURN public.normalize_order_sequence_answer(p_answer)
        = public.normalize_order_sequence_answer(v_expected)
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(v_question.accepted_answers, '[]'::jsonb)) alias(value)
        WHERE public.normalize_order_sequence_answer(p_answer)
            = public.normalize_order_sequence_answer(alias.value)
      );
  END IF;

  IF v_type IN ('standard_text', 'scriptorium') THEN
    RETURN btrim(coalesce(p_answer, '')) = btrim(coalesce(v_expected, ''))
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(v_question.accepted_answers, '[]'::jsonb)) alias(value)
        WHERE btrim(coalesce(p_answer, '')) = btrim(alias.value)
      );
  END IF;

  RETURN lower(btrim(coalesce(p_answer, ''))) = lower(btrim(coalesce(v_expected, '')))
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(v_question.accepted_answers, '[]'::jsonb)) alias(value)
      WHERE lower(btrim(coalesce(p_answer, ''))) = lower(btrim(alias.value))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.daily_game_answer_is_correct(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quiz_answer_is_correct(p_answer jsonb, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_answer text;
  v_expected text;
BEGIN
  IF p_answer IS NULL OR p_payload IS NULL OR NOT (p_payload ? 'correct_answer') THEN
    RETURN false;
  END IF;

  IF p_answer = p_payload->'correct_answer' THEN
    RETURN true;
  END IF;

  v_type := coalesce(p_payload->>'type', '');
  v_expected := p_payload->>'correct_answer';
  IF jsonb_typeof(p_answer) = 'array' THEN
    SELECT string_agg(answer.value, '|' ORDER BY answer.ordinality)
    INTO v_answer
    FROM jsonb_array_elements_text(p_answer) WITH ORDINALITY AS answer(value, ordinality);
  ELSIF jsonb_typeof(p_answer) = 'string' THEN
    v_answer := p_answer #>> '{}';
  ELSE
    RETURN false;
  END IF;

  IF v_type = 'order_sequence' THEN
    RETURN public.normalize_order_sequence_answer(v_answer)
        = public.normalize_order_sequence_answer(v_expected)
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(p_payload->'accepted_answers', '[]'::jsonb)) accepted(value)
        WHERE public.normalize_order_sequence_answer(v_answer)
            = public.normalize_order_sequence_answer(accepted.value)
      );
  END IF;

  IF v_type IN ('standard_text', 'scriptorium') THEN
    RETURN btrim(v_answer) = btrim(v_expected)
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(p_payload->'accepted_answers', '[]'::jsonb)) accepted(value)
        WHERE btrim(accepted.value) = btrim(v_answer)
      );
  END IF;

  RETURN lower(btrim(v_answer)) = lower(btrim(v_expected))
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(p_payload->'accepted_answers', '[]'::jsonb)) accepted(value)
      WHERE lower(btrim(accepted.value)) = lower(btrim(v_answer))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_answer_is_correct(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Waiting rooms are safe to regenerate. Remove only unpublished decks that
-- still contain a multi-word free-text answer; active matches keep their
-- immutable deck so this release never changes a game already in progress.
WITH affected AS MATERIALIZED (
  SELECT deck.room_id
  FROM public.arena_question_decks deck
  JOIN public.arena_rooms room ON room.id = deck.room_id
  WHERE room.status = 'waiting'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(deck.questions, '[]'::jsonb)) question(item)
      WHERE coalesce(question.item->>'type', 'standard_text') = 'standard_text'
        AND btrim(coalesce(question.item->>'correct_answer', '')) ~ E'\\s'
    )
), removed AS (
  DELETE FROM public.arena_question_decks deck
  USING affected
  WHERE deck.room_id = affected.room_id
  RETURNING deck.room_id
)
UPDATE public.arena_rooms room
SET question_set = '[]'::jsonb,
    question_generated_at = NULL,
    question_generation_claimed_at = NULL,
    question_generation_claimed_by = NULL
WHERE room.id IN (SELECT removed.room_id FROM removed);
