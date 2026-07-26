/*
# Add delete_cadet RPC

Allows an instructor to remove a cadet from the system:
1. Deactivates their role_assignment (status -> 'inactive')
2. Removes them from any tent they're in
3. Does NOT delete the auth.users account — only removes their access
*/

DROP FUNCTION IF EXISTS delete_cadet(p_user_id uuid);
CREATE OR REPLACE FUNCTION delete_cadet(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller
      AND role = 'instructor'
      AND status = 'active'
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete cadets';
  END IF;

  -- Deactivate all role assignments for this user
  UPDATE role_assignments SET status = 'inactive' WHERE user_id = p_user_id;

  -- Remove from any tent
  DELETE FROM tent_members WHERE user_id = p_user_id;

  RETURN true;
END;
$$;
