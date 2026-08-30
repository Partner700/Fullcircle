/* Safe external reading and weekly-quiz links. Public visitors see only what
   is intentionally shared, never answers, result marks, or camp discussion. */
CREATE TABLE IF NOT EXISTS public.public_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  guest_key text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quiz_session_id, guest_key)
);

ALTER TABLE public.public_quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_shared_daily_reading(p_narrative_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'narrative_date', narrative.narrative_date,
    'title', narrative.title,
    'theme', narrative.theme,
    'scripture_reference', narrative.scripture_reference,
    'translation', narrative.translation,
    'main_text', narrative.main_text,
    'highlighted_verses', coalesce(narrative.highlighted_verses, '[]'::jsonb),
    'scripture_passages', coalesce(narrative.scripture_passages, '[]'::jsonb),
    'verse_of_day', narrative.verse_of_day
  )
  FROM public.daily_narratives narrative
  WHERE narrative.narrative_date = p_narrative_date
    AND narrative.narrative_date <= timezone('Africa/Douala', now())::date
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_quiz(p_quiz_session_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'session', jsonb_build_object(
      'id', session.id,
      'title', session.title,
      'session_date', session.session_date,
      'live_opens_at', session.live_opens_at,
      'live_closes_at', session.live_closes_at,
      'status', session.status
    ),
    'questions', CASE
      WHEN session.status = 'live'
        AND now() >= session.live_opens_at
        AND now() <= session.live_closes_at
      THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', question.id,
          'question_index', question.question_index,
          'question_payload', question.question_payload - 'correct_answer' - 'accepted_answers' - 'explanation'
        ) ORDER BY question.question_index)
        FROM public.generated_questions question
        WHERE question.quiz_session_id = session.id
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  )
  FROM public.quiz_sessions session
  WHERE session.id = p_quiz_session_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.save_shared_quiz_answer(
  p_quiz_session_id uuid,
  p_guest_key text,
  p_question_id uuid,
  p_answer jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live_opens_at timestamptz;
  v_live_closes_at timestamptz;
  v_status text;
BEGIN
  IF nullif(trim(p_guest_key), '') IS NULL THEN
    RAISE EXCEPTION 'A guest session is required.';
  END IF;
  SELECT session.live_opens_at, session.live_closes_at, session.status
  INTO v_live_opens_at, v_live_closes_at, v_status
  FROM public.quiz_sessions session
  WHERE session.id = p_quiz_session_id;
  IF NOT FOUND OR v_status <> 'live' OR now() < v_live_opens_at OR now() > v_live_closes_at THEN
    RAISE EXCEPTION 'This quiz is not accepting answers right now.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.generated_questions question
    WHERE question.id = p_question_id AND question.quiz_session_id = p_quiz_session_id
  ) THEN
    RAISE EXCEPTION 'That question does not belong to this quiz.';
  END IF;

  INSERT INTO public.public_quiz_attempts AS attempt(quiz_session_id, guest_key, answers, updated_at)
  VALUES (p_quiz_session_id, trim(p_guest_key), jsonb_build_object(p_question_id::text, p_answer), now())
  ON CONFLICT (quiz_session_id, guest_key) DO UPDATE
  SET answers = attempt.answers || jsonb_build_object(p_question_id::text, p_answer),
      status = 'in_progress',
      updated_at = now();
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_shared_quiz(p_quiz_session_id uuid, p_guest_key text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.public_quiz_attempts
  SET status = 'submitted', updated_at = now()
  WHERE quiz_session_id = p_quiz_session_id AND guest_key = trim(p_guest_key);
  IF NOT FOUND THEN RAISE EXCEPTION 'Start the quiz before submitting it.'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_daily_reading(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shared_quiz(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_shared_quiz_answer(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_shared_quiz(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_daily_reading(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_quiz(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_shared_quiz_answer(uuid, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_shared_quiz(uuid, text) TO anon, authenticated, service_role;
