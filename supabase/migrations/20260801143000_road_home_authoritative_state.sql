-- Server-owned state for Full Circle: The Road Home.
-- The private row contains answer keys and command metadata. Clients can only
-- read the separately sanitised public snapshot written by the Edge Function.

CREATE TABLE IF NOT EXISTS public.arena_ludo_games (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  private_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.arena_ludo_public_states (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  public_state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.arena_ludo_commands (
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_id text NOT NULL,
  state_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, command_id)
);

CREATE TABLE IF NOT EXISTS public.arena_ludo_events (
  id text PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id text,
  message text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arena_ludo_public_states_updated_idx
  ON public.arena_ludo_public_states(updated_at DESC);
CREATE INDEX IF NOT EXISTS arena_ludo_events_room_created_idx
  ON public.arena_ludo_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arena_ludo_commands_created_idx
  ON public.arena_ludo_commands(created_at DESC);

ALTER TABLE public.arena_ludo_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_ludo_public_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_ludo_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_ludo_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.arena_ludo_games FROM anon, authenticated;
REVOKE ALL ON public.arena_ludo_commands FROM anon, authenticated;

DROP POLICY IF EXISTS "arena players read ludo public state" ON public.arena_ludo_public_states;
CREATE POLICY "arena players read ludo public state"
ON public.arena_ludo_public_states FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = arena_ludo_public_states.room_id
      AND participant.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "arena players read ludo events" ON public.arena_ludo_events;
CREATE POLICY "arena players read ludo events"
ON public.arena_ludo_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = arena_ludo_events.room_id
      AND participant.user_id = auth.uid()
  )
);

GRANT SELECT ON public.arena_ludo_public_states TO authenticated;
GRANT SELECT ON public.arena_ludo_events TO authenticated;

ALTER TABLE public.arena_ludo_public_states REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'arena_ludo_public_states'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_ludo_public_states;
  END IF;
END $$;

-- Keep the idempotency table small without requiring a scheduled job.
CREATE OR REPLACE FUNCTION public.trim_arena_ludo_commands()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.arena_ludo_commands
  WHERE created_at < now() - interval '7 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trim_arena_ludo_commands_after_insert ON public.arena_ludo_commands;
CREATE TRIGGER trim_arena_ludo_commands_after_insert
AFTER INSERT ON public.arena_ludo_commands
FOR EACH STATEMENT EXECUTE FUNCTION public.trim_arena_ludo_commands();
