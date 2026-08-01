CREATE TABLE IF NOT EXISTS public.arena_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arena_room_messages_room_created_idx ON public.arena_room_messages(room_id, created_at);
ALTER TABLE public.arena_room_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arena members read waiting room chat" ON public.arena_room_messages;
CREATE POLICY "arena members read waiting room chat" ON public.arena_room_messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.arena_participants p WHERE p.room_id = arena_room_messages.room_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "arena members write waiting room chat" ON public.arena_room_messages;
CREATE POLICY "arena members write waiting room chat" ON public.arena_room_messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.arena_participants p WHERE p.room_id = arena_room_messages.room_id AND p.user_id = auth.uid()));

ALTER TABLE public.arena_room_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_room_messages;
