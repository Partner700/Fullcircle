CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "direct_messages_select_participants" ON public.direct_messages;
CREATE POLICY "direct_messages_select_participants" ON public.direct_messages
  FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "direct_messages_insert_sender" ON public.direct_messages;
CREATE POLICY "direct_messages_insert_sender" ON public.direct_messages
  FOR INSERT
  WITH CHECK (auth.uid() = sender_id AND sender_id <> recipient_id);

DROP POLICY IF EXISTS "direct_messages_update_recipient_read" ON public.direct_messages;
CREATE POLICY "direct_messages_update_recipient_read" ON public.direct_messages
  FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_recipient
  ON public.direct_messages(sender_id, recipient_id, created_at);

CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_unread
  ON public.direct_messages(recipient_id, read_at)
  WHERE read_at IS NULL;
