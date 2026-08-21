/* Deliver scheduled reminders as durable user notifications and keep quote
   streaks from being blanked by a stale zero-valued board snapshot. */

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
          WHEN 'midday_reminder' THEN 'Daily meditation reminder'
          WHEN 'daily_game_reminder' THEN 'Daily game reminder'
          ELSE 'Full Circle reminder'
        END,
        v_announcement.content,
        CASE p_type
          WHEN 'morning_call' THEN 'dashboard'
          WHEN 'midday_reminder' THEN 'narrative'
          WHEN 'daily_game_reminder' THEN 'game'
          ELSE 'dashboard'
        END,
        jsonb_build_object('reminder_date', v_day, 'announcement_id', v_announcement.id)
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.deliver_due_daily_reminder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deliver_due_daily_reminder(text) TO service_role;

-- Repair the original bootstrap function: its reminder rows omitted the
-- audience value, causing the midnight seed to fail with a column mismatch.
CREATE OR REPLACE FUNCTION public.ensure_daily_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := timezone('Africa/Douala', now())::date;
BEGIN
  INSERT INTO public.scheduled_announcements(
    announcement_type, publish_at, expires_at, reminder_date,
    audience, content, is_active
  )
  VALUES
    ('morning_call', (v_day + time '00:00') AT TIME ZONE 'Africa/Douala', (v_day + time '07:00') AT TIME ZONE 'Africa/Douala', v_day, 'all', 'Join the morning call and begin today together.', true),
    ('midday_reminder', (v_day + time '07:01') AT TIME ZONE 'Africa/Douala', (v_day + time '21:00') AT TIME ZONE 'Africa/Douala', v_day, 'all', 'Submit your daily meditation before 9:00 PM.', true),
    ('daily_game_reminder', (v_day + time '15:00') AT TIME ZONE 'Africa/Douala', (v_day + interval '1 day') AT TIME ZONE 'Africa/Douala', v_day, 'all', 'The daily games are open. Come play today.', true)
  ON CONFLICT (announcement_type, reminder_date) DO UPDATE
    SET publish_at = EXCLUDED.publish_at,
        expires_at = EXCLUDED.expires_at,
        content = EXCLUDED.content,
        is_active = true;

  PERFORM public.process_automatic_sentry_promotions();
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_daily_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_daily_reminders() TO authenticated, service_role;

-- Backfill any reminder that is already due today when this migration is
-- applied, so a deployment during the reminder window does not miss it.
SELECT public.ensure_daily_reminders();
SELECT public.deliver_due_daily_reminder('morning_call');
SELECT public.deliver_due_daily_reminder('midday_reminder');
SELECT public.deliver_due_daily_reminder('daily_game_reminder');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-daily-reminders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-daily-reminders');
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

DROP FUNCTION IF EXISTS public.get_daily_quote_feed(integer);

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text,
  current_streak integer,
  total_figs integer,
  rhudes integer,
  role text,
  tent_house_id text,
  tent_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now())::date AS today
  ),
  active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id,
      CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
      CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
      assignment.start_date DESC NULLS LAST,
      assignment.created_at DESC
  ),
  active_tents AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      tents.tent_house_id,
      tents.name AS tent_name
    FROM public.tent_members member
    JOIN public.tents tents ON tents.id = member.tent_id
    ORDER BY member.user_id, member.joined_at DESC
  ),
  strict AS (
    SELECT dr_user.id AS user_id,
      COALESCE((SELECT current_streak FROM public.compute_strict_streak(dr_user.id) LIMIT 1), 0)::integer AS current_streak
    FROM public.profiles dr_user
  )
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url,
    GREATEST(COALESCE(marks.current_streak, 0), COALESCE(strict.current_streak, 0))::integer AS current_streak,
    COALESCE(marks.total_figs, 0)::integer AS total_figs,
    COALESCE(marks.rhudes, 0)::integer AS rhudes,
    COALESCE(roles.role, 'cadet')::text AS role,
    tents.tent_house_id,
    tents.tent_name
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  LEFT JOIN public.get_marks_board_live() marks ON marks.user_id = dr.user_id
  LEFT JOIN strict ON strict.user_id = dr.user_id
  LEFT JOIN active_roles roles ON roles.user_id = dr.user_id
  LEFT JOIN active_tents tents ON tents.user_id = dr.user_id
  CROSS JOIN clock c
  WHERE dr.meditation_submitted = true
    AND dr.record_date = c.today
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.meditation_submitted_at DESC NULLS LAST, p.display_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;
