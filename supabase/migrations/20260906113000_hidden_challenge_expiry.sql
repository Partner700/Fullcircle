/*
  Treasures and Mines expire after 48 hours.

  Expiry is server-authoritative and idempotent. Unclaimed escrow is returned
  once per unresolved recipient, while an untouched box or mine is replaced
  with a fresh market token that can be hidden again.
*/

ALTER TABLE public.hidden_challenges
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.hidden_challenges
SET expires_at = created_at + interval '48 hours'
WHERE expires_at IS NULL;

ALTER TABLE public.hidden_challenges
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '48 hours'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS hidden_challenges_active_expiry_idx
  ON public.hidden_challenges(expires_at, id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.hidden_challenge_expirations (
  challenge_id uuid PRIMARY KEY REFERENCES public.hidden_challenges(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  replacement_token_id uuid REFERENCES public.hidden_item_tokens(id) ON DELETE SET NULL,
  unresolved_claim_count integer NOT NULL DEFAULT 0 CHECK (unresolved_claim_count >= 0),
  refunded_denarii bigint NOT NULL DEFAULT 0 CHECK (refunded_denarii >= 0),
  refunded_relic_quantity integer NOT NULL DEFAULT 0 CHECK (refunded_relic_quantity >= 0),
  refunded_freezer_quantity integer NOT NULL DEFAULT 0 CHECK (refunded_freezer_quantity >= 0),
  expired_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hidden_challenge_expirations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hidden_challenge_expirations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_hidden_challenges(
  p_creator_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge public.hidden_challenges%ROWTYPE;
  v_unresolved_count integer;
  v_refund_denarii bigint;
  v_refund_relics integer;
  v_refund_freezers integer;
  v_replacement_token_id uuid;
  v_expired_count integer := 0;
  v_claim_ids uuid[];
  v_restore_token boolean;
BEGIN
  FOR v_challenge IN
    SELECT challenge.*
    FROM public.hidden_challenges challenge
    WHERE challenge.status = 'active'
      AND challenge.expires_at <= clock_timestamp()
      AND (p_creator_id IS NULL OR challenge.creator_id = p_creator_id)
    ORDER BY challenge.expires_at, challenge.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT
      count(*)::integer,
      coalesce(array_agg(claim.id ORDER BY claim.id), ARRAY[]::uuid[])
    INTO v_unresolved_count, v_claim_ids
    FROM public.hidden_challenge_claims claim
    WHERE claim.challenge_id = v_challenge.id
      AND claim.status IN ('pending', 'opened');

    IF v_unresolved_count = 0 THEN
      UPDATE public.hidden_challenges
      SET status = 'closed', updated_at = clock_timestamp()
      WHERE id = v_challenge.id;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.hidden_challenge_expirations expiration
      WHERE expiration.challenge_id = v_challenge.id
    ) THEN
      UPDATE public.hidden_challenge_claims
      SET status = 'closed',
          settled_at = coalesce(settled_at, clock_timestamp()),
          updated_at = clock_timestamp()
      WHERE id = ANY(v_claim_ids)
        AND status IN ('pending', 'opened');
      UPDATE public.hidden_challenges
      SET status = 'closed', updated_at = clock_timestamp()
      WHERE id = v_challenge.id;
      CONTINUE;
    END IF;

    v_refund_denarii := CASE
      WHEN v_challenge.item_type = 'treasure'
        THEN v_challenge.reward_denarii::bigint * v_unresolved_count::bigint
      ELSE 0
    END;
    v_refund_relics := CASE
      WHEN v_challenge.item_type = 'treasure'
        THEN v_challenge.reward_relic_quantity * v_unresolved_count
      ELSE 0
    END;
    v_refund_freezers := CASE
      WHEN v_challenge.item_type = 'treasure'
        THEN v_challenge.reward_freezer_quantity * v_unresolved_count
      ELSE 0
    END;

    /* A failed Treasure attempt only passes the locked box onward; it does
       not consume it. The token is therefore restored unless a Treasure was
       won/exhausted or a Mine already charged/was escaped. */
    v_restore_token := NOT EXISTS (
      SELECT 1
      FROM public.hidden_challenge_claims claim
      WHERE claim.challenge_id = v_challenge.id
        AND (
          (v_challenge.item_type = 'treasure' AND claim.status IN ('won', 'closed'))
          OR (v_challenge.item_type = 'mine' AND claim.status IN ('escaped', 'charged', 'closed'))
        )
    );

    IF v_restore_token THEN
      INSERT INTO public.hidden_item_tokens(owner_id, item_type, status, purchased_at)
      VALUES (v_challenge.creator_id, v_challenge.item_type, 'available', clock_timestamp())
      RETURNING id INTO v_replacement_token_id;
    ELSE
      v_replacement_token_id := NULL;
    END IF;

    INSERT INTO public.hidden_challenge_expirations(
      challenge_id,
      creator_id,
      replacement_token_id,
      unresolved_claim_count,
      refunded_denarii,
      refunded_relic_quantity,
      refunded_freezer_quantity,
      expired_at
    ) VALUES (
      v_challenge.id,
      v_challenge.creator_id,
      v_replacement_token_id,
      v_unresolved_count,
      v_refund_denarii,
      v_refund_relics,
      v_refund_freezers,
      clock_timestamp()
    )
    ON CONFLICT (challenge_id) DO NOTHING;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_refund_denarii > 0 THEN
      INSERT INTO public.denarii_ledger_entries(
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_challenge.creator_id,
        v_refund_denarii,
        'treasure_refund',
        v_challenge.id::text || ':expiry',
        'Treasure contents returned after 48-hour expiry'
      );
    END IF;

    IF v_refund_relics > 0 THEN
      INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (
        v_challenge.creator_id,
        v_challenge.reward_relic_type_id,
        v_refund_relics,
        'Returned from an expired Treasure Box'
      )
      ON CONFLICT (user_id, relic_type_id) DO UPDATE
        SET quantity = public.relic_inventory.quantity + EXCLUDED.quantity,
            source_description = EXCLUDED.source_description;
    END IF;

    IF v_refund_freezers > 0 THEN
      INSERT INTO public.streak_freezers(user_id, freezer_type, source)
      SELECT
        v_challenge.creator_id,
        v_challenge.reward_freezer_type,
        'treasure_reward'
      FROM generate_series(1, v_refund_freezers);
    END IF;

    UPDATE public.hidden_challenge_claims
    SET status = 'closed',
        settled_at = coalesce(settled_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE id = ANY(v_claim_ids)
      AND status IN ('pending', 'opened');

    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, clock_timestamp())
    WHERE notification.recipient_id IN (
      SELECT claim.current_target_id
      FROM public.hidden_challenge_claims claim
      WHERE claim.id = ANY(v_claim_ids)
    )
      AND notification.metadata->>'hidden_challenge_claim_id' = ANY(v_claim_ids::text[]);

    UPDATE public.hidden_challenges
    SET status = 'closed', updated_at = clock_timestamp()
    WHERE id = v_challenge.id;

    PERFORM public.notify_user(
      v_challenge.creator_id,
      NULL,
      CASE v_challenge.item_type WHEN 'treasure' THEN 'treasure' ELSE 'mine' END,
      CASE v_challenge.item_type
        WHEN 'treasure' THEN 'Your Treasure Box expired'
        ELSE 'Your Mine expired'
      END,
      CASE
        WHEN v_challenge.item_type = 'treasure' AND v_restore_token
          THEN 'The box and all unopened contents were restored after 48 hours.'
        WHEN v_challenge.item_type = 'treasure'
          THEN 'All unopened contents were restored after 48 hours.'
        WHEN v_restore_token
          THEN 'The unused Mine was restored after 48 hours.'
        ELSE 'The remaining Mine placement closed after 48 hours.'
      END,
      'store',
      jsonb_build_object(
        'hidden_challenge_id', v_challenge.id,
        'expired', true,
        'replacement_token_id', v_replacement_token_id,
        'unresolved_claim_count', v_unresolved_count,
        'refunded_denarii', v_refund_denarii,
        'refunded_relic_quantity', v_refund_relics,
        'refunded_freezer_quantity', v_refund_freezers
      )
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_hidden_challenges(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_hidden_challenges(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_hidden_item_inventory()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inventory jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.expire_hidden_challenges(v_user_id);

  SELECT jsonb_build_object(
    'treasure_boxes', count(*) FILTER (WHERE token.item_type = 'treasure' AND token.status = 'available'),
    'mines', count(*) FILTER (WHERE token.item_type = 'mine' AND token.status = 'available'),
    'wallet_denarii', (
      SELECT coalesce(sum(entry.amount), 0)::bigint
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = v_user_id
    )
  )
  INTO v_inventory
  FROM public.hidden_item_tokens token
  WHERE token.owner_id = v_user_id;

  RETURN v_inventory;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_hidden_challenge_claim(
  p_placement text,
  p_reference_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id uuid;
BEGIN
  PERFORM public.expire_hidden_challenges();

  SELECT claim.id
  INTO v_claim_id
  FROM public.hidden_challenge_claims claim
  JOIN public.hidden_challenges challenge ON challenge.id = claim.challenge_id
  WHERE claim.current_target_id = auth.uid()
    AND claim.status IN ('pending', 'opened')
    AND challenge.status = 'active'
    AND challenge.expires_at > clock_timestamp()
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

  RETURN v_claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_pending_hidden_verse_markers(
  p_narrative_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  claim_id uuid,
  reference_key text,
  item_type text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.expire_hidden_challenges();

  RETURN QUERY
  SELECT claim.id, claim.reference_key, challenge.item_type
  FROM public.hidden_challenge_claims claim
  JOIN public.hidden_challenges challenge ON challenge.id = claim.challenge_id
  WHERE claim.current_target_id = auth.uid()
    AND claim.placement = 'verse'
    AND claim.status IN ('pending', 'opened')
    AND challenge.status = 'active'
    AND challenge.expires_at > clock_timestamp()
    AND challenge.item_type = 'mine'
    AND claim.reference_key IS NOT NULL
    AND (
      coalesce(cardinality(p_narrative_ids), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM unnest(p_narrative_ids) narrative_id
        WHERE narrative_id::text = split_part(claim.reference_key, '|', 1)
      )
    )
  ORDER BY claim.created_at, claim.id;
END;
$$;

/* Keep direct-message claim IDs from bypassing the same expiry rule. */
ALTER FUNCTION public.open_hidden_challenge(uuid, uuid)
  RENAME TO open_hidden_challenge_before_expiry;

CREATE OR REPLACE FUNCTION public.open_hidden_challenge(
  p_claim_id uuid,
  p_open_nonce uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.expire_hidden_challenges();
  RETURN public.open_hidden_challenge_before_expiry(p_claim_id, p_open_nonce);
END;
$$;

REVOKE ALL ON FUNCTION public.open_hidden_challenge_before_expiry(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_hidden_challenge(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_hidden_challenge(uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_hidden_item_inventory()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_hidden_item_inventory()
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_pending_hidden_challenge_claim(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_hidden_challenge_claim(text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_pending_hidden_verse_markers(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_hidden_verse_markers(uuid[])
  TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-hidden-challenge-expiry')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'full-circle-hidden-challenge-expiry'
    );
    PERFORM cron.schedule(
      'full-circle-hidden-challenge-expiry',
      '*/5 * * * *',
      'SELECT public.expire_hidden_challenges();'
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;

SELECT public.expire_hidden_challenges();
