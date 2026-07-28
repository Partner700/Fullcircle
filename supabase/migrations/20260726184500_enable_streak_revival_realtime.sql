/*
# Realtime streak revival

Publish streak freezer and revival changes so an open cadet session refreshes
the top-bar streak and Settings statistics immediately.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'streak_freezers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.streak_freezers;
  END IF;
END;
$$;
