/*
  Treasures and Mines.

  A 50-Denarii market token is consumed when an item is hidden. Treasure
  contents are escrowed once per tagged recipient. Questions and settlement
  stay server-authoritative, and every claim is locked before it can pay,
  transfer, or charge a wallet.
*/

ALTER TABLE public.denarii_ledger_entries
  DROP CONSTRAINT IF EXISTS denarii_ledger_entries_source_type_check;

ALTER TABLE public.denarii_ledger_entries
  ADD CONSTRAINT denarii_ledger_entries_source_type_check
  CHECK (source_type IN (
    'game_level', 'game_blitz', 'quiz_reward', 'fortune_quiz_reward',
    'relic_purchase', 'relic_reward', 'admin_adjustment',
    'hint_purchase', 'answer_reveal', 'freezer_daily', 'freezer_weekly',
    'attendance', 'arena_stake', 'arena_fee', 'arena_reward',
    'mobile_money', 'campay_payment', 'notification_opt_in',
    'challenge_submission', 'dove_question_cost', 'dove_question_reward',
    'hidden_item_purchase', 'treasure_escrow', 'treasure_reward',
    'treasure_refund', 'mine_penalty', 'mine_reward'
  ));

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;

ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN (
    'denarii', 'payment', 'relic', 'redemption', 'simons_purse', 'simons_coin',
    'thiefs_request', 'game_reward', 'arena_reward', 'founders_gift',
    'treasure_reward'
  ));

CREATE TABLE public.hidden_item_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('treasure', 'mine')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used')),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX hidden_item_tokens_owner_available_idx
  ON public.hidden_item_tokens(owner_id, item_type, purchased_at)
  WHERE status = 'available';

CREATE TABLE public.hidden_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_id uuid NOT NULL UNIQUE REFERENCES public.hidden_item_tokens(id) ON DELETE RESTRICT,
  item_type text NOT NULL CHECK (item_type IN ('treasure', 'mine')),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  message_body text,
  reward_denarii integer NOT NULL DEFAULT 0 CHECK (reward_denarii BETWEEN 0 AND 100000000),
  reward_relic_type_id uuid REFERENCES public.relic_types(id) ON DELETE RESTRICT,
  reward_relic_quantity integer NOT NULL DEFAULT 0 CHECK (reward_relic_quantity BETWEEN 0 AND 100),
  reward_freezer_type text CHECK (reward_freezer_type IN ('daily', 'weekly')),
  reward_freezer_quantity integer NOT NULL DEFAULT 0 CHECK (reward_freezer_quantity BETWEEN 0 AND 100),
  mine_penalty_denarii integer NOT NULL DEFAULT 0 CHECK (mine_penalty_denarii BETWEEN 0 AND 100000000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hidden_challenges_creator_idx
  ON public.hidden_challenges(creator_id, created_at DESC);

CREATE TABLE public.hidden_challenge_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.hidden_challenges(id) ON DELETE CASCADE,
  original_target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement text NOT NULL CHECK (placement IN (
    'direct_message', 'verse', 'todays_reading', 'app_open',
    'daily_trivia', 'daily_games'
  )),
  reference_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'opened', 'won', 'escaped', 'charged', 'closed'
  )),
  transfer_count integer NOT NULL DEFAULT 0 CHECK (transfer_count >= 0),
  last_outcome text CHECK (last_outcome IN ('wrong', 'forfeited')),
  question_source_type text,
  question_source_id uuid,
  question_payload jsonb,
  correct_answer text,
  accepted_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_nonce uuid,
  opened_at timestamptz,
  attempt_deadline timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, original_target_id),
  CHECK (jsonb_typeof(accepted_answers) = 'array')
);

CREATE INDEX hidden_challenge_claims_pending_context_idx
  ON public.hidden_challenge_claims(current_target_id, placement, reference_key, created_at)
  WHERE status IN ('pending', 'opened');

CREATE TABLE public.hidden_challenge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.hidden_challenges(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES public.hidden_challenge_claims(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transfer_number integer NOT NULL DEFAULT 0 CHECK (transfer_number >= 0),
  submitted_answer text,
  correct_answer text,
  outcome text NOT NULL CHECK (outcome IN ('correct', 'wrong', 'forfeited')),
  denarii_paid integer NOT NULL DEFAULT 0 CHECK (denarii_paid >= 0),
  reward_denarii integer NOT NULL DEFAULT 0 CHECK (reward_denarii >= 0),
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, transfer_number)
);

CREATE INDEX hidden_challenge_attempts_challenge_idx
  ON public.hidden_challenge_attempts(challenge_id, answered_at);

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS hidden_challenge_claim_id uuid
  REFERENCES public.hidden_challenge_claims(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS direct_messages_hidden_claim_uidx
  ON public.direct_messages(hidden_challenge_claim_id)
  WHERE hidden_challenge_claim_id IS NOT NULL;

CREATE UNIQUE INDEX hidden_item_purchase_ledger_uidx
  ON public.denarii_ledger_entries(user_id, source_type, source_reference)
  WHERE source_type = 'hidden_item_purchase';

CREATE UNIQUE INDEX hidden_challenge_settlement_ledger_uidx
  ON public.denarii_ledger_entries(user_id, source_type, source_reference)
  WHERE source_type IN (
    'treasure_escrow', 'treasure_reward', 'treasure_refund',
    'mine_penalty', 'mine_reward'
  );

ALTER TABLE public.hidden_item_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidden_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidden_challenge_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidden_challenge_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hidden_item_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hidden_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hidden_challenge_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hidden_challenge_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_hidden_challenge_answer(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:][:punct:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.purchase_hidden_item_token(p_item_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_token_id uuid;
  v_balance bigint := 0;
  v_cost integer := 50;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.';
  END IF;
  IF p_item_type NOT IN ('treasure', 'mine') THEN
    RAISE EXCEPTION 'Choose a Treasure Box or a Mine.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_user_id::text, 0));
  SELECT coalesce(sum(entry.amount), 0)::bigint
  INTO v_balance
  FROM public.denarii_ledger_entries entry
  WHERE entry.user_id = v_user_id;

  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'You need 50 Denarii to buy this item. Your balance is %.', v_balance;
  END IF;

  INSERT INTO public.hidden_item_tokens(owner_id, item_type)
  VALUES (v_user_id, p_item_type)
  RETURNING id INTO v_token_id;

  INSERT INTO public.denarii_ledger_entries(
    user_id, amount, source_type, source_reference, description
  ) VALUES (
    v_user_id,
    -v_cost,
    'hidden_item_purchase',
    v_token_id::text,
    CASE p_item_type WHEN 'treasure' THEN 'Treasure Box purchased' ELSE 'Mine purchased' END
  );

  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'item_type', p_item_type,
    'cost', v_cost,
    'wallet_denarii', v_balance - v_cost
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_hidden_item_inventory()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'treasure_boxes', count(*) FILTER (WHERE token.item_type = 'treasure' AND token.status = 'available'),
    'mines', count(*) FILTER (WHERE token.item_type = 'mine' AND token.status = 'available'),
    'wallet_denarii', (
      SELECT coalesce(sum(entry.amount), 0)::bigint
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = auth.uid()
    )
  )
  FROM public.hidden_item_tokens token
  WHERE token.owner_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.hidden_challenge_action_key(
  p_placement text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_placement
    WHEN 'direct_message' THEN 'tent'
    WHEN 'verse' THEN 'narrative'
    WHEN 'todays_reading' THEN 'narrative'
    WHEN 'daily_trivia' THEN 'game'
    WHEN 'daily_games' THEN 'games'
    ELSE 'dashboard'
  END;
$$;

CREATE OR REPLACE FUNCTION public.create_hidden_challenge(
  p_item_type text,
  p_target_ids uuid[],
  p_difficulty text,
  p_placement text,
  p_reference_key text DEFAULT NULL,
  p_message_body text DEFAULT NULL,
  p_reward_denarii integer DEFAULT 0,
  p_reward_relic_type_id uuid DEFAULT NULL,
  p_reward_relic_quantity integer DEFAULT 0,
  p_reward_freezer_type text DEFAULT NULL,
  p_reward_freezer_quantity integer DEFAULT 0,
  p_mine_penalty_denarii integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_token public.hidden_item_tokens%ROWTYPE;
  v_challenge_id uuid;
  v_claim_id uuid;
  v_message_id uuid;
  v_target uuid;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_target_count integer;
  v_balance bigint := 0;
  v_escrow_denarii bigint := 0;
  v_needed integer := 0;
  v_available integer := 0;
  v_relic_name text;
  v_target_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT public.has_current_subscription_access(v_actor) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.';
  END IF;
  IF p_item_type NOT IN ('treasure', 'mine') THEN
    RAISE EXCEPTION 'Choose a Treasure Box or a Mine.';
  END IF;
  IF p_difficulty NOT IN ('easy', 'moderate', 'hard') THEN
    RAISE EXCEPTION 'Choose an easy, moderate, or hard question.';
  END IF;
  IF p_placement NOT IN (
    'direct_message', 'verse', 'todays_reading', 'app_open',
    'daily_trivia', 'daily_games'
  ) THEN
    RAISE EXCEPTION 'Choose a supported hiding place.';
  END IF;
  IF p_item_type = 'treasure' AND p_placement NOT IN ('direct_message', 'verse') THEN
    RAISE EXCEPTION 'Treasure Boxes can be hidden in a direct message or a verse insight.';
  END IF;
  IF p_placement IN ('verse', 'todays_reading', 'daily_trivia', 'daily_games')
     AND NULLIF(btrim(coalesce(p_reference_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Choose where this item will be hidden.';
  END IF;
  IF length(btrim(coalesce(p_message_body, ''))) > 2000 THEN
    RAISE EXCEPTION 'A hidden message or insight cannot exceed 2000 characters.';
  END IF;
  IF coalesce(p_reward_denarii, -1) NOT BETWEEN 0 AND 100000000
     OR coalesce(p_reward_relic_quantity, -1) NOT BETWEEN 0 AND 100
     OR coalesce(p_reward_freezer_quantity, -1) NOT BETWEEN 0 AND 100
     OR coalesce(p_mine_penalty_denarii, -1) NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Enter valid whole-number amounts.';
  END IF;
  IF p_reward_relic_quantity > 0 AND p_reward_relic_type_id IS NULL THEN
    RAISE EXCEPTION 'Choose the relic placed inside the box.';
  END IF;
  IF p_reward_relic_quantity = 0 AND p_reward_relic_type_id IS NOT NULL THEN
    p_reward_relic_type_id := NULL;
  END IF;
  IF p_reward_freezer_quantity > 0 AND p_reward_freezer_type NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'Choose the freezer placed inside the box.';
  END IF;
  IF p_reward_freezer_quantity = 0 THEN
    p_reward_freezer_type := NULL;
  END IF;
  IF p_item_type = 'mine' AND p_mine_penalty_denarii < 1 THEN
    RAISE EXCEPTION 'Set the Denarii amount the Mine can collect.';
  END IF;
  IF p_item_type = 'treasure' AND p_mine_penalty_denarii <> 0 THEN
    RAISE EXCEPTION 'A Treasure Box cannot charge a Mine penalty.';
  END IF;
  IF p_item_type = 'mine' AND (
    p_reward_denarii <> 0 OR p_reward_relic_quantity <> 0 OR p_reward_freezer_quantity <> 0
  ) THEN
    RAISE EXCEPTION 'A Mine cannot contain Treasure rewards.';
  END IF;

  SELECT coalesce(array_agg(candidate.user_id ORDER BY candidate.ordinality), ARRAY[]::uuid[])
  INTO v_target_ids
  FROM (
    SELECT DISTINCT ON (target.user_id) target.user_id, target.ordinality
    FROM unnest(coalesce(p_target_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS target(user_id, ordinality)
    WHERE target.user_id IS NOT NULL AND target.user_id <> v_actor
    ORDER BY target.user_id, target.ordinality
  ) candidate;

  v_target_count := cardinality(v_target_ids);
  IF v_target_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Tag between one and three people.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_target_ids) target(user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = target.user_id
        AND assignment.status IN ('active', 'approved')
    )
  ) THEN
    RAISE EXCEPTION 'Every tagged person must be an active camp member.';
  END IF;

  SELECT token.*
  INTO v_token
  FROM public.hidden_item_tokens token
  WHERE token.owner_id = v_actor
    AND token.item_type = p_item_type
    AND token.status = 'available'
  ORDER BY token.purchased_at, token.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buy a % in the Market before hiding one.',
      CASE p_item_type WHEN 'treasure' THEN 'Treasure Box' ELSE 'Mine' END;
  END IF;

  INSERT INTO public.hidden_challenges(
    creator_id,
    token_id,
    item_type,
    difficulty,
    message_body,
    reward_denarii,
    reward_relic_type_id,
    reward_relic_quantity,
    reward_freezer_type,
    reward_freezer_quantity,
    mine_penalty_denarii
  ) VALUES (
    v_actor,
    v_token.id,
    p_item_type,
    p_difficulty,
    NULLIF(btrim(coalesce(p_message_body, '')), ''),
    CASE WHEN p_item_type = 'treasure' THEN p_reward_denarii ELSE 0 END,
    CASE WHEN p_item_type = 'treasure' THEN p_reward_relic_type_id ELSE NULL END,
    CASE WHEN p_item_type = 'treasure' THEN p_reward_relic_quantity ELSE 0 END,
    CASE WHEN p_item_type = 'treasure' THEN p_reward_freezer_type ELSE NULL END,
    CASE WHEN p_item_type = 'treasure' THEN p_reward_freezer_quantity ELSE 0 END,
    CASE WHEN p_item_type = 'mine' THEN p_mine_penalty_denarii ELSE 0 END
  )
  RETURNING id INTO v_challenge_id;

  IF p_item_type = 'treasure' AND p_reward_denarii > 0 THEN
    v_escrow_denarii := p_reward_denarii::bigint * v_target_count::bigint;
    PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_actor::text, 0));
    SELECT coalesce(sum(entry.amount), 0)::bigint
    INTO v_balance
    FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = v_actor;

    IF v_balance < v_escrow_denarii THEN
      RAISE EXCEPTION 'You need % Denarii to fund this box for % recipient(s). Your balance is %.',
        v_escrow_denarii, v_target_count, v_balance;
    END IF;

    INSERT INTO public.denarii_ledger_entries(
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_actor,
      -v_escrow_denarii,
      'treasure_escrow',
      v_challenge_id::text,
      'Treasure escrow for ' || v_target_count::text || ' recipient(s)'
    );
  END IF;

  IF p_item_type = 'treasure' AND p_reward_relic_quantity > 0 THEN
    v_needed := p_reward_relic_quantity * v_target_count;
    SELECT relic.name INTO v_relic_name
    FROM public.relic_types relic
    WHERE relic.id = p_reward_relic_type_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected relic no longer exists.';
    END IF;

    SELECT inventory.quantity
    INTO v_available
    FROM public.relic_inventory inventory
    WHERE inventory.user_id = v_actor
      AND inventory.relic_type_id = p_reward_relic_type_id
    FOR UPDATE;

    IF coalesce(v_available, 0) < v_needed THEN
      RAISE EXCEPTION 'You need % copies of % to fund every tagged box.', v_needed, v_relic_name;
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - v_needed,
        source_description = 'Reserved inside a Treasure Box'
    WHERE user_id = v_actor
      AND relic_type_id = p_reward_relic_type_id;
  END IF;

  IF p_item_type = 'treasure' AND p_reward_freezer_quantity > 0 THEN
    v_needed := p_reward_freezer_quantity * v_target_count;
    SELECT count(*)::integer
    INTO v_available
    FROM public.streak_freezers freezer
    WHERE freezer.user_id = v_actor
      AND freezer.freezer_type = p_reward_freezer_type
      AND freezer.used_at IS NULL
      AND freezer.applied_to_date IS NULL
      AND freezer.activated_at IS NULL;

    IF v_available < v_needed THEN
      RAISE EXCEPTION 'You need % unused % freezer(s) to fund every tagged box.',
        v_needed, p_reward_freezer_type;
    END IF;

    DELETE FROM public.streak_freezers freezer
    WHERE freezer.id IN (
      SELECT available.id
      FROM public.streak_freezers available
      WHERE available.user_id = v_actor
        AND available.freezer_type = p_reward_freezer_type
        AND available.used_at IS NULL
        AND available.applied_to_date IS NULL
        AND available.activated_at IS NULL
      ORDER BY available.purchased_at, available.id
      LIMIT v_needed
    );
  END IF;

  UPDATE public.hidden_item_tokens
  SET status = 'used', used_at = now()
  WHERE id = v_token.id;

  FOREACH v_target IN ARRAY v_target_ids
  LOOP
    INSERT INTO public.hidden_challenge_claims(
      challenge_id,
      original_target_id,
      current_target_id,
      placement,
      reference_key
    ) VALUES (
      v_challenge_id,
      v_target,
      v_target,
      p_placement,
      NULLIF(btrim(coalesce(p_reference_key, '')), '')
    )
    RETURNING id INTO v_claim_id;

    IF p_placement = 'direct_message' THEN
      INSERT INTO public.direct_messages(
        sender_id,
        recipient_id,
        body,
        hidden_challenge_claim_id
      ) VALUES (
        v_actor,
        v_target,
        coalesce(
          NULLIF(btrim(coalesce(p_message_body, '')), ''),
          CASE p_item_type
            WHEN 'treasure' THEN 'I left something for you in this message.'
            ELSE 'There is something hidden in this message.'
          END
        ),
        v_claim_id
      )
      RETURNING id INTO v_message_id;

      UPDATE public.hidden_challenge_claims
      SET reference_key = v_message_id::text
      WHERE id = v_claim_id;
    ELSIF p_item_type = 'treasure' THEN
      PERFORM public.notify_user(
        v_target,
        v_actor,
        'treasure',
        'A Treasure Box was hidden for you',
        'Open the matching verse insights to find it.',
        public.hidden_challenge_action_key(p_placement),
        jsonb_build_object(
          'hidden_challenge_claim_id', v_claim_id,
          'placement', p_placement,
          'reference_key', p_reference_key,
          'narrative_id', split_part(coalesce(p_reference_key, ''), '|', 1),
          'verse_reference', split_part(coalesce(p_reference_key, ''), '|', 2)
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'challenge_id', v_challenge_id,
    'item_type', p_item_type,
    'recipient_count', v_target_count,
    'escrow_denarii', v_escrow_denarii
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_hidden_challenge_claim(
  p_placement text,
  p_reference_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT claim.id
  FROM public.hidden_challenge_claims claim
  JOIN public.hidden_challenges challenge ON challenge.id = claim.challenge_id
  WHERE claim.current_target_id = auth.uid()
    AND claim.status IN ('pending', 'opened')
    AND challenge.status = 'active'
    AND claim.placement = p_placement
    AND (
      NULLIF(btrim(coalesce(p_reference_key, '')), '') IS NULL
      OR claim.reference_key = btrim(p_reference_key)
      OR claim.placement IN ('todays_reading', 'daily_trivia', 'daily_games')
    )
  ORDER BY
    CASE WHEN claim.reference_key = btrim(coalesce(p_reference_key, '')) THEN 0 ELSE 1 END,
    claim.created_at,
    claim.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.open_hidden_challenge(
  p_claim_id uuid,
  p_open_nonce uuid
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
  v_source_type text;
  v_source_id uuid;
  v_question_payload jsonb;
  v_correct_answer text;
  v_accepted_answers jsonb;
  v_creator_name text;
  v_creator_avatar text;
  v_original_name text;
  v_original_avatar text;
  v_participant_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR p_open_nonce IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.current_target_id <> v_user_id THEN
    RETURN NULL;
  END IF;

  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = v_claim.challenge_id;

  IF v_challenge.status <> 'active' OR v_claim.status NOT IN ('pending', 'opened') THEN
    RETURN NULL;
  END IF;

  IF v_claim.status = 'opened' AND v_claim.open_nonce IS DISTINCT FROM p_open_nonce THEN
    PERFORM public.settle_hidden_challenge_failure(v_claim.id, v_user_id, 'forfeited');
    RETURN NULL;
  END IF;

  IF v_claim.status = 'pending' THEN
    SELECT
      pool.source_type,
      pool.source_id,
      pool.question_payload,
      pool.correct_answer,
      pool.accepted_answers
    INTO
      v_source_type,
      v_source_id,
      v_question_payload,
      v_correct_answer,
      v_accepted_answers
    FROM (
      SELECT
        'daily_trivia'::text AS source_type,
        question.id AS source_id,
        jsonb_build_object(
          'question_text', question.question_text,
          'question_type', CASE
            WHEN jsonb_typeof(question.options) = 'array' AND jsonb_array_length(question.options) >= 2
              THEN 'multiple_choice'
            ELSE 'standard_text'
          END,
          'options', CASE WHEN jsonb_typeof(question.options) = 'array' THEN question.options ELSE '[]'::jsonb END,
          'reference', question.scripture_reference
        ) AS question_payload,
        question.correct_answer::text AS correct_answer,
        coalesce(question.accepted_answers, '[]'::jsonb) AS accepted_answers,
        CASE
          WHEN question.narrative_date BETWEEN timezone('Africa/Douala', now())::date - 6
            AND timezone('Africa/Douala', now())::date
            OR session.session_date BETWEEN timezone('Africa/Douala', now())::date - 7
              AND timezone('Africa/Douala', now())::date
          THEN 0 ELSE 1
        END AS age_priority
      FROM public.custom_questions question
      LEFT JOIN public.quiz_sessions session ON session.id = question.quiz_session_id
      WHERE question.is_approved = true
        AND coalesce(question.difficulty_tag, 'moderate') = v_challenge.difficulty
        AND question.question_type IN (
          'multiple_choice', 'true_false', 'fill_blank', 'standard_text',
          'scriptorium', 'cloze', 'comprehension'
        )

      UNION ALL

      SELECT
        'weekly_quiz'::text AS source_type,
        question.id AS source_id,
        jsonb_build_object(
          'question_text', coalesce(question.question_payload->>'question', question.question_payload->>'question_text'),
          'question_type', CASE
            WHEN jsonb_typeof(question.question_payload->'options') = 'array'
              AND jsonb_array_length(question.question_payload->'options') >= 2
              THEN 'multiple_choice'
            ELSE 'standard_text'
          END,
          'options', CASE
            WHEN jsonb_typeof(question.question_payload->'options') = 'array'
              THEN question.question_payload->'options'
            ELSE '[]'::jsonb
          END,
          'reference', question.question_payload->>'reference'
        ) AS question_payload,
        question.question_payload->>'correct_answer' AS correct_answer,
        CASE
          WHEN jsonb_typeof(question.question_payload->'accepted_answers') = 'array'
            THEN question.question_payload->'accepted_answers'
          ELSE '[]'::jsonb
        END AS accepted_answers,
        CASE
          WHEN question.source_narrative_date BETWEEN timezone('Africa/Douala', now())::date - 6
            AND timezone('Africa/Douala', now())::date
            OR session.session_date BETWEEN timezone('Africa/Douala', now())::date - 7
              AND timezone('Africa/Douala', now())::date
          THEN 0 ELSE 1
        END AS age_priority
      FROM public.generated_questions question
      JOIN public.quiz_sessions session ON session.id = question.quiz_session_id
      WHERE question.difficulty_tag = v_challenge.difficulty
        AND coalesce(question.question_payload->>'type', 'standard_text') IN (
          'multiple_choice', 'true_false', 'fill_blank', 'standard_text',
          'scriptorium', 'cloze', 'comprehension'
        )
        AND NULLIF(btrim(question.question_payload->>'correct_answer'), '') IS NOT NULL
    ) pool
    WHERE NULLIF(btrim(coalesce(pool.question_payload->>'question_text', '')), '') IS NOT NULL
      AND NULLIF(btrim(coalesce(pool.correct_answer, '')), '') IS NOT NULL
    ORDER BY pool.age_priority, random()
    LIMIT 1;

    IF v_source_id IS NULL THEN
      RAISE EXCEPTION 'No approved % question is available yet. Ask the instructor to add one.', v_challenge.difficulty;
    END IF;

    UPDATE public.hidden_challenge_claims
    SET status = 'opened',
        question_source_type = v_source_type,
        question_source_id = v_source_id,
        question_payload = v_question_payload,
        correct_answer = v_correct_answer,
        accepted_answers = coalesce(v_accepted_answers, '[]'::jsonb),
        open_nonce = p_open_nonce,
        opened_at = now(),
        attempt_deadline = now() + interval '30 minutes',
        updated_at = now()
    WHERE id = v_claim.id
    RETURNING * INTO v_claim;
  END IF;

  SELECT profile.display_name, profile.avatar_url
  INTO v_original_name, v_original_avatar
  FROM public.profiles profile
  WHERE profile.id = v_claim.original_target_id;

  IF v_claim.transfer_count = 0 THEN
    SELECT profile.display_name, profile.avatar_url
    INTO v_creator_name, v_creator_avatar
    FROM public.profiles profile
    WHERE profile.id = v_challenge.creator_id;
  END IF;

  SELECT count(*)::integer
  INTO v_participant_count
  FROM public.hidden_challenge_attempts attempt
  WHERE attempt.challenge_id = v_challenge.id;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'challenge_id', v_challenge.id,
    'item_type', v_challenge.item_type,
    'difficulty', v_challenge.difficulty,
    'placement', v_claim.placement,
    'message_body', v_challenge.message_body,
    'question_text', v_claim.question_payload->>'question_text',
    'question_type', v_claim.question_payload->>'question_type',
    'options', coalesce(v_claim.question_payload->'options', '[]'::jsonb),
    'reference', v_claim.question_payload->>'reference',
    'mine_penalty_denarii', v_challenge.mine_penalty_denarii,
    'sender_name', v_creator_name,
    'sender_avatar_url', v_creator_avatar,
    'original_target_name', v_original_name,
    'original_target_avatar_url', v_original_avatar,
    'transfer_count', v_claim.transfer_count,
    'last_outcome', v_claim.last_outcome,
    'opened_at', v_claim.opened_at,
    'attempt_deadline', v_claim.attempt_deadline,
    'participant_count', v_participant_count
  );
END;
$$;

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
  v_balance bigint := 0;
  v_paid integer := 0;
  v_next_target uuid;
  v_original_name text;
  v_reference text;
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
    IF p_user_id::text < v_challenge.creator_id::text THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || p_user_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_challenge.creator_id::text, 0));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_challenge.creator_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || p_user_id::text, 0));
    END IF;

    PERFORM 1
    FROM public.profiles profile
    WHERE profile.id IN (p_user_id, v_challenge.creator_id)
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
        v_challenge.creator_id, v_paid, 'mine_reward', v_reference,
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
$$;

CREATE OR REPLACE FUNCTION public.submit_hidden_challenge_answer(
  p_claim_id uuid,
  p_open_nonce uuid,
  p_answer text
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
  v_answer text;
  v_correct boolean := false;
  v_relic_name text;
BEGIN
  IF v_user_id IS NULL OR p_open_nonce IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NULLIF(btrim(coalesce(p_answer, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Choose or enter an answer first.';
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.current_target_id <> v_user_id
     OR v_claim.status <> 'opened' OR v_claim.open_nonce <> p_open_nonce THEN
    RAISE EXCEPTION 'This hidden question is no longer open.';
  END IF;

  IF v_claim.attempt_deadline IS NOT NULL AND v_claim.attempt_deadline <= now() THEN
    RETURN public.settle_hidden_challenge_failure(v_claim.id, v_user_id, 'forfeited');
  END IF;

  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = v_claim.challenge_id;

  v_answer := public.normalize_hidden_challenge_answer(p_answer);
  v_correct := v_answer = public.normalize_hidden_challenge_answer(v_claim.correct_answer)
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(v_claim.accepted_answers, '[]'::jsonb)) accepted(value)
      WHERE v_answer = public.normalize_hidden_challenge_answer(accepted.value)
    );

  IF NOT v_correct THEN
    UPDATE public.hidden_challenge_claims SET updated_at = now() WHERE id = v_claim.id;
    RETURN public.settle_hidden_challenge_failure(v_claim.id, v_user_id, 'wrong');
  END IF;

  IF v_challenge.item_type = 'treasure' THEN
    IF v_challenge.reward_denarii > 0 THEN
      INSERT INTO public.denarii_ledger_entries(
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_user_id,
        v_challenge.reward_denarii,
        'treasure_reward',
        v_claim.id::text,
        'Treasure Box reward'
      );
    END IF;

    IF v_challenge.reward_relic_quantity > 0 THEN
      SELECT relic.name INTO v_relic_name
      FROM public.relic_types relic
      WHERE relic.id = v_challenge.reward_relic_type_id;

      INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (
        v_user_id,
        v_challenge.reward_relic_type_id,
        v_challenge.reward_relic_quantity,
        'Won from a Treasure Box'
      )
      ON CONFLICT (user_id, relic_type_id) DO UPDATE
        SET quantity = public.relic_inventory.quantity + EXCLUDED.quantity,
            source_description = EXCLUDED.source_description;
    END IF;

    IF v_challenge.reward_freezer_quantity > 0 THEN
      INSERT INTO public.streak_freezers(user_id, freezer_type, source)
      SELECT
        v_user_id,
        v_challenge.reward_freezer_type,
        'treasure_reward'
      FROM generate_series(1, v_challenge.reward_freezer_quantity);
    END IF;

    INSERT INTO public.hidden_challenge_attempts(
      challenge_id, claim_id, user_id, transfer_number,
      submitted_answer, outcome, reward_denarii, correct_answer
    ) VALUES (
      v_challenge.id, v_claim.id, v_user_id, v_claim.transfer_count,
      btrim(p_answer), 'correct', v_challenge.reward_denarii, v_claim.correct_answer
    )
    ON CONFLICT (claim_id, transfer_number) DO NOTHING;

    UPDATE public.hidden_challenge_claims
    SET status = 'won', settled_at = now(), updated_at = now()
    WHERE id = v_claim.id;

    UPDATE public.user_notifications
    SET read_at = coalesce(read_at, now())
    WHERE recipient_id = v_user_id
      AND metadata->>'hidden_challenge_claim_id' = v_claim.id::text;

    RETURN jsonb_build_object(
      'claim_id', v_claim.id,
      'item_type', 'treasure',
      'outcome', 'correct',
      'is_correct', true,
      'correct_answer', v_claim.correct_answer,
      'reward_denarii', v_challenge.reward_denarii,
      'reward_relic_name', v_relic_name,
      'reward_relic_quantity', v_challenge.reward_relic_quantity,
      'reward_freezer_type', v_challenge.reward_freezer_type,
      'reward_freezer_quantity', v_challenge.reward_freezer_quantity,
      'empty_box', v_challenge.reward_denarii = 0
        AND v_challenge.reward_relic_quantity = 0
        AND v_challenge.reward_freezer_quantity = 0,
      'transferred', false
    );
  END IF;

  INSERT INTO public.hidden_challenge_attempts(
    challenge_id, claim_id, user_id, transfer_number,
    submitted_answer, outcome, correct_answer
  ) VALUES (
    v_challenge.id, v_claim.id, v_user_id, v_claim.transfer_count,
    btrim(p_answer), 'correct', v_claim.correct_answer
  )
  ON CONFLICT (claim_id, transfer_number) DO NOTHING;

  UPDATE public.hidden_challenge_claims
  SET status = 'escaped', settled_at = now(), updated_at = now()
  WHERE id = v_claim.id;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'item_type', 'mine',
    'outcome', 'correct',
    'is_correct', true,
    'correct_answer', v_claim.correct_answer,
    'denarii_paid', 0,
    'transferred', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_hidden_challenge(
  p_claim_id uuid,
  p_open_nonce uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claim public.hidden_challenge_claims%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR p_open_nonce IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND OR v_claim.current_target_id <> v_user_id
     OR v_claim.status <> 'opened' OR v_claim.open_nonce <> p_open_nonce THEN
    RETURN NULL;
  END IF;

  RETURN public.settle_hidden_challenge_failure(v_claim.id, v_user_id, 'forfeited');
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM public.hidden_challenge_attempts attempt
  WHERE attempt.claim_id = p_claim_id
    AND attempt.user_id = v_user_id
  ORDER BY attempt.answered_at DESC, attempt.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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
    'transferred', v_challenge.item_type = 'treasure'
      AND v_attempt.outcome <> 'correct'
      AND v_claim.transfer_count > v_attempt.transfer_number
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hidden_challenge_participants(p_challenge_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  outcome text,
  answered_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.hidden_challenges challenge
    WHERE challenge.id = p_challenge_id
      AND (
        challenge.creator_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.hidden_challenge_claims claim
          WHERE claim.challenge_id = challenge.id
            AND (
              claim.current_target_id = auth.uid()
              OR claim.original_target_id = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.hidden_challenge_attempts own_attempt
                WHERE own_attempt.claim_id = claim.id
                  AND own_attempt.user_id = auth.uid()
              )
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'This hidden challenge is not available to you.';
  END IF;

  RETURN QUERY
  SELECT
    attempt.user_id,
    profile.display_name,
    profile.avatar_url,
    attempt.outcome,
    attempt.answered_at
  FROM public.hidden_challenge_attempts attempt
  JOIN public.profiles profile ON profile.id = attempt.user_id
  WHERE attempt.challenge_id = p_challenge_id
  ORDER BY attempt.answered_at, attempt.id;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_hidden_challenge_answer(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hidden_challenge_action_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_hidden_challenge_failure(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_hidden_item_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_hidden_item_inventory() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_hidden_challenge(text, uuid[], text, text, text, text, integer, uuid, integer, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pending_hidden_challenge_claim(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_hidden_challenge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_hidden_challenge_answer(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forfeit_hidden_challenge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_hidden_challenge_result(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_hidden_challenge_participants(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purchase_hidden_item_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_hidden_item_inventory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hidden_challenge(text, uuid[], text, text, text, text, integer, uuid, integer, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_hidden_challenge_claim(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_hidden_challenge(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hidden_challenge_answer(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_hidden_challenge(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hidden_challenge_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hidden_challenge_participants(uuid) TO authenticated;

ALTER TABLE public.hidden_challenge_claims REPLICA IDENTITY FULL;
ALTER TABLE public.hidden_challenge_attempts REPLICA IDENTITY FULL;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['hidden_challenge_claims', 'hidden_challenge_attempts']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables publication_table
      WHERE publication_table.pubname = 'supabase_realtime'
        AND publication_table.schemaname = 'public'
        AND publication_table.tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
