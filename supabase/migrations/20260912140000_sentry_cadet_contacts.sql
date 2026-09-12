-- Keep contact numbers private while letting sentries contact their own cadets.
CREATE OR REPLACE FUNCTION public.get_sentry_cadet_contacts(p_tent_id uuid)
RETURNS TABLE(user_id uuid, whatsapp_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_instructor(v_caller)
     AND NOT public.is_sentry_of_tent(v_caller, p_tent_id) THEN
    RAISE EXCEPTION 'Only the tent sentry or an instructor can view these contacts.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.whatsapp_number
  FROM public.tent_members member
  JOIN public.profiles profile ON profile.id = member.user_id
  WHERE member.tent_id = p_tent_id
    AND member.role = 'cadet'
  ORDER BY member.joined_at, member.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sentry_cadet_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sentry_cadet_contacts(uuid) TO authenticated;
