/* Arena question decks now come exclusively from questions previously used in
   Weekly and Fortune quizzes. New completed quiz uploads automatically become
   eligible without changing the Arena function or application bundle. */

CREATE OR REPLACE FUNCTION public.get_arena_quiz_question_pool(
  p_limit integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(source.question_payload ORDER BY source.live_closes_at DESC, source.question_index),
    '[]'::jsonb
  )
  FROM (
    SELECT
      question.question_payload || jsonb_build_object(
        'difficulty_tag', COALESCE(
          NULLIF(question.question_payload ->> 'difficulty_tag', ''),
          question.difficulty_tag
        )
      ) AS question_payload,
      session.live_closes_at,
      question.question_index
    FROM public.generated_questions question
    JOIN public.quiz_sessions session ON session.id = question.quiz_session_id
    WHERE session.quiz_type IN ('saturday', 'fortune')
      AND session.live_closes_at < now()
      AND jsonb_typeof(question.question_payload) = 'object'
      AND NULLIF(btrim(question.question_payload ->> 'question'), '') IS NOT NULL
      AND NULLIF(btrim(question.question_payload ->> 'correct_answer'), '') IS NOT NULL
    ORDER BY session.live_closes_at DESC, question.question_index
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 5000)
  ) source;
$$;

REVOKE ALL ON FUNCTION public.get_arena_quiz_question_pool(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arena_quiz_question_pool(integer) TO service_role;
