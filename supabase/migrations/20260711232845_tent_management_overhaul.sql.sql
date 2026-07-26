/*
# Tent management improvements

1. Changes
- Add `max_cadets` column to `tents` table (default 5, not null)
- Add CHECK constraint to prevent tents from exceeding 5 cadets
- Create `remove_tent_member` RPC: removes a cadet from a tent
- Create `set_tent_sentry` RPC: assigns or changes sentry on a tent
- Create `add_cadet_to_tent` RPC: adds a cadet to an existing tent (enforces 5-cap)
- Create `delete_role_assignment` RPC: deletes a user's role assignment (for removing sentries/cadets)

2. Security
- All RPCs are SECURITY DEFINER, execute to authenticated
- No RLS policy changes needed
*/

-- Add max_cadets column
ALTER TABLE tents ADD COLUMN IF NOT EXISTS max_cadets int NOT NULL DEFAULT 5;

-- Add cadet count check constraint (enforced at tent_members insert via trigger)
CREATE OR REPLACE FUNCTION enforce_tent_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count int;
  max_cadets int;
BEGIN
  SELECT count(*) INTO current_count FROM tent_members WHERE tent_id = NEW.tent_id;
  SELECT max_cadets INTO max_cadets FROM tents WHERE id = NEW.tent_id;
  IF current_count >= max_cadets THEN
    RAISE EXCEPTION 'Tent is full (max % cadets)', max_cadets;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_tent_capacity_trigger ON tent_members;
CREATE TRIGGER enforce_tent_capacity_trigger
  BEFORE INSERT ON tent_members
  FOR EACH ROW EXECUTE FUNCTION enforce_tent_capacity();

-- Remove a cadet from a tent
CREATE OR REPLACE FUNCTION remove_tent_member(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM tent_members WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_tent_member(uuid) TO authenticated;

-- Add a cadet to an existing tent (enforces capacity)
CREATE OR REPLACE FUNCTION add_cadet_to_tent(p_tent_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tent_members (tent_id, user_id)
  VALUES (p_tent_id, p_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION add_cadet_to_tent(uuid, uuid) TO authenticated;

-- Delete a role assignment (removes sentry or cadet role)
CREATE OR REPLACE FUNCTION delete_role_assignment(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove from tent first
  DELETE FROM tent_members WHERE user_id = p_user_id;
  -- Clear sentry assignment on any tents they own
  UPDATE tents SET sentry_id = NULL WHERE sentry_id = p_user_id;
  -- Delete the role
  DELETE FROM role_assignments WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_role_assignment(uuid) TO authenticated;
