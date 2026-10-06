/*
  Always provide the signed-in instructor's authoritative camp totals. This
  single-row fallback is deliberately independent of the multi-instructor
  competition roster so a missing legacy roster row cannot empty the boards.
*/

CREATE OR REPLACE FUNCTION public.get_current_instructor_camp_totals()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  narratives numeric,
  residents numeric,
  marks numeric,
  total_denarii numeric,
  total_figs numeric,
  rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view instructor camp totals.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH members AS MATERIALIZED (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), components AS MATERIALIZED (
    SELECT component.*
    FROM public.get_member_mark_components() component
    JOIN members member ON member.user_id = component.user_id
  ), totals AS (
    SELECT
      (SELECT count(*)::numeric FROM public.daily_narratives) AS narratives,
      (SELECT count(*)::numeric FROM members) AS residents,
      coalesce((SELECT sum(component.marks)::numeric FROM components component), 0)::numeric AS member_marks,
      coalesce((SELECT sum(component.wallet_denarii)::numeric FROM components component), 0)::numeric AS denarii,
      coalesce((SELECT sum(component.total_figs)::numeric FROM components component), 0)::numeric AS figs
  )
  SELECT
    profile.id,
    profile.display_name,
    profile.avatar_url,
    totals.narratives,
    totals.residents,
    (totals.member_marks + totals.narratives + totals.residents * 5)::numeric,
    totals.denarii,
    totals.figs,
    1
  FROM public.profiles profile
  CROSS JOIN totals
  WHERE profile.id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_instructor_camp_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_instructor_camp_totals() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_current_instructor_camp_totals() IS
  'Returns the current instructor camp totals even when the competition roster is unavailable.';
