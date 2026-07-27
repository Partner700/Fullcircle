ALTER TABLE public.scheduled_announcements
  ADD COLUMN IF NOT EXISTS image_position_x smallint NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS image_position_y smallint NOT NULL DEFAULT 50;

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_image_position_x_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_image_position_x_check
  CHECK (image_position_x BETWEEN 0 AND 100);

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_image_position_y_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_image_position_y_check
  CHECK (image_position_y BETWEEN 0 AND 100);
