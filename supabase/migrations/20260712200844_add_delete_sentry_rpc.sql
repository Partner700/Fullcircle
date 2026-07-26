/*
# Add delete_sentry RPC

Allows an instructor to remove a sentry. Two modes:
1. p_replacement_user_id IS NULL → delete the tent entirely
   (cascade removes tent_members for all cadets in that tent)
2. p_replacement_user_id IS PROVIDED → swap the sentry:
   the old sentry is removed from tent_members and deactivated,
   the replacement is inserted as the new sentry for that tent.

The caller must be an active instructor.
*/

DROP FUNCTION IF EXISTS delete_sentry(p_sentry_user_id uuid, p_replacement_user_id uuid);
CREATE OR REPLACE FUNCTION delete_sentry(
  p_sentry_user_id uuid,
  p_replacement_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
  v_tent_id uuid;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller
      AND role = 'instructor'
      AND status = 'active'
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete sentries';
  END IF;

  -- Find the tent this sentry leads
  SELECT tent_id INTO v_tent_id
  FROM tent_members
  WHERE user_id = p_sentry_user_id AND role = 'sentry'
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    -- Sentry has no tent — just deactivate their role
    UPDATE role_assignments SET status = 'inactive'
    WHERE user_id = p_sentry_user_id AND role = 'sentry';
    RETURN true;
  END IF;

  IF p_replacement_user_id IS NOT NULL THEN
    -- Replace: remove old sentry from tent, insert new one
    DELETE FROM tent_members
    WHERE user_id = p_sentry_user_id AND role = 'sentry';

    -- Deactivate old sentry's role
    UPDATE role_assignments SET status = 'inactive'
    WHERE user_id = p_sentry_user_id AND role = 'sentry';

    -- Insert replacement as sentry (upsert in case they're already a member)
    INSERT INTO tent_members (tent_id, user_id, role)
    VALUES (v_tent_id, p_replacement_user_id, 'sentry')
    ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'sentry';

    -- Ensure replacement has an active sentry role
    INSERT INTO role_assignments (user_id, role, status, requested_at)
    VALUES (p_replacement_user_id, 'sentry', 'active', now())
    ON CONFLICT (user_id, role) DO UPDATE SET status = 'active';
  ELSE
    -- No replacement → delete the entire tent (cascades to tent_members)
    DELETE FROM tent_members WHERE tent_id = v_tent_id;
    DELETE FROM tents WHERE id = v_tent_id;

    -- Deactivate old sentry's role
    UPDATE role_assignments SET status = 'inactive'
    WHERE user_id = p_sentry_user_id AND role = 'sentry';
  END IF;

  RETURN true;
END;
$$;
