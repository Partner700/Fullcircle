CREATE TABLE IF NOT EXISTS public.daily_quote_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote_record_date date NOT NULL,
  reactor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL CHECK (reaction_type IN ('amen', 'spark', 'thoughtful')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_user_id, quote_record_date, reactor_user_id, reaction_type)
);

ALTER TABLE public.daily_quote_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_quote_reactions_select" ON public.daily_quote_reactions;
CREATE POLICY "daily_quote_reactions_select"
  ON public.daily_quote_reactions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "daily_quote_reactions_insert_own" ON public.daily_quote_reactions;
CREATE POLICY "daily_quote_reactions_insert_own"
  ON public.daily_quote_reactions FOR INSERT TO authenticated
  WITH CHECK (reactor_user_id = auth.uid());

DROP POLICY IF EXISTS "daily_quote_reactions_delete_own" ON public.daily_quote_reactions;
CREATE POLICY "daily_quote_reactions_delete_own"
  ON public.daily_quote_reactions FOR DELETE TO authenticated
  USING (reactor_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_daily_quote_reactions_quote
  ON public.daily_quote_reactions(quote_user_id, quote_record_date);

CREATE OR REPLACE FUNCTION public.react_to_daily_quote(
  p_quote_user_id uuid,
  p_quote_record_date date,
  p_reactor_user_id uuid,
  p_reaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote text;
  v_reactor_name text;
BEGIN
  IF p_reaction_type NOT IN ('amen', 'spark', 'thoughtful') THEN
    RAISE EXCEPTION 'Unsupported reaction type';
  END IF;

  SELECT daily_quote INTO v_quote
  FROM public.daily_records
  WHERE user_id = p_quote_user_id
    AND record_date = p_quote_record_date
    AND NULLIF(btrim(COALESCE(daily_quote, '')), '') IS NOT NULL;

  IF v_quote IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  INSERT INTO public.daily_quote_reactions (
    quote_user_id,
    quote_record_date,
    reactor_user_id,
    reaction_type
  )
  VALUES (
    p_quote_user_id,
    p_quote_record_date,
    p_reactor_user_id,
    p_reaction_type
  )
  ON CONFLICT (quote_user_id, quote_record_date, reactor_user_id, reaction_type)
  DO NOTHING;

  IF p_quote_user_id <> p_reactor_user_id THEN
    SELECT display_name INTO v_reactor_name
    FROM public.profiles
    WHERE id = p_reactor_user_id;

    PERFORM public.notify_user(
      p_quote_user_id,
      p_reactor_user_id,
      'social',
      'Quote reaction',
      COALESCE(v_reactor_name, 'Someone') || ' reacted to your quote.',
      'dashboard',
      jsonb_build_object(
        'quote_record_date', p_quote_record_date,
        'reaction_type', p_reaction_type
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT SELECT, INSERT, DELETE ON public.daily_quote_reactions TO authenticated;
GRANT EXECUTE ON FUNCTION public.react_to_daily_quote(uuid, date, uuid, text) TO authenticated;
