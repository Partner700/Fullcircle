/* Fifteen-second Treasures/Mines and server-authoritative Mine relics. */

INSERT INTO public.relic_types (
  slug, name, description, effect, effect_type, rarity, denarii_cost,
  money_price_usd, money_price_xaf, effect_scope, icon
) VALUES (
  'shield-of-faith',
  'Shield of Faith',
  'Automatically blocks one failed or forfeited Mine before any Denarii can be taken.',
  'block_mine',
  'block_mine',
  'rare',
  100,
  NULL,
  NULL,
  'single_mine',
  'Shield'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  effect = EXCLUDED.effect,
  effect_type = EXCLUDED.effect_type,
  rarity = EXCLUDED.rarity,
  denarii_cost = EXCLUDED.denarii_cost,
  money_price_usd = EXCLUDED.money_price_usd,
  money_price_xaf = EXCLUDED.money_price_xaf,
  effect_scope = EXCLUDED.effect_scope,
  icon = EXCLUDED.icon;

ALTER TABLE public.hidden_challenge_attempts
  ADD COLUMN IF NOT EXISTS protection_relic_slug text;

CREATE OR REPLACE FUNCTION public.enforce_hidden_challenge_fifteen_seconds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'opened' AND OLD.status IS DISTINCT FROM 'opened' THEN
    NEW.opened_at := clock_timestamp();
    NEW.attempt_deadline := NEW.opened_at + interval '15 seconds';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hidden_challenge_fifteen_seconds
  ON public.hidden_challenge_claims;
CREATE TRIGGER trg_hidden_challenge_fifteen_seconds
BEFORE UPDATE ON public.hidden_challenge_claims
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hidden_challenge_fifteen_seconds();

UPDATE public.hidden_challenge_claims
SET attempt_deadline = least(
  coalesce(attempt_deadline, clock_timestamp()),
  coalesce(opened_at, clock_timestamp()) + interval '15 seconds'
)
WHERE status = 'opened';

/* Preserve the original settlement as the no-shield path, then put the
   automatic shield decision in front of it. */
ALTER FUNCTION public.settle_hidden_challenge_failure(uuid, uuid, text)
  RENAME TO settle_hidden_challenge_failure_unprotected;

CREATE OR REPLACE FUNCTION public.settle_hidden_challenge_failure(
  p_claim_id uuid,
  p_user_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.hidden_challenge_claims%ROWTYPE;
  v_challenge public.hidden_challenges%ROWTYPE;
  v_shield public.relic_types%ROWTYPE;
  v_inventory_id uuid;
BEGIN
  IF p_outcome NOT IN ('wrong', 'forfeited') THEN
    RAISE EXCEPTION 'Unsupported failure outcome.';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.current_target_id <> p_user_id
     OR v_claim.status <> 'opened' THEN
    RETURN NULL;
  END IF;

  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = v_claim.challenge_id;

  IF v_challenge.item_type = 'mine' THEN
    SELECT relic.* INTO v_shield
    FROM public.relic_types relic
    WHERE relic.slug = 'shield-of-faith';

    IF FOUND THEN
      SELECT inventory.id INTO v_inventory_id
      FROM public.relic_inventory inventory
      WHERE inventory.user_id = p_user_id
        AND inventory.relic_type_id = v_shield.id
        AND inventory.quantity > 0
      FOR UPDATE;
    END IF;

    IF v_inventory_id IS NOT NULL THEN
      UPDATE public.relic_inventory
      SET quantity = quantity - 1
      WHERE id = v_inventory_id;

      INSERT INTO public.relic_usage_log(
        user_id, relic_type_id, effect_applied
      ) VALUES (
        p_user_id, v_shield.id,
        'blocked_mine:' || v_claim.id::text
      );

      INSERT INTO public.hidden_challenge_attempts(
        challenge_id, claim_id, user_id, transfer_number,
        outcome, denarii_paid, correct_answer, protection_relic_slug
      ) VALUES (
        v_challenge.id, v_claim.id, p_user_id, v_claim.transfer_count,
        p_outcome, 0, v_claim.correct_answer, 'shield-of-faith'
      )
      ON CONFLICT (claim_id, transfer_number) DO NOTHING;

      UPDATE public.hidden_challenge_claims
      SET status = 'escaped',
          last_outcome = p_outcome,
          settled_at = now(),
          updated_at = now()
      WHERE id = v_claim.id;

      RETURN jsonb_build_object(
        'claim_id', v_claim.id,
        'item_type', 'mine',
        'outcome', p_outcome,
        'is_correct', false,
        'denarii_paid', 0,
        'correct_answer', v_claim.correct_answer,
        'mine_blocked', true,
        'protection_relic_name', v_shield.name,
        'transferred', false
      );
    END IF;
  END IF;

  RETURN public.settle_hidden_challenge_failure_unprotected(
    p_claim_id, p_user_id, p_outcome
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hidden_challenge_result(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.hidden_challenge_attempts%ROWTYPE;
  v_claim public.hidden_challenge_claims%ROWTYPE;
  v_challenge public.hidden_challenges%ROWTYPE;
  v_relic_name text;
  v_protection_name text;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT attempt.* INTO v_attempt
  FROM public.hidden_challenge_attempts attempt
  WHERE attempt.claim_id = p_claim_id
    AND attempt.user_id = v_user_id
  ORDER BY attempt.answered_at DESC, attempt.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id;
  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = v_attempt.challenge_id;

  IF v_challenge.reward_relic_quantity > 0 THEN
    SELECT relic.name INTO v_relic_name
    FROM public.relic_types relic
    WHERE relic.id = v_challenge.reward_relic_type_id;
  END IF;
  IF v_attempt.protection_relic_slug IS NOT NULL THEN
    SELECT relic.name INTO v_protection_name
    FROM public.relic_types relic
    WHERE relic.slug = v_attempt.protection_relic_slug;
  END IF;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'item_type', v_challenge.item_type,
    'outcome', v_attempt.outcome,
    'is_correct', v_attempt.outcome = 'correct',
    'correct_answer', v_attempt.correct_answer,
    'denarii_paid', v_attempt.denarii_paid,
    'reward_denarii', v_attempt.reward_denarii,
    'reward_relic_name', v_relic_name,
    'reward_relic_quantity', CASE WHEN v_attempt.outcome = 'correct' THEN v_challenge.reward_relic_quantity ELSE 0 END,
    'reward_freezer_type', CASE WHEN v_attempt.outcome = 'correct' THEN v_challenge.reward_freezer_type ELSE NULL END,
    'reward_freezer_quantity', CASE WHEN v_attempt.outcome = 'correct' THEN v_challenge.reward_freezer_quantity ELSE 0 END,
    'empty_box', v_challenge.item_type = 'treasure'
      AND v_attempt.outcome = 'correct'
      AND v_challenge.reward_denarii = 0
      AND v_challenge.reward_relic_quantity = 0
      AND v_challenge.reward_freezer_quantity = 0,
    'mine_blocked', v_attempt.protection_relic_slug IS NOT NULL,
    'protection_relic_name', v_protection_name,
    'transferred', v_challenge.item_type = 'treasure'
      AND v_attempt.outcome <> 'correct'
      AND v_claim.transfer_count > v_attempt.transfer_number
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_hidden_challenge_relics(p_claim_id uuid)
RETURNS TABLE (
  slug text,
  name text,
  quantity integer,
  automatic boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.hidden_challenge_claims claim
    JOIN public.hidden_challenges challenge ON challenge.id = claim.challenge_id
    WHERE claim.id = p_claim_id
      AND claim.current_target_id = auth.uid()
      AND claim.status = 'opened'
      AND challenge.item_type = 'mine'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    relic.slug,
    relic.name,
    inventory.quantity,
    relic.slug = 'shield-of-faith'
  FROM public.relic_inventory inventory
  JOIN public.relic_types relic ON relic.id = inventory.relic_type_id
  WHERE inventory.user_id = auth.uid()
    AND inventory.quantity > 0
    AND relic.slug IN (
      'hint', 'eliminate', 'skip', 'freeze-timer', 'reveal-reference',
      'witch-ball-endor', 'talking-donkey', 'sword-goliath',
      'shield-of-faith'
    )
  ORDER BY (relic.slug = 'shield-of-faith') DESC, relic.denarii_cost, relic.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.use_hidden_challenge_relic(
  p_claim_id uuid,
  p_open_nonce uuid,
  p_relic_slug text,
  p_answer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claim public.hidden_challenge_claims%ROWTYPE;
  v_challenge public.hidden_challenges%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_eliminated jsonb := '[]'::jsonb;
  v_is_safe boolean := false;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR p_open_nonce IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_relic_slug NOT IN (
    'hint', 'eliminate', 'skip', 'freeze-timer', 'reveal-reference',
    'witch-ball-endor', 'talking-donkey', 'sword-goliath'
  ) THEN
    RAISE EXCEPTION 'This relic cannot be used on a Mine.';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id
  FOR UPDATE;
  IF NOT FOUND OR v_claim.current_target_id <> v_user_id
     OR v_claim.status <> 'opened' OR v_claim.open_nonce <> p_open_nonce THEN
    RAISE EXCEPTION 'This Mine is no longer open.';
  END IF;

  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = v_claim.challenge_id;
  IF v_challenge.item_type <> 'mine' THEN
    RAISE EXCEPTION 'Question relics are available here only for Mines.';
  END IF;
  IF v_claim.attempt_deadline IS NOT NULL
     AND v_claim.attempt_deadline <= clock_timestamp() THEN
    RETURN public.settle_hidden_challenge_failure(v_claim.id, v_user_id, 'forfeited');
  END IF;
  IF p_relic_slug = 'eliminate'
     AND jsonb_array_length(coalesce(v_claim.question_payload->'options', '[]'::jsonb)) < 3 THEN
    RAISE EXCEPTION 'Eliminate needs a multiple-choice question with at least three options.';
  END IF;
  IF p_relic_slug = 'talking-donkey'
     AND nullif(btrim(coalesce(p_answer, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Choose an answer before asking the Talking Donkey.';
  END IF;
  IF p_relic_slug = 'reveal-reference'
     AND nullif(btrim(coalesce(v_claim.question_payload->>'reference', '')), '') IS NULL THEN
    RAISE EXCEPTION 'This question has no hidden reference.';
  END IF;

  SELECT relic.* INTO v_relic
  FROM public.relic_types relic
  WHERE relic.slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  SELECT inventory.* INTO v_inventory
  FROM public.relic_inventory inventory
  WHERE inventory.user_id = v_user_id
    AND inventory.relic_type_id = v_relic.id
    AND inventory.quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inventory.id;
  INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
  VALUES (
    v_user_id, v_relic.id,
    'mine:' || p_relic_slug || ':' || v_claim.id::text
  );

  IF p_relic_slug IN ('skip', 'witch-ball-endor', 'sword-goliath') THEN
    v_result := public.submit_hidden_challenge_answer(
      v_claim.id, p_open_nonce, v_claim.correct_answer
    );
    RETURN v_result || jsonb_build_object(
      'relic_used', p_relic_slug,
      'relic_notice', CASE p_relic_slug
        WHEN 'skip' THEN 'The Mine was skipped safely.'
        WHEN 'sword-goliath' THEN 'The Sword of Goliath secured the answer.'
        ELSE 'The answer was revealed and the Mine was escaped.'
      END
    );
  ELSIF p_relic_slug = 'freeze-timer' THEN
    UPDATE public.hidden_challenge_claims
    SET attempt_deadline = clock_timestamp() + interval '15 seconds',
        updated_at = now()
    WHERE id = v_claim.id
    RETURNING attempt_deadline INTO v_claim.attempt_deadline;
    RETURN jsonb_build_object(
      'success', true,
      'relic_used', p_relic_slug,
      'attempt_deadline', v_claim.attempt_deadline,
      'relic_notice', 'The timer has been reset to 15 seconds.'
    );
  ELSIF p_relic_slug = 'eliminate' THEN
    SELECT coalesce(jsonb_agg(option_value), '[]'::jsonb)
    INTO v_eliminated
    FROM (
      SELECT option_value
      FROM jsonb_array_elements_text(
        coalesce(v_claim.question_payload->'options', '[]'::jsonb)
      ) option(option_value)
      WHERE public.normalize_hidden_challenge_answer(option_value)
        <> public.normalize_hidden_challenge_answer(v_claim.correct_answer)
      ORDER BY random()
      LIMIT 2
    ) wrong;
    RETURN jsonb_build_object(
      'success', true,
      'relic_used', p_relic_slug,
      'eliminated_options', v_eliminated,
      'relic_notice', 'Two wrong choices have been removed.'
    );
  ELSIF p_relic_slug = 'talking-donkey' THEN
    v_is_safe := public.normalize_hidden_challenge_answer(p_answer)
      = public.normalize_hidden_challenge_answer(v_claim.correct_answer)
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          coalesce(v_claim.accepted_answers, '[]'::jsonb)
        ) accepted(value)
        WHERE public.normalize_hidden_challenge_answer(p_answer)
          = public.normalize_hidden_challenge_answer(accepted.value)
      );
    RETURN jsonb_build_object(
      'success', true,
      'relic_used', p_relic_slug,
      'answer_safe', v_is_safe,
      'eliminated_options', CASE
        WHEN v_is_safe THEN '[]'::jsonb
        ELSE jsonb_build_array(p_answer)
      END,
      'relic_notice', CASE
        WHEN v_is_safe THEN 'The Talking Donkey says this answer is safe.'
        ELSE 'The Talking Donkey warns that this answer is wrong.'
      END
    );
  ELSIF p_relic_slug = 'reveal-reference' THEN
    RETURN jsonb_build_object(
      'success', true,
      'relic_used', p_relic_slug,
      'relic_notice', 'Reference: ' || (v_claim.question_payload->>'reference')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'relic_used', p_relic_slug,
    'relic_notice', 'The answer begins with "' || left(v_claim.correct_answer, 1)
      || '" and has ' || char_length(btrim(v_claim.correct_answer)) || ' characters.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_hidden_challenge_fifteen_seconds()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_hidden_challenge_failure_unprotected(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_hidden_challenge_failure(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_hidden_challenge_result(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_hidden_challenge_relics(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.use_hidden_challenge_relic(uuid, uuid, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_hidden_challenge_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_hidden_challenge_relics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_hidden_challenge_relic(uuid, uuid, text, text)
  TO authenticated;
