/* Server-authoritative quiz delivery, scoring, relics, and rewards. */

DROP POLICY IF EXISTS "read_questions" ON public.generated_questions;
DROP POLICY IF EXISTS "insert_quiz_attempts_own" ON public.quiz_attempts;
DROP POLICY IF EXISTS "update_quiz_attempts_own" ON public.quiz_attempts;
DROP POLICY IF EXISTS "insert_responses_own" ON public.question_responses;
DROP POLICY IF EXISTS "update_responses_own" ON public.question_responses;

DROP POLICY IF EXISTS "instructors read generated questions" ON public.generated_questions;
CREATE POLICY "instructors read generated questions"
ON public.generated_questions FOR SELECT TO authenticated
USING (public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS "instructors update generated questions" ON public.generated_questions;
CREATE POLICY "instructors update generated questions"
ON public.generated_questions FOR UPDATE TO authenticated
USING (public.is_instructor(auth.uid()))
WITH CHECK (public.is_instructor(auth.uid()));

CREATE OR REPLACE FUNCTION public.quiz_answer_is_correct(p_answer jsonb, p_payload jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_answer IS NULL OR p_payload IS NULL OR NOT (p_payload ? 'correct_answer') THEN false
    WHEN p_answer = p_payload->'correct_answer' THEN true
    WHEN jsonb_typeof(p_answer) = 'string'
      AND COALESCE(p_payload->>'type', '') IN ('standard_text', 'scriptorium')
      AND btrim(p_answer #>> '{}') = btrim(p_payload->>'correct_answer') THEN true
    WHEN jsonb_typeof(p_answer) = 'string'
      AND COALESCE(p_payload->>'type', '') NOT IN ('standard_text', 'scriptorium')
      AND lower(btrim(p_answer #>> '{}')) = lower(btrim(p_payload->>'correct_answer')) THEN true
    WHEN jsonb_typeof(p_answer) = 'string'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(p_payload->'accepted_answers', '[]'::jsonb)) accepted(value)
        WHERE CASE
          WHEN COALESCE(p_payload->>'type', '') IN ('standard_text', 'scriptorium')
            THEN btrim(accepted.value) = btrim(p_answer #>> '{}')
          ELSE lower(btrim(accepted.value)) = lower(btrim(p_answer #>> '{}'))
        END
      ) THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.quiz_answer_is_correct(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_quiz_questions_for_play(p_quiz_session_id uuid)
RETURNS TABLE (
  id uuid,
  quiz_session_id uuid,
  question_index integer,
  source_narrative_date date,
  difficulty_tag text,
  mechanic_type text,
  recycled_from_game boolean,
  question_payload jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.quiz_sessions%ROWTYPE;
  v_can_see_answers boolean := false;
  v_is_participant boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE quiz_sessions.id = p_quiz_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz session not found.';
  END IF;

  v_is_participant := EXISTS (
    SELECT 1 FROM public.role_assignments role
    WHERE role.user_id = v_user_id
      AND role.role IN ('cadet', 'sentry')
      AND role.status IN ('active', 'approved')
  );

  IF NOT v_is_participant AND NOT public.is_instructor(v_user_id) THEN
    RAISE EXCEPTION 'This account cannot access quiz questions.';
  END IF;

  v_can_see_answers := public.is_instructor(v_user_id) OR EXISTS (
    SELECT 1
    FROM public.quiz_attempts attempt
    WHERE attempt.user_id = v_user_id
      AND attempt.quiz_session_id = p_quiz_session_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (
        v_session.quiz_type <> 'saturday'
        OR timezone('Africa/Douala', now()) >= v_session.session_date::timestamp + time '15:00'
      )
  );

  RETURN QUERY
  SELECT
    question.id,
    question.quiz_session_id,
    question.question_index,
    question.source_narrative_date,
    question.difficulty_tag,
    question.mechanic_type,
    question.recycled_from_game,
    CASE WHEN v_can_see_answers THEN question.question_payload ELSE
      question.question_payload - ARRAY[
        'correct_answer', 'accepted_answers', 'explanation', 'reference',
        'answer', 'solution', 'correct_order', 'blanks', 'pairs',
        'sort_items', 'grid_items', 'answer_key'
      ]::text[]
    END,
    question.created_at
  FROM public.generated_questions question
  WHERE question.quiz_session_id = p_quiz_session_id
  ORDER BY question.question_index;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_quiz_attempt(p_quiz_session_id uuid)
RETURNS public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.quiz_sessions%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_question_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments role
    WHERE role.user_id = v_user_id
      AND role.role IN ('cadet', 'sentry')
      AND role.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only cadets and sentries can take this quiz.';
  END IF;

  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = p_quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  SELECT count(*) INTO v_question_count
  FROM public.generated_questions
  WHERE quiz_session_id = p_quiz_session_id;
  IF v_question_count = 0 THEN
    RAISE EXCEPTION 'This quiz has no questions and cannot be started.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.generated_questions question
    WHERE question.quiz_session_id = p_quiz_session_id
      AND COALESCE(question.question_payload->>'type', question.mechanic_type, '')
        NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'spot_error', 'standard_text', 'scriptorium', 'order_sequence')
  ) THEN
    RAISE EXCEPTION 'This quiz contains a question type that is not ready for reliable play. Ask the instructor to edit it before launch.';
  END IF;

  IF now() < v_session.live_opens_at OR now() >= v_session.live_closes_at THEN
    RAISE EXCEPTION 'This quiz is not currently open.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id AND quiz_session_id = p_quiz_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempt.status IN ('submitted', 'timed_out', 'forfeited') THEN
      RAISE EXCEPTION 'This attempt has already ended.';
    END IF;
    UPDATE public.quiz_attempts
    SET status = 'in_progress', highest_question_reached = greatest(highest_question_reached, 1)
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  ELSE
    INSERT INTO public.quiz_attempts (
      user_id, quiz_session_id, status, highest_question_reached
    ) VALUES (
      v_user_id, p_quiz_session_id, 'in_progress', 1
    ) RETURNING * INTO v_attempt;
  END IF;

  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_quiz_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question public.generated_questions%ROWTYPE;
  v_donkey_active boolean := false;
  v_correct boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This quiz attempt is not active.';
  END IF;

  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = v_attempt.quiz_session_id;
  IF now() >= v_session.live_closes_at AND NOT (
    v_session.quiz_type = 'saturday'
    AND timezone('Africa/Douala', now()) < v_session.session_date::timestamp + time '14:45'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(v_attempt.relics_used, '[]'::jsonb)) used
      WHERE used->>'slug' = 'lazarus-coin'
    )
  ) THEN
    RAISE EXCEPTION 'Quiz time has ended.';
  END IF;

  SELECT * INTO v_question FROM public.generated_questions
  WHERE id = p_question_id AND quiz_session_id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this quiz.'; END IF;

  v_correct := public.quiz_answer_is_correct(p_answer, v_question.question_payload);
  v_donkey_active := EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_attempt.relics_used, '[]'::jsonb)) used
    WHERE used->>'slug' = 'talking-donkey'
      AND used->>'question_id' = p_question_id::text
  );

  IF v_donkey_active AND NOT v_correct THEN
    UPDATE public.quiz_attempts
    SET relics_used = coalesce((
      SELECT jsonb_agg(used)
      FROM jsonb_array_elements(coalesce(relics_used, '[]'::jsonb)) used
      WHERE NOT (
        used->>'slug' = 'talking-donkey'
        AND used->>'question_id' = p_question_id::text
      )
    ), '[]'::jsonb)
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
      'accepted', false,
      'warning', 'The Talking Donkey warns that this answer is not right. Try another answer.'
    );
  END IF;

  INSERT INTO public.question_responses (
    quiz_attempt_id, question_id, answer, submitted_at, last_edited_at
  ) VALUES (
    v_attempt.id, p_question_id, p_answer, now(), now()
  )
  ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE SET
    answer = EXCLUDED.answer,
    last_edited_at = now();

  UPDATE public.quiz_attempts
  SET highest_question_reached = greatest(highest_question_reached, v_question.question_index)
  WHERE id = v_attempt.id;

  RETURN jsonb_build_object('accepted', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.use_quiz_question_relic(
  p_attempt_id uuid,
  p_question_id uuid,
  p_relic_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_question public.generated_questions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_eliminated jsonb := '[]'::jsonb;
  v_effect jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_relic_slug NOT IN (
    'hint', 'eliminate', 'skip', 'reveal-reference',
    'witch-ball-endor', 'talking-donkey'
  ) THEN
    RAISE EXCEPTION 'This relic cannot be used on an individual quiz question.';
  END IF;

  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id AND status = 'in_progress'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;

  SELECT * INTO v_question FROM public.generated_questions
  WHERE id = p_question_id AND quiz_session_id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this quiz.'; END IF;

  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  SELECT * INTO v_inventory FROM public.relic_inventory
  WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;

  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
  INSERT INTO public.relic_usage_log (
    user_id, quiz_attempt_id, relic_type_id, question_id, effect_applied
  ) VALUES (
    v_user_id, v_attempt.id, v_relic.id, v_question.id, p_relic_slug
  );

  IF p_relic_slug = 'hint' THEN
    v_effect := jsonb_build_object(
      'notice', coalesce(nullif(v_question.question_payload->>'hint', ''),
        'Read the question and passage again for the detail that distinguishes the choices.')
    );
  ELSIF p_relic_slug = 'eliminate' THEN
    SELECT coalesce(jsonb_agg(option_value), '[]'::jsonb) INTO v_eliminated
    FROM (
      SELECT option_value
      FROM jsonb_array_elements_text(coalesce(v_question.question_payload->'options', '[]'::jsonb)) options(option_value)
      WHERE option_value <> v_question.question_payload->>'correct_answer'
      ORDER BY random()
      LIMIT 2
    ) wrong;
    v_effect := jsonb_build_object('eliminated_options', v_eliminated, 'notice', 'Wrong options have been removed.');
  ELSIF p_relic_slug = 'skip' THEN
    INSERT INTO public.question_responses (quiz_attempt_id, question_id, answer, submitted_at, last_edited_at)
    VALUES (v_attempt.id, v_question.id, NULL, now(), now())
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE SET answer = NULL, last_edited_at = now();
    v_effect := jsonb_build_object('skipped', true, 'notice', 'Question skipped. It will not add to your score.');
  ELSIF p_relic_slug = 'reveal-reference' THEN
    v_effect := jsonb_build_object(
      'notice', CASE WHEN coalesce(v_question.question_payload->>'reference', '') = ''
        THEN 'This question has no additional reference.'
        ELSE 'Reference: ' || (v_question.question_payload->>'reference') END
    );
  ELSIF p_relic_slug = 'witch-ball-endor' THEN
    INSERT INTO public.question_responses (quiz_attempt_id, question_id, answer, submitted_at, last_edited_at)
    VALUES (v_attempt.id, v_question.id, v_question.question_payload->'correct_answer', now(), now())
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE
      SET answer = EXCLUDED.answer, last_edited_at = now();
    v_effect := jsonb_build_object('auto_answered', true, 'notice', 'The answer has been secured for this question.');
  ELSIF p_relic_slug = 'talking-donkey' THEN
    UPDATE public.quiz_attempts
    SET relics_used = coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('slug', p_relic_slug, 'question_id', p_question_id, 'used_at', now())
    )
    WHERE id = v_attempt.id;
    v_effect := jsonb_build_object('donkey_active', true, 'notice', 'The Talking Donkey is listening.');
  END IF;

  RETURN jsonb_build_object('success', true, 'slug', p_relic_slug) || v_effect;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt_secure(
  p_attempt_id uuid,
  p_status text DEFAULT 'submitted',
  p_use_goliath boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_figs integer := 0;
  v_reward integer := 0;
  v_perfect boolean := false;
  v_source_type text;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_day_type text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_status NOT IN ('submitted', 'timed_out') THEN RAISE EXCEPTION 'Invalid completion status.'; END IF;

  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz attempt not found.'; END IF;

  IF v_attempt.status IN ('submitted', 'timed_out') THEN
    RETURN jsonb_build_object(
      'success', true,
      'attempt', to_jsonb(v_attempt),
      'already_submitted', true
    );
  END IF;
  IF v_attempt.status <> 'in_progress' THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;

  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = v_attempt.quiz_session_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE public.quiz_answer_is_correct(response.answer, question.question_payload))::integer,
    coalesce(sum(
      CASE WHEN public.quiz_answer_is_correct(response.answer, question.question_payload) THEN
        CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END
      ELSE 0 END
    ), 0)::integer
  INTO v_question_count, v_correct_count, v_figs
  FROM public.generated_questions question
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id AND response.quiz_attempt_id = v_attempt.id
  WHERE question.quiz_session_id = v_attempt.quiz_session_id;

  IF v_question_count = 0 THEN RAISE EXCEPTION 'This quiz has no questions.'; END IF;

  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log (user_id, quiz_attempt_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_attempt.id, v_relic.id, 'perfect_quiz');
    v_correct_count := v_question_count;
    SELECT coalesce(sum(CASE difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END), 0)::integer
    INTO v_figs FROM public.generated_questions WHERE quiz_session_id = v_attempt.quiz_session_id;
  END IF;

  v_perfect := v_correct_count = v_question_count;
  v_reward := CASE
    WHEN v_perfect THEN coalesce(v_session.reward_perfect, 6000)
    WHEN v_correct_count > 0 THEN coalesce(v_session.reward_partial, 1000)
    ELSE 0
  END;
  v_source_type := CASE WHEN v_session.quiz_type = 'fortune' THEN 'fortune_quiz_reward' ELSE 'quiz_reward' END;

  UPDATE public.quiz_attempts
  SET status = p_status,
      talents_scored = v_figs,
      highest_question_reached = greatest(highest_question_reached, v_question_count),
      submitted_at = now(),
      relics_used = CASE WHEN p_use_goliath THEN
        coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('slug', 'sword-goliath', 'used_at', now())
        )
      ELSE relics_used END
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_reward > 0 AND NOT EXISTS (
    SELECT 1 FROM public.denarii_ledger_entries
    WHERE user_id = v_user_id
      AND source_type = v_source_type
      AND source_reference = v_attempt.id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id, v_reward, v_source_type, v_attempt.id::text,
      CASE WHEN v_perfect THEN 'Perfect quiz score'
        ELSE v_correct_count || '/' || v_question_count || ' correct' END
      || ' · ' || v_figs || ' figs'
    );
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM v_session.session_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_session.session_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  INSERT INTO public.daily_records (
    user_id, record_date, day_type, quiz_attempt_id, streak_valid
  ) VALUES (
    v_user_id, v_session.session_date, v_day_type, v_attempt.id,
    CASE WHEN v_day_type = 'saturday' THEN true ELSE NULL END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    quiz_attempt_id = EXCLUDED.quiz_attempt_id,
    streak_valid = CASE WHEN EXCLUDED.day_type = 'saturday' THEN true ELSE public.daily_records.streak_valid END;

  RETURN jsonb_build_object(
    'success', true,
    'attempt', to_jsonb(v_attempt),
    'correct_count', v_correct_count,
    'question_count', v_question_count,
    'figs', v_figs,
    'perfect', v_perfect,
    'denarii_awarded', v_reward
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_quiz_attempt(p_attempt_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.quiz_attempts
  SET status = 'forfeited', forfeited_at = now()
  WHERE id = p_attempt_id
    AND user_id = auth.uid()
    AND status = 'in_progress';
  RETURN FOUND;
END;
$$;

-- The legacy function trusted client-supplied scores and must not remain callable.
REVOKE ALL ON FUNCTION public.submit_quiz_attempt(uuid, uuid, text, integer, jsonb)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_quiz_questions_for_play(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_quiz_attempt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_quiz_response(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_quiz_question_relic(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quiz_attempt_secure(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forfeit_quiz_attempt(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_quiz_questions_for_play(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_quiz_attempt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz_response(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_quiz_question_relic(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt_secure(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_quiz_attempt(uuid) TO authenticated;
