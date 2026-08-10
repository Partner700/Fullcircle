/* Keep contact/onboarding data private while preserving the social directory. */

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  RETURN CASE WHEN FOUND THEN to_jsonb(v_profile) ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profiles_for_instructor()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can read private profile details.';
  END IF;
  RETURN QUERY SELECT profile.* FROM public.profiles profile ORDER BY profile.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_profiles_for_instructor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profiles_for_instructor() TO authenticated;

-- Table reads are limited to fields needed for names, avatars, comments,
-- leaderboards, tents, and Arena presence. Private columns are available only
-- through the two scoped functions above.
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, display_name, avatar_url, created_at) ON public.profiles TO authenticated;

