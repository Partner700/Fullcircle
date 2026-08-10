-- A quiz must contain at least one playable question before it can leave its
-- scheduled draft state. This protects every client, not only the instructor UI.
CREATE OR REPLACE FUNCTION public.prevent_empty_quiz_launch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('countdown', 'live')
     AND OLD.status = 'scheduled'
     AND NOT EXISTS (
       SELECT 1
       FROM public.generated_questions question
       WHERE question.quiz_session_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'This quiz cannot be launched because it has no questions.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_sessions_require_questions_before_launch ON public.quiz_sessions;
CREATE TRIGGER quiz_sessions_require_questions_before_launch
BEFORE UPDATE OF status ON public.quiz_sessions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_empty_quiz_launch();
