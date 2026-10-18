BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE journey_review_packet ON COMMIT DROP AS
  SELECT convert_from(decode(:'rollout_payload', 'base64'), 'UTF8')::jsonb AS body;

DO $$
DECLARE packet jsonb;
BEGIN
  SELECT body INTO STRICT packet FROM journey_review_packet;
  IF packet->>'character' IS DISTINCT FROM 'elisha'
    OR jsonb_array_length(packet->'items') <> 88 THEN
    RAISE EXCEPTION 'The reviewed Elisha packet is not the expected 88-question package.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261018130000')
    OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261018131000') THEN
    RAISE EXCEPTION 'The rehearsed Journey runtime and review migrations are not both installed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_journey_characters
    WHERE slug = 'elisha' AND display_name = 'Elisha') THEN
    RAISE EXCEPTION 'The staged Elisha character is missing.';
  END IF;
END;
$$;

CREATE TEMP TABLE journey_review_items ON COMMIT DROP AS
  SELECT (item->>'source_number')::integer AS source_number,
    (item->>'stage')::smallint AS question_stage,
    item->>'type' AS question_type,
    item->>'question' AS question_text,
    item->'options' AS options,
    item->>'correct_answer' AS correct_answer,
    item->>'reference' AS source_reference,
    item->>'source_kind' AS source_kind,
    nullif(item->>'source_question_page', '')::integer AS source_question_page,
    nullif(item->>'source_answer_page', '')::integer AS source_answer_page,
    item->>'answer_key_text' AS answer_key_text,
    coalesce(item->>'difficulty_tag', CASE WHEN (item->>'stage')::integer <= 2
      THEN 'easy' ELSE 'moderate' END) AS difficulty_tag
  FROM journey_review_packet packet
  CROSS JOIN LATERAL jsonb_array_elements(packet.body->'items') item;

DO $$
BEGIN
  IF (SELECT count(*) FROM journey_review_items) <> 88
    OR (SELECT count(DISTINCT source_number) FROM journey_review_items) <> 88
    OR (SELECT count(*) FROM journey_review_items WHERE source_number < 236) <> 84
    OR (SELECT count(*) FROM journey_review_items WHERE source_number BETWEEN 236 AND 239) <> 4
    OR EXISTS (SELECT 1 FROM generate_series(1, 5) stage(number)
      WHERE (SELECT count(*) FROM journey_review_items item
        WHERE item.question_stage = stage.number) < 10)
    OR EXISTS (SELECT 1 FROM journey_review_items item
      WHERE item.question_type NOT IN ('true_false', 'multiple_choice', 'odd_one', 'fill_blank', 'order_sequence')
        OR item.options IS NULL OR jsonb_typeof(item.options) <> 'array'
        OR length(btrim(item.question_text)) < 5
        OR length(btrim(item.correct_answer)) < 1
        OR length(btrim(item.source_reference)) < 3)
    OR (SELECT count(*) FROM journey_review_items item
      JOIN public.arena_journey_questions question
        ON question.character_slug = 'elisha' AND question.source_number = item.source_number
      WHERE item.source_number < 236
        AND question.question_stage = item.question_stage
        AND question.question_type = item.question_type
        AND question.question_text = item.question_text
        AND question.options = item.options
        AND question.correct_answer = item.correct_answer
        AND question.source_reference = item.source_reference
        AND question.source_kind = item.source_kind) <> 84 THEN
    RAISE EXCEPTION 'The reviewed questions do not match the verified staged Elisha source.';
  END IF;
END;
$$;

INSERT INTO public.arena_journey_questions (
  character_slug, question_stage, question_type, question_text, options,
  correct_answer, source_reference, source_number, source_kind,
  source_question_page, source_answer_page, answer_key_text, difficulty_tag
)
SELECT 'elisha', question_stage, question_type, question_text, options,
  correct_answer, source_reference, source_number, source_kind,
  source_question_page, source_answer_page, answer_key_text, difficulty_tag
FROM journey_review_items WHERE source_number BETWEEN 236 AND 239
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM journey_review_items item
    JOIN public.arena_journey_questions question
      ON question.character_slug = 'elisha' AND question.source_number = item.source_number
    WHERE question.question_stage = item.question_stage
      AND question.question_type = item.question_type
      AND question.question_text = item.question_text
      AND question.options = item.options
      AND question.correct_answer = item.correct_answer
      AND question.source_reference = item.source_reference
      AND question.source_kind = item.source_kind
      AND question.review_status IN ('pending', 'approved')) <> 88 THEN
    RAISE EXCEPTION 'An Elisha question was changed or rejected; nothing will be approved.';
  END IF;
END;
$$;

UPDATE public.arena_journey_questions question
SET review_status = 'approved', reviewed_at = now(),
  review_note = 'Source-checked initial Elisha rollout; see scripts/elisha-reviewed-rollout.json.'
FROM journey_review_items item
WHERE question.character_slug = 'elisha'
  AND question.source_number = item.source_number
  AND question.review_status = 'pending';

DO $$
BEGIN
  IF (SELECT count(*) FROM journey_review_items item
    JOIN public.arena_journey_questions question
      ON question.character_slug = 'elisha' AND question.source_number = item.source_number
    WHERE question.review_status = 'approved') <> 88
    OR EXISTS (SELECT 1 FROM generate_series(1, 5) stage(number)
      WHERE (SELECT count(*) FROM public.arena_journey_questions question
        WHERE question.character_slug = 'elisha'
          AND question.question_stage = stage.number
          AND question.review_status = 'approved') < 10) THEN
    RAISE EXCEPTION 'Elisha still lacks ten approved questions in every stage.';
  END IF;
END;
$$;

UPDATE public.arena_journey_characters
SET ready = true, updated_at = now()
WHERE slug = 'elisha' AND ready = false;

SELECT count(*) AS approved_elisha_questions,
  count(*) FILTER (WHERE question_stage = 1) AS stage_one,
  count(*) FILTER (WHERE question_stage = 2) AS stage_two,
  count(*) FILTER (WHERE question_stage = 3) AS stage_three,
  count(*) FILTER (WHERE question_stage = 4) AS stage_four,
  count(*) FILTER (WHERE question_stage = 5) AS stage_five
FROM public.arena_journey_questions
WHERE character_slug = 'elisha' AND review_status = 'approved';
