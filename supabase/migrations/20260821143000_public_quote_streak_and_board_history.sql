/* Public, read-only streak data needed by quote cards. It exposes only the
   current streak and does not widen access to private ledgers or profiles. */

CREATE OR REPLACE FUNCTION public.get_public_quote_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE((SELECT current_streak FROM public.get_authoritative_streak(p_user_id) LIMIT 1), 0),
    COALESCE((SELECT current_streak FROM public.compute_strict_streak(p_user_id) LIMIT 1), 0)
  )::integer;
$$;

REVOKE ALL ON FUNCTION public.get_public_quote_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_quote_streak(uuid) TO authenticated, service_role;
