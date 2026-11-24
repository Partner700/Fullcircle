-- Full Circle: defensive Boomerang relic, one-use Mine reflection, and
-- atomic Arena relic consumption. Never settle a payment without verification.
ALTER TABLE public.hidden_challenge_claims ADD COLUMN IF NOT EXISTS reflected_by uuid REFERENCES public.profiles(id);
INSERT INTO public.relic_types(name,description,effect,rarity,denarii_cost,effect_scope,icon,slug,money_price_xaf,is_active,effect_type,cash_bundles)
VALUES ('Boomerang','Reflect one incoming Mine back to the sender, or reflect an Arena capture back to the player who landed on you. Consumed once.',
'reflect_attack','rare',3000,'single_attack','RotateCcw','boomerang',300,true,'reflect_attack','{"3":300}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET name=excluded.name,description=excluded.description,effect=excluded.effect,icon=excluded.icon,
 denarii_cost=excluded.denarii_cost,effect_scope=excluded.effect_scope,is_active=true,effect_type=excluded.effect_type,
 cash_bundles=excluded.cash_bundles,money_price_xaf=excluded.money_price_xaf;
CREATE OR REPLACE FUNCTION public.get_my_hidden_challenge_relics(p_claim_id uuid)
 RETURNS TABLE(slug text, name text, quantity integer, automatic boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'shield-of-faith', 'boomerang'
    )
  ORDER BY (relic.slug = 'shield-of-faith') DESC, relic.denarii_cost, relic.name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.use_hidden_challenge_relic(p_claim_id uuid, p_open_nonce uuid, p_relic_slug text, p_answer text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'witch-ball-endor', 'talking-donkey', 'sword-goliath', 'boomerang'
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

  IF p_relic_slug = 'boomerang' THEN
    IF v_challenge.creator_id IS NULL OR v_challenge.creator_id = v_user_id
       OR v_claim.reflected_by IS NOT NULL THEN
      RAISE EXCEPTION 'This Mine cannot be reflected again.';
    END IF;
    INSERT INTO public.hidden_challenge_attempts(
      challenge_id,claim_id,user_id,transfer_number,outcome,correct_answer,protection_relic_slug
    ) VALUES (v_challenge.id,v_claim.id,v_user_id,v_claim.transfer_count,
              'correct',v_claim.correct_answer,'boomerang')
    ON CONFLICT (claim_id,transfer_number) DO NOTHING;

    UPDATE public.hidden_challenge_claims SET
      current_target_id=v_challenge.creator_id,
      reflected_by=v_user_id,
      placement='app_open',reference_key=NULL,
      status='pending',transfer_count=transfer_count+1,
      last_outcome='correct',question_source_type=NULL,question_source_id=NULL,
      question_payload=NULL,correct_answer=NULL,accepted_answers='[]'::jsonb,
      open_nonce=NULL,opened_at=NULL,attempt_deadline=NULL,settled_at=NULL,
      updated_at=now()
    WHERE id=v_claim.id;

    PERFORM public.notify_user(v_challenge.creator_id,v_user_id,'mine',
      'Your Mine was returned by Boomerang',
      'The cadet you targeted sent your Mine back to you. Open it to escape the penalty.',
      'dashboard',jsonb_build_object('hidden_challenge_claim_id',v_claim.id,
       'placement','app_open','reflected_by',v_user_id));

    RETURN jsonb_build_object(
      'claim_id',v_claim.id,'item_type','mine',
      'outcome','reflected','is_correct',true,'denarii_paid',0,
      'relic_used','boomerang','relic_notice','Boomerang returned this Mine to its sender.',
      'transferred',true
    );
  END IF;

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
$function$;
CREATE OR REPLACE FUNCTION public.settle_hidden_challenge_failure_unprotected(p_claim_id uuid, p_user_id uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim public.hidden_challenge_claims%ROWTYPE;
  v_challenge public.hidden_challenges%ROWTYPE;
  v_balance bigint := 0;
  v_paid integer := 0;
  v_next_target uuid;
  v_original_name text;
  v_reference text;
  v_reward_target uuid;
BEGIN
  IF p_outcome NOT IN ('wrong', 'forfeited') THEN
    RAISE EXCEPTION 'Unsupported failure outcome.';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.current_target_id <> p_user_id OR v_claim.status <> 'opened' THEN
    RETURN NULL;
  END IF;

  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = v_claim.challenge_id;

  IF v_challenge.item_type = 'mine' THEN
    v_reward_target := coalesce(v_claim.reflected_by, v_challenge.creator_id);
    IF p_user_id::text < v_reward_target::text THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || p_user_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_reward_target::text, 0));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_reward_target::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || p_user_id::text, 0));
    END IF;

    PERFORM 1
    FROM public.profiles profile
    WHERE profile.id IN (p_user_id, v_reward_target)
    ORDER BY profile.id
    FOR UPDATE;

    SELECT greatest(coalesce(sum(entry.amount), 0), 0)::bigint
    INTO v_balance
    FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = p_user_id;

    v_paid := least(v_balance, v_challenge.mine_penalty_denarii)::integer;
    v_reference := v_claim.id::text || ':' || v_claim.transfer_count::text;

    IF v_paid > 0 THEN
      INSERT INTO public.denarii_ledger_entries(
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        p_user_id, -v_paid, 'mine_penalty', v_reference,
        'Mine ' || p_outcome || ' penalty'
      );

      INSERT INTO public.denarii_ledger_entries(
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_reward_target, v_paid, 'mine_reward', v_reference,
        'Denarii collected by a Mine'
      );
    END IF;

    INSERT INTO public.hidden_challenge_attempts(
      challenge_id, claim_id, user_id, transfer_number,
      outcome, denarii_paid, correct_answer
    ) VALUES (
      v_challenge.id, v_claim.id, p_user_id, v_claim.transfer_count,
      p_outcome, v_paid, v_claim.correct_answer
    )
    ON CONFLICT (claim_id, transfer_number) DO NOTHING;

    UPDATE public.hidden_challenge_claims
    SET status = 'charged',
        last_outcome = p_outcome,
        settled_at = now(),
        updated_at = now()
    WHERE id = v_claim.id;

    RETURN jsonb_build_object(
      'claim_id', v_claim.id,
      'item_type', 'mine',
      'outcome', p_outcome,
      'is_correct', false,
      'denarii_paid', v_paid,
      'correct_answer', v_claim.correct_answer,
      'transferred', false
    );
  END IF;

  INSERT INTO public.hidden_challenge_attempts(
    challenge_id, claim_id, user_id, transfer_number, outcome, correct_answer
  ) VALUES (
    v_challenge.id, v_claim.id, p_user_id, v_claim.transfer_count, p_outcome, v_claim.correct_answer
  )
  ON CONFLICT (claim_id, transfer_number) DO NOTHING;

  SELECT profile.id
  INTO v_next_target
  FROM public.profiles profile
  WHERE profile.id <> v_challenge.creator_id
    AND profile.id <> p_user_id
    AND EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.status IN ('active', 'approved')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.hidden_challenge_attempts prior
      WHERE prior.claim_id = v_claim.id
        AND prior.user_id = profile.id
    )
  ORDER BY random()
  LIMIT 1;

  IF v_next_target IS NULL THEN
    SELECT profile.id
    INTO v_next_target
    FROM public.profiles profile
    WHERE profile.id <> v_challenge.creator_id
      AND profile.id <> p_user_id
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.status IN ('active', 'approved')
      )
    ORDER BY random()
    LIMIT 1;
  END IF;

  IF v_next_target IS NULL THEN
    UPDATE public.hidden_challenge_claims
    SET status = 'closed',
        last_outcome = p_outcome,
        settled_at = now(),
        updated_at = now()
    WHERE id = v_claim.id;

    IF v_challenge.reward_denarii > 0 THEN
      INSERT INTO public.denarii_ledger_entries(
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_challenge.creator_id,
        v_challenge.reward_denarii,
        'treasure_refund',
        v_claim.id::text,
        'Treasure returned because no recipient was available'
      );
    END IF;
    IF v_challenge.reward_relic_quantity > 0 THEN
      INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (
        v_challenge.creator_id,
        v_challenge.reward_relic_type_id,
        v_challenge.reward_relic_quantity,
        'Returned unopened Treasure Box'
      )
      ON CONFLICT (user_id, relic_type_id) DO UPDATE
        SET quantity = public.relic_inventory.quantity + EXCLUDED.quantity,
            source_description = EXCLUDED.source_description;
    END IF;
    IF v_challenge.reward_freezer_quantity > 0 THEN
      INSERT INTO public.streak_freezers(user_id, freezer_type, source)
      SELECT
        v_challenge.creator_id,
        v_challenge.reward_freezer_type,
        'treasure_reward'
      FROM generate_series(1, v_challenge.reward_freezer_quantity);
    END IF;

    RETURN jsonb_build_object(
      'claim_id', v_claim.id,
      'item_type', 'treasure',
      'outcome', p_outcome,
      'is_correct', false,
      'correct_answer', v_claim.correct_answer,
      'transferred', false
    );
  END IF;

  SELECT profile.display_name
  INTO v_original_name
  FROM public.profiles profile
  WHERE profile.id = v_claim.original_target_id;

  UPDATE public.hidden_challenge_claims
  SET current_target_id = v_next_target,
      placement = 'app_open',
      reference_key = NULL,
      status = 'pending',
      transfer_count = transfer_count + 1,
      last_outcome = p_outcome,
      question_source_type = NULL,
      question_source_id = NULL,
      question_payload = NULL,
      correct_answer = NULL,
      accepted_answers = '[]'::jsonb,
      open_nonce = NULL,
      opened_at = NULL,
      attempt_deadline = NULL,
      updated_at = now()
  WHERE id = v_claim.id;

  PERFORM public.notify_user(
    v_next_target,
    NULL,
    'treasure',
    'A wandering Treasure Box found you',
    'This box was first meant for ' || coalesce(v_original_name, 'another camp member') || '.',
    'dashboard',
    jsonb_build_object(
      'hidden_challenge_claim_id', v_claim.id,
      'placement', 'app_open',
      'sender_hidden', true,
      'original_target_id', v_claim.original_target_id
    )
  );

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'item_type', 'treasure',
    'outcome', p_outcome,
    'is_correct', false,
    'correct_answer', v_claim.correct_answer,
    'transferred', true
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.commit_arena_boomerang_turn(p_room_id uuid, p_expected_version integer, p_next_state jsonb, p_command_id uuid, p_actor_id uuid, p_public_state jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_offer jsonb;
  v_result jsonb;
  v_relic_id uuid;
  v_inventory_id uuid;
  v_duplicate boolean;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Arena commands are server-only.' USING ERRCODE = '42501';
  END IF;

  -- Match the existing Arena commit functions' lock order.
  PERFORM 1 FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF p_public_state IS NULL THEN
    SELECT state->'game'->'shieldOffer' INTO v_offer
      FROM public.arena_journey_games WHERE room_id = p_room_id FOR UPDATE;
    SELECT EXISTS (SELECT 1 FROM public.arena_journey_commands
      WHERE room_id = p_room_id AND command_id = p_command_id) INTO v_duplicate;
  ELSE
    SELECT private_state->'shieldOffer' INTO v_offer
      FROM public.arena_ludo_games WHERE room_id = p_room_id FOR UPDATE;
    SELECT EXISTS (SELECT 1 FROM public.arena_ludo_commands
      WHERE room_id = p_room_id AND command_id = p_command_id) INTO v_duplicate;
  END IF;

  IF NOT v_duplicate THEN
    IF v_offer->>'playerId' IS DISTINCT FROM p_actor_id::text
      OR coalesce((v_offer->>'deadline')::timestamptz, '-infinity') <= clock_timestamp()
      OR NOT EXISTS (SELECT 1 FROM public.arena_participants
        WHERE room_id = p_room_id AND user_id = p_actor_id AND forfeited_at IS NULL) THEN
      RAISE EXCEPTION 'The Boomerang decision is no longer available to you.';
    END IF;

    SELECT id INTO v_relic_id FROM public.relic_types WHERE slug = 'boomerang';
    SELECT id INTO v_inventory_id FROM public.relic_inventory
      WHERE user_id = p_actor_id AND relic_type_id = v_relic_id AND quantity > 0
      ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own a Boomerang.'; END IF;
  END IF;

  IF p_public_state IS NULL THEN
    v_result := public.commit_arena_journey_turn(
      p_room_id, p_expected_version, p_next_state, p_command_id, p_actor_id, NULL);
  ELSE
    v_result := public.commit_arena_ludo_turn(
      p_room_id, p_expected_version, p_next_state, p_public_state, p_command_id, p_actor_id, NULL);
  END IF;

  IF NOT (v_result->>'duplicate')::boolean THEN
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory_id;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
      VALUES (p_actor_id, v_relic_id, 'arena:' || p_room_id::text || ':boomerang');
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.commit_arena_boomerang_turn(uuid,integer,jsonb,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_arena_boomerang_turn(uuid,integer,jsonb,uuid,uuid,jsonb) TO service_role;
