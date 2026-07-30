-- Deliver user notification inserts to connected clients immediately.
-- The application also polls while visible, so a temporary mobile socket loss
-- cannot leave a user without their updates.

ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
