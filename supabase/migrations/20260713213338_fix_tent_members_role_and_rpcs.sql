/*
# Fix tent_members: add role column + fix all RPCs

1. Add `role` column to tent_members (cadet | sentry, default cadet)
2. Populate role from tents.sentry_id for existing rows
3. Fix enforce_tent_capacity trigger to count only cadets (not sentries)
4. Fix delete_cadet and delete_sentry to use 'removed' (valid status)
5. Update add_cadet_to_tent, set_tent_sentry RPCs to set role
*/

-- 1. Add role column
ALTER TABLE tent_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'cadet'
  CHECK (role IN ('cadet','sentry'));

-- 2. Backfill: set role='sentry' where user_id matches tents.sentry_id
UPDATE tent_members tm
SET role = 'sentry'
FROM tents t
WHERE tm.tent_id = t.id
  AND t.sentry_id = tm.user_id;

-- 3. Fix capacity trigger: only count cadets
CREATE OR REPLACE FUNCTION enforce_tent_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_cadet_count int;
  max_c int;
BEGIN
  -- Only enforce capacity for cadets, not sentries
  IF NEW.role = 'sentry' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO current_cadet_count
    FROM tent_members WHERE tent_id = NEW.tent_id AND role = 'cadet';
  SELECT max_cadets INTO max_c FROM tents WHERE id = NEW.tent_id;
  IF current_cadet_count >= COALESCE(max_c, 5) THEN
    RAISE EXCEPTION 'Tent is full (max % cadets)', COALESCE(max_c, 5);
  END IF;
  RETURN NEW;
END;
$$;

-- 4a. Fix delete_cadet: use 'removed' (valid status)
DROP FUNCTION IF EXISTS delete_cadet(uuid);
CREATE OR REPLACE FUNCTION delete_cadet(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller AND role = 'instructor' AND status = 'active'
  ) INTO v_is_instructor;
  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete cadets';
  END IF;
  UPDATE role_assignments SET status = 'removed' WHERE user_id = p_user_id;
  DELETE FROM tent_members WHERE user_id = p_user_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_cadet(uuid) TO authenticated;

-- 4b. Fix delete_sentry: use 'removed' (valid status)
DROP FUNCTION IF EXISTS delete_sentry(uuid, uuid);
CREATE OR REPLACE FUNCTION delete_sentry(p_sentry_user_id uuid, p_replacement_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
  v_tent_id uuid;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller AND role = 'instructor' AND status = 'active'
  ) INTO v_is_instructor;
  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete sentries';
  END IF;

  SELECT tent_id INTO v_tent_id
  FROM tent_members WHERE user_id = p_sentry_user_id AND role = 'sentry' LIMIT 1;

  IF v_tent_id IS NULL THEN
    UPDATE role_assignments SET status = 'removed'
    WHERE user_id = p_sentry_user_id AND role = 'sentry';
    RETURN true;
  END IF;

  IF p_replacement_user_id IS NOT NULL THEN
    DELETE FROM tent_members WHERE user_id = p_sentry_user_id AND role = 'sentry';
    UPDATE role_assignments SET status = 'removed'
    WHERE user_id = p_sentry_user_id AND role = 'sentry';
    INSERT INTO tent_members (tent_id, user_id, role)
    VALUES (v_tent_id, p_replacement_user_id, 'sentry')
    ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'sentry';
    UPDATE tents SET sentry_id = p_replacement_user_id WHERE id = v_tent_id;
    INSERT INTO role_assignments (user_id, role, status)
    VALUES (p_replacement_user_id, 'sentry', 'active')
    ON CONFLICT (user_id, role) DO UPDATE SET status = 'active';
  ELSE
    DELETE FROM tent_members WHERE tent_id = v_tent_id;
    DELETE FROM tents WHERE id = v_tent_id;
    UPDATE role_assignments SET status = 'removed'
    WHERE user_id = p_sentry_user_id AND role = 'sentry';
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_sentry(uuid, uuid) TO authenticated;

-- 5. Fix add_cadet_to_tent to always set role='cadet'
CREATE OR REPLACE FUNCTION add_cadet_to_tent(p_tent_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tent_members (tent_id, user_id, role)
  VALUES (p_tent_id, p_user_id, 'cadet')
  ON CONFLICT (tent_id, user_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION add_cadet_to_tent(uuid, uuid) TO authenticated;

-- 6. Fix delete_tent to remove all members first
CREATE OR REPLACE FUNCTION delete_tent(p_tent_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller AND role = 'instructor' AND status = 'active'
  ) INTO v_is_instructor;
  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete tents';
  END IF;
  DELETE FROM tent_members WHERE tent_id = p_tent_id;
  DELETE FROM tents WHERE id = p_tent_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_tent(uuid) TO authenticated;
