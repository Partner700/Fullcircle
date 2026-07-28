/*
# Same-day quotes and Today's Progress image

- Keep the dashboard quote slideshow focused on the current Douala day.
- Add a persistent instructor-managed image slot for Today's Progress.
*/

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  WHERE dr.record_date = timezone('Africa/Douala', now())::date
    AND dr.meditation_submitted = true
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.meditation_submitted_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call',
      'midday_reminder',
      'evening_reminder',
      'quote_of_day',
      'streakboard_release',
      'general',
      'weekly_background',
      'panel_image_welcome',
      'panel_image_verse',
      'panel_image_announcement',
      'panel_image_quote',
      'panel_image_market',
      'panel_image_reading',
      'panel_image_quiz',
      'panel_image_progress'
    )
  );

