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

CREATE OR REPLACE FUNCTION public.save_panel_image_setting(
  p_announcement_type text,
  p_audience text,
  p_content text,
  p_publish_at timestamptz DEFAULT now(),
  p_position_x integer DEFAULT 50,
  p_position_y integer DEFAULT 50
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can save panel images';
  END IF;
  IF p_announcement_type <> 'weekly_background' AND p_announcement_type NOT LIKE 'panel_image_%' THEN
    RAISE EXCEPTION 'Invalid panel image type';
  END IF;
  IF p_audience NOT IN ('all', 'cadets', 'sentries', 'instructors') THEN
    RAISE EXCEPTION 'Invalid panel image audience';
  END IF;

  SELECT id INTO v_id
  FROM public.scheduled_announcements
  WHERE announcement_type = p_announcement_type AND audience = p_audience
  ORDER BY is_active DESC, publish_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.scheduled_announcements (
      announcement_type, audience, content, publish_at, is_active,
      image_position_x, image_position_y
    ) VALUES (
      p_announcement_type, p_audience, p_content, COALESCE(p_publish_at, now()), true,
      greatest(0, least(100, COALESCE(p_position_x, 50))),
      greatest(0, least(100, COALESCE(p_position_y, 50)))
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.scheduled_announcements
    SET content = p_content,
        publish_at = COALESCE(p_publish_at, now()),
        is_active = true,
        image_position_x = greatest(0, least(100, COALESCE(p_position_x, 50))),
        image_position_y = greatest(0, least(100, COALESCE(p_position_y, 50)))
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_panel_image_setting(text, text, text, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_panel_image_setting(text, text, text, timestamptz, integer, integer) TO authenticated;
