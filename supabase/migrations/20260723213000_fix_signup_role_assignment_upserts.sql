/*
# Fix signup and role-assignment upserts

The role_assignments table uses a partial unique index for active/approved
roles. RPCs must include the same predicate in ON CONFLICT targets; otherwise
Postgres rejects the statement with "no unique or exclusion constraint".
*/

ALTER TABLE role_assignments ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE role_assignments DROP CONSTRAINT IF EXISTS role_assignments_status_check;
ALTER TABLE role_assignments ADD CONSTRAINT role_assignments_status_check
  CHECK (status IN ('pending', 'approved', 'active', 'removed', 'promoted'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_assignments_unique_active
  ON role_assignments (user_id, role)
  WHERE status IN ('active', 'approved');

DROP FUNCTION IF EXISTS complete_signup(text, text);
DROP FUNCTION IF EXISTS complete_signup(text, text, text);
CREATE OR REPLACE FUNCTION complete_signup(p_display_name text, p_role text, p_matricule text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_role text;
  v_matricule_valid boolean;
  v_instructor_exists boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to complete signup.';
  END IF;

  IF p_role NOT IN ('cadet', 'sentry', 'instructor') THEN
    RAISE EXCEPTION 'Invalid role.';
  END IF;

  INSERT INTO profiles (id, display_name, email)
  SELECT v_user_id, p_display_name, u.email
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        email = COALESCE(profiles.email, EXCLUDED.email);

  SELECT role INTO v_existing_role
  FROM role_assignments
  WHERE user_id = v_user_id
    AND status IN ('active', 'approved')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_role IS NOT NULL THEN
    RETURN true;
  END IF;

  IF p_role = 'instructor' THEN
    SELECT EXISTS(
      SELECT 1
      FROM role_assignments
      WHERE role = 'instructor'
        AND status IN ('active', 'approved')
    ) INTO v_instructor_exists;

    IF v_instructor_exists THEN
      RAISE EXCEPTION 'Instructor accounts can only be created by an existing instructor.';
    END IF;
  END IF;

  IF p_role = 'sentry' THEN
    IF p_matricule IS NULL OR btrim(p_matricule) = '' THEN
      RAISE EXCEPTION 'A matricule is required to sign up as a sentry.';
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM sentry_matricules
      WHERE matricule = p_matricule
        AND used = false
    ) INTO v_matricule_valid;

    IF NOT v_matricule_valid THEN
      RAISE EXCEPTION 'Invalid or already-used matricule.';
    END IF;

    UPDATE sentry_matricules
    SET used = true,
        assigned_to = v_user_id
    WHERE matricule = p_matricule;
  END IF;

  INSERT INTO role_assignments (user_id, role, status, start_date, end_date)
  VALUES (v_user_id, p_role, 'active', CURRENT_DATE, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    start_date = COALESCE(role_assignments.start_date, EXCLUDED.start_date),
    end_date = NULL;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION complete_signup(text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS promote_user(uuid, text);
CREATE OR REPLACE FUNCTION promote_user(p_user_id uuid, p_new_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM role_assignments
    WHERE user_id = v_caller
      AND role = 'instructor'
      AND status IN ('active', 'approved')
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can promote users';
  END IF;

  IF p_new_role NOT IN ('cadet', 'sentry', 'instructor') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE role_assignments
  SET status = CASE WHEN status = 'removed' THEN status ELSE 'removed' END,
      end_date = COALESCE(end_date, CURRENT_DATE)
  WHERE user_id = p_user_id
    AND status IN ('active', 'approved');

  INSERT INTO role_assignments (user_id, role, status, start_date, approver_id, end_date)
  VALUES (p_user_id, p_new_role, 'active', CURRENT_DATE, v_caller, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    approver_id = v_caller,
    start_date = EXCLUDED.start_date,
    end_date = NULL;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION promote_user(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION promote_to_sentry(p_user_id uuid, p_approver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM role_assignments
    WHERE user_id = p_approver_id
      AND role = 'instructor'
      AND status IN ('active', 'approved')
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can promote cadets';
  END IF;

  UPDATE role_assignments
  SET status = 'promoted',
      end_date = CURRENT_DATE
  WHERE user_id = p_user_id
    AND role = 'cadet'
    AND status IN ('active', 'approved');

  INSERT INTO role_assignments (user_id, role, status, approver_id, start_date, end_date)
  VALUES (p_user_id, 'sentry', 'active', p_approver_id, CURRENT_DATE, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    approver_id = p_approver_id,
    start_date = EXCLUDED.start_date,
    end_date = NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION promote_to_sentry(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION promote_to_instructor(p_new_instructor_id uuid, p_current_instructor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_instructor boolean;
  v_is_sentry boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM role_assignments
    WHERE user_id = p_current_instructor_id
      AND role = 'instructor'
      AND status IN ('active', 'approved')
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only the current instructor can hand over';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM role_assignments
    WHERE user_id = p_new_instructor_id
      AND role = 'sentry'
      AND status IN ('active', 'approved')
  ) INTO v_is_sentry;

  IF NOT v_is_sentry THEN
    RAISE EXCEPTION 'Only sentries can be promoted to instructor';
  END IF;

  UPDATE role_assignments
  SET status = 'removed',
      end_date = CURRENT_DATE
  WHERE user_id = p_current_instructor_id
    AND role = 'instructor'
    AND status IN ('active', 'approved');

  UPDATE role_assignments
  SET status = 'promoted',
      end_date = CURRENT_DATE
  WHERE user_id = p_new_instructor_id
    AND role = 'sentry'
    AND status IN ('active', 'approved');

  INSERT INTO role_assignments (user_id, role, status, approver_id, start_date, end_date)
  VALUES (p_new_instructor_id, 'instructor', 'active', p_current_instructor_id, CURRENT_DATE, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    approver_id = p_current_instructor_id,
    start_date = EXCLUDED.start_date,
    end_date = NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION promote_to_instructor(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS delete_sentry(uuid, uuid);
CREATE OR REPLACE FUNCTION delete_sentry(p_sentry_user_id uuid, p_replacement_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
  v_tent_id uuid;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM role_assignments
    WHERE user_id = v_caller
      AND role = 'instructor'
      AND status IN ('active', 'approved')
  ) INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete sentries';
  END IF;

  SELECT tent_id INTO v_tent_id
  FROM tent_members
  WHERE user_id = p_sentry_user_id
    AND role = 'sentry'
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    UPDATE role_assignments
    SET status = 'removed',
        end_date = CURRENT_DATE
    WHERE user_id = p_sentry_user_id
      AND role = 'sentry'
      AND status IN ('active', 'approved');
    RETURN true;
  END IF;

  IF p_replacement_user_id IS NOT NULL THEN
    DELETE FROM tent_members
    WHERE user_id = p_sentry_user_id
      AND role = 'sentry';

    UPDATE role_assignments
    SET status = 'removed',
        end_date = CURRENT_DATE
    WHERE user_id = p_sentry_user_id
      AND role = 'sentry'
      AND status IN ('active', 'approved');

    INSERT INTO tent_members (tent_id, user_id, role)
    VALUES (v_tent_id, p_replacement_user_id, 'sentry')
    ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'sentry';

    UPDATE tents
    SET sentry_id = p_replacement_user_id
    WHERE id = v_tent_id;

    UPDATE role_assignments
    SET status = 'promoted',
        end_date = CURRENT_DATE
    WHERE user_id = p_replacement_user_id
      AND role = 'cadet'
      AND status IN ('active', 'approved');

    INSERT INTO role_assignments (user_id, role, status, start_date, end_date)
    VALUES (p_replacement_user_id, 'sentry', 'active', CURRENT_DATE, NULL)
    ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
    DO UPDATE SET
      status = 'active',
      start_date = EXCLUDED.start_date,
      end_date = NULL;
  ELSE
    DELETE FROM tent_members WHERE tent_id = v_tent_id;
    DELETE FROM tents WHERE id = v_tent_id;

    UPDATE role_assignments
    SET status = 'removed',
        end_date = CURRENT_DATE
    WHERE user_id = p_sentry_user_id
      AND role = 'sentry'
      AND status IN ('active', 'approved');
  END IF;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_sentry(uuid, uuid) TO authenticated;
