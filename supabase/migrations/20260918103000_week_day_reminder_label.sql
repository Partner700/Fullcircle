-- Preserve the existing schedule and artwork key; rename the visible reminder.
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
          WHEN 'midday_reminder' THEN 'Week-day reminder'
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

UPDATE public.user_notifications SET title = 'Week-day reminder'
WHERE notification_type = 'midday_reminder' AND title IS DISTINCT FROM 'Week-day reminder';
