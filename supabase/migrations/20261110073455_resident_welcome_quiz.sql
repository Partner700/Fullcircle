CREATE TABLE private.resident_welcome_quizzes (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  question smallint NOT NULL DEFAULT 1 CHECK (question BETWEEN 1 AND 4),
  score smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 3),
  deadline timestamptz NOT NULL
);
REVOKE ALL ON TABLE private.resident_welcome_quizzes FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.resident_welcome_quiz(p_question integer DEFAULT NULL, p_answer integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  resident uuid := auth.uid();
  quiz private.resident_welcome_quizzes%ROWTYPE;
  moment timestamptz;
  prompt text;
  options jsonb;
  was_correct boolean;
BEGIN
  IF resident IS NULL THEN RAISE EXCEPTION 'Sign in to start the welcome quiz.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id=resident) THEN
    RETURN jsonb_build_object('status','skip');
  END IF;
  INSERT INTO private.resident_welcome_quizzes(user_id,deadline)
    VALUES(resident,clock_timestamp()+interval '10 seconds') ON CONFLICT DO NOTHING;
  SELECT * INTO quiz FROM private.resident_welcome_quizzes WHERE user_id=resident FOR UPDATE;
  IF quiz.question=4 THEN RETURN jsonb_build_object('status','skip'); END IF;
  moment := clock_timestamp();
  IF p_question=quiz.question AND (p_answer BETWEEN 0 AND 2 OR moment>=quiz.deadline) THEN
    was_correct := moment<quiz.deadline AND p_answer=CASE quiz.question WHEN 1 THEN 1 WHEN 2 THEN 0 ELSE 2 END;
    UPDATE private.resident_welcome_quizzes
    SET question=question+1, score=score+CASE WHEN was_correct THEN 1 ELSE 0 END,
        deadline=moment+interval '10 seconds'
    WHERE user_id=resident RETURNING * INTO quiz;
    IF quiz.question=4 THEN
      INSERT INTO public.streak_freezers(user_id,freezer_type,source)
      SELECT resident, CASE WHEN quiz.score=3 THEN 'weekly' ELSE 'daily' END, 'welcome_quiz'
      FROM generate_series(1,CASE quiz.score WHEN 0 THEN 0 WHEN 2 THEN 3 ELSE 1 END);
      RETURN jsonb_build_object('status','complete','score',quiz.score);
    END IF;
  END IF;

  CASE quiz.question
    WHEN 1 THEN prompt := 'Who built the ark?'; options := '["Moses","Noah","David"]';
    WHEN 2 THEN prompt := 'Who defeated Goliath?'; options := '["David","Samuel","Solomon"]';
    ELSE prompt := 'Where was Jesus born?'; options := '["Nazareth","Jerusalem","Bethlehem"]';
  END CASE;
  RETURN jsonb_build_object('status','question','question',jsonb_build_object(
    'index',quiz.question,'prompt',prompt,'options',options,
    'remaining_ms',greatest(0,floor(extract(epoch FROM quiz.deadline-clock_timestamp())*1000))::integer));
END;
$$;
REVOKE ALL ON FUNCTION public.resident_welcome_quiz(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resident_welcome_quiz(integer,integer) TO authenticated;

ALTER TABLE public.streak_freezers DROP CONSTRAINT streak_freezers_source_check;
ALTER TABLE public.streak_freezers ADD CONSTRAINT streak_freezers_source_check CHECK (source IN (
  'denarii','payment','relic','redemption','simons_purse','simons_coin','thiefs_request',
  'game_reward','arena_reward','founders_gift','treasure_reward','welcome_quiz'
));
