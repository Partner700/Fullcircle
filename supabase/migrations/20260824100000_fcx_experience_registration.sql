/* Full Circle Experience registration: one instructor-managed monthly event,
   a public paid-attendee roster, and a hard capacity limit. */

CREATE TABLE IF NOT EXISTS public.fcx_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Full Circle Experience (FCX)',
  event_month date NOT NULL,
  event_date date,
  capacity integer NOT NULL DEFAULT 30 CHECK (capacity BETWEEN 1 AND 100),
  ticket_price_xaf integer CHECK (ticket_price_xaf IS NULL OR ticket_price_xaf >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fcx_event_month_is_first_day CHECK (event_month = date_trunc('month', event_month)::date),
  CONSTRAINT fcx_event_date_matches_month CHECK (
    event_date IS NULL OR date_trunc('month', event_date)::date = event_month
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fcx_one_active_event_idx
  ON public.fcx_events (is_active)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.fcx_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.fcx_events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_name text,
  payment_source text NOT NULL DEFAULT 'external' CHECK (payment_source IN ('app', 'external')),
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fcx_registration_has_one_person CHECK (
    (user_id IS NOT NULL AND guest_name IS NULL)
    OR (user_id IS NULL AND NULLIF(btrim(guest_name), '') IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fcx_registration_event_user_idx
  ON public.fcx_registrations (event_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fcx_registration_event_guest_idx
  ON public.fcx_registrations (event_id, lower(btrim(guest_name)))
  WHERE guest_name IS NOT NULL;

ALTER TABLE public.fcx_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fcx_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fcx_events_read_authenticated ON public.fcx_events;
CREATE POLICY fcx_events_read_authenticated
  ON public.fcx_events FOR SELECT TO authenticated
  USING (is_active = true OR public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS fcx_registrations_read_authenticated ON public.fcx_registrations;
CREATE POLICY fcx_registrations_read_authenticated
  ON public.fcx_registrations FOR SELECT TO authenticated
  USING (
    public.is_instructor(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.fcx_events event
      WHERE event.id = event_id AND event.is_active = true
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.fcx_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fcx_registrations FROM anon, authenticated;

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
        'avatar_url', profile.avatar_url,
        'is_app_member', entry.user_id IS NOT NULL
      ) ORDER BY entry.created_at, COALESCE(profile.display_name, entry.guest_name)
    ) AS items
    FROM public.fcx_registrations entry
    LEFT JOIN public.profiles profile ON profile.id = entry.user_id
    WHERE entry.event_id = event.id
  ) registration ON true
  WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.save_fcx_experience(
  p_event_id uuid DEFAULT NULL,
  p_event_month date DEFAULT NULL,
  p_event_date date DEFAULT NULL,
  p_title text DEFAULT 'Full Circle Experience (FCX)',
  p_capacity integer DEFAULT 30,
  p_ticket_price_xaf integer DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_event_month date := date_trunc(
    'month',
    COALESCE(p_event_month, timezone('Africa/Douala', now())::date)
  )::date;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_instructor(v_user_id) THEN
    RAISE EXCEPTION 'Only the instructor can manage FCX.' USING ERRCODE = '42501';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100 THEN
    RAISE EXCEPTION 'FCX capacity must be between 1 and 100.';
  END IF;
  IF p_ticket_price_xaf IS NOT NULL AND p_ticket_price_xaf < 0 THEN
    RAISE EXCEPTION 'Ticket price cannot be negative.';
  END IF;

  IF p_is_active THEN
    UPDATE public.fcx_events SET is_active = false, updated_at = now(), updated_by = v_user_id
    WHERE is_active = true AND (p_event_id IS NULL OR id <> p_event_id);
  END IF;

  IF p_event_id IS NULL THEN
    INSERT INTO public.fcx_events(
      title, event_month, event_date, capacity, ticket_price_xaf,
      is_active, created_by, updated_by
    ) VALUES (
      COALESCE(NULLIF(btrim(p_title), ''), 'Full Circle Experience (FCX)'),
      v_event_month, p_event_date, p_capacity, p_ticket_price_xaf,
      p_is_active, v_user_id, v_user_id
    ) RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.fcx_events
    SET title = COALESCE(NULLIF(btrim(p_title), ''), 'Full Circle Experience (FCX)'),
        event_month = v_event_month,
        event_date = p_event_date,
        capacity = p_capacity,
        ticket_price_xaf = p_ticket_price_xaf,
        is_active = p_is_active,
        updated_by = v_user_id,
        updated_at = now()
    WHERE id = p_event_id
    RETURNING id INTO v_event_id;
    IF v_event_id IS NULL THEN RAISE EXCEPTION 'FCX event was not found.'; END IF;
    IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = v_event_id) > p_capacity THEN
      RAISE EXCEPTION 'Capacity cannot be below the current registration count.';
    END IF;
  END IF;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_fcx_registration(
  p_event_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_payment_source text DEFAULT 'external'
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
    SET payment_source = p_payment_source, added_by = v_actor
    WHERE id = v_registration_id;
    RETURN v_registration_id;
  END IF;

  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = p_event_id) >= v_capacity THEN
    RAISE EXCEPTION 'All FCX spaces are already filled.';
  END IF;

  INSERT INTO public.fcx_registrations(event_id, user_id, guest_name, payment_source, added_by)
  VALUES (p_event_id, p_user_id, v_guest_name, p_payment_source, v_actor)
  RETURNING id INTO v_registration_id;
  RETURN v_registration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_fcx_registration(p_registration_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can remove FCX registrations.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.fcx_registrations WHERE id = p_registration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_fcx_experience() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_fcx_experience(uuid, date, date, text, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_fcx_registration(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_fcx_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_fcx_experience() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_fcx_experience(uuid, date, date, text, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_fcx_registration(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_fcx_registration(uuid) TO authenticated, service_role;

INSERT INTO public.fcx_events(title, event_month, capacity, is_active)
SELECT
  'Full Circle Experience (FCX)',
  date_trunc('month', timezone('Africa/Douala', now())::date)::date,
  30,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.fcx_events WHERE is_active = true);
