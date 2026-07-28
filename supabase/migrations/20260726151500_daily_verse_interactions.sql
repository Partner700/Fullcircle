CREATE TABLE IF NOT EXISTS public.daily_verse_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_date date NOT NULL,
  reactor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL CHECK (reaction_type IN ('amen', 'spark', 'thoughtful')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (narrative_date, reactor_user_id, reaction_type)
);

CREATE TABLE IF NOT EXISTS public.daily_verse_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_date date NOT NULL,
  commenter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_verse_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_verse_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_verse_reactions_select_all" ON public.daily_verse_reactions;
CREATE POLICY "daily_verse_reactions_select_all" ON public.daily_verse_reactions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "daily_verse_reactions_insert_own" ON public.daily_verse_reactions;
CREATE POLICY "daily_verse_reactions_insert_own" ON public.daily_verse_reactions
  FOR INSERT WITH CHECK (auth.uid() = reactor_user_id);

DROP POLICY IF EXISTS "daily_verse_comments_select_all" ON public.daily_verse_comments;
CREATE POLICY "daily_verse_comments_select_all" ON public.daily_verse_comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "daily_verse_comments_insert_own" ON public.daily_verse_comments;
CREATE POLICY "daily_verse_comments_insert_own" ON public.daily_verse_comments
  FOR INSERT WITH CHECK (auth.uid() = commenter_user_id);

CREATE INDEX IF NOT EXISTS idx_daily_verse_reactions_date ON public.daily_verse_reactions(narrative_date);
CREATE INDEX IF NOT EXISTS idx_daily_verse_comments_date ON public.daily_verse_comments(narrative_date, created_at);
