-- Reader insight reactions in Today's Reading.

CREATE TABLE IF NOT EXISTS public.scripture_insight_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id uuid NOT NULL REFERENCES public.scripture_verse_insights(id) ON DELETE CASCADE,
  reactor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL CHECK (reaction_type IN ('heart', 'lightbulb')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insight_id, reactor_user_id, reaction_type)
);

ALTER TABLE public.scripture_insight_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users read scripture insight reactions"
ON public.scripture_insight_reactions;
CREATE POLICY "Authenticated users read scripture insight reactions"
ON public.scripture_insight_reactions
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX IF NOT EXISTS scripture_insight_reactions_insight_idx
ON public.scripture_insight_reactions(insight_id, reaction_type);

REVOKE ALL ON TABLE public.scripture_insight_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.scripture_insight_reactions TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_scripture_insight_reaction(
  p_insight_id uuid,
  p_reaction_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_reaction_type NOT IN ('heart', 'lightbulb') THEN
    RAISE EXCEPTION 'Unsupported insight reaction.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.scripture_verse_insights insight
    WHERE insight.id = p_insight_id
  ) THEN
    RAISE EXCEPTION 'Insight not found.';
  END IF;

  DELETE FROM public.scripture_insight_reactions reaction
  WHERE reaction.insight_id = p_insight_id
    AND reaction.reactor_user_id = v_user_id
    AND reaction.reaction_type = p_reaction_type;

  IF FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.scripture_insight_reactions (
    insight_id,
    reactor_user_id,
    reaction_type
  ) VALUES (
    p_insight_id,
    v_user_id,
    p_reaction_type
  )
  ON CONFLICT (insight_id, reactor_user_id, reaction_type) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_scripture_insight_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_scripture_insight_reaction(uuid, text) TO authenticated, service_role;
