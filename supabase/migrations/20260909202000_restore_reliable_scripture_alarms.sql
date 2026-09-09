/*
  Restore Scripture alarm delivery after newcomer-guidance updates.

  Alarm eligibility is based on account age instead of the mutable guide state,
  so reopening or extending a tour cannot silence alarms for established users.
  A one-minute watchdog retries dispatch throughout each ten-minute window while
  the existing uniqueness boundary prevents duplicate alarm occurrences.
*/

CREATE OR REPLACE FUNCTION private.user_is_scripture_alarm_eligible(
  p_user_id uuid,
  p_alarm_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = p_user_id
      -- Do not alarm somebody on the calendar day they join Full Circle.
      AND timezone(
        'Africa/Douala',
        coalesce(profile.created_at, '-infinity'::timestamptz)
      )::date < p_alarm_date
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.status IN ('active', 'approved', 'promoted')
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.dispatch_due_scripture_alarms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_slot text;
  v_slot_created integer;
  v_created integer := 0;
BEGIN
  -- Each dispatcher rejects calls outside its own ten-minute window. Calling
  -- all slots here keeps this watchdog timezone-safe and idempotent.
  FOREACH v_slot IN ARRAY ARRAY['morning', 'midday', 'evening', 'final']::text[]
  LOOP
    BEGIN
      v_slot_created := public.dispatch_scripture_alarm(v_slot);
      v_created := v_created + coalesce(v_slot_created, 0);
    EXCEPTION WHEN OTHERS THEN
      -- One malformed source question must not prevent another due slot from
      -- being checked on the next watchdog minute.
      RAISE WARNING 'Scripture alarm dispatch failed for slot %: %', v_slot, SQLERRM;
    END;
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION private.user_is_scripture_alarm_eligible(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.dispatch_due_scripture_alarms()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Recreate the primary jobs as well as a minute watchdog. The watchdog
    -- covers a delayed or skipped exact-minute execution; the occurrence
    -- uniqueness constraint guarantees that retries never pile up alarms.
    PERFORM cron.unschedule('full-circle-scripture-alarm-morning')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-morning');
    PERFORM cron.unschedule('full-circle-scripture-alarm-midday')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-midday');
    PERFORM cron.unschedule('full-circle-scripture-alarm-evening')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-evening');
    PERFORM cron.unschedule('full-circle-scripture-alarm-final')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-final');
    PERFORM cron.unschedule('full-circle-scripture-alarm-watchdog')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-watchdog');
    PERFORM cron.unschedule('full-circle-scripture-alarm-expiry')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-expiry');

    PERFORM cron.schedule(
      'full-circle-scripture-alarm-morning',
      '59 4 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('morning');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-midday',
      '0 11 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('midday');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-evening',
      '0 17 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('evening');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-final',
      '30 19 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('final');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-watchdog',
      '* * * * *',
      $job$SELECT private.dispatch_due_scripture_alarms();$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-expiry',
      '* * * * *',
      $job$SELECT private.expire_stale_scripture_alarms();$job$
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;

-- If deployment occurs inside a live alarm window, deliver that alarm now.
SELECT private.dispatch_due_scripture_alarms();
