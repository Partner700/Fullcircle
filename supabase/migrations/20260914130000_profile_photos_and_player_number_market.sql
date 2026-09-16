/*
  Reliable profile photos and the Resident / Player Number market.

  Avatar storage and profile updates are repaired independently so a file
  cannot upload successfully without its URL being attached to the owner.
  Number bids are escrowed and every transfer is settled atomically while
  enforcing one number per account and a 48-hour change interval.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  26214400,
  NULL
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), EXCLUDED.file_size_limit),
    allowed_mime_types = NULL;

DROP POLICY IF EXISTS "avatar_read_all" ON storage.objects;
CREATE POLICY "avatar_read_all" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_upload_own" ON storage.objects;
CREATE POLICY "avatar_upload_own" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatar_update_own" ON storage.objects;
CREATE POLICY "avatar_update_own" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatar_delete_own" ON storage.objects;
CREATE POLICY "avatar_delete_own" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE OR REPLACE FUNCTION public.save_own_avatar(p_avatar_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_url text := btrim(coalesce(p_avatar_url, ''));
  v_object_path text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF v_url = '' OR v_url !~* '^https?://' THEN
    RAISE EXCEPTION 'The uploaded profile photo URL is invalid.';
  END IF;

  v_object_path := split_part(split_part(v_url, '/storage/v1/object/public/avatars/', 2), '?', 1);
  IF v_object_path = '' OR split_part(v_object_path, '/', 1) <> v_user_id::text THEN
    RAISE EXCEPTION 'A profile can only use a photo uploaded by its owner.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET avatar_url = v_url
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;
  RETURN v_url;
END;
$$;

REVOKE ALL ON FUNCTION public.save_own_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_own_avatar(text) TO authenticated, service_role;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS player_number_changed_at timestamptz;

/* Existing assignments predate trading, so they begin eligible to trade. */
UPDATE public.profiles
SET player_number_changed_at = least(
  coalesce(player_number_assigned_at, now() - interval '48 hours'),
  now() - interval '48 hours'
)
WHERE player_number IS NOT NULL
  AND player_number_changed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.player_number_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_number integer NOT NULL CHECK (player_number BETWEEN 1 AND 999),
  asking_price integer NOT NULL CHECK (asking_price BETWEEN 1 AND 100000000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  accepted_bid_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS player_number_listings_active_seller_uidx
  ON public.player_number_listings(seller_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS player_number_listings_active_number_uidx
  ON public.player_number_listings(player_number)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS player_number_listings_active_created_idx
  ON public.player_number_listings(created_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS profiles_player_number_grace_release_idx
  ON public.profiles(player_number_grace_until)
  WHERE player_number IS NOT NULL AND player_number_grace_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.player_number_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.player_number_listings(id) ON DELETE CASCADE,
  bidder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'accepted', 'refunded', 'withdrawn', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (listing_id, bidder_id)
);

ALTER TABLE public.player_number_listings
  DROP CONSTRAINT IF EXISTS player_number_listings_accepted_bid_fk;
ALTER TABLE public.player_number_listings
  ADD CONSTRAINT player_number_listings_accepted_bid_fk
  FOREIGN KEY (accepted_bid_id) REFERENCES public.player_number_bids(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS player_number_bids_listing_active_idx
  ON public.player_number_bids(listing_id, amount DESC, created_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS player_number_bids_bidder_active_idx
  ON public.player_number_bids(bidder_id, created_at DESC)
  WHERE status = 'active';

ALTER TABLE public.player_number_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_number_bids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_number_listings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.player_number_bids FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.refund_player_number_bid(
  p_bid_id uuid,
  p_status text DEFAULT 'refunded'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_bid public.player_number_bids%ROWTYPE;
  v_bidder_id uuid;
BEGIN
  SELECT bid.bidder_id INTO v_bidder_id
  FROM public.player_number_bids bid
  WHERE bid.id = p_bid_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_bidder_id::text, 0));
  SELECT * INTO v_bid
  FROM public.player_number_bids bid
  WHERE bid.id = p_bid_id
  FOR UPDATE;

  IF NOT FOUND OR v_bid.status <> 'active' THEN
    RETURN 0;
  END IF;
  IF p_status NOT IN ('refunded', 'withdrawn', 'rejected') THEN
    RAISE EXCEPTION 'Invalid bid refund status.';
  END IF;

  INSERT INTO public.denarii_ledger_entries(
    user_id, amount, source_type, source_reference, description
  ) VALUES (
    v_bid.bidder_id,
    v_bid.amount,
    'player_number_purchase',
    'player-number-bid-refund:' || v_bid.id::text || ':' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text,
    'Player number bid returned'
  );

  UPDATE public.player_number_bids
  SET status = p_status,
      resolved_at = now(),
      updated_at = now()
  WHERE id = v_bid.id;
  RETURN v_bid.amount;
END;
$$;

REVOKE ALL ON FUNCTION private.refund_player_number_bid(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.close_player_number_listing(
  p_listing_id uuid,
  p_status text DEFAULT 'cancelled'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_bid record;
  v_refunded integer := 0;
BEGIN
  IF p_status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'Invalid listing close status.';
  END IF;

  PERFORM 1
  FROM public.player_number_listings listing
  WHERE listing.id = p_listing_id
    AND listing.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_bid IN
    SELECT bid.id
    FROM public.player_number_bids bid
    WHERE bid.listing_id = p_listing_id
      AND bid.status = 'active'
    ORDER BY bid.created_at
  LOOP
    v_refunded := v_refunded + private.refund_player_number_bid(v_bid.id, 'refunded');
  END LOOP;

  UPDATE public.player_number_listings
  SET status = p_status,
      updated_at = now(),
      closed_at = now()
  WHERE id = p_listing_id;
  RETURN v_refunded;
END;
$$;

REVOKE ALL ON FUNCTION private.close_player_number_listing(uuid, text) FROM PUBLIC, anon, authenticated;

/* Expiry now also closes a listing and returns every outstanding bid before
   the number is released. */
CREATE OR REPLACE FUNCTION private.release_expired_player_numbers(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_profile record;
  v_listing record;
  v_released integer := 0;
BEGIN
  FOR v_profile IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE profile.player_number IS NOT NULL
      AND profile.player_number_grace_until IS NOT NULL
      AND profile.player_number_grace_until <= now()
      AND NOT public.has_current_subscription_access(profile.id)
      AND (p_user_id IS NULL OR profile.id = p_user_id)
    ORDER BY profile.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-user:' || v_profile.id::text, 0));
  END LOOP;

  FOR v_profile IN
    SELECT profile.id, profile.player_number, profile.player_number_source,
           profile.player_number_grace_until
    FROM public.profiles profile
    WHERE profile.player_number IS NOT NULL
      AND profile.player_number_grace_until IS NOT NULL
      AND profile.player_number_grace_until <= now()
      AND NOT public.has_current_subscription_access(profile.id)
      AND (p_user_id IS NULL OR profile.id = p_user_id)
    ORDER BY profile.id
    FOR UPDATE SKIP LOCKED
  LOOP
    FOR v_listing IN
      SELECT listing.id
      FROM public.player_number_listings listing
      WHERE listing.seller_id = v_profile.id
        AND listing.status = 'active'
      FOR UPDATE
    LOOP
      PERFORM private.close_player_number_listing(v_listing.id, 'expired');
    END LOOP;

    INSERT INTO public.player_number_history(
      user_id, player_number, action, source, details
    ) VALUES (
      v_profile.id,
      v_profile.player_number,
      'released',
      'subscription_lapse',
      jsonb_build_object('grace_until', v_profile.player_number_grace_until)
    );

    UPDATE public.profiles
    SET player_number = NULL,
        player_number_assigned_at = NULL,
        player_number_assigned_by = NULL,
        player_number_source = NULL,
        player_number_grace_until = NULL,
        player_number_changed_at = NULL
    WHERE id = v_profile.id;
    v_released := v_released + 1;
  END LOOP;
  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION private.release_expired_player_numbers(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_player_number_options()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM private.release_expired_player_numbers();

  SELECT jsonb_build_object(
    'current_number', profile.player_number,
    'assigned_at', profile.player_number_assigned_at,
    'changed_at', profile.player_number_changed_at,
    'next_change_at', CASE
      WHEN profile.player_number_changed_at IS NULL THEN NULL
      ELSE profile.player_number_changed_at + interval '48 hours'
    END,
    'can_change', profile.player_number_changed_at IS NULL
      OR profile.player_number_changed_at <= now() - interval '48 hours',
    'grace_until', profile.player_number_grace_until,
    'wallet_denarii', coalesce(public.get_user_denarii_total(v_user_id), 0),
    'options', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'player_number', catalog.player_number,
        'denarii_price', catalog.denarii_price
      ) ORDER BY catalog.player_number)
      FROM public.player_number_catalog catalog
      WHERE catalog.is_enabled = true
        AND NOT EXISTS (
          SELECT 1 FROM public.profiles owner
          WHERE owner.player_number = catalog.player_number
        )
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_player_number_marketplace()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_listings jsonb;
  v_own_bids jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM private.release_expired_player_numbers();

  SELECT coalesce(jsonb_agg(item.payload ORDER BY item.created_at DESC), '[]'::jsonb)
  INTO v_listings
  FROM (
    SELECT listing.created_at,
      jsonb_build_object(
        'id', listing.id,
        'seller_id', listing.seller_id,
        'seller_name', seller.display_name,
        'seller_avatar_url', seller.avatar_url,
        'player_number', listing.player_number,
        'asking_price', listing.asking_price,
        'created_at', listing.created_at,
        'highest_bid', coalesce((
          SELECT max(bid.amount)
          FROM public.player_number_bids bid
          WHERE bid.listing_id = listing.id AND bid.status = 'active'
        ), 0),
        'my_bid', (
          SELECT jsonb_build_object(
            'id', bid.id,
            'amount', bid.amount,
            'status', bid.status,
            'created_at', bid.created_at,
            'updated_at', bid.updated_at
          )
          FROM public.player_number_bids bid
          WHERE bid.listing_id = listing.id
            AND bid.bidder_id = v_user_id
            AND bid.status = 'active'
          LIMIT 1
        ),
        'bids', CASE WHEN listing.seller_id = v_user_id THEN coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', bid.id,
            'bidder_id', bid.bidder_id,
            'bidder_name', bidder.display_name,
            'bidder_avatar_url', bidder.avatar_url,
            'amount', bid.amount,
            'can_change', bidder.player_number_changed_at IS NULL
              OR bidder.player_number_changed_at <= now() - interval '48 hours',
            'next_change_at', CASE
              WHEN bidder.player_number_changed_at IS NULL THEN NULL
              ELSE bidder.player_number_changed_at + interval '48 hours'
            END,
            'status', bid.status,
            'created_at', bid.created_at,
            'updated_at', bid.updated_at
          ) ORDER BY bid.amount DESC, bid.created_at)
          FROM public.player_number_bids bid
          JOIN public.profiles bidder ON bidder.id = bid.bidder_id
          WHERE bid.listing_id = listing.id
            AND bid.status = 'active'
        ), '[]'::jsonb) ELSE '[]'::jsonb END
      ) AS payload
    FROM public.player_number_listings listing
    JOIN public.profiles seller ON seller.id = listing.seller_id
    WHERE listing.status = 'active'
      AND seller.player_number = listing.player_number
  ) item;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', bid.id,
    'listing_id', bid.listing_id,
    'player_number', listing.player_number,
    'seller_id', listing.seller_id,
    'seller_name', seller.display_name,
    'amount', bid.amount,
    'asking_price', listing.asking_price,
    'created_at', bid.created_at,
    'updated_at', bid.updated_at
  ) ORDER BY bid.updated_at DESC), '[]'::jsonb)
  INTO v_own_bids
  FROM public.player_number_bids bid
  JOIN public.player_number_listings listing ON listing.id = bid.listing_id
  JOIN public.profiles seller ON seller.id = listing.seller_id
  WHERE bid.bidder_id = v_user_id
    AND bid.status = 'active'
    AND listing.status = 'active';

  RETURN jsonb_build_object(
    'listings', coalesce(v_listings, '[]'::jsonb),
    'own_bids', coalesce(v_own_bids, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_player_number(p_player_number integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_price integer;
  v_balance bigint;
  v_deadline timestamptz;
  v_previous integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT public.is_instructor(v_user_id) AND NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Subscribe before choosing a player number.';
  END IF;
  IF p_player_number IS NULL OR p_player_number NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION 'Choose a player number from #001 to #999.';
  END IF;

  PERFORM private.release_expired_player_numbers(v_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-user:' || v_user_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number:' || p_player_number::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_user_id::text, 0));

  SELECT * INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF v_profile.player_number = p_player_number THEN
    RETURN jsonb_build_object('player_number', p_player_number, 'denarii_charged', 0, 'grace_until', v_profile.player_number_grace_until);
  END IF;
  IF v_profile.player_number_changed_at IS NOT NULL
     AND v_profile.player_number_changed_at > now() - interval '48 hours' THEN
    RAISE EXCEPTION 'A player number can only be changed once every 48 hours. Try again after %.',
      to_char(v_profile.player_number_changed_at + interval '48 hours', 'DD Mon YYYY HH24:MI');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.player_number_listings listing
    WHERE listing.seller_id = v_user_id AND listing.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cancel your active number listing before choosing another number.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.player_number_bids bid
    WHERE bid.bidder_id = v_user_id AND bid.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Withdraw your active number bids before choosing another number.';
  END IF;

  SELECT catalog.denarii_price INTO v_price
  FROM public.player_number_catalog catalog
  WHERE catalog.player_number = p_player_number
    AND catalog.is_enabled = true
  FOR UPDATE;
  IF v_price IS NULL THEN RAISE EXCEPTION 'That player number is unavailable.'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles owner WHERE owner.player_number = p_player_number) THEN
    RAISE EXCEPTION 'Player number #% has already been taken.', lpad(p_player_number::text, 3, '0');
  END IF;

  v_balance := coalesce(public.get_user_denarii_total(v_user_id), 0);
  IF v_balance < v_price THEN
    RAISE EXCEPTION 'You need % Denarii for #% but currently have %.', v_price, lpad(p_player_number::text, 3, '0'), v_balance;
  END IF;

  IF v_price > 0 THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (
      v_user_id, -v_price, 'player_number_purchase',
      'player-number-' || lpad(p_player_number::text, 3, '0') || '-' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text,
      'Reserved Resident / Player Number #' || lpad(p_player_number::text, 3, '0')
    );
  END IF;

  v_previous := v_profile.player_number;
  IF v_previous IS NOT NULL THEN
    INSERT INTO public.player_number_history(user_id, player_number, action, source, actor_id, details)
    VALUES (
      v_user_id, v_previous, 'released', 'self_change', v_user_id,
      jsonb_build_object('replacement_number', p_player_number)
    );
  END IF;

  v_deadline := private.player_number_grace_deadline(v_user_id);
  UPDATE public.profiles
  SET player_number = p_player_number,
      player_number_assigned_at = now(),
      player_number_assigned_by = v_user_id,
      player_number_source = 'self_claim',
      player_number_grace_until = v_deadline,
      player_number_changed_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.player_number_history(user_id, player_number, action, source, denarii_price, actor_id, details)
  VALUES (
    v_user_id, p_player_number, 'assigned', 'self_claim', v_price, v_user_id,
    jsonb_build_object('previous_number', v_previous)
  );

  RETURN jsonb_build_object(
    'player_number', p_player_number,
    'previous_number', v_previous,
    'denarii_charged', v_price,
    'grace_until', v_deadline,
    'next_change_at', now() + interval '48 hours'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_player_number(p_asking_price integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_listing_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT public.is_instructor(v_user_id) AND NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Subscribe before trading a player number.';
  END IF;
  IF p_asking_price IS NULL OR p_asking_price NOT BETWEEN 1 AND 100000000 THEN
    RAISE EXCEPTION 'Enter an asking price from 1 to 100,000,000 Denarii.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-user:' || v_user_id::text, 0));
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.player_number IS NULL THEN
    RAISE EXCEPTION 'Choose a player number before listing one for sale.';
  END IF;
  SELECT listing.id INTO v_listing_id
  FROM public.player_number_listings listing
  WHERE listing.seller_id = v_user_id AND listing.status = 'active'
  FOR UPDATE;

  IF v_listing_id IS NULL THEN
    INSERT INTO public.player_number_listings(seller_id, player_number, asking_price)
    VALUES (v_user_id, v_profile.player_number, p_asking_price)
    RETURNING id INTO v_listing_id;
  ELSE
    UPDATE public.player_number_listings
    SET asking_price = p_asking_price,
        updated_at = now()
    WHERE id = v_listing_id
      AND player_number = v_profile.player_number;
    IF NOT FOUND THEN RAISE EXCEPTION 'Your saved listing no longer matches your player number.'; END IF;
  END IF;

  RETURN jsonb_build_object('listing_id', v_listing_id, 'player_number', v_profile.player_number, 'asking_price', p_asking_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.place_player_number_bid(p_listing_id uuid, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_listing public.player_number_listings%ROWTYPE;
  v_bid public.player_number_bids%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_available bigint;
  v_bid_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT public.is_instructor(v_user_id) AND NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Subscribe before bidding for a player number.';
  END IF;
  IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 100000000 THEN
    RAISE EXCEPTION 'Enter a bid from 1 to 100,000,000 Denarii.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-listing:' || p_listing_id::text, 0));
  SELECT * INTO v_listing
  FROM public.player_number_listings listing
  WHERE listing.id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND OR v_listing.status <> 'active' THEN RAISE EXCEPTION 'That number is no longer available for bids.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_user_id::text, 0));
  IF v_listing.seller_id = v_user_id THEN RAISE EXCEPTION 'You cannot bid on your own player number.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles seller
    WHERE seller.id = v_listing.seller_id AND seller.player_number = v_listing.player_number
  ) THEN
    RAISE EXCEPTION 'That number listing is no longer valid.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.player_number_listings listing
    WHERE listing.seller_id = v_user_id AND listing.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cancel your own number listing before bidding for another.';
  END IF;

  SELECT * INTO v_bid
  FROM public.player_number_bids bid
  WHERE bid.listing_id = p_listing_id AND bid.bidder_id = v_user_id
  FOR UPDATE;

  v_available := coalesce(public.get_user_denarii_total(v_user_id), 0)
    + CASE WHEN FOUND AND v_bid.status = 'active' THEN v_bid.amount ELSE 0 END;
  IF v_available < p_amount THEN
    RAISE EXCEPTION 'You need % more Denarii for that bid.', p_amount - v_available;
  END IF;

  IF v_bid.id IS NULL THEN
    INSERT INTO public.player_number_bids(listing_id, bidder_id, amount)
    VALUES (p_listing_id, v_user_id, p_amount)
    RETURNING id INTO v_bid_id;
  ELSE
    v_bid_id := v_bid.id;
    IF v_bid.status = 'active' THEN
      PERFORM private.refund_player_number_bid(v_bid.id, 'refunded');
    END IF;
    UPDATE public.player_number_bids
    SET amount = p_amount,
        status = 'active',
        updated_at = now(),
        resolved_at = NULL
    WHERE id = v_bid.id;
  END IF;

  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
  VALUES (
    v_user_id, -p_amount, 'player_number_purchase',
    'player-number-bid-escrow:' || v_bid_id::text || ':' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text,
    'Bid held for Player Number #' || lpad(v_listing.player_number::text, 3, '0')
  );

  PERFORM public.notify_user(
    v_listing.seller_id,
    v_user_id,
    'player_number',
    'New player number bid',
    coalesce(v_profile.display_name, 'A Full Circle member') || ' offered ' || p_amount || ' Denarii for #' || lpad(v_listing.player_number::text, 3, '0') || '.',
    'subscription',
    jsonb_build_object('player_number', v_listing.player_number, 'listing_id', v_listing.id, 'bid_id', v_bid_id)
  );

  RETURN jsonb_build_object('bid_id', v_bid_id, 'listing_id', p_listing_id, 'amount', p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_player_number_bid(p_bid_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.player_number_bids bid
  WHERE bid.id = p_bid_id AND bid.bidder_id = v_user_id AND bid.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'That active bid was not found.'; END IF;
  RETURN private.refund_player_number_bid(p_bid_id, 'withdrawn');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_player_number_listing(p_listing_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.player_number_listings listing
  WHERE listing.id = p_listing_id AND listing.seller_id = v_user_id AND listing.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That active listing was not found.'; END IF;
  RETURN private.close_player_number_listing(p_listing_id, 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_player_number_bid(p_bid_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bid public.player_number_bids%ROWTYPE;
  v_listing public.player_number_listings%ROWTYPE;
  v_seller public.profiles%ROWTYPE;
  v_buyer public.profiles%ROWTYPE;
  v_other_bid record;
  v_buyer_previous integer;
  v_deadline timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_bid FROM public.player_number_bids bid WHERE bid.id = p_bid_id;
  IF NOT FOUND OR v_bid.status <> 'active' THEN RAISE EXCEPTION 'That bid is no longer active.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-user:' || least(v_user_id::text, v_bid.bidder_id::text), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-user:' || greatest(v_user_id::text, v_bid.bidder_id::text), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-bid:' || p_bid_id::text, 0));
  SELECT * INTO v_listing FROM public.player_number_listings listing WHERE listing.id = v_bid.listing_id FOR UPDATE;
  IF NOT FOUND OR v_listing.status <> 'active' THEN RAISE EXCEPTION 'That listing is no longer active.'; END IF;
  SELECT * INTO v_bid FROM public.player_number_bids bid WHERE bid.id = p_bid_id FOR UPDATE;
  IF NOT FOUND OR v_bid.status <> 'active' THEN RAISE EXCEPTION 'That bid is no longer active.'; END IF;
  IF v_listing.seller_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the number owner can accept a bid.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number:' || v_listing.player_number::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_user_id::text, 0));

  SELECT * INTO v_seller FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT * INTO v_buyer FROM public.profiles WHERE id = v_bid.bidder_id FOR UPDATE;
  IF v_seller.player_number IS DISTINCT FROM v_listing.player_number THEN
    RAISE EXCEPTION 'You no longer own the listed player number.';
  END IF;
  IF NOT public.is_instructor(v_user_id) AND NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Renew before completing this number sale.';
  END IF;
  IF NOT public.is_instructor(v_buyer.id) AND NOT public.has_current_subscription_access(v_buyer.id) THEN
    RAISE EXCEPTION 'The selected bidder needs an active subscription before receiving the number.';
  END IF;
  IF v_seller.player_number_changed_at IS NOT NULL
     AND v_seller.player_number_changed_at > now() - interval '48 hours' THEN
    RAISE EXCEPTION 'Your 48-hour number-change period has not finished.';
  END IF;
  IF v_buyer.player_number_changed_at IS NOT NULL
     AND v_buyer.player_number_changed_at > now() - interval '48 hours' THEN
    RAISE EXCEPTION 'That bidder is still inside their 48-hour number-change period.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.player_number_listings listing
    WHERE listing.seller_id = v_buyer.id AND listing.status = 'active'
  ) THEN
    RAISE EXCEPTION 'That bidder must cancel their own number listing first.';
  END IF;

  v_buyer_previous := v_buyer.player_number;
  IF v_buyer_previous IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number:' || v_buyer_previous::text, 0));
    INSERT INTO public.player_number_history(user_id, player_number, action, source, actor_id, details)
    VALUES (
      v_buyer.id, v_buyer_previous, 'released', 'marketplace_swap', v_buyer.id,
      jsonb_build_object('replacement_number', v_listing.player_number, 'listing_id', v_listing.id)
    );
  END IF;

  INSERT INTO public.player_number_history(user_id, player_number, action, source, denarii_price, actor_id, details)
  VALUES (
    v_seller.id, v_listing.player_number, 'released', 'marketplace_sale', v_bid.amount, v_buyer.id,
    jsonb_build_object('listing_id', v_listing.id, 'bid_id', v_bid.id)
  );

  UPDATE public.profiles
  SET player_number = NULL,
      player_number_assigned_at = NULL,
      player_number_assigned_by = NULL,
      player_number_source = NULL,
      player_number_grace_until = NULL,
      player_number_changed_at = now()
  WHERE id = v_seller.id;

  v_deadline := private.player_number_grace_deadline(v_buyer.id);
  UPDATE public.profiles
  SET player_number = v_listing.player_number,
      player_number_assigned_at = now(),
      player_number_assigned_by = v_seller.id,
      player_number_source = 'self_claim',
      player_number_grace_until = v_deadline,
      player_number_changed_at = now()
  WHERE id = v_buyer.id;

  INSERT INTO public.player_number_history(user_id, player_number, action, source, denarii_price, actor_id, details)
  VALUES (
    v_buyer.id, v_listing.player_number, 'assigned', 'marketplace_purchase', v_bid.amount, v_seller.id,
    jsonb_build_object('previous_number', v_buyer_previous, 'listing_id', v_listing.id, 'bid_id', v_bid.id)
  );

  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
  VALUES (
    v_seller.id, v_bid.amount, 'player_number_purchase',
    'player-number-sale:' || v_bid.id::text,
    'Sold Player Number #' || lpad(v_listing.player_number::text, 3, '0')
  );

  UPDATE public.player_number_bids
  SET status = 'accepted', resolved_at = now(), updated_at = now()
  WHERE id = v_bid.id;
  UPDATE public.player_number_listings
  SET status = 'sold', accepted_bid_id = v_bid.id, closed_at = now(), updated_at = now()
  WHERE id = v_listing.id;

  FOR v_other_bid IN
    SELECT bid.id
    FROM public.player_number_bids bid
    WHERE bid.listing_id = v_listing.id
      AND bid.status = 'active'
      AND bid.id <> v_bid.id
  LOOP
    PERFORM private.refund_player_number_bid(v_other_bid.id, 'rejected');
  END LOOP;

  PERFORM public.notify_user(
    v_seller.id, v_buyer.id, 'player_number', 'Player number sold',
    coalesce(v_buyer.display_name, 'A member') || ' bought #' || lpad(v_listing.player_number::text, 3, '0') || ' for ' || v_bid.amount || ' Denarii.',
    'subscription', jsonb_build_object('player_number', v_listing.player_number, 'listing_id', v_listing.id)
  );
  PERFORM public.notify_user(
    v_buyer.id, v_seller.id, 'player_number', 'Your new player number',
    'You now own #' || lpad(v_listing.player_number::text, 3, '0') || '.',
    'subscription', jsonb_build_object('player_number', v_listing.player_number, 'listing_id', v_listing.id)
  );

  RETURN jsonb_build_object(
    'player_number', v_listing.player_number,
    'seller_id', v_seller.id,
    'buyer_id', v_buyer.id,
    'amount', v_bid.amount,
    'buyer_previous_number', v_buyer_previous,
    'next_change_at', now() + interval '48 hours'
  );
END;
$$;

/* Instructor assignment keeps its override behavior but records the same
   change clock so later self-service changes follow one rule. */
CREATE OR REPLACE FUNCTION public.assign_player_number(p_user_id uuid, p_player_number integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_deadline timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only the instructor can assign player numbers.' USING ERRCODE = '42501';
  END IF;
  IF p_player_number IS NULL OR p_player_number NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION 'Choose a player number from #001 to #999.';
  END IF;

  PERFORM private.release_expired_player_numbers();
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number-user:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number:' || p_player_number::text, 0));
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That app member was not found.'; END IF;
  IF v_profile.player_number = p_player_number THEN
    RETURN jsonb_build_object('player_number', p_player_number, 'grace_until', v_profile.player_number_grace_until);
  END IF;
  IF v_profile.player_number IS NOT NULL THEN
    RAISE EXCEPTION '% already owns player number #%.', v_profile.display_name, lpad(v_profile.player_number::text, 3, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles owner WHERE owner.player_number = p_player_number) THEN
    RAISE EXCEPTION 'Player number #% has already been taken.', lpad(p_player_number::text, 3, '0');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.player_number_catalog catalog
    WHERE catalog.player_number = p_player_number AND catalog.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'That player number is unavailable.';
  END IF;

  v_deadline := private.player_number_grace_deadline(p_user_id);
  UPDATE public.profiles
  SET player_number = p_player_number,
      player_number_assigned_at = now(),
      player_number_assigned_by = v_actor,
      player_number_source = 'instructor',
      player_number_grace_until = v_deadline,
      player_number_changed_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.player_number_history(user_id, player_number, action, source, actor_id)
  VALUES (p_user_id, p_player_number, 'assigned', 'instructor', v_actor);
  RETURN jsonb_build_object(
    'player_number', p_player_number,
    'grace_until', v_deadline,
    'next_change_at', now() + interval '48 hours'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_number_options() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_player_number_marketplace() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_player_number(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_player_number(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.place_player_number_bid(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_player_number_bid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_player_number_listing(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_player_number_bid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_player_number(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_player_number_options() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_player_number_marketplace() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_player_number(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_player_number(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_player_number_bid(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_player_number_bid(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_player_number_listing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_player_number_bid(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_player_number(uuid, integer) TO authenticated, service_role;
