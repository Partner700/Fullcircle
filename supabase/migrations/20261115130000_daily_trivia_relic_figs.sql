-- Keep the authoritative Fig award tied to the relic used in this run and question.
DROP TRIGGER IF EXISTS daily_game_assisted_fig_guard ON public.daily_game_responses;

CREATE OR REPLACE FUNCTION public.submit_daily_game_answer(p_run_id uuid, p_question_id uuid, p_answer text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid(); v_run public.daily_game_runs%ROWTYPE;
  v_response public.daily_game_responses%ROWTYPE; v_correct boolean; v_figs integer;
  v_total_figs integer; v_correct_count integer; v_assisted boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.user_id IS DISTINCT FROM v_user_id OR v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;
  IF NOT (v_run.question_ids ? p_question_id::text) THEN RAISE EXCEPTION 'Question is not part of this run.'; END IF;
  SELECT * INTO v_response FROM public.daily_game_responses WHERE run_id = p_run_id AND question_id = p_question_id;
  IF FOUND THEN
    SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
    INTO v_total_figs, v_correct_count FROM public.daily_game_responses WHERE run_id = p_run_id;
    RETURN jsonb_build_object('correct', v_response.is_correct, 'figs_earned', v_response.figs_earned,
      'total_figs', v_total_figs, 'correct_count', v_correct_count,
      'answer_payload', public.build_daily_game_question_payload(p_question_id, true));
  END IF;
  v_correct := public.daily_game_answer_is_correct(p_answer, p_question_id);
  IF NOT v_correct AND EXISTS (SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'talking-donkey' AND consumed_at IS NULL) THEN
    UPDATE public.daily_game_question_aids SET consumed_at = now()
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'talking-donkey';
    RETURN jsonb_build_object('protected', true, 'correct', false, 'notice', 'The Talking Donkey stopped that answer. Try once more.');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id
      AND (aid_type LIKE 'relic:%' OR aid_type = 'auto-answer')
  ) INTO v_assisted;
  SELECT CASE
    WHEN coalesce(question.difficulty_tag, 'moderate') = 'hard' THEN 5
    WHEN coalesce(question.difficulty_tag, 'moderate') IN ('moderate', 'medium') THEN 3
    ELSE 1
  END INTO v_figs FROM public.custom_questions question WHERE question.id = p_question_id;
  IF EXISTS (SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'relic:skip') THEN
    v_figs := 1;
  ELSIF NOT v_correct THEN
    v_figs := 0;
  ELSIF EXISTS (SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type LIKE 'relic:%'
      AND aid_type <> 'relic:reveal-reference') THEN
    v_figs := 1;
  ELSIF EXISTS (SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'auto-answer') THEN
    v_figs := 0;
  ELSIF v_assisted THEN
    v_figs := greatest(v_figs - 1, 0);
  END IF;
  INSERT INTO public.daily_game_responses(run_id, question_id, submitted_answer, is_correct, figs_earned, assisted_by_relic)
  VALUES (p_run_id, p_question_id, coalesce(p_answer, ''), v_correct, v_figs, v_assisted) RETURNING * INTO v_response;
  SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
  INTO v_total_figs, v_correct_count FROM public.daily_game_responses WHERE run_id = p_run_id;
  RETURN jsonb_build_object('correct', v_correct, 'figs_earned', v_figs, 'total_figs', v_total_figs,
    'correct_count', v_correct_count, 'answer_payload', public.build_daily_game_question_payload(p_question_id, true));
END;
$$;

CREATE OR REPLACE FUNCTION public.use_daily_game_question_aid(
  p_run_id uuid,
  p_question_id uuid,
  p_aid_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_question public.custom_questions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_cost integer := 0;
  v_wrong_options jsonb := '[]'::jsonb;
  v_result jsonb := '{}'::jsonb;
  v_submit_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.user_id IS DISTINCT FROM v_user_id OR v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;
  IF NOT (v_run.question_ids ? p_question_id::text) THEN RAISE EXCEPTION 'Question is not part of this run.'; END IF;
  IF EXISTS (SELECT 1 FROM public.daily_game_responses WHERE run_id = p_run_id AND question_id = p_question_id) THEN
    RAISE EXCEPTION 'This question has already been answered.';
  END IF;
  SELECT * INTO v_question FROM public.custom_questions WHERE id = p_question_id;

  IF p_aid_type = 'reveal-reference' AND EXISTS (
    SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'relic:reveal-reference'
  ) THEN
    RAISE EXCEPTION 'Reveal Reference has already been used on this question.';
  END IF;

  IF p_aid_type = 'paid-hint' THEN
    v_cost := 50;
  ELSIF p_aid_type = 'paid-reveal' THEN
    v_cost := 100;
  ELSE
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_aid_type;
    IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
    INSERT INTO public.daily_game_question_aids(run_id, question_id, aid_type)
    VALUES (p_run_id, p_question_id, 'relic:' || p_aid_type)
    ON CONFLICT DO NOTHING;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_relic.id, 'daily_game_question:' || p_question_id::text);
  END IF;

  IF v_cost > 0 THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (
      v_user_id, -v_cost,
      CASE WHEN p_aid_type = 'paid-hint' THEN 'hint_purchase' ELSE 'answer_reveal' END,
      p_run_id::text || ':' || p_question_id::text,
      CASE WHEN p_aid_type = 'paid-hint' THEN 'Daily game hint' ELSE 'Daily game answer reveal' END
    );
    INSERT INTO public.denarii_purchases(user_id, purchase_type, amount, reference_id)
    VALUES (v_user_id, CASE WHEN p_aid_type = 'paid-hint' THEN 'hint' ELSE 'answer_reveal' END, v_cost, p_run_id::text);
  END IF;

  IF p_aid_type IN ('paid-reveal', 'witch-ball-endor') THEN
    v_submit_result := public.submit_daily_game_answer(
      p_run_id,
      p_question_id,
      public.build_daily_game_question_payload(p_question_id, true)->>'correct_answer'
    );
    RETURN v_submit_result || jsonb_build_object('auto_answered', true, 'cost', v_cost);
  ELSIF p_aid_type = 'skip' THEN
    v_submit_result := public.submit_daily_game_answer(p_run_id, p_question_id, '');
    RETURN v_submit_result || jsonb_build_object('skipped', true);
  ELSIF p_aid_type = 'talking-donkey' THEN
    INSERT INTO public.daily_game_question_aids(run_id, question_id, aid_type)
    VALUES (p_run_id, p_question_id, p_aid_type)
    ON CONFLICT (run_id, question_id, aid_type) DO UPDATE SET consumed_at = NULL, created_at = now();
    RETURN jsonb_build_object('donkey_active', true, 'notice', 'The Talking Donkey will stop one wrong answer.');
  ELSIF p_aid_type = 'freeze-timer' THEN
    RETURN jsonb_build_object('extra_seconds', 60, 'notice', 'Your current round received 60 extra seconds.');
  ELSIF p_aid_type = 'reveal-reference' THEN
    RETURN jsonb_build_object('reference', nullif(v_question.scripture_reference,''));
  ELSIF p_aid_type = 'eliminate' THEN
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO v_wrong_options
    FROM (
      SELECT value FROM jsonb_array_elements_text(coalesce(v_question.options, '[]'::jsonb)) option(value)
      WHERE lower(btrim(value)) <> lower(btrim(v_question.correct_answer))
      ORDER BY random() LIMIT 2
    ) wrong;
    RETURN jsonb_build_object('eliminated_options', v_wrong_options, 'notice', 'Wrong options have been removed.');
  END IF;

  v_result := jsonb_build_object(
    'hint', coalesce(nullif(v_question.explanation, ''), 'Read the question and passage again for the detail that changes the answer.'),
    'cost', v_cost
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_daily_game_run(p_run_id uuid, p_use_goliath boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid(); v_run public.daily_game_runs%ROWTYPE;
  v_question_count integer; v_answered_count integer; v_correct_count integer;
  v_score integer; v_max_score integer; v_passed boolean; v_level_max integer;
  v_reward integer := 0; v_earned_today integer; v_attempt public.game_attempts%ROWTYPE;
  v_relic public.relic_types%ROWTYPE; v_inventory public.relic_inventory%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.user_id IS DISTINCT FROM v_user_id OR v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;
  v_question_count := jsonb_array_length(v_run.question_ids);
  SELECT count(*), count(*) FILTER (WHERE response.is_correct), coalesce(sum(response.figs_earned), 0)
  INTO v_answered_count, v_correct_count, v_score
  FROM public.daily_game_responses response WHERE response.run_id = p_run_id;
  SELECT coalesce(sum(CASE WHEN coalesce(question.difficulty_tag, 'moderate') = 'hard' THEN 5
    WHEN coalesce(question.difficulty_tag, 'moderate') IN ('moderate', 'medium') THEN 3 ELSE 1 END), 0)
  INTO v_max_score FROM public.custom_questions question WHERE v_run.question_ids ? question.id::text;

  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_relic.id, 'perfect_game_level_' || v_run.level);
    v_correct_count := v_question_count;
    v_score := v_question_count;
  END IF;

  v_passed := v_question_count > 0 AND v_correct_count >= ceil(v_question_count * 0.60);
  v_level_max := CASE WHEN v_run.level <= 3 THEN 50 WHEN v_run.level <= 6 THEN 100 ELSE 200 END;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(reward), 0)::integer INTO v_earned_today
  FROM public.game_attempts WHERE user_id = v_user_id AND narrative_date = v_run.narrative_date;
  IF v_passed AND v_run.mode <> 'practice' AND NOT EXISTS (SELECT 1 FROM public.game_attempts earned
    WHERE earned.user_id = v_user_id AND earned.narrative_date = v_run.narrative_date
      AND earned.level = v_run.level AND earned.reward > 0) THEN
    v_reward := least(round(v_level_max * (CASE WHEN p_use_goliath THEN 1
      ELSE v_score::numeric / greatest(v_max_score, 1) END))::integer,
      greatest(1000 - v_earned_today, 0));
  END IF;
  INSERT INTO public.game_attempts(user_id, narrative_date, level, mode, score, max_score, reward, status, completed_at)
  VALUES (v_user_id, v_run.narrative_date, v_run.level, v_run.mode, v_score, v_max_score, v_reward,
    CASE WHEN v_passed THEN 'passed' ELSE 'failed' END, now()) RETURNING * INTO v_attempt;
  UPDATE public.daily_game_runs SET status = 'completed', completed_at = now() WHERE id = p_run_id;
  IF v_reward > 0 THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (v_user_id, v_reward, 'game_level', v_attempt.id::text,
      'Level ' || v_run.level || ' · ' || v_score || '/' || v_max_score || ' figs');
  END IF;
  RETURN jsonb_build_object('success', true, 'passed', v_passed, 'score', v_score, 'max_score', v_max_score,
    'correct_count', v_correct_count, 'question_count', v_question_count, 'reward', v_reward);
END;
$$;
