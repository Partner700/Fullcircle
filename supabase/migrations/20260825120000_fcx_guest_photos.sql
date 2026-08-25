/* Let the instructor attach a cropped photo to an external FCX attendee. */

ALTER TABLE public.fcx_registrations
  ADD COLUMN IF NOT EXISTS guest_avatar_url text;

CREATE OR REPLACE FUNCTION public.get_active_fcx_experience()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN event.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', event.id,
    'title', event.title,
    'event_month', event.event_month,
    'event_date', event.event_date,
    'capacity', event.capacity,
    'ticket_price_xaf', event.ticket_price_xaf,
    'is_active', event.is_active,
    'registrations', COALESCE(registration.items, '[]'::jsonb)
  ) END
  FROM (
    SELECT active_event.*
    FROM public.fcx_events active_event
    WHERE active_event.is_active = true
    ORDER BY active_event.event_month DESC, active_event.created_at DESC
    LIMIT 1
  ) event
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', entry.id,
        'event_id', entry.event_id,
        'user_id', entry.user_id,
        'guest_name', entry.guest_name,
        'payment_source', entry.payment_source,
        'created_at', entry.created_at,
        'display_name', COALESCE(profile.display_name, entry.guest_name),
        'avatar_url', COALESCE(profile.avatar_url, entry.guest_avatar_url),
        'is_app_member', entry.user_id IS NOT NULL
      ) ORDER BY entry.created_at, COALESCE(profile.display_name, entry.guest_name)
    ) AS items
    FROM public.fcx_registrations entry
    LEFT JOIN public.profiles profile ON profile.id = entry.user_id
    WHERE entry.event_id = event.id
  ) registration ON true
  WHERE auth.uid() IS NOT NULL;
$$;

DROP FUNCTION IF EXISTS public.add_fcx_registration(uuid, uuid, text, text);

CREATE FUNCTION public.add_fcx_registration(
  p_event_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_payment_source text DEFAULT 'external',
  p_guest_avatar_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_capacity integer;
  v_registration_id uuid;
  v_guest_name text := NULLIF(btrim(p_guest_name), '');
  v_guest_avatar_url text := NULLIF(btrim(p_guest_avatar_url), '');
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only the instructor can add FCX registrations.' USING ERRCODE = '42501';
  END IF;
  IF (p_user_id IS NULL) = (v_guest_name IS NULL) THEN
    RAISE EXCEPTION 'Choose one app member or enter one external guest.';
  END IF;
  IF p_payment_source NOT IN ('app', 'external') THEN
    RAISE EXCEPTION 'Payment source must be app or external.';
  END IF;
  IF p_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That app member was not found.';
  END IF;
  IF v_guest_avatar_url IS NOT NULL AND v_guest_avatar_url !~* '^https?://' THEN
    RAISE EXCEPTION 'The participant photo URL is invalid.';
  END IF;
  IF p_user_id IS NOT NULL THEN
    v_guest_avatar_url := NULL;
  END IF;

  SELECT capacity INTO v_capacity FROM public.fcx_events
  WHERE id = p_event_id AND is_active = true
  FOR UPDATE;
  IF v_capacity IS NULL THEN RAISE EXCEPTION 'The active FCX event was not found.'; END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_registration_id FROM public.fcx_registrations
    WHERE event_id = p_event_id AND user_id = p_user_id;
  ELSE
    SELECT id INTO v_registration_id FROM public.fcx_registrations
    WHERE event_id = p_event_id AND lower(btrim(guest_name)) = lower(v_guest_name);
  END IF;

  IF v_registration_id IS NOT NULL THEN
    UPDATE public.fcx_registrations
    SET payment_source = p_payment_source,
        guest_avatar_url = CASE
          WHEN user_id IS NULL THEN COALESCE(v_guest_avatar_url, guest_avatar_url)
          ELSE NULL
        END,
        added_by = v_actor
    WHERE id = v_registration_id;
    RETURN v_registration_id;
  END IF;

  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = p_event_id) >= v_capacity THEN
    RAISE EXCEPTION 'All FCX spaces are already filled.';
  END IF;

  INSERT INTO public.fcx_registrations(
    event_id, user_id, guest_name, guest_avatar_url, payment_source, added_by
  ) VALUES (
    p_event_id, p_user_id, v_guest_name, v_guest_avatar_url, p_payment_source, v_actor
  )
  RETURNING id INTO v_registration_id;
  RETURN v_registration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_fcx_registration(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_fcx_registration(uuid, uuid, text, text, text) TO authenticated, service_role;
