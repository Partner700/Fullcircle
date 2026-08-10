/* Follow-up for projects that already ran the initial sound-assignment migration. */

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call', 'midday_reminder', 'evening_reminder', 'quote_of_day',
      'streakboard_release', 'general', 'weekly_background'
    )
    OR announcement_type LIKE 'panel_image_%'
    OR announcement_type LIKE 'sound_%'
  );
