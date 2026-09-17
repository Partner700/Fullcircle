-- Delete live tent assignments without discarding historical leaderboard rows.
-- The original RPC predates the snapshot tables, whose non-cascading foreign
-- keys prevented instructors from deleting any tent represented in history.

CREATE OR REPLACE FUNCTION public.delete_tent(p_tent_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only active instructors can delete tents'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Preserve the person's historical board record while detaching it from a
  -- tent that no longer exists. Current memberships and conversations retain
  -- their existing ON DELETE CASCADE behavior.
  UPDATE public.streakboard_snapshots
  SET tent_id = NULL
  WHERE tent_id = p_tent_id;

  UPDATE public.leaderboard_weekly_snapshots
  SET tent_id = NULL
  WHERE tent_id = p_tent_id;

  DELETE FROM public.tent_members
  WHERE tent_id = p_tent_id;

  DELETE FROM public.tents
  WHERE id = p_tent_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_tent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_tent(uuid) TO authenticated, service_role;
