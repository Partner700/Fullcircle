DROP POLICY IF EXISTS "read_awards" ON public.awards;
CREATE POLICY "read_awards" ON public.awards FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.award_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id uuid NOT NULL REFERENCES public.awards(id) ON DELETE CASCADE,
  reactor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL CHECK (reaction_type IN ('celebrate', 'fire', 'love')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (award_id, reactor_id, reaction_type)
);

ALTER TABLE public.award_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "award_reactions_read_all" ON public.award_reactions;
CREATE POLICY "award_reactions_read_all" ON public.award_reactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "award_reactions_insert_own" ON public.award_reactions;
CREATE POLICY "award_reactions_insert_own" ON public.award_reactions FOR INSERT TO authenticated WITH CHECK (reactor_id = auth.uid());
DROP POLICY IF EXISTS "award_reactions_delete_own" ON public.award_reactions;
CREATE POLICY "award_reactions_delete_own" ON public.award_reactions FOR DELETE TO authenticated USING (reactor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.react_to_award(p_award_id uuid, p_reactor_id uuid, p_reaction_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_reactor_id THEN RAISE EXCEPTION 'Invalid reactor'; END IF;
  IF p_reaction_type NOT IN ('celebrate', 'fire', 'love') THEN RAISE EXCEPTION 'Invalid reaction'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.award_reactions
    WHERE award_id = p_award_id AND reactor_id = p_reactor_id AND reaction_type = p_reaction_type
  ) THEN
    DELETE FROM public.award_reactions
    WHERE award_id = p_award_id AND reactor_id = p_reactor_id AND reaction_type = p_reaction_type;
  ELSE
    INSERT INTO public.award_reactions (award_id, reactor_id, reaction_type)
    VALUES (p_award_id, p_reactor_id, p_reaction_type);
  END IF;
END;
$$;

GRANT SELECT, INSERT, DELETE ON public.award_reactions TO authenticated;
GRANT EXECUTE ON FUNCTION public.react_to_award(uuid, uuid, text) TO authenticated;
