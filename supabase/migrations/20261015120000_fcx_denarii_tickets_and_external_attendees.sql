/* FCX seats are reserved only after an atomic Denarii debit or instructor confirmation. */

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
    'treasure_refund', 'mine_penalty', 'mine_reward',
    'player_number_purchase', 'fcx_ticket'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS fcx_ticket_one_debit_per_member_event
  ON public.denarii_ledger_entries (user_id, source_reference)
  WHERE source_type = 'fcx_ticket';

CREATE OR REPLACE FUNCTION public.add_fcx_external_attendee(
  p_event_id uuid,
  p_guest_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(p_guest_name), '');
  v_capacity integer;
  v_registration_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only the instructor can add FCX attendees.' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Enter an attendee name of at most 120 characters.';
  END IF;

  SELECT capacity INTO v_capacity
  FROM public.fcx_events
  WHERE id = p_event_id AND is_active = true
  FOR UPDATE;
  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'The active FCX event was not found.';
  END IF;

  SELECT id INTO v_registration_id
  FROM public.fcx_registrations
  WHERE event_id = p_event_id AND lower(btrim(guest_name)) = lower(v_name);
  IF v_registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'This attendee is already on the paid FCX list.';
  END IF;
  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = p_event_id) >= v_capacity THEN
    RAISE EXCEPTION 'All FCX spaces are already filled.';
  END IF;

  INSERT INTO public.fcx_registrations (event_id, guest_name, payment_source, added_by)
  VALUES (p_event_id, v_name, 'external', v_actor)
  RETURNING id INTO v_registration_id;
  RETURN v_registration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_fcx_external_attendee_photo(
  p_registration_id uuid,
  p_avatar_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url text := nullif(btrim(p_avatar_url), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can update FCX attendee photos.' USING ERRCODE = '42501';
  END IF;
  IF v_url IS NULL OR v_url !~* '^https://' THEN
    RAISE EXCEPTION 'The participant photo URL is invalid.';
  END IF;

  UPDATE public.fcx_registrations registration
  SET guest_avatar_url = v_url
  FROM public.fcx_events event
  WHERE registration.id = p_registration_id
    AND registration.event_id = event.id
    AND event.is_active = true
    AND registration.user_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This external attendee is no longer on the active FCX list.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_fcx_ticket(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_capacity integer;
  v_registration_id uuid;
  v_cost integer := 600000;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'Sign in before buying an FCX ticket.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_current_subscription_access(v_buyer) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.' USING ERRCODE = '42501';
  END IF;

  SELECT capacity INTO v_capacity
  FROM public.fcx_events
  WHERE id = p_event_id AND is_active = true
  FOR UPDATE;
  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'No active FCX ticket is available.';
  END IF;

  SELECT id INTO v_registration_id
  FROM public.fcx_registrations
  WHERE event_id = p_event_id AND user_id = v_buyer;
  IF v_registration_id IS NOT NULL THEN
    RETURN jsonb_build_object('registration_id', v_registration_id, 'already_registered', true, 'cost', 0);
  END IF;
  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = p_event_id) >= v_capacity THEN
    RAISE EXCEPTION 'All FCX spaces are already filled.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = v_buyer
      AND entry.source_type = 'fcx_ticket'
      AND entry.source_reference = p_event_id::text
  ) THEN
    RAISE EXCEPTION 'This FCX ticket was already purchased. Contact the instructor to restore your place.';
  END IF;

  INSERT INTO public.denarii_ledger_entries (
    user_id, amount, source_type, source_reference, description
  ) VALUES (
    v_buyer, -v_cost, 'fcx_ticket', p_event_id::text, 'FCX ticket'
  );

  INSERT INTO public.fcx_registrations (event_id, user_id, payment_source, added_by)
  VALUES (p_event_id, v_buyer, 'app', v_buyer)
  RETURNING id INTO v_registration_id;

  RETURN jsonb_build_object('registration_id', v_registration_id, 'already_registered', false, 'cost', v_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.add_fcx_external_attendee(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_fcx_external_attendee_photo(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_fcx_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_fcx_external_attendee(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_fcx_external_attendee_photo(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_fcx_ticket(uuid) TO authenticated, service_role;
