/*
# Add reading and quiz panel images

Allow the instructor to persist custom background images for the Today's
Reading panel and the cadet quiz header through the existing image manager.
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
      'weekly_background',
      'panel_image_welcome',
      'panel_image_verse',
      'panel_image_announcement',
      'panel_image_quote',
      'panel_image_market',
      'panel_image_reading',
      'panel_image_quiz'
    )
  );
