-- Production resilience: user-first active Arena lookup.
-- Already installed on Full Circle v3 via the connected Supabase project;
-- IF NOT EXISTS keeps future migration/replay idempotent.
CREATE INDEX IF NOT EXISTS arena_participants_active_user_room_idx
  ON public.arena_participants (user_id, room_id)
  WHERE forfeited_at IS NULL AND finished_at IS NULL;
