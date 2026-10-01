-- Aggregate only requested quotes; preserve existing RLS and return each avatar once.
CREATE OR REPLACE FUNCTION public.get_quote_reaction_summaries(p_quotes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to read quote reactions' USING ERRCODE = '42501';
  END IF;
  IF p_quotes IS NULL OR jsonb_typeof(p_quotes) <> 'array' THEN
    RAISE EXCEPTION 'Expected a quote list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_quotes) > 500 THEN
    RAISE EXCEPTION 'Too many quotes requested' USING ERRCODE = '22023';
  END IF;

  WITH wanted AS MATERIALIZED (
    SELECT DISTINCT q.user_id, q.record_date
    FROM jsonb_to_recordset(p_quotes) AS q(user_id uuid, record_date date)
    WHERE q.user_id IS NOT NULL AND q.record_date IS NOT NULL
  ), reactions AS MATERIALIZED (
    SELECT r.quote_user_id, r.quote_record_date, r.reaction_type, r.reactor_user_id
    FROM public.daily_quote_reactions r
    JOIN wanted w ON w.user_id = r.quote_user_id AND w.record_date = r.quote_record_date
  ), summaries AS (
    SELECT r.quote_user_id::text || ':' || to_char(r.quote_record_date, 'YYYY-MM-DD') AS quote_key,
      r.reaction_type AS kind,
      jsonb_build_object('count', count(*), 'reacted', bool_or(r.reactor_user_id = (SELECT auth.uid())),
        'actor_ids', jsonb_agg(DISTINCT r.reactor_user_id ORDER BY r.reactor_user_id)) AS value
    FROM reactions r GROUP BY r.quote_user_id, r.quote_record_date, r.reaction_type
    UNION ALL
    SELECT c.quote_user_id::text || ':' || to_char(c.quote_record_date, 'YYYY-MM-DD'), 'comments',
      jsonb_build_object('count', count(*), 'reacted', false)
    FROM public.daily_quote_comments c
    JOIN wanted w ON w.user_id = c.quote_user_id AND w.record_date = c.quote_record_date
    GROUP BY c.quote_user_id, c.quote_record_date
  ), by_quote AS (
    SELECT quote_key, jsonb_object_agg(kind, value) AS value FROM summaries GROUP BY quote_key
  ), actors AS (
    SELECT p.id, jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url) AS value
    FROM public.profiles p WHERE p.id IN (SELECT reactor_user_id FROM reactions)
  )
  SELECT jsonb_build_object(
    'quotes', COALESCE((SELECT jsonb_object_agg(quote_key, value) FROM by_quote), '{}'::jsonb),
    'actors', COALESCE((SELECT jsonb_object_agg(id::text, value) FROM actors), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_quote_reaction_summaries(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quote_reaction_summaries(jsonb) TO authenticated;
