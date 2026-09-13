-- Keep the same profile access boundary and add approved real-life challenges.
CREATE OR REPLACE FUNCTION public.get_profile_cv(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_result jsonb;
BEGIN
  IF v_caller IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND v_caller IS DISTINCT FROM v_target
     AND NOT public.is_instructor(v_caller)
     AND NOT EXISTS (
       SELECT 1
       FROM public.tents tent
       JOIN public.tent_members member ON member.tent_id = tent.id
       WHERE tent.sentry_id = v_caller
         AND member.user_id = v_target
     )
  THEN
    RAISE EXCEPTION 'You cannot view this profile.';
  END IF;

  SELECT jsonb_build_object(
    'user_id', profile.id,
    'display_name', profile.display_name,
    'avatar_url', profile.avatar_url,
    'role', coalesce(active_role.role, 'cadet'),
    'tent_id', home_tent.id,
    'tent_name', home_tent.name,
    'tent_house_id', home_tent.tent_house_id,
    'member_since', profile.created_at,
    'total_denarii', stats.total_denarii,
    'current_streak', stats.current_streak,
    'longest_streak', stats.longest_streak,
    'total_figs', stats.total_figs,
    'rhudes', stats.rhudes,
    'marks', stats.marks,
    'completed_challenges', (SELECT count(*) FROM public.challenge_submissions challenge
      WHERE challenge.user_id = profile.id AND challenge.status = 'approved')
  )
  INTO v_result
  FROM public.profiles profile
  CROSS JOIN LATERAL public.get_user_live_stats(profile.id) stats
  LEFT JOIN LATERAL (
    SELECT assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.user_id = profile.id
      AND assignment.status IN ('active', 'approved', 'promoted')
      AND (assignment.end_date IS NULL OR assignment.end_date >= timezone('Africa/Douala', now())::date)
    ORDER BY CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
             assignment.created_at DESC
    LIMIT 1
  ) active_role ON true
  LEFT JOIN LATERAL (
    SELECT tent.id, tent.name, tent.tent_house_id
    FROM public.tents tent
    LEFT JOIN public.tent_members member
      ON member.tent_id = tent.id
     AND member.user_id = profile.id
    WHERE member.user_id IS NOT NULL OR tent.sentry_id = profile.id
    ORDER BY coalesce(member.joined_at, tent.created_at) DESC
    LIMIT 1
  ) home_tent ON true
  WHERE profile.id = v_target;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'This Full Circle profile does not exist.';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_cv(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_cv(uuid) TO authenticated, service_role;
