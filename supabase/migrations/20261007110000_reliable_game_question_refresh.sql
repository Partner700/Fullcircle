/*
  Give the instructor question editor one bounded, authoritative read path.
  This keeps a transient reading-list or RLS helper failure from making a
  successfully imported question set look empty.
*/

CREATE OR REPLACE FUNCTION public.get_instructor_custom_game_questions(
  p_level integer,
  p_narrative_date date DEFAULT NULL,
  p_approved_only boolean DEFAULT false
)
RETURNS SETOF public.custom_questions
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.is_instructor(v_user_id) THEN
    RAISE EXCEPTION 'Only an active instructor can read the game question bank.'
      USING ERRCODE = '42501';
  END IF;

  IF p_level IS NULL OR p_level NOT BETWEEN 1 AND 7 THEN
    RAISE EXCEPTION 'Choose a game level from 1 to 7.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT question.*
  FROM public.custom_questions question
  WHERE question.game_level = p_level
    AND (p_narrative_date IS NULL OR question.narrative_date = p_narrative_date)
    AND (NOT coalesce(p_approved_only, false) OR question.is_approved = true)
  ORDER BY
    question.narrative_date DESC NULLS LAST,
    question.game_round ASC NULLS FIRST,
    question.question_index ASC,
    question.created_at ASC,
    question.id ASC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.get_instructor_custom_game_questions(integer, date, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_custom_game_questions(integer, date, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.get_instructor_custom_game_questions(integer, date, boolean) IS
  'Returns a bounded Daily Game question segment to an authenticated active instructor.';

NOTIFY pgrst, 'reload schema';
