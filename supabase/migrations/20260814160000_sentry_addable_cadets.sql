-- Let sentries list active cadets who do not currently belong to any tent.
-- The actual add action remains guarded by sentry_add_cadet_to_tent.

CREATE OR REPLACE FUNCTION public.get_sentry_addable_cadets(p_sentry_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tent_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only list cadets from your own sentry account.';
  END IF;

  SELECT tent.id INTO v_tent_id
  FROM public.tents tent
  WHERE tent.sentry_id = p_sentry_id
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    SELECT member.tent_id INTO v_tent_id
    FROM public.tent_members member
    WHERE member.user_id = p_sentry_id
      AND member.role = 'sentry'
    LIMIT 1;
  END IF;

  IF v_tent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (profile.id)
    profile.id AS user_id,
    profile.display_name,
    profile.avatar_url
  FROM public.profiles profile
  JOIN public.role_assignments assignment ON assignment.user_id = profile.id
  WHERE assignment.role = 'cadet'
    AND assignment.status IN ('active', 'approved')
    AND NOT EXISTS (
      SELECT 1
      FROM public.tent_members member
      WHERE member.user_id = profile.id
        AND member.role = 'cadet'
    )
  ORDER BY profile.id, profile.display_name ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sentry_addable_cadets(uuid) TO authenticated;
