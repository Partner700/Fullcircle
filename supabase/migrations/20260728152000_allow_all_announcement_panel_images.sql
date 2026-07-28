/*
# Allow every instructor panel image slot

Instructor image uploads are stored as scheduled_announcements rows with
announcement_type values like `panel_image_sentry_overview`,
`panel_image_instructor_dashboard`, and future `panel_image_*` slots. The
database check must allow the pattern, not just a short fixed list.
*/

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
      'weekly_background'
    )
    OR announcement_type LIKE 'panel_image_%'
  );
