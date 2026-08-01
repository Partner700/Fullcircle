CREATE TABLE IF NOT EXISTS public.quiz_waiting_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_waiting_messages_session_created_idx ON public.quiz_waiting_messages(quiz_session_id, created_at);
ALTER TABLE public.quiz_waiting_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users read quiz waiting chat" ON public.quiz_waiting_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated users write quiz waiting chat" ON public.quiz_waiting_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
ALTER TABLE public.quiz_waiting_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_waiting_messages;
