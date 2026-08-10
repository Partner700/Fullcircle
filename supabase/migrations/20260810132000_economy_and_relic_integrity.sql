/* Atomic currency, inventory, freezer, and daily-game operations. */

DROP POLICY IF EXISTS "insert_ledger_own" ON public.denarii_ledger_entries;
DROP POLICY IF EXISTS "insert_game_attempts_own" ON public.game_attempts;
DROP POLICY IF EXISTS "update_game_attempts_own" ON public.game_attempts;
DROP POLICY IF EXISTS "insert_relic_inventory_own" ON public.relic_inventory;
DROP POLICY IF EXISTS "update_relic_inventory_own" ON public.relic_inventory;
DROP POLICY IF EXISTS "insert_relic_usage_own" ON public.relic_usage_log;
DROP POLICY IF EXISTS "insert_own_freezers" ON public.streak_freezers;
DROP POLICY IF EXISTS "update_own_freezers" ON public.streak_freezers;
DROP POLICY IF EXISTS "insert_own_purchases" ON public.denarii_purchases;

CREATE OR REPLACE FUNCTION public.purchase_relic(
  p_user_id uuid,
  p_relic_slug text,
  p_currency text DEFAULT 'denarii'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_relic public.relic_types%ROWTYPE;
  v_balance bigint;
  v_service_request boolean := coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
BEGIN
  IF NOT v_service_request AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'You can only purchase relics for your own account.';
  END IF;
  IF p_currency NOT IN ('denarii', 'money', 'campay') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;
  IF p_currency <> 'denarii' AND NOT v_service_request THEN
    RAISE EXCEPTION 'Real-money relics are granted only after verified payment.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User account not found.'; END IF;

  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  IF p_currency = 'denarii' THEN
    IF v_relic.denarii_cost IS NULL OR v_relic.denarii_cost <= 0 THEN
      RAISE EXCEPTION '% cannot be bought with denarii.', v_relic.name;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO v_balance
    FROM public.denarii_ledger_entries WHERE user_id = p_user_id;
    IF v_balance < v_relic.denarii_cost THEN
      RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_relic.denarii_cost, v_balance;
    END IF;
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, description
    ) VALUES (
      p_user_id, -v_relic.denarii_cost, 'relic_purchase', 'Purchased ' || v_relic.name
    );
  ELSIF v_relic.money_price_xaf IS NULL OR v_relic.money_price_xaf <= 0 THEN
    RAISE EXCEPTION '% cannot be bought with real money.', v_relic.name;
  END IF;

  INSERT INTO public.relic_inventory (
    user_id, relic_type_id, quantity, source_description
  ) VALUES (
    p_user_id, v_relic.id, 1, 'Purchased with ' || p_currency
  )
  ON CONFLICT (user_id, relic_type_id) DO UPDATE
  SET quantity = public.relic_inventory.quantity + 1,
      source_description = EXCLUDED.source_description;

  RETURN jsonb_build_object(
    'success', true,
    'method', p_currency,
    'relic_id', v_relic.id,
    'relic_slug', v_relic.slug
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_sentry_can_gift_cadet(
  p_sentry_id uuid,
  p_cadet_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tent_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only send gifts from your own sentry account.';
  END IF;
  IF NOT public.is_sentry(p_sentry_id) THEN
    RAISE EXCEPTION 'Only an active sentry can send a cadet gift.';
  END IF;

  SELECT sentry_member.tent_id INTO v_tent_id
  FROM public.tent_members sentry_member
  JOIN public.tent_members cadet_member ON cadet_member.tent_id = sentry_member.tent_id
  WHERE sentry_member.user_id = p_sentry_id
    AND sentry_member.role = 'sentry'
    AND cadet_member.user_id = p_cadet_id
    AND cadet_member.role = 'cadet'
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    RAISE EXCEPTION 'You can only buy gifts for cadets assigned to your tent.';
  END IF;
  RETURN v_tent_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_daily_freezer_secure()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_cost integer := 500;
  v_balance bigint;
  v_freezer_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM public.denarii_ledger_entries WHERE user_id = v_user_id;
  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_cost, v_balance;
  END IF;

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (v_user_id, -v_cost, 'freezer_daily', 'Daily streak freezer purchased');
  INSERT INTO public.streak_freezers (user_id, freezer_type, source)
  VALUES (v_user_id, 'daily', 'denarii') RETURNING id INTO v_freezer_id;
  INSERT INTO public.denarii_purchases (user_id, purchase_type, amount, reference_id)
  VALUES (v_user_id, 'freezer_daily', v_cost, v_freezer_id::text);

  RETURN jsonb_build_object('success', true, 'freezer_id', v_freezer_id, 'cost', v_cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_game_assist(
  p_narrative_date date,
  p_level integer,
  p_assist_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_cost integer;
  v_source text;
  v_balance bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_level NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Invalid game level.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives WHERE narrative_date = p_narrative_date) THEN
    RAISE EXCEPTION 'Narrative not found.';
  END IF;

  IF p_assist_type = 'hint' THEN
    v_cost := 50;
    v_source := 'hint_purchase';
  ELSIF p_assist_type = 'answer_reveal' THEN
    v_cost := 100;
    v_source := 'answer_reveal';
  ELSE
    RAISE EXCEPTION 'Unsupported game assist.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM public.denarii_ledger_entries WHERE user_id = v_user_id;
  IF v_balance < v_cost THEN RAISE EXCEPTION 'Insufficient denarii.'; END IF;

  INSERT INTO public.denarii_ledger_entries (
    user_id, amount, source_type, source_reference, description
  ) VALUES (
    v_user_id, -v_cost, v_source,
    p_narrative_date::text || ':level:' || p_level,
    CASE WHEN p_assist_type = 'hint' THEN 'Game hint' ELSE 'Game answer reveal' END
      || ' on Level ' || p_level
  );
  INSERT INTO public.denarii_purchases (user_id, purchase_type, amount, reference_id)
  VALUES (
    v_user_id,
    CASE WHEN p_assist_type = 'hint' THEN 'hint' ELSE 'answer_reveal' END,
    v_cost,
    p_narrative_date::text || ':level:' || p_level
  );
  RETURN jsonb_build_object('success', true, 'cost', v_cost, 'balance', v_balance - v_cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_daily_game_level(
  p_narrative_date date,
  p_level integer,
  p_mode text,
  p_score integer,
  p_max_score integer,
  p_use_goliath boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_approved_count integer;
  v_final_score integer;
  v_passed boolean;
  v_level_max integer;
  v_reward integer := 0;
  v_earned_today integer := 0;
  v_attempt public.game_attempts%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_level NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Invalid game level.'; END IF;
  IF p_mode NOT IN ('normal', 'practice', 'blitz') THEN RAISE EXCEPTION 'Invalid game mode.'; END IF;
  IF p_max_score < 1 OR p_max_score > 30 OR p_score < 0 OR p_score > p_max_score THEN
    RAISE EXCEPTION 'Invalid game score.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives WHERE narrative_date = p_narrative_date) THEN
    RAISE EXCEPTION 'Narrative not found.';
  END IF;

  SELECT count(*)::integer INTO v_approved_count
  FROM public.custom_questions question
  WHERE question.narrative_date = p_narrative_date
    AND question.game_level = p_level
    AND question.is_approved = true
    AND (p_level >= 5 OR coalesce(question.is_bonus, false) = false);
  IF v_approved_count <> p_max_score THEN
    RAISE EXCEPTION 'The approved question set changed. Reload this level before submitting.';
  END IF;

  IF p_level > 1 AND p_mode <> 'practice' AND NOT EXISTS (
    SELECT 1 FROM public.game_attempts previous
    WHERE previous.user_id = v_user_id
      AND previous.narrative_date = p_narrative_date
      AND previous.level = p_level - 1
      AND previous.status = 'passed'
  ) THEN
    RAISE EXCEPTION 'Complete the previous level first.';
  END IF;

  v_final_score := p_score;
  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    v_final_score := p_max_score;
  END IF;

  v_passed := v_final_score >= ceil(p_max_score * 0.60);
  v_level_max := CASE WHEN p_level <= 3 THEN 50 WHEN p_level <= 6 THEN 100 ELSE 200 END;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(reward), 0)::integer INTO v_earned_today
  FROM public.game_attempts
  WHERE user_id = v_user_id AND narrative_date = p_narrative_date;

  IF v_passed AND p_mode <> 'practice' AND NOT EXISTS (
    SELECT 1 FROM public.game_attempts earned
    WHERE earned.user_id = v_user_id
      AND earned.narrative_date = p_narrative_date
      AND earned.level = p_level
      AND earned.reward > 0
  ) THEN
    v_reward := least(round(v_level_max * (v_final_score::numeric / p_max_score))::integer,
      greatest(1000 - v_earned_today, 0));
  END IF;

  INSERT INTO public.game_attempts (
    user_id, narrative_date, level, mode, score, max_score,
    reward, status, completed_at,
    hint_used, answer_revealed
  ) VALUES (
    v_user_id, p_narrative_date, p_level, p_mode, v_final_score, p_max_score,
    v_reward, CASE WHEN v_passed THEN 'passed' ELSE 'failed' END, now(),
    false, false
  ) RETURNING * INTO v_attempt;

  IF p_use_goliath THEN
    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_relic.id, 'perfect_game_level_' || p_level);
  END IF;

  IF v_reward > 0 THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id, v_reward, 'game_level', v_attempt.id::text,
      'Level ' || p_level || ' · ' || v_final_score || '/' || p_max_score || ' correct'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'attempt', to_jsonb(v_attempt),
    'passed', v_passed,
    'score', v_final_score,
    'max_score', p_max_score,
    'reward', v_reward
  );
END;
$$;

-- Lazarus must be owned by the signed-in user and is valid only before 2:45 PM.
CREATE OR REPLACE FUNCTION public.reset_quiz_attempt_with_lazarus(
  p_user_id uuid,
  p_quiz_session_id uuid
)
RETURNS public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_attempt_found boolean := false;
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_deadline timestamp;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only reopen your own quiz.';
  END IF;
  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = p_quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;
  IF v_session.quiz_type <> 'saturday' THEN
    RAISE EXCEPTION 'The Lazarus Coin only applies to Saturday quizzes.';
  END IF;
  v_deadline := v_session.session_date::timestamp + time '14:45';
  IF v_local_now::date <> v_session.session_date OR v_local_now >= v_deadline THEN
    RAISE EXCEPTION 'The Lazarus Coin can only be used before 2:45 PM on quiz day.';
  END IF;

  SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'lazarus-coin';
  SELECT * INTO v_inventory FROM public.relic_inventory
  WHERE user_id = p_user_id AND relic_type_id = v_relic.id AND quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You need a Lazarus Coin to reopen this quiz.'; END IF;

  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE user_id = p_user_id AND quiz_session_id = p_quiz_session_id
  FOR UPDATE;
  v_attempt_found := FOUND;

  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
  IF v_attempt_found THEN
    DELETE FROM public.question_responses WHERE quiz_attempt_id = v_attempt.id;
    DELETE FROM public.denarii_ledger_entries
    WHERE source_reference = v_attempt.id::text
      AND source_type IN ('quiz_reward', 'fortune_quiz_reward');
    UPDATE public.quiz_attempts
    SET status = 'in_progress', talents_scored = 0, highest_question_reached = 1,
        relics_used = coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('slug', 'lazarus-coin', 'used_at', now())
        ),
        forfeited_at = NULL, submitted_at = NULL
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
  ELSE
    INSERT INTO public.quiz_attempts (
      user_id, quiz_session_id, status, highest_question_reached, relics_used
    ) VALUES (
      p_user_id, p_quiz_session_id, 'in_progress', 1,
      jsonb_build_array(jsonb_build_object('slug', 'lazarus-coin', 'used_at', now()))
    ) RETURNING * INTO v_attempt;
  END IF;
  RETURN v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_relic(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_sentry_can_gift_cadet(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_daily_freezer_secure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_game_assist(date, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_daily_game_level(date, integer, text, integer, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_quiz_attempt_with_lazarus(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.purchase_relic(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_sentry_can_gift_cadet(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_daily_freezer_secure() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_game_assist(date, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_game_level(date, integer, text, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_quiz_attempt_with_lazarus(uuid, uuid) TO authenticated;
