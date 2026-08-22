/* Replace Saturday's morning-call reminder with the 9:15 AM weekly quiz and
   keep the reminder schedule authoritative in Africa/Douala time. */

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;
ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call', 'midday_reminder', 'evening_reminder',
      'daily_game_reminder', 'weekly_quiz_reminder', 'quote_of_day',
      'streakboard_release', 'general', 'birthday', 'weekly_background'
    )
    OR announcement_type LIKE 'panel_image_%'
    OR announcement_type LIKE 'sound_%'
  );

CREATE OR REPLACE FUNCTION public.deliver_due_daily_reminder(p_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := timezone('Africa/Douala', now())::date;
  v_announcement public.scheduled_announcements%ROWTYPE;
  v_user uuid;
BEGIN
  SELECT * INTO v_announcement
  FROM public.scheduled_announcements
  WHERE announcement_type = p_type
    AND reminder_date = v_day
    AND is_active = true
    AND publish_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR v_user IN SELECT id FROM public.profiles LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_notifications notification
      WHERE notification.recipient_id = v_user
        AND notification.notification_type = p_type
        AND notification.metadata ->> 'reminder_date' = v_day::text
    ) THEN
      PERFORM public.notify_user(
        v_user,
        NULL,
        p_type,
        CASE p_type
          WHEN 'morning_call' THEN 'Morning call'
          WHEN 'weekly_quiz_reminder' THEN 'Weekly quiz starts now'
          WHEN 'midday_reminder' THEN 'Daily meditation reminder'
          WHEN 'daily_game_reminder' THEN 'Daily game reminder'
          ELSE 'Full Circle reminder'
        END,
        v_announcement.content,
        CASE p_type
          WHEN 'morning_call' THEN 'dashboard'
          WHEN 'weekly_quiz_reminder' THEN 'quiz'
          WHEN 'midday_reminder' THEN 'narrative'
          WHEN 'daily_game_reminder' THEN 'game'
          ELSE 'dashboard'
        END,
        jsonb_build_object(
          'reminder_date', v_day,
          'announcement_id', v_announcement.id,
          'reminder_type', p_type
        )
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.deliver_due_daily_reminder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deliver_due_daily_reminder(text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_daily_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := timezone('Africa/Douala', now())::date;
  v_is_saturday boolean := extract(isodow FROM timezone('Africa/Douala', now())) = 6;
  v_is_sunday boolean := extract(isodow FROM timezone('Africa/Douala', now())) = 7;
BEGIN
  IF v_is_saturday THEN
    UPDATE public.scheduled_announcements
    SET is_active = false
    WHERE announcement_type IN ('morning_call', 'midday_reminder')
      AND reminder_date = v_day;

    INSERT INTO public.scheduled_announcements(
      announcement_type, publish_at, expires_at, reminder_date,
      audience, content, is_active
    ) VALUES (
      'weekly_quiz_reminder',
      (v_day + time '09:15') AT TIME ZONE 'Africa/Douala',
      (v_day + time '15:00') AT TIME ZONE 'Africa/Douala',
      v_day,
      'all',
      'The weekly quiz is open. Join now and complete today''s streak challenge.',
      true
    )
    ON CONFLICT (announcement_type, reminder_date) WHERE reminder_date IS NOT NULL DO UPDATE
      SET publish_at = EXCLUDED.publish_at,
          expires_at = EXCLUDED.expires_at,
          audience = EXCLUDED.audience,
          content = EXCLUDED.content,
          is_active = true;
  ELSIF v_is_sunday THEN
    UPDATE public.scheduled_announcements
    SET is_active = false
    WHERE announcement_type IN ('morning_call', 'midday_reminder', 'weekly_quiz_reminder')
      AND reminder_date = v_day;
  ELSE
    UPDATE public.scheduled_announcements
    SET is_active = false
    WHERE announcement_type = 'weekly_quiz_reminder'
      AND reminder_date = v_day;

    INSERT INTO public.scheduled_announcements(
      announcement_type, publish_at, expires_at, reminder_date,
      audience, content, is_active
    ) VALUES (
      'morning_call',
      (v_day + time '00:00') AT TIME ZONE 'Africa/Douala',
      (v_day + time '07:00') AT TIME ZONE 'Africa/Douala',
      v_day,
      'all',
      'Join the morning call and begin today together.',
      true
    )
    ON CONFLICT (announcement_type, reminder_date) WHERE reminder_date IS NOT NULL DO UPDATE
      SET publish_at = EXCLUDED.publish_at,
          expires_at = EXCLUDED.expires_at,
          audience = EXCLUDED.audience,
          content = EXCLUDED.content,
          is_active = true;

    INSERT INTO public.scheduled_announcements(
      announcement_type, publish_at, expires_at, reminder_date,
      audience, content, is_active
    ) VALUES (
      'midday_reminder',
      (v_day + time '07:01') AT TIME ZONE 'Africa/Douala',
      (v_day + time '21:00') AT TIME ZONE 'Africa/Douala',
      v_day,
      'all',
      'Submit your daily meditation before 9:00 PM.',
      true
    )
    ON CONFLICT (announcement_type, reminder_date) WHERE reminder_date IS NOT NULL DO UPDATE
      SET publish_at = EXCLUDED.publish_at,
          expires_at = EXCLUDED.expires_at,
          audience = EXCLUDED.audience,
          content = EXCLUDED.content,
          is_active = true;
  END IF;

  INSERT INTO public.scheduled_announcements(
    announcement_type, publish_at, expires_at, reminder_date,
    audience, content, is_active
  ) VALUES (
    'daily_game_reminder',
    (v_day + time '15:00') AT TIME ZONE 'Africa/Douala',
    (v_day + interval '1 day') AT TIME ZONE 'Africa/Douala',
    v_day,
    'all',
    'The daily games are open. Come play today.',
    true
  )
  ON CONFLICT (announcement_type, reminder_date) WHERE reminder_date IS NOT NULL DO UPDATE
    SET publish_at = EXCLUDED.publish_at,
        expires_at = EXCLUDED.expires_at,
        audience = EXCLUDED.audience,
        content = EXCLUDED.content,
        is_active = true;

  PERFORM public.process_automatic_sentry_promotions();
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_daily_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_daily_reminders() TO authenticated, service_role;

SELECT public.ensure_daily_reminders();
SELECT public.deliver_due_daily_reminder('morning_call');
SELECT public.deliver_due_daily_reminder('weekly_quiz_reminder');
SELECT public.deliver_due_daily_reminder('midday_reminder');
SELECT public.deliver_due_daily_reminder('daily_game_reminder');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-daily-reminders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-daily-reminders');
    PERFORM cron.unschedule('full-circle-weekly-quiz-reminder')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-weekly-quiz-reminder');
    PERFORM cron.unschedule('full-circle-midday-reminder')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-midday-reminder');
    PERFORM cron.unschedule('full-circle-daily-game-reminder')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-daily-game-reminder');

    PERFORM cron.schedule(
      'full-circle-daily-reminders',
      '0 23 * * *',
      $job$SELECT public.ensure_daily_reminders(); SELECT public.deliver_due_daily_reminder('morning_call');$job$
    );
    PERFORM cron.schedule(
      'full-circle-weekly-quiz-reminder',
      '15 8 * * 6',
      $job$SELECT public.ensure_daily_reminders(); SELECT public.deliver_due_daily_reminder('weekly_quiz_reminder');$job$
    );
    PERFORM cron.schedule(
      'full-circle-midday-reminder',
      '1 6 * * *',
      $job$SELECT public.deliver_due_daily_reminder('midday_reminder');$job$
    );
    PERFORM cron.schedule(
      'full-circle-daily-game-reminder',
      '0 14 * * *',
      $job$SELECT public.deliver_due_daily_reminder('daily_game_reminder');$job$
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;
