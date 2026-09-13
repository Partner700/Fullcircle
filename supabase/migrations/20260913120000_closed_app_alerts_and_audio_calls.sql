/*
  Make closed-app alarms server-owned and add Full Circle audio calls.

  A single minute watchdog creates due Scripture alarms, retries Web Push,
  opens the weekday Morning Call, rings invitees without stacking notices,
  and expires stale work. Browser foreground polling remains a fallback only.
*/

CREATE TABLE public.audio_call_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('all', 'tent')),
  tent_id uuid REFERENCES public.tents(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 100),
  provider text NOT NULL DEFAULT 'jitsi' CHECK (provider = 'jitsi'),
  provider_room_name text NOT NULL UNIQUE,
  automatic boolean NOT NULL DEFAULT false,
  call_date date,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'expired')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tent') = (tent_id IS NOT NULL)),
  CHECK (expires_at > starts_at),
  CHECK ((automatic AND call_date IS NOT NULL) OR NOT automatic)
);

CREATE UNIQUE INDEX audio_call_one_automatic_morning_per_day
  ON public.audio_call_rooms(call_date)
  WHERE automatic AND scope = 'all';
CREATE INDEX audio_call_rooms_live_scope
  ON public.audio_call_rooms(scope, tent_id, expires_at DESC)
  WHERE status IN ('ringing', 'active');

CREATE TABLE public.audio_call_recipients (
  call_id uuid NOT NULL REFERENCES public.audio_call_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'joined', 'declined', 'left', 'missed')),
  notification_id uuid REFERENCES public.user_notifications(id) ON DELETE SET NULL,
  push_attempts integer NOT NULL DEFAULT 0 CHECK (push_attempts BETWEEN 0 AND 6),
  last_push_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, user_id)
);
CREATE INDEX audio_call_recipients_user_live
  ON public.audio_call_recipients(user_id, created_at DESC)
  WHERE status IN ('ringing', 'joined');

ALTER TABLE public.audio_call_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_call_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audio_call_rooms, public.audio_call_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audio_call_rooms, public.audio_call_recipients TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_audio_call(p_call_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_instructor(auth.uid())
    OR EXISTS (SELECT 1 FROM public.audio_call_rooms room WHERE room.id = p_call_id AND room.host_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.audio_call_recipients recipient WHERE recipient.call_id = p_call_id AND recipient.user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_audio_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_audio_call(uuid) TO authenticated;

CREATE POLICY read_relevant_audio_call_rooms ON public.audio_call_rooms
  FOR SELECT TO authenticated USING (public.can_access_audio_call(id));

CREATE POLICY read_relevant_audio_call_recipients ON public.audio_call_recipients
  FOR SELECT TO authenticated USING (public.can_access_audio_call(call_id));

CREATE OR REPLACE FUNCTION private.audio_call_payload(p_call_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT jsonb_build_object(
    'id', room.id,
    'scope', room.scope,
    'tent_id', room.tent_id,
    'title', room.title,
    'provider', room.provider,
    'provider_room_name', room.provider_room_name,
    'automatic', room.automatic,
    'status', room.status,
    'starts_at', room.starts_at,
    'expires_at', room.expires_at,
    'host_id', room.host_id,
    'host_name', host.display_name,
    'host_avatar_url', host.avatar_url,
    'recipient_status', recipient.status,
    'participant_count', (
      SELECT count(*) FROM public.audio_call_recipients participant
      WHERE participant.call_id = room.id AND participant.status = 'joined'
    ),
    'can_end', room.host_id = p_user_id OR public.is_instructor(p_user_id)
  )
  FROM public.audio_call_rooms room
  JOIN public.profiles host ON host.id = room.host_id
  JOIN public.audio_call_recipients recipient
    ON recipient.call_id = room.id AND recipient.user_id = p_user_id
  WHERE room.id = p_call_id;
$$;
REVOKE ALL ON FUNCTION private.audio_call_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.create_audio_call(
  p_host_id uuid,
  p_scope text,
  p_tent_id uuid,
  p_title text,
  p_automatic boolean,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_call_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_call_id uuid := gen_random_uuid();
  v_recipient record;
  v_notification_id uuid;
BEGIN
  INSERT INTO public.audio_call_rooms(
    id, scope, tent_id, host_id, title, provider_room_name,
    automatic, call_date, starts_at, expires_at
  ) VALUES (
    v_call_id, p_scope, p_tent_id, p_host_id, btrim(p_title),
    'FullCircle-' || replace(v_call_id::text, '-', ''),
    p_automatic, p_call_date, p_starts_at, p_expires_at
  );

  IF p_scope = 'all' THEN
    INSERT INTO public.audio_call_recipients(call_id, user_id, status, joined_at)
    SELECT v_call_id, profile.id,
      CASE WHEN profile.id = p_host_id AND NOT p_automatic THEN 'joined' ELSE 'ringing' END,
      CASE WHEN profile.id = p_host_id AND NOT p_automatic THEN now() END
    FROM public.profiles profile
    WHERE EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.status IN ('active', 'approved', 'promoted')
    );
  ELSE
    INSERT INTO public.audio_call_recipients(call_id, user_id, status, joined_at)
    SELECT v_call_id, eligible.user_id,
      CASE WHEN eligible.user_id = p_host_id THEN 'joined' ELSE 'ringing' END,
      CASE WHEN eligible.user_id = p_host_id THEN now() END
    FROM (
      SELECT member.user_id FROM public.tent_members member WHERE member.tent_id = p_tent_id
      UNION
      SELECT tent.sentry_id FROM public.tents tent WHERE tent.id = p_tent_id AND tent.sentry_id IS NOT NULL
    ) eligible
    WHERE EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      WHERE assignment.user_id = eligible.user_id
        AND assignment.status IN ('active', 'approved', 'promoted')
    ) OR eligible.user_id = p_host_id;
  END IF;

  INSERT INTO public.audio_call_recipients(call_id, user_id, status, joined_at)
  VALUES (
    v_call_id,
    p_host_id,
    CASE WHEN p_automatic THEN 'ringing' ELSE 'joined' END,
    CASE WHEN p_automatic THEN NULL ELSE now() END
  )
  ON CONFLICT (call_id, user_id) DO UPDATE
    SET status = CASE WHEN p_automatic THEN 'ringing' ELSE 'joined' END,
        joined_at = CASE WHEN p_automatic THEN NULL ELSE coalesce(public.audio_call_recipients.joined_at, now()) END,
        updated_at = now();

  FOR v_recipient IN
    SELECT recipient.user_id
    FROM public.audio_call_recipients recipient
    WHERE recipient.call_id = v_call_id
      AND (p_automatic OR recipient.user_id <> p_host_id)
  LOOP
    v_notification_id := public.notify_user(
      v_recipient.user_id,
      p_host_id,
      'audio_call',
      p_title,
      CASE WHEN p_scope = 'all'
        THEN 'Full Circle is calling. Tap to join the audio room.'
        ELSE 'Your tent is calling. Tap to join the audio room.'
      END,
      'call',
      jsonb_build_object(
        'call_id', v_call_id,
        'call_scope', p_scope,
        'tent_id', p_tent_id,
        'expires_at', p_expires_at
      )
    );
    UPDATE public.audio_call_recipients
    SET notification_id = v_notification_id,
        push_attempts = 1,
        last_push_at = now(),
        updated_at = now()
    WHERE call_id = v_call_id AND user_id = v_recipient.user_id;
  END LOOP;

  UPDATE public.audio_call_rooms SET status = 'active', updated_at = now() WHERE id = v_call_id;
  RETURN v_call_id;
END;
$$;
REVOKE ALL ON FUNCTION private.create_audio_call(uuid, text, uuid, text, boolean, timestamptz, timestamptz, date)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_audio_call(p_scope text DEFAULT NULL, p_tent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_scope text;
  v_tent_id uuid;
  v_existing uuid;
  v_call_id uuid;
  v_title text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  v_role := public.get_user_active_role(v_user_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'An active Full Circle role is required.'; END IF;
  v_scope := coalesce(nullif(lower(btrim(p_scope)), ''), CASE WHEN v_role = 'instructor' THEN 'all' ELSE 'tent' END);
  IF v_scope NOT IN ('all', 'tent') THEN RAISE EXCEPTION 'Choose an all-user or tent call.'; END IF;
  IF v_scope = 'all' AND NOT public.is_instructor(v_user_id) THEN
    RAISE EXCEPTION 'Only the instructor can ring everyone.';
  END IF;

  IF v_scope = 'tent' THEN
    v_tent_id := coalesce(
      p_tent_id,
      public.get_user_tent_id(v_user_id),
      (SELECT tent.id FROM public.tents tent WHERE tent.sentry_id = v_user_id LIMIT 1)
    );
    IF v_tent_id IS NULL THEN RAISE EXCEPTION 'Join a tent before starting a tent call.'; END IF;
    IF NOT public.is_instructor(v_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.tent_members member WHERE member.tent_id = v_tent_id AND member.user_id = v_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.tents tent WHERE tent.id = v_tent_id AND tent.sentry_id = v_user_id)
    THEN RAISE EXCEPTION 'You can only ring your own tent.'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('audio-call:' || v_scope || ':' || coalesce(v_tent_id::text, 'all'), 91312));
  SELECT room.id INTO v_existing
  FROM public.audio_call_rooms room
  WHERE room.scope = v_scope
    AND room.tent_id IS NOT DISTINCT FROM v_tent_id
    AND room.status IN ('ringing', 'active')
    AND room.expires_at > now()
  ORDER BY room.created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    INSERT INTO public.audio_call_recipients(call_id, user_id, status, joined_at)
    VALUES (v_existing, v_user_id, 'joined', now())
    ON CONFLICT (call_id, user_id) DO UPDATE
      SET status = 'joined', joined_at = coalesce(public.audio_call_recipients.joined_at, now()), left_at = NULL, updated_at = now();
    RETURN private.audio_call_payload(v_existing, v_user_id);
  END IF;

  v_title := CASE WHEN v_scope = 'all' THEN 'Full Circle Call' ELSE 'Tent Call' END;
  v_call_id := private.create_audio_call(
    v_user_id, v_scope, v_tent_id, v_title, false, now(), now() + interval '45 minutes', NULL
  );
  RETURN private.audio_call_payload(v_call_id, v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_active_audio_calls()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(jsonb_agg(private.audio_call_payload(room.id, auth.uid()) ORDER BY
    CASE recipient.status WHEN 'joined' THEN 0 ELSE 1 END, room.created_at DESC), '[]'::jsonb)
  FROM public.audio_call_rooms room
  JOIN public.audio_call_recipients recipient ON recipient.call_id = room.id AND recipient.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND room.status IN ('ringing', 'active')
    AND room.starts_at <= now()
    AND room.expires_at > now()
    AND recipient.status IN ('ringing', 'joined');
$$;

CREATE OR REPLACE FUNCTION public.answer_audio_call(p_call_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_room public.audio_call_rooms;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF v_action NOT IN ('join', 'decline', 'leave') THEN RAISE EXCEPTION 'Choose join, decline, or leave.'; END IF;
  SELECT * INTO v_room FROM public.audio_call_rooms WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This call no longer exists.'; END IF;
  IF v_room.status NOT IN ('ringing', 'active') OR v_room.expires_at <= now() THEN
    RAISE EXCEPTION 'This call has ended.';
  END IF;

  UPDATE public.audio_call_recipients
  SET status = CASE v_action WHEN 'join' THEN 'joined' WHEN 'decline' THEN 'declined' ELSE 'left' END,
      joined_at = CASE WHEN v_action = 'join' THEN coalesce(joined_at, now()) ELSE joined_at END,
      left_at = CASE WHEN v_action IN ('decline', 'leave') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE call_id = p_call_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You were not invited to this call.'; END IF;

  UPDATE public.user_notifications SET read_at = coalesce(read_at, now())
  WHERE recipient_id = v_user_id AND notification_type = 'audio_call'
    AND metadata->>'call_id' = p_call_id::text;
  IF v_action = 'join' THEN
    UPDATE public.audio_call_rooms SET status = 'active', updated_at = now() WHERE id = p_call_id;
    RETURN private.audio_call_payload(p_call_id, v_user_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_audio_call(p_call_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  UPDATE public.audio_call_rooms
  SET status = 'ended', ended_at = now(), updated_at = now()
  WHERE id = p_call_id AND status IN ('ringing', 'active')
    AND (host_id = v_user_id OR public.is_instructor(v_user_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the call host or instructor can end this call.'; END IF;
  UPDATE public.audio_call_recipients
  SET status = CASE WHEN status = 'ringing' THEN 'missed' WHEN status = 'joined' THEN 'left' ELSE status END,
      left_at = CASE WHEN status IN ('ringing', 'joined') THEN now() ELSE left_at END,
      updated_at = now()
  WHERE call_id = p_call_id;
  UPDATE public.user_notifications SET read_at = coalesce(read_at, now())
  WHERE notification_type = 'audio_call' AND metadata->>'call_id' = p_call_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.start_audio_call(text, uuid), public.get_my_active_audio_calls(),
  public.answer_audio_call(uuid, text), public.end_audio_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_audio_call(text, uuid), public.get_my_active_audio_calls(),
  public.answer_audio_call(uuid, text), public.end_audio_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.audio_call_push_is_current(p_notification_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.audio_call_recipients recipient
    JOIN public.audio_call_rooms room ON room.id = recipient.call_id
    WHERE recipient.notification_id = p_notification_id
      AND recipient.status = 'ringing'
      AND room.status IN ('ringing', 'active')
      AND room.starts_at <= now()
      AND room.expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION public.audio_call_push_is_current(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audio_call_push_is_current(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.ensure_morning_audio_call(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_local timestamp := timezone('Africa/Douala', p_now);
  v_date date := v_local::date;
  v_start timestamptz := (v_date + time '05:59') AT TIME ZONE 'Africa/Douala';
  v_end timestamptz := (v_date + time '07:00') AT TIME ZONE 'Africa/Douala';
  v_instructor uuid;
BEGIN
  IF extract(isodow FROM v_date)::integer NOT BETWEEN 1 AND 5
     OR p_now < v_start OR p_now >= v_end
  THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('morning-audio-call:' || v_date::text, 91312));
  IF EXISTS (SELECT 1 FROM public.audio_call_rooms WHERE automatic AND scope = 'all' AND call_date = v_date) THEN
    RETURN 0;
  END IF;
  SELECT assignment.user_id INTO v_instructor
  FROM public.role_assignments assignment
  WHERE assignment.role = 'instructor' AND assignment.status IN ('active', 'approved', 'promoted')
  ORDER BY assignment.created_at LIMIT 1;
  IF v_instructor IS NULL THEN RETURN 0; END IF;
  PERFORM private.create_audio_call(
    v_instructor, 'all', NULL, 'Morning Call', true, v_start, v_end, v_date
  );
  RETURN 1;
END;
$$;
REVOKE ALL ON FUNCTION private.ensure_morning_audio_call(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.dispatch_audio_call_rings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_recipient record;
  v_secret text;
  v_count integer := 0;
BEGIN
  SELECT secret INTO v_secret FROM private.push_webhook_config WHERE singleton;
  IF v_secret IS NULL THEN RETURN 0; END IF;
  FOR v_recipient IN
    SELECT recipient.call_id, recipient.user_id, recipient.notification_id
    FROM public.audio_call_recipients recipient
    JOIN public.audio_call_rooms room ON room.id = recipient.call_id
    WHERE recipient.status = 'ringing'
      AND recipient.notification_id IS NOT NULL
      AND recipient.push_attempts < 4
      AND recipient.last_push_at <= now() - interval '45 seconds'
      AND room.status IN ('ringing', 'active')
      AND room.starts_at <= now()
      AND room.expires_at > now()
    ORDER BY recipient.last_push_at
    LIMIT 500
    FOR UPDATE OF recipient SKIP LOCKED
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := 'https://kckzqsafzemeijxfohuy.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-full-circle-push-secret', v_secret),
        body := jsonb_build_object('notification_id', v_recipient.notification_id),
        timeout_milliseconds := 10000
      );
      UPDATE public.audio_call_recipients
      SET push_attempts = push_attempts + 1, last_push_at = now(), updated_at = now()
      WHERE call_id = v_recipient.call_id AND user_id = v_recipient.user_id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.audio_call_recipients
      SET last_push_at = now(), updated_at = now()
      WHERE call_id = v_recipient.call_id AND user_id = v_recipient.user_id;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.dispatch_audio_call_rings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.expire_audio_calls()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.audio_call_rooms
    SET status = 'expired', ended_at = coalesce(ended_at, now()), updated_at = now()
    WHERE status IN ('ringing', 'active') AND expires_at <= now()
    RETURNING id
  ), recipients AS (
    UPDATE public.audio_call_recipients recipient
    SET status = CASE WHEN recipient.status = 'ringing' THEN 'missed' WHEN recipient.status = 'joined' THEN 'left' ELSE recipient.status END,
        left_at = CASE WHEN recipient.status IN ('ringing', 'joined') THEN now() ELSE recipient.left_at END,
        updated_at = now()
    WHERE EXISTS (SELECT 1 FROM expired WHERE expired.id = recipient.call_id)
    RETURNING recipient.notification_id
  ), notices AS (
    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.id IN (SELECT notification_id FROM recipients WHERE notification_id IS NOT NULL)
    RETURNING notification.id
  )
  SELECT count(*)::integer INTO v_count FROM expired;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.expire_audio_calls() FROM PUBLIC, anon, authenticated;

CREATE TABLE private.background_alert_health (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text
);
INSERT INTO private.background_alert_health(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
REVOKE ALL ON private.background_alert_health FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.run_background_alert_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_errors text[] := '{}';
BEGIN
  UPDATE private.background_alert_health SET last_started_at = now(), last_error = NULL WHERE singleton;
  BEGIN PERFORM private.dispatch_due_scripture_alarms();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'standard alarms: ' || SQLERRM); END;
  BEGIN PERFORM private.dispatch_personal_alarms();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'personal alarms: ' || SQLERRM); END;
  BEGIN PERFORM private.dispatch_alarm_push_queue();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'alarm push: ' || SQLERRM); END;
  BEGIN PERFORM private.ensure_morning_audio_call();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'morning call: ' || SQLERRM); END;
  BEGIN PERFORM private.dispatch_audio_call_rings();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'call push: ' || SQLERRM); END;
  BEGIN PERFORM private.expire_stale_scripture_alarms();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'alarm expiry: ' || SQLERRM); END;
  BEGIN PERFORM private.expire_audio_calls();
  EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, 'call expiry: ' || SQLERRM); END;
  UPDATE private.background_alert_health
  SET last_completed_at = now(), last_error = nullif(array_to_string(v_errors, E'\n'), '')
  WHERE singleton;
END;
$$;
REVOKE ALL ON FUNCTION private.run_background_alert_watchdog() FROM PUBLIC, anon, authenticated;

-- Reinstall all background alert work as one idempotent minute job. The Cron
-- extension was enabled by the preceding alarm migration.
DO $$
DECLARE v_job text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Supabase Cron is required for closed-app alarms and calls.';
  END IF;
  FOREACH v_job IN ARRAY ARRAY[
    'full-circle-personal-alarms',
    'full-circle-alarm-push-retry',
    'full-circle-scripture-alarm-morning',
    'full-circle-scripture-alarm-midday',
    'full-circle-scripture-alarm-evening',
    'full-circle-scripture-alarm-final',
    'full-circle-scripture-alarm-watchdog',
    'full-circle-scripture-alarm-expiry',
    'full-circle-background-alert-watchdog'
  ]::text[]
  LOOP
    PERFORM cron.unschedule(v_job) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job);
  END LOOP;
  PERFORM cron.schedule(
    'full-circle-background-alert-watchdog',
    '* * * * *',
    'SELECT private.run_background_alert_watchdog();'
  );
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.audio_call_rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.audio_call_recipients;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

SELECT private.run_background_alert_watchdog();
