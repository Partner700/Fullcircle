/* Preserve answer aliases and Scripture references on externally imported
   Daily Game questions. Quiz questions already keep both inside JSON payloads. */

ALTER TABLE public.custom_questions
  ADD COLUMN IF NOT EXISTS accepted_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scripture_reference text;

UPDATE public.custom_questions
SET accepted_answers = '[]'::jsonb
WHERE accepted_answers IS NULL;

ALTER TABLE public.custom_questions
  ALTER COLUMN accepted_answers SET DEFAULT '[]'::jsonb,
  ALTER COLUMN accepted_answers SET NOT NULL;

ALTER TABLE public.custom_questions
  DROP CONSTRAINT IF EXISTS custom_questions_accepted_answers_array;

ALTER TABLE public.custom_questions
  ADD CONSTRAINT custom_questions_accepted_answers_array
  CHECK (jsonb_typeof(accepted_answers) = 'array');

DROP POLICY IF EXISTS "instructor_insert_custom_questions" ON public.custom_questions;
CREATE POLICY "instructor_insert_custom_questions"
ON public.custom_questions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = instructor_id AND public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS "instructor_update_custom_questions" ON public.custom_questions;
CREATE POLICY "instructor_update_custom_questions"
ON public.custom_questions FOR UPDATE TO authenticated
USING (auth.uid() = instructor_id AND public.is_instructor(auth.uid()))
WITH CHECK (auth.uid() = instructor_id AND public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS "instructor_delete_custom_questions" ON public.custom_questions;
CREATE POLICY "instructor_delete_custom_questions"
ON public.custom_questions FOR DELETE TO authenticated
USING (auth.uid() = instructor_id AND public.is_instructor(auth.uid()));

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
