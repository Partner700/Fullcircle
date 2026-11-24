-- Restore already-spent Reveal Reference safely on the same question.
-- Network retries must not double-charge users or prevent reopening the
-- Scripture reference. The original once-per-question relic rule remains.
CREATE OR REPLACE FUNCTION public.use_daily_game_question_aid(p_run_id uuid, p_question_id uuid, p_aid_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- The already-spent reference remains available on the same question.
    -- Neither inventory nor Fig scoring changes for a repeated display.
    RETURN jsonb_build_object(
      'reference',nullif(v_question.scripture_reference,''),
      'reused',true,'notice','Reference restored. No additional relic was consumed.'
    );
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
$function$
;

CREATE OR REPLACE FUNCTION public.use_quiz_question_relic(p_attempt_id uuid, p_question_id uuid, p_relic_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_reference text;
  v_passage text;
  v_question public.generated_questions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_eliminated jsonb := '[]'::jsonb;
  v_effect jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_relic_slug NOT IN ('hint', 'eliminate', 'skip', 'reveal-reference', 'witch-ball-endor', 'talking-donkey') THEN
    RAISE EXCEPTION 'This relic cannot be used on an individual quiz question.';
  END IF;
  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;
  SELECT * INTO v_question FROM public.generated_questions
  WHERE id = p_question_id AND quiz_session_id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this quiz.'; END IF;
  SELECT * INTO v_session FROM public.quiz_sessions WHERE id=v_attempt.quiz_session_id;
  IF v_session.quiz_type='valediction' THEN RAISE EXCEPTION 'Relics cannot be used in the Valediction quiz.'; END IF;
  IF now() >= private.quiz_relic_closes_at(v_session,v_attempt) THEN RAISE EXCEPTION 'Quiz time has ended.'; END IF;
  IF p_relic_slug='reveal-reference' THEN
    v_reference:=nullif(btrim(v_question.question_payload->>'reference'),'');
    v_passage:=nullif(btrim(v_question.question_payload->>'passage'),'');
    IF coalesce(v_reference,v_passage) IS NULL THEN RAISE EXCEPTION 'This question has no Scripture reference.'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_attempt.relics_used,'[]')) item
      WHERE item->>'slug'='reveal-reference' AND item->>'question_id'=p_question_id::text)
    THEN
      -- Reopen an already-paid reference without spending a second relic.
      -- A network retry or a closed popup must not look like a failed use.
      RETURN jsonb_build_object(
        'success',true,'slug',p_relic_slug,'reused',true,
        'reference',coalesce(v_reference,'Scripture passage'),
        'passage',v_passage,
        'effective_closes_at',private.quiz_relic_closes_at(v_session,v_attempt),
        'notice','Reference restored. No additional relic was consumed.'
      );
    END IF;
  END IF;
  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;
  SELECT * INTO v_inventory FROM public.relic_inventory
  WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;

  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
  INSERT INTO public.relic_usage_log(user_id, quiz_attempt_id, relic_type_id, question_id, effect_applied)
  VALUES (v_user_id, v_attempt.id, v_relic.id, v_question.id, p_relic_slug);

  IF p_relic_slug = 'hint' THEN
    v_effect := jsonb_build_object('notice', coalesce(nullif(v_question.question_payload->>'hint', ''),
      'Read the question and passage again for the detail that distinguishes the choices.'));
  ELSIF p_relic_slug = 'eliminate' THEN
    SELECT coalesce(jsonb_agg(option_value), '[]'::jsonb) INTO v_eliminated
    FROM (SELECT option_value
      FROM jsonb_array_elements_text(coalesce(v_question.question_payload->'options', '[]'::jsonb)) options(option_value)
      WHERE option_value <> v_question.question_payload->>'correct_answer'
      ORDER BY random() LIMIT 2) wrong;
    v_effect := jsonb_build_object('eliminated_options', v_eliminated, 'notice', 'Wrong options have been removed.');
  ELSIF p_relic_slug = 'skip' THEN
    INSERT INTO public.question_responses(quiz_attempt_id, question_id, answer, submitted_at, last_edited_at, assisted_by_relic)
    VALUES (v_attempt.id, v_question.id, NULL, now(), now(), true)
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE
      SET answer = NULL, last_edited_at = now(), assisted_by_relic = true;
    v_effect := jsonb_build_object('skipped', true, 'notice', 'Question skipped. It will not add to your score.');
  ELSIF p_relic_slug = 'reveal-reference' THEN
    UPDATE public.quiz_attempts SET relics_used=coalesce(relics_used,'[]')||jsonb_build_array(
      jsonb_build_object('slug','reveal-reference','question_id',p_question_id,'used_at',now()))
    WHERE id=v_attempt.id RETURNING * INTO v_attempt;
    v_effect:=jsonb_build_object('reference',coalesce(v_reference,'Scripture passage'),
      'passage',v_passage,'effective_closes_at',private.quiz_relic_closes_at(v_session,v_attempt));
  ELSIF p_relic_slug = 'witch-ball-endor' THEN
    INSERT INTO public.question_responses(quiz_attempt_id, question_id, answer, submitted_at, last_edited_at, assisted_by_relic)
    VALUES (v_attempt.id, v_question.id, v_question.question_payload->'correct_answer', now(), now(), true)
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE
      SET answer = EXCLUDED.answer, last_edited_at = now(), assisted_by_relic = true;
    v_effect := jsonb_build_object('auto_answered', true, 'figs_earned', 1,
      'notice', 'The answer has been secured for this question. This assisted answer earns 1 Fig.');
  ELSIF p_relic_slug = 'talking-donkey' THEN
    UPDATE public.quiz_attempts SET relics_used = coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('slug', p_relic_slug, 'question_id', p_question_id, 'used_at', now()))
    WHERE id = v_attempt.id;
    v_effect := jsonb_build_object('donkey_active', true, 'notice', 'The Talking Donkey is listening.');
  END IF;
  RETURN jsonb_build_object('success', true, 'slug', p_relic_slug) || v_effect;
END;
$function$
;
