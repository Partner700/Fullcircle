/*
# Enforce exclusive roles and consistent tent membership

- Restore PH to cadet without changing the account or its activity history.
- Allow only one active/approved role and one tent membership per user.
- Require tent membership roles to match the user's current platform role.
- Remove stale tent assignments whenever a user's role changes.
- Keep each tent's sentry row synchronized with tents.sentry_id.
*/

DO $$
DECLARE
  v_ph_id constant uuid := 'a70cc97a-7957-4ef8-90f7-b43b6584d111';
  v_restored integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_ph_id) THEN
    UPDATE public.role_assignments
    SET
      status = 'removed',
      end_date = CURRENT_DATE
    WHERE user_id = v_ph_id
      AND role = 'sentry'
      AND status IN ('active', 'approved');

    WITH latest_cadet_role AS (
      SELECT ctid
      FROM public.role_assignments
      WHERE user_id = v_ph_id
        AND role = 'cadet'
      ORDER BY created_at DESC
      LIMIT 1
    )
    UPDATE public.role_assignments ra
    SET
      status = 'active',
      end_date = NULL
    FROM latest_cadet_role latest
    WHERE ra.ctid = latest.ctid;

    GET DIAGNOSTICS v_restored = ROW_COUNT;

    IF v_restored = 0 THEN
      INSERT INTO public.role_assignments (
        user_id,
        role,
        status,
        start_date,
        end_date
      )
      VALUES (
        v_ph_id,
        'cadet',
        'active',
        CURRENT_DATE,
        NULL
      );
    END IF;

    UPDATE public.tent_members
    SET role = 'cadet'
    WHERE user_id = v_ph_id;

    UPDATE public.tents
    SET sentry_id = NULL
    WHERE sentry_id = v_ph_id;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_one_current_role
  ON public.role_assignments (user_id)
  WHERE status IN ('active', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS tent_members_one_membership_per_user
  ON public.tent_members (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS tents_one_tent_per_sentry
  ON public.tents (sentry_id)
  WHERE sentry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_tent_member_current_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    WHERE ra.user_id = NEW.user_id
      AND ra.role = NEW.role
      AND ra.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION
      'Tent membership role must match the user''s current platform role.';
  END IF;

  IF NEW.role = 'sentry' AND EXISTS (
    SELECT 1
    FROM public.tents t
    WHERE t.id = NEW.tent_id
      AND t.sentry_id IS NOT NULL
      AND t.sentry_id <> NEW.user_id
  ) THEN
    RAISE EXCEPTION 'This tent already has a different sentry.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_tent_member_current_role_trigger
  ON public.tent_members;
CREATE TRIGGER enforce_tent_member_current_role_trigger
  BEFORE INSERT OR UPDATE OF user_id, role, tent_id
  ON public.tent_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tent_member_current_role();

CREATE OR REPLACE FUNCTION public.cleanup_membership_after_role_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status IN ('active', 'approved')
    AND (
      NEW.status NOT IN ('active', 'approved')
      OR NEW.role IS DISTINCT FROM OLD.role
    )
  THEN
    DELETE FROM public.tent_members
    WHERE user_id = NEW.user_id
      AND role = OLD.role;

    IF OLD.role = 'sentry' THEN
      UPDATE public.tents
      SET sentry_id = NULL
      WHERE sentry_id = NEW.user_id;
    END IF;
  END IF;

  IF NEW.status IN ('active', 'approved') THEN
    DELETE FROM public.tent_members
    WHERE user_id = NEW.user_id
      AND role <> NEW.role;

    IF NEW.role <> 'sentry' THEN
      UPDATE public.tents
      SET sentry_id = NULL
      WHERE sentry_id = NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_membership_after_role_change_trigger
  ON public.role_assignments;
CREATE TRIGGER cleanup_membership_after_role_change_trigger
  AFTER INSERT OR UPDATE OF role, status
  ON public.role_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_membership_after_role_change();

CREATE OR REPLACE FUNCTION public.validate_tent_sentry_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sentry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    WHERE ra.user_id = NEW.sentry_id
      AND ra.role = 'sentry'
      AND ra.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'A tent sentry must have the current sentry role.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_tent_sentry_role_trigger
  ON public.tents;
CREATE TRIGGER validate_tent_sentry_role_trigger
  BEFORE INSERT OR UPDATE OF sentry_id
  ON public.tents
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_tent_sentry_role();

CREATE OR REPLACE FUNCTION public.sync_tent_sentry_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.sentry_id IS NOT NULL
    AND OLD.sentry_id IS DISTINCT FROM NEW.sentry_id
  THEN
    DELETE FROM public.tent_members
    WHERE tent_id = NEW.id
      AND user_id = OLD.sentry_id
      AND role = 'sentry';
  END IF;

  IF NEW.sentry_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR OLD.sentry_id IS DISTINCT FROM NEW.sentry_id
    )
  THEN
    INSERT INTO public.tent_members (tent_id, user_id, role)
    VALUES (NEW.id, NEW.sentry_id, 'sentry')
    ON CONFLICT (tent_id, user_id)
    DO UPDATE SET role = 'sentry';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_tent_sentry_membership_trigger
  ON public.tents;
CREATE TRIGGER sync_tent_sentry_membership_trigger
  AFTER INSERT OR UPDATE OF sentry_id
  ON public.tents
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tent_sentry_membership();

DROP FUNCTION IF EXISTS public.delete_sentry(uuid, uuid);
CREATE OR REPLACE FUNCTION public.delete_sentry(
  p_sentry_user_id uuid,
  p_replacement_user_id uuid DEFAULT NULL
)
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
  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments
    WHERE user_id = v_caller
      AND role = 'instructor'
      AND status IN ('active', 'approved')
  )
  INTO v_is_instructor;

  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can delete sentries';
  END IF;

  SELECT t.id
  INTO v_tent_id
  FROM public.tents t
  WHERE t.sentry_id = p_sentry_user_id
  LIMIT 1;

  UPDATE public.role_assignments
  SET
    status = 'removed',
    end_date = CURRENT_DATE
  WHERE user_id = p_sentry_user_id
    AND role = 'sentry'
    AND status IN ('active', 'approved');

  IF v_tent_id IS NULL THEN
    RETURN true;
  END IF;

  IF p_replacement_user_id IS NOT NULL THEN
    UPDATE public.role_assignments
    SET
      status = 'promoted',
      end_date = CURRENT_DATE
    WHERE user_id = p_replacement_user_id
      AND role = 'cadet'
      AND status IN ('active', 'approved');

    INSERT INTO public.role_assignments (
      user_id,
      role,
      status,
      start_date,
      end_date
    )
    VALUES (
      p_replacement_user_id,
      'sentry',
      'active',
      CURRENT_DATE,
      NULL
    )
    ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
    DO UPDATE SET
      status = 'active',
      start_date = EXCLUDED.start_date,
      end_date = NULL;

    UPDATE public.tents
    SET sentry_id = p_replacement_user_id
    WHERE id = v_tent_id;
  ELSE
    DELETE FROM public.tents
    WHERE id = v_tent_id;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_sentry(uuid, uuid) TO authenticated;
