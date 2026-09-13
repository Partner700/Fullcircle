-- Personal schedules use the same answer-to-dismiss engine as standard alarms.
CREATE TABLE public.personal_alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  alarm_time time NOT NULL CHECK (extract(second FROM alarm_time) = 0),
  timezone text NOT NULL,
  repeat_days integer[] NOT NULL DEFAULT '{}',
  once_date date,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (repeat_days <@ ARRAY[1,2,3,4,5,6,7] AND array_position(repeat_days, NULL) IS NULL),
  CHECK ((cardinality(repeat_days) = 0) = (once_date IS NOT NULL))
);
ALTER TABLE public.personal_alarms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_alarms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.personal_alarms TO authenticated;
CREATE POLICY read_own_personal_alarms ON public.personal_alarms
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.scripture_alarm_occurrences
  ADD COLUMN personal_alarm_id uuid REFERENCES public.personal_alarms(id) ON DELETE SET NULL,
  ADD COLUMN alarm_title text;
ALTER TABLE public.scripture_alarm_occurrences DROP CONSTRAINT scripture_alarm_occurrences_alarm_slot_check;
ALTER TABLE public.scripture_alarm_occurrences ADD CONSTRAINT scripture_alarm_occurrences_alarm_slot_check
  CHECK (alarm_slot IN ('morning', 'midday', 'evening', 'final') OR alarm_slot ~ '^personal:[0-9a-f-]{36}$');

CREATE OR REPLACE FUNCTION public.save_personal_alarm(
  p_id uuid, p_title text, p_time time, p_timezone text,
  p_repeat_days integer[], p_once_date date, p_enabled boolean DEFAULT true
)
RETURNS public.personal_alarms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  v_user uuid := auth.uid();
  v_result public.personal_alarms;
  v_days integer[];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Enter an alarm name of 1 to 80 characters.'; END IF;
  IF p_time IS NULL OR extract(second FROM p_time) <> 0 THEN RAISE EXCEPTION 'Choose an alarm time in hours and minutes.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN RAISE EXCEPTION 'Choose a valid timezone.'; END IF;
  IF p_repeat_days IS NULL OR NOT (p_repeat_days <@ ARRAY[1,2,3,4,5,6,7]) OR array_position(p_repeat_days, NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose valid repeat days.'; END IF;
  SELECT coalesce(array_agg(DISTINCT day ORDER BY day), '{}') INTO v_days FROM unnest(p_repeat_days) day;
  IF cardinality(v_days) = 0 AND (p_once_date IS NULL OR (p_enabled AND (p_once_date + p_time) AT TIME ZONE p_timezone <= now())) THEN
    RAISE EXCEPTION 'Choose a future date and time for a one-time alarm.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 414));
  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.personal_alarms WHERE user_id = v_user) >= 20 THEN RAISE EXCEPTION 'You can keep up to 20 personal alarms.'; END IF;
    INSERT INTO public.personal_alarms(user_id,title,alarm_time,timezone,repeat_days,once_date,enabled)
    VALUES (v_user,btrim(p_title),p_time,p_timezone,v_days,CASE WHEN cardinality(v_days)=0 THEN p_once_date END,coalesce(p_enabled,true))
    RETURNING * INTO v_result;
  ELSE
    UPDATE public.personal_alarms SET title=btrim(p_title), alarm_time=p_time, timezone=p_timezone,
      repeat_days=v_days, once_date=CASE WHEN cardinality(v_days)=0 THEN p_once_date END,
      enabled=coalesce(p_enabled,true), updated_at=now()
    WHERE id=p_id AND user_id=v_user RETURNING * INTO v_result;
    IF NOT FOUND THEN RAISE EXCEPTION 'Alarm not found.'; END IF;
  END IF;
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.delete_personal_alarm(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.personal_alarms WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alarm not found.'; END IF;
  UPDATE public.scripture_alarm_occurrences SET status='missed', missed_at=now(), updated_at=now()
    WHERE personal_alarm_id=p_id AND user_id=auth.uid() AND status='pending';
  UPDATE public.user_notifications SET read_at=coalesce(read_at,now())
    WHERE recipient_id=auth.uid() AND notification_type='scripture_alarm'
      AND metadata->>'personal_alarm_id'=p_id::text;
  DELETE FROM public.personal_alarms WHERE id=p_id AND user_id=auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.save_personal_alarm(uuid,text,time,text,integer[],date,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_personal_alarm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_personal_alarm(uuid,text,time,text,integer[],date,boolean), public.delete_personal_alarm(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.dispatch_personal_alarms(p_user_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  v_schedule public.personal_alarms;
  v_date date;
  v_due timestamptz;
  v_alarm_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_schedule IN
    SELECT * FROM public.personal_alarms WHERE enabled AND (p_user_id IS NULL OR user_id=p_user_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Yesterday is needed for a ten-minute window crossing local midnight.
    FOREACH v_date IN ARRAY ARRAY[timezone(v_schedule.timezone,p_now)::date - 1, timezone(v_schedule.timezone,p_now)::date] LOOP
      IF NOT ((cardinality(v_schedule.repeat_days)=0 AND v_schedule.once_date=v_date)
        OR extract(isodow FROM v_date)::integer=ANY(v_schedule.repeat_days)) THEN CONTINUE; END IF;
      v_due := (v_date + v_schedule.alarm_time) AT TIME ZONE v_schedule.timezone;
      IF p_now < v_due OR p_now >= v_due + interval '10 minutes' OR v_schedule.updated_at > v_due THEN CONTINUE; END IF;
      INSERT INTO public.scripture_alarm_occurrences(user_id,alarm_date,alarm_slot,triggered_at,expires_at,personal_alarm_id,alarm_title)
        VALUES (v_schedule.user_id,v_date,'personal:'||v_schedule.id::text,v_due,v_due+interval '10 minutes',v_schedule.id,v_schedule.title)
        ON CONFLICT (user_id,alarm_date,alarm_slot) DO NOTHING RETURNING id INTO v_alarm_id;
      IF v_alarm_id IS NULL THEN CONTINUE; END IF;
      PERFORM private.assign_scripture_alarm_question(v_alarm_id);
      PERFORM public.notify_user(v_schedule.user_id,NULL,'scripture_alarm',v_schedule.title,
        'Answer a Scripture question to silence your alarm. Available for 10 minutes.','dashboard',
        jsonb_build_object('alarm_id',v_alarm_id,'personal_alarm_id',v_schedule.id,'alarm_slot','personal','expires_at',v_due+interval '10 minutes'));
      v_count := v_count+1;
      IF cardinality(v_schedule.repeat_days)=0 THEN UPDATE public.personal_alarms SET enabled=false WHERE id=v_schedule.id; END IF;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.dispatch_personal_alarms(uuid,timestamptz) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION private.expire_stale_scripture_alarms(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_expired integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.scripture_alarm_occurrences alarm
    SET status = 'missed',
        missed_at = coalesce(alarm.missed_at, now()),
        question_source_type = NULL,
        question_source_id = NULL,
        question_payload = NULL,
        correct_answer = NULL,
        accepted_answers = '[]'::jsonb,
        updated_at = now()
    WHERE alarm.status = 'pending'
      AND (
        alarm.expires_at <= now()
        OR (alarm.personal_alarm_id IS NULL AND NOT private.user_is_scripture_alarm_eligible(alarm.user_id, alarm.alarm_date))
      )
      AND (p_user_id IS NULL OR alarm.user_id = p_user_id)
    RETURNING alarm.id, alarm.user_id
  ), marked_notifications AS (
    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.notification_type = 'scripture_alarm'
      AND EXISTS (
        SELECT 1
        FROM expired
        WHERE expired.user_id = notification.recipient_id
          AND notification.metadata->>'alarm_id' = expired.id::text
      )
    RETURNING notification.id
  )
  SELECT count(*)::integer INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

CREATE OR REPLACE FUNCTION private.scripture_alarm_public_payload(p_alarm_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT jsonb_build_object(
    'id', alarm.id,
    'alarm_date', alarm.alarm_date,
    'alarm_slot', CASE WHEN alarm.personal_alarm_id IS NOT NULL THEN 'personal' ELSE alarm.alarm_slot END,
    'title', alarm.alarm_title,
    'triggered_at', alarm.triggered_at,
    'expires_at', alarm.expires_at,
    'question_text', alarm.question_payload->>'question_text',
    'question_type', coalesce(alarm.question_payload->>'question_type', 'standard_text'),
    'options', coalesce(alarm.question_payload->'options', '[]'::jsonb),
    'reference', alarm.question_payload->>'reference',
    'attempt_count', alarm.attempt_count
  )
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.id = p_alarm_id
    AND alarm.status = 'pending'
    AND alarm.triggered_at <= now()
    AND alarm.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.get_pending_scripture_alarm()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := timezone('Africa/Douala', now())::date;
  v_alarm_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  PERFORM private.dispatch_personal_alarms(v_user_id);
  PERFORM private.expire_stale_scripture_alarms(v_user_id);
  PERFORM public.ensure_my_due_scripture_alarms();
  PERFORM private.clear_completed_meditation_alarms(v_user_id, v_today);

  SELECT alarm.id INTO v_alarm_id
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.user_id = v_user_id
    AND alarm.status = 'pending'
    AND alarm.triggered_at <= now()
    AND alarm.expires_at > now()
  ORDER BY alarm.triggered_at, alarm.created_at
  LIMIT 1;

  IF v_alarm_id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.scripture_alarm_occurrences alarm
    WHERE alarm.id = v_alarm_id AND alarm.question_payload IS NOT NULL
  ) THEN
    PERFORM private.assign_scripture_alarm_question(v_alarm_id);
  END IF;
  RETURN private.scripture_alarm_public_payload(v_alarm_id);
END;
$$;


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'Enable Supabase Cron (pg_cron) before installing scheduled alarms.';
  END IF;
  PERFORM cron.schedule('full-circle-personal-alarms','* * * * *','SELECT private.dispatch_personal_alarms();');
END;
$$;
