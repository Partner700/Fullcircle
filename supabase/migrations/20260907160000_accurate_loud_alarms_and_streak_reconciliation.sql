/*
  Keep meditation alarms tied to authoritative submission state.

  The morning alarm remains universal. Noon, 18:00, and 20:30 alarms are
  suppressed or cleared as soon as today's meditation is submitted. Alarm
  cleanup never writes daily_records or any streak evidence table.
*/

CREATE OR REPLACE FUNCTION private.daily_meditation_is_submitted(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_records record
    WHERE record.user_id = p_user_id
      AND record.record_date = p_record_date
      AND (
        coalesce(record.meditation_submitted, false)
        OR record.meditation_submitted_at IS NOT NULL
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.clear_completed_meditation_alarms(
  p_user_id uuid,
  p_alarm_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_cleared integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_alarm_date IS NULL
     OR NOT private.daily_meditation_is_submitted(p_user_id, p_alarm_date)
  THEN
    RETURN 0;
  END IF;

  WITH cleared AS (
    UPDATE public.scripture_alarm_occurrences alarm
    SET status = 'cleared',
        cleared_at = coalesce(alarm.cleared_at, now()),
        question_source_type = NULL,
        question_source_id = NULL,
        question_payload = NULL,
        correct_answer = NULL,
        accepted_answers = '[]'::jsonb,
        updated_at = now()
    WHERE alarm.user_id = p_user_id
      AND alarm.alarm_date = p_alarm_date
      AND alarm.alarm_slot IN ('midday', 'evening', 'final')
      AND alarm.status = 'pending'
    RETURNING alarm.id
  ), marked_notifications AS (
    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.recipient_id = p_user_id
      AND notification.notification_type = 'scripture_alarm'
      AND EXISTS (
        SELECT 1
        FROM cleared
        WHERE notification.metadata->>'alarm_id' = cleared.id::text
      )
    RETURNING notification.id
  )
  SELECT count(*)::integer
  INTO v_cleared
  FROM cleared;

  RETURN v_cleared;
END;
$$;

CREATE OR REPLACE FUNCTION private.create_scripture_alarm_for_user(
  p_user_id uuid,
  p_alarm_date date,
  p_alarm_slot text,
  p_triggered_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_alarm_id uuid;
  v_label text;
  v_body text;
BEGIN
  IF p_alarm_slot NOT IN ('morning', 'midday', 'evening', 'final') THEN
    RAISE EXCEPTION 'Unsupported Scripture alarm slot.';
  END IF;

  -- Recheck immediately before insertion, not only while choosing recipients.
  IF p_alarm_slot <> 'morning'
     AND private.daily_meditation_is_submitted(p_user_id, p_alarm_date)
  THEN
    PERFORM private.clear_completed_meditation_alarms(p_user_id, p_alarm_date);
    RETURN false;
  END IF;

  INSERT INTO public.scripture_alarm_occurrences(user_id, alarm_date, alarm_slot, triggered_at)
  VALUES (p_user_id, p_alarm_date, p_alarm_slot, p_triggered_at)
  ON CONFLICT (user_id, alarm_date, alarm_slot) DO NOTHING
  RETURNING id INTO v_alarm_id;

  IF v_alarm_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM private.assign_scripture_alarm_question(v_alarm_id);
  v_label := CASE p_alarm_slot
    WHEN 'morning' THEN 'Morning Scripture alarm'
    WHEN 'midday' THEN 'Midday meditation alarm'
    WHEN 'evening' THEN 'Evening meditation alarm'
    ELSE 'Final meditation alarm'
  END;
  v_body := CASE p_alarm_slot
    WHEN 'morning' THEN 'Answer the Scripture question to silence the morning alarm.'
    ELSE 'Finish and send your daily meditation. Answer the Scripture question to silence this alarm.'
  END;

  PERFORM public.notify_user(
    p_user_id,
    NULL,
    'scripture_alarm',
    v_label,
    v_body,
    'dashboard',
    jsonb_build_object(
      'alarm_id', v_alarm_id,
      'alarm_date', p_alarm_date,
      'alarm_slot', p_alarm_slot
    )
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_scripture_alarm(p_alarm_slot text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_now_local timestamp := timezone('Africa/Douala', now());
  v_today date := v_now_local::date;
  v_due_time time;
  v_triggered_at timestamptz;
  v_profile record;
  v_created integer := 0;
BEGIN
  IF p_alarm_slot NOT IN ('morning', 'midday', 'evening', 'final') THEN
    RAISE EXCEPTION 'Unsupported Scripture alarm slot.';
  END IF;
  IF extract(isodow FROM v_today)::integer NOT BETWEEN 1 AND 5 THEN
    RETURN 0;
  END IF;

  v_due_time := CASE p_alarm_slot
    WHEN 'morning' THEN time '05:59'
    WHEN 'midday' THEN time '12:00'
    WHEN 'evening' THEN time '18:00'
    ELSE time '20:30'
  END;
  IF v_now_local::time < v_due_time THEN
    RETURN 0;
  END IF;
  v_triggered_at := ((v_today + v_due_time) AT TIME ZONE 'Africa/Douala');

  FOR v_profile IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.status IN ('active', 'approved')
    )
      AND (
        p_alarm_slot = 'morning'
        OR NOT private.daily_meditation_is_submitted(profile.id, v_today)
      )
  LOOP
    IF private.create_scripture_alarm_for_user(v_profile.id, v_today, p_alarm_slot, v_triggered_at) THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_due_scripture_alarms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now_local timestamp := timezone('Africa/Douala', now());
  v_today date := v_now_local::date;
  v_has_meditation boolean := false;
  v_created integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF extract(isodow FROM v_today)::integer NOT BETWEEN 1 AND 5 THEN
    RETURN 0;
  END IF;

  v_has_meditation := private.daily_meditation_is_submitted(v_user_id, v_today);
  IF v_has_meditation THEN
    PERFORM private.clear_completed_meditation_alarms(v_user_id, v_today);
  END IF;

  IF v_now_local::time >= time '05:59'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'morning', ((v_today + time '05:59') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;
  IF NOT v_has_meditation AND v_now_local::time >= time '12:00'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'midday', ((v_today + time '12:00') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;
  IF NOT v_has_meditation AND v_now_local::time >= time '18:00'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'evening', ((v_today + time '18:00') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;
  IF NOT v_has_meditation AND v_now_local::time >= time '20:30'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'final', ((v_today + time '20:30') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;

  RETURN v_created;
END;
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Also retire an old meditation reminder that survived an earlier release.
  PERFORM private.clear_completed_meditation_alarms(v_user_id, record.record_date)
  FROM public.daily_records record
  WHERE record.user_id = v_user_id
    AND (
      coalesce(record.meditation_submitted, false)
      OR record.meditation_submitted_at IS NOT NULL
    );
  PERFORM public.ensure_my_due_scripture_alarms();
  PERFORM private.clear_completed_meditation_alarms(v_user_id, v_today);

  SELECT alarm.id INTO v_alarm_id
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.user_id = v_user_id
    AND alarm.status = 'pending'
  ORDER BY alarm.triggered_at, alarm.created_at
  LIMIT 1;

  IF v_alarm_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.scripture_alarm_occurrences alarm
    WHERE alarm.id = v_alarm_id
      AND alarm.question_payload IS NOT NULL
  ) THEN
    PERFORM private.assign_scripture_alarm_question(v_alarm_id);
  END IF;

  RETURN private.scripture_alarm_public_payload(v_alarm_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.clear_meditation_alarms_after_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.meditation_submitted, false)
       OR NEW.meditation_submitted_at IS NOT NULL
    THEN
      PERFORM private.clear_completed_meditation_alarms(NEW.user_id, NEW.record_date);
    END IF;
  ELSIF (
    coalesce(NEW.meditation_submitted, false)
    OR NEW.meditation_submitted_at IS NOT NULL
  ) AND NOT (
    coalesce(OLD.meditation_submitted, false)
    OR OLD.meditation_submitted_at IS NOT NULL
  ) THEN
    PERFORM private.clear_completed_meditation_alarms(NEW.user_id, NEW.record_date);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_completed_scripture_alarms
  ON public.daily_records;
CREATE TRIGGER clear_completed_scripture_alarms
AFTER INSERT OR UPDATE OF meditation_submitted, meditation_submitted_at
ON public.daily_records
FOR EACH ROW EXECUTE FUNCTION private.clear_meditation_alarms_after_submission();

REVOKE ALL ON FUNCTION private.daily_meditation_is_submitted(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.clear_completed_meditation_alarms(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.clear_meditation_alarms_after_submission()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_scripture_alarm_for_user(uuid, date, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_scripture_alarm(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_scripture_alarm(text) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_my_due_scripture_alarms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_due_scripture_alarms() TO authenticated;
REVOKE ALL ON FUNCTION public.get_pending_scripture_alarm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_scripture_alarm() TO authenticated;

-- Clear only irrelevant meditation reminders already pending at deployment.
SELECT private.clear_completed_meditation_alarms(record.user_id, record.record_date)
FROM public.daily_records record
WHERE record.record_date = timezone('Africa/Douala', now())::date
  AND (
    coalesce(record.meditation_submitted, false)
    OR record.meditation_submitted_at IS NOT NULL
  );

-- Immediate evidence triggers remain primary. This tighter reconciliation is
-- a safety net for interrupted clients and delayed administrative corrections.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('full-circle-streak-snapshots');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'full-circle-streak-snapshots',
      '*/15 * * * *',
      'SELECT public.refresh_all_streak_snapshots();'
    );
  END IF;
END;
$$;

SELECT public.refresh_all_streak_snapshots();
