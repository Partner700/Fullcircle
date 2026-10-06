/*
  The earliest role helpers inherited their caller's search_path and used
  unqualified relation names. Hardened RPCs intentionally set search_path to
  an empty value, so calling is_instructor() from one of them could fail with
  "relation role_assignments does not exist" before the RPC returned data.

  Keep the established behavior and privileges while making every shared role
  lookup independent of its caller's search path.
*/

CREATE OR REPLACE FUNCTION public.get_user_active_role(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT assignment.role
  FROM public.role_assignments assignment
  WHERE assignment.user_id = p_user_id
    AND assignment.status IN ('active', 'approved')
  ORDER BY assignment.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_instructor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = p_user_id
      AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_sentry(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = p_user_id
      AND assignment.role = 'sentry'
      AND assignment.status IN ('active', 'approved')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_tent_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT member.tent_id
  FROM public.tent_members member
  WHERE member.user_id = p_user_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.is_instructor(uuid) IS
  'Schema-safe active instructor lookup for RLS policies and hardened RPCs.';
COMMENT ON FUNCTION public.is_sentry(uuid) IS
  'Schema-safe active sentry lookup for RLS policies and hardened RPCs.';
