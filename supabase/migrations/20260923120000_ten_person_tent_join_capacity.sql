-- Tent applications are available only while a tent has fewer than ten
-- distinct people. Count both cadets and the sentry, and enforce the limit at
-- the membership table so no UI, RPC, or concurrent approval can bypass it.

CREATE OR REPLACE FUNCTION public.enforce_tent_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_count integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.tent_id IS NOT DISTINCT FROM NEW.tent_id
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.tents tent
  WHERE tent.id = NEW.tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT count(DISTINCT member.user_id)::integer
    INTO v_member_count
    FROM public.tent_members member
    WHERE member.tent_id = NEW.tent_id
      AND member.id <> OLD.id;
  ELSE
    SELECT count(DISTINCT member.user_id)::integer
    INTO v_member_count
    FROM public.tent_members member
    WHERE member.tent_id = NEW.tent_id;
  END IF;

  IF coalesce(v_member_count, 0) >= 10 THEN
    RAISE EXCEPTION 'This tent is full (maximum 10 people).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_tent_capacity_trigger ON public.tent_members;
CREATE TRIGGER enforce_tent_capacity_trigger
BEFORE INSERT OR UPDATE OF tent_id, user_id ON public.tent_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_tent_capacity();

CREATE OR REPLACE FUNCTION public.request_to_join_tent(p_tent_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_member_count integer;
  v_tent_name text;
  v_applicant_name text;
  v_sentry_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to request a tent.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You already belong to a tent.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only cadets who are not yet in a tent can apply.';
  END IF;

  SELECT tent.name
  INTO v_tent_name
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  SELECT count(DISTINCT member.user_id)::integer
  INTO v_member_count
  FROM public.tent_members member
  WHERE member.tent_id = p_tent_id;
  IF coalesce(v_member_count, 0) >= 10 THEN
    RAISE EXCEPTION 'This tent already has 10 people. Please choose another tent.';
  END IF;

  UPDATE public.tent_join_requests
  SET status = 'cancelled', reviewed_at = now()
  WHERE user_id = auth.uid() AND status = 'pending';

  INSERT INTO public.tent_join_requests(tent_id, user_id)
  VALUES (p_tent_id, auth.uid())
  RETURNING id INTO v_request_id;

  SELECT display_name INTO v_applicant_name
  FROM public.profiles
  WHERE id = auth.uid();

  FOR v_sentry_id IN
    SELECT DISTINCT sentry.user_id
    FROM (
      SELECT tent.sentry_id AS user_id
      FROM public.tents tent
      WHERE tent.id = p_tent_id
      UNION ALL
      SELECT member.user_id
      FROM public.tent_members member
      WHERE member.tent_id = p_tent_id AND member.role = 'sentry'
    ) sentry
    WHERE sentry.user_id IS NOT NULL
  LOOP
    PERFORM public.notify_user(
      v_sentry_id,
      auth.uid(),
      'tent_join_request',
      'Tent application',
      coalesce(v_applicant_name, 'A new cadet') || ' applied to join ' || coalesce(v_tent_name, 'your tent') || '.',
      'cadets',
      jsonb_build_object('request_id', v_request_id, 'tent_id', p_tent_id, 'applicant_id', auth.uid())
    );
  END LOOP;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_tent_join_request(p_request_id uuid, p_approve boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.tent_join_requests%ROWTYPE;
  v_allowed boolean;
  v_member_count integer;
  v_tent_name text;
BEGIN
  SELECT * INTO v_request
  FROM public.tent_join_requests
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending request not found.'; END IF;

  SELECT public.is_instructor(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tents tent
    WHERE tent.id = v_request.tent_id AND tent.sentry_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.tent_members member
    WHERE member.tent_id = v_request.tent_id
      AND member.user_id = auth.uid()
      AND member.role = 'sentry'
  ) INTO v_allowed;
  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'Only this tent''s sentry or the instructor can review this application.';
  END IF;

  SELECT tent.name INTO v_tent_name
  FROM public.tents tent
  WHERE tent.id = v_request.tent_id;

  IF p_approve THEN
    PERFORM 1
    FROM public.tents tent
    WHERE tent.id = v_request.tent_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

    IF EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.user_id = v_request.user_id
        AND member.tent_id <> v_request.tent_id
    ) THEN
      RAISE EXCEPTION 'This cadet already belongs to another tent.';
    END IF;

    SELECT count(DISTINCT member.user_id)::integer
    INTO v_member_count
    FROM public.tent_members member
    WHERE member.tent_id = v_request.tent_id;
    IF coalesce(v_member_count, 0) >= 10 AND NOT EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.user_id = v_request.user_id
        AND member.tent_id = v_request.tent_id
    ) THEN
      RAISE EXCEPTION 'This tent is full (maximum 10 people).';
    END IF;

    INSERT INTO public.tent_members(tent_id, user_id, role)
    VALUES (v_request.tent_id, v_request.user_id, 'cadet')
    ON CONFLICT (user_id) DO UPDATE
      SET role = CASE
        WHEN public.tent_members.tent_id = EXCLUDED.tent_id THEN 'cadet'
        ELSE public.tent_members.role
      END;
  END IF;

  UPDATE public.tent_join_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_request_id;

  IF p_approve THEN
    UPDATE public.tent_join_requests
    SET status = 'cancelled', reviewed_at = now()
    WHERE user_id = v_request.user_id
      AND id <> p_request_id
      AND status = 'pending';
  END IF;

  PERFORM public.notify_user(
    v_request.user_id,
    auth.uid(),
    'tent_join_request',
    CASE WHEN p_approve THEN 'Tent application accepted' ELSE 'Tent application declined' END,
    CASE WHEN p_approve
      THEN 'You are now a member of ' || coalesce(v_tent_name, 'your tent') || '.'
      ELSE coalesce(v_tent_name, 'The tent') || ' could not accept your application this time.'
    END,
    'tent',
    jsonb_build_object('request_id', p_request_id, 'tent_id', v_request.tent_id, 'approved', p_approve)
  );
  RETURN true;
END;
$$;

-- Pending applications to tents which are already full must return to the
-- available-tent picker instead of remaining actionable for a sentry.
UPDATE public.tent_join_requests request
SET status = 'cancelled', reviewed_at = now()
WHERE request.status = 'pending'
  AND (
    SELECT count(DISTINCT member.user_id)
    FROM public.tent_members member
    WHERE member.tent_id = request.tent_id
  ) >= 10;

REVOKE ALL ON FUNCTION public.request_to_join_tent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_tent_join_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_to_join_tent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tent_join_request(uuid, boolean) TO authenticated;
