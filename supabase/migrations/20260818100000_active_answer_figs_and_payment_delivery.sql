/*
  Figs are earned only through active answers, and each verified CamPay payment
  delivers its relic exactly once.
*/

ALTER TABLE public.question_responses
  ADD COLUMN IF NOT EXISTS assisted_by_relic boolean NOT NULL DEFAULT false;

ALTER TABLE public.daily_game_responses
  ADD COLUMN IF NOT EXISTS assisted_by_relic boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.relic_payment_deliveries (
  payment_id uuid PRIMARY KEY REFERENCES public.mobile_money_payments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relic_type_id uuid NOT NULL REFERENCES public.relic_types(id) ON DELETE RESTRICT,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.relic_payment_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.relic_payment_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.relic_payment_deliveries TO service_role;

-- Undo the former 35-second timeout. A delayed mobile-money confirmation must
-- remain verifiable instead of becoming permanently ineligible for delivery.
UPDATE public.mobile_money_payments
SET status = 'pending', confirmed_at = NULL, rejection_reason = NULL
WHERE lower(status) = 'rejected'
  AND rejection_reason = 'Payment was not confirmed within 35 seconds.'
  AND relic_granted_at IS NULL;

CREATE OR REPLACE FUNCTION public.finalize_campay_payment(
  p_payment_id uuid,
  p_provider_reference text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_verification jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_newly_granted boolean := false;
  v_currency text := upper(trim(COALESCE(p_verified_currency, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'CamPay confirmation is service-only.';
  END IF;
  IF p_verified_amount IS NULL OR p_verified_amount <= 0 THEN
    RAISE EXCEPTION 'CamPay did not provide a valid verified amount.';
  END IF;
  IF v_currency <> 'XAF' THEN
    RAISE EXCEPTION 'Unexpected CamPay currency: %', COALESCE(NULLIF(v_currency, ''), 'missing');
  END IF;

  SELECT * INTO v_payment
  FROM public.mobile_money_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF lower(v_payment.status) IN ('failed', 'cancelled', 'canceled', 'expired') THEN
    RAISE EXCEPTION 'A failed payment cannot be confirmed.';
  END IF;
  IF lower(v_payment.status) = 'rejected'
    AND coalesce(v_payment.rejection_reason, '') <> 'Payment was not confirmed within 35 seconds.' THEN
    RAISE EXCEPTION 'A rejected payment cannot be confirmed.';
  END IF;
  IF upper(COALESCE(v_payment.currency_code, '')) <> v_currency THEN
    RAISE EXCEPTION 'Verified currency does not match the checkout.';
  END IF;
  IF round(v_payment.amount_local, 2) <> round(p_verified_amount, 2) THEN
    RAISE EXCEPTION 'Verified amount does not match the checkout.';
  END IF;
  IF v_payment.provider_reference IS NOT NULL
    AND p_provider_reference IS NOT NULL
    AND v_payment.provider_reference <> p_provider_reference THEN
    RAISE EXCEPTION 'Verified provider reference does not match the checkout.';
  END IF;

  SELECT * INTO v_relic FROM public.relic_types WHERE slug = v_payment.relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  INSERT INTO public.relic_payment_deliveries(payment_id, user_id, relic_type_id)
  VALUES (v_payment.id, v_payment.user_id, v_relic.id)
  ON CONFLICT (payment_id) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
    VALUES (v_payment.user_id, v_relic.id, 1, 'Confirmed CamPay purchase ' || v_payment.id::text)
    ON CONFLICT (user_id, relic_type_id) DO UPDATE
      SET quantity = public.relic_inventory.quantity + 1,
          source_description = EXCLUDED.source_description;
    v_newly_granted := true;
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'confirmed', confirmed_by = NULL,
      confirmed_at = COALESCE(confirmed_at, now()),
      relic_granted_at = COALESCE(relic_granted_at, now()),
      provider_reference = COALESCE(provider_reference, NULLIF(trim(p_provider_reference), '')),
      verified_amount_local = p_verified_amount,
      verified_currency_code = v_currency,
      provider_verification = COALESCE(p_verification, '{}'::jsonb),
      rejection_reason = NULL
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'confirmed', 'newly_granted', v_newly_granted);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_campay_payment(uuid, text, numeric, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_campay_payment(uuid, text, numeric, text, jsonb) TO service_role;

-- Recover recent confirmed Master's Reward purchases that were marked delivered
-- by the legacy migration even though no relic remained in inventory.
WITH candidates AS (
  SELECT payment.id AS payment_id, payment.user_id, relic.id AS relic_type_id
  FROM public.mobile_money_payments payment
  JOIN public.relic_types relic ON relic.slug = payment.relic_slug
  WHERE payment.relic_slug = 'masters-reward'
    AND lower(payment.status) IN ('confirmed', 'successful', 'success', 'completed')
    AND payment.created_at >= timestamptz '2026-08-10 00:00:00+00'
    AND NOT EXISTS (
      SELECT 1 FROM public.relic_payment_deliveries delivery
      WHERE delivery.payment_id = payment.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.relic_inventory inventory
      WHERE inventory.user_id = payment.user_id
        AND inventory.relic_type_id = relic.id
        AND inventory.quantity > 0
    )
), delivered AS (
  INSERT INTO public.relic_payment_deliveries(payment_id, user_id, relic_type_id)
  SELECT payment_id, user_id, relic_type_id FROM candidates
  ON CONFLICT (payment_id) DO NOTHING
  RETURNING payment_id, user_id, relic_type_id
), delivery_totals AS (
  SELECT
    user_id,
    relic_type_id,
    count(*)::integer AS quantity,
    min(payment_id::text) AS first_payment_id
  FROM delivered
  GROUP BY user_id, relic_type_id
)
INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
SELECT
  user_id,
  relic_type_id,
  quantity,
  'Recovered ' || quantity || ' confirmed CamPay purchase(s), beginning with ' || first_payment_id
FROM delivery_totals
ON CONFLICT (user_id, relic_type_id) DO UPDATE
  SET quantity = public.relic_inventory.quantity + EXCLUDED.quantity,
      source_description = EXCLUDED.source_description;

-- Relic-secured quiz answers remain correct but do not produce figs.
UPDATE public.question_responses response
SET assisted_by_relic = true
WHERE EXISTS (
  SELECT 1 FROM public.relic_usage_log usage
  JOIN public.relic_types relic ON relic.id = usage.relic_type_id
  WHERE usage.quiz_attempt_id = response.quiz_attempt_id
    AND usage.question_id = response.question_id
    AND relic.slug = 'witch-ball-endor'
);

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
  IF p_relic_slug NOT IN ('hint', 'eliminate', 'skip', 'reveal-reference', 'witch-ball-endor', 'talking-donkey') THEN
    RAISE EXCEPTION 'This relic cannot be used on an individual quiz question.';
  END IF;
  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;
  SELECT * INTO v_question FROM public.generated_questions
  WHERE id = p_question_id AND quiz_session_id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this quiz.'; END IF;
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
    v_effect := jsonb_build_object('notice', CASE WHEN coalesce(v_question.question_payload->>'reference', '') = ''
      THEN 'This question has no additional reference.' ELSE 'Reference: ' || (v_question.question_payload->>'reference') END);
  ELSIF p_relic_slug = 'witch-ball-endor' THEN
    INSERT INTO public.question_responses(quiz_attempt_id, question_id, answer, submitted_at, last_edited_at, assisted_by_relic)
    VALUES (v_attempt.id, v_question.id, v_question.question_payload->'correct_answer', now(), now(), true)
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE
      SET answer = EXCLUDED.answer, last_edited_at = now(), assisted_by_relic = true;
    v_effect := jsonb_build_object('auto_answered', true, 'figs_earned', 0,
      'notice', 'The answer has been secured for this question. Assisted answers do not earn figs.');
  ELSIF p_relic_slug = 'talking-donkey' THEN
    UPDATE public.quiz_attempts SET relics_used = coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('slug', p_relic_slug, 'question_id', p_question_id, 'used_at', now()))
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
  v_user_id uuid := auth.uid(); v_attempt public.quiz_attempts%ROWTYPE; v_session public.quiz_sessions%ROWTYPE;
  v_question_count integer := 0; v_correct_count integer := 0; v_figs integer := 0; v_reward integer := 0;
  v_perfect boolean := false; v_source_type text; v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE; v_day_type text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_status NOT IN ('submitted', 'timed_out') THEN RAISE EXCEPTION 'Invalid completion status.'; END IF;
  SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = p_attempt_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz attempt not found.'; END IF;
  IF v_attempt.status IN ('submitted', 'timed_out') THEN
    RETURN jsonb_build_object('success', true, 'attempt', to_jsonb(v_attempt), 'already_submitted', true);
  END IF;
  IF v_attempt.status <> 'in_progress' THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;
  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = v_attempt.quiz_session_id;

  SELECT count(*)::integer,
    count(*) FILTER (WHERE public.quiz_answer_is_correct(response.answer, question.question_payload))::integer,
    coalesce(sum(CASE
      WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
        AND NOT coalesce(response.assisted_by_relic, false)
      THEN CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END
      ELSE 0 END), 0)::integer
  INTO v_question_count, v_correct_count, v_figs
  FROM public.generated_questions question
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id AND response.quiz_attempt_id = v_attempt.id
  WHERE question.quiz_session_id = v_attempt.quiz_session_id;
  IF v_question_count = 0 THEN RAISE EXCEPTION 'This quiz has no questions.'; END IF;

  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, quiz_attempt_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_attempt.id, v_relic.id, 'perfect_quiz');
    v_correct_count := v_question_count;
    v_figs := 0;
  END IF;

  v_perfect := v_correct_count = v_question_count;
  v_reward := CASE WHEN v_perfect THEN coalesce(v_session.reward_perfect, 6000)
    WHEN v_correct_count > 0 THEN coalesce(v_session.reward_partial, 1000) ELSE 0 END;
  v_source_type := CASE WHEN v_session.quiz_type = 'fortune' THEN 'fortune_quiz_reward' ELSE 'quiz_reward' END;
  UPDATE public.quiz_attempts SET status = p_status, talents_scored = v_figs,
    highest_question_reached = greatest(highest_question_reached, v_question_count), submitted_at = now(),
    relics_used = CASE WHEN p_use_goliath THEN coalesce(relics_used, '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object('slug', 'sword-goliath', 'used_at', now())) ELSE relics_used END
  WHERE id = v_attempt.id RETURNING * INTO v_attempt;
  IF v_reward > 0 AND NOT EXISTS (SELECT 1 FROM public.denarii_ledger_entries
    WHERE user_id = v_user_id AND source_type = v_source_type AND source_reference = v_attempt.id::text) THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (v_user_id, v_reward, v_source_type, v_attempt.id::text,
      (CASE WHEN v_perfect THEN 'Perfect quiz score' ELSE v_correct_count || '/' || v_question_count || ' correct' END)
      || ' · ' || v_figs || ' figs');
  END IF;
  v_day_type := CASE WHEN extract(dow FROM v_session.session_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_session.session_date) = 6 THEN 'saturday' ELSE 'weekday' END;
  INSERT INTO public.daily_records(user_id, record_date, day_type, quiz_attempt_id, streak_valid)
  VALUES (v_user_id, v_session.session_date, v_day_type, v_attempt.id,
    CASE WHEN v_day_type = 'saturday' THEN true ELSE NULL END)
  ON CONFLICT (user_id, record_date) DO UPDATE SET quiz_attempt_id = EXCLUDED.quiz_attempt_id,
    streak_valid = CASE WHEN EXCLUDED.day_type = 'saturday' THEN true ELSE public.daily_records.streak_valid END;
  RETURN jsonb_build_object('success', true, 'attempt', to_jsonb(v_attempt), 'correct_count', v_correct_count,
    'question_count', v_question_count, 'figs', v_figs, 'perfect', v_perfect, 'denarii_awarded', v_reward);
END;
$$;

REVOKE ALL ON FUNCTION public.use_quiz_question_relic(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_quiz_attempt_secure(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_quiz_question_relic(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt_secure(uuid, text, boolean) TO authenticated;

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
  SELECT EXISTS (SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'auto-answer') INTO v_assisted;
  SELECT CASE WHEN NOT v_correct OR v_assisted THEN 0
    WHEN coalesce(question.difficulty_tag, 'moderate') = 'hard' THEN 5
    WHEN coalesce(question.difficulty_tag, 'moderate') IN ('moderate', 'medium') THEN 3 ELSE 1 END
  INTO v_figs FROM public.custom_questions question WHERE question.id = p_question_id;
  INSERT INTO public.daily_game_responses(run_id, question_id, submitted_answer, is_correct, figs_earned, assisted_by_relic)
  VALUES (p_run_id, p_question_id, coalesce(p_answer, ''), v_correct, v_figs, v_assisted) RETURNING * INTO v_response;
  SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
  INTO v_total_figs, v_correct_count FROM public.daily_game_responses WHERE run_id = p_run_id;
  RETURN jsonb_build_object('correct', v_correct, 'figs_earned', v_figs, 'total_figs', v_total_figs,
    'correct_count', v_correct_count, 'answer_payload', public.build_daily_game_question_payload(p_question_id, true));
END;
$$;

-- The aid RPC inserts this marker before calling submit_daily_game_answer.
CREATE OR REPLACE FUNCTION public.mark_daily_game_auto_answer(p_run_id uuid, p_question_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.daily_game_runs
    WHERE id = p_run_id AND user_id = auth.uid() AND status = 'in_progress') THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;
  INSERT INTO public.daily_game_question_aids(run_id, question_id, aid_type, consumed_at)
  VALUES (p_run_id, p_question_id, 'auto-answer', now())
  ON CONFLICT (run_id, question_id, aid_type) DO UPDATE SET consumed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_daily_game_auto_answer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_daily_game_answer(uuid, uuid, text) TO authenticated;

-- Wrap automatic daily-game answers at the data layer, including existing calls
-- from the aid RPC, so they can never earn figs.
CREATE OR REPLACE FUNCTION public.prevent_assisted_daily_game_figs()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = NEW.run_id AND question_id = NEW.question_id AND aid_type = 'auto-answer') THEN
    NEW.figs_earned := 0;
    NEW.assisted_by_relic := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_game_assisted_fig_guard ON public.daily_game_responses;
CREATE TRIGGER daily_game_assisted_fig_guard
BEFORE INSERT OR UPDATE ON public.daily_game_responses
FOR EACH ROW EXECUTE FUNCTION public.prevent_assisted_daily_game_figs();

-- Replace the auto-answer branch in the existing aid implementation indirectly:
-- a relic usage log entry identifies the answer before the nested submit occurs.
CREATE OR REPLACE FUNCTION public.mark_daily_game_relic_auto_answers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_run_id uuid;
BEGIN
  IF NEW.effect_applied LIKE 'daily_game_question:%' THEN
    SELECT run.id INTO v_run_id
    FROM public.daily_game_runs run
    WHERE run.user_id = NEW.user_id AND run.status = 'in_progress'
      AND run.question_ids ? split_part(NEW.effect_applied, ':', 2)
    ORDER BY run.started_at DESC LIMIT 1;
    IF v_run_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.relic_types relic
      WHERE relic.id = NEW.relic_type_id AND relic.slug = 'witch-ball-endor') THEN
      INSERT INTO public.daily_game_question_aids(run_id, question_id, aid_type, consumed_at)
      VALUES (v_run_id, split_part(NEW.effect_applied, ':', 2)::uuid, 'auto-answer', now())
      ON CONFLICT (run_id, question_id, aid_type) DO UPDATE SET consumed_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_daily_game_relic_auto_answers ON public.relic_usage_log;
CREATE TRIGGER mark_daily_game_relic_auto_answers
AFTER INSERT ON public.relic_usage_log
FOR EACH ROW EXECUTE FUNCTION public.mark_daily_game_relic_auto_answers();

CREATE OR REPLACE FUNCTION public.mark_paid_daily_game_auto_answers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_run_id uuid; v_question_id uuid;
BEGIN
  IF NEW.source_type = 'answer_reveal' AND NEW.source_reference LIKE '%:%' THEN
    v_run_id := split_part(NEW.source_reference, ':', 1)::uuid;
    v_question_id := split_part(NEW.source_reference, ':', 2)::uuid;
    INSERT INTO public.daily_game_question_aids(run_id, question_id, aid_type, consumed_at)
    VALUES (v_run_id, v_question_id, 'auto-answer', now())
    ON CONFLICT (run_id, question_id, aid_type) DO UPDATE SET consumed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_paid_daily_game_auto_answers ON public.denarii_ledger_entries;
CREATE TRIGGER mark_paid_daily_game_auto_answers
AFTER INSERT ON public.denarii_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.mark_paid_daily_game_auto_answers();

-- A whole-level Sword validation may pass the level, but cannot manufacture figs.
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
    v_score := 0;
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

REVOKE ALL ON FUNCTION public.complete_daily_game_run(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_daily_game_run(uuid, boolean) TO authenticated;
