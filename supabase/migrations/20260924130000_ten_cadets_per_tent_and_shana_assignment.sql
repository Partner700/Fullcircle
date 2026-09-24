/*
  A tent's capacity is ten cadets. Its sentry is leadership and does not use a
  cadet place. The preceding capacity release counted the sentry among ten
  people, which incorrectly made a tent with one sentry and nine cadets full.

  Keep the database trigger, instructor assignment, sentry assignment, tour
  direction, applications, and approvals on the same rule. If the reported
  Shana and Square A0 records are both unambiguous, finish that requested
  placement without moving Shana away from any existing tent.
*/

UPDATE public.tents
SET max_cadets = 10
WHERE max_cadets IS NULL OR max_cadets < 10;

CREATE OR REPLACE FUNCTION public.tent_cadet_limit(p_tent_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT greatest(coalesce(tent.max_cadets, 10), 10)::integer
  FROM public.tents tent
  WHERE tent.id = p_tent_id;
$$;

CREATE OR REPLACE FUNCTION public.tent_cadet_count(p_tent_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(DISTINCT member.user_id)::integer
  FROM public.tent_members member
  WHERE member.tent_id = p_tent_id
    AND coalesce(member.role, 'cadet') = 'cadet';
$$;

REVOKE ALL ON FUNCTION public.tent_cadet_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tent_cadet_count(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_tent_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadet_count integer;
  v_cadet_limit integer;
BEGIN
  PERFORM 1
  FROM public.tents tent
  WHERE tent.id = NEW.tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  -- Sentries occupy their own leadership place and never consume a cadet slot.
  IF coalesce(NEW.role, 'cadet') <> 'cadet' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT count(DISTINCT member.user_id)::integer
    INTO v_cadet_count
    FROM public.tent_members member
    WHERE member.tent_id = NEW.tent_id
      AND coalesce(member.role, 'cadet') = 'cadet'
      AND member.id <> OLD.id;
  ELSE
    SELECT count(DISTINCT member.user_id)::integer
    INTO v_cadet_count
    FROM public.tent_members member
    WHERE member.tent_id = NEW.tent_id
      AND coalesce(member.role, 'cadet') = 'cadet';
  END IF;

  v_cadet_limit := public.tent_cadet_limit(NEW.tent_id);
  IF coalesce(v_cadet_count, 0) >= coalesce(v_cadet_limit, 10) THEN
    RAISE EXCEPTION 'This tent is full (maximum % cadets plus its sentry).', coalesce(v_cadet_limit, 10);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_tent_capacity_trigger ON public.tent_members;
CREATE TRIGGER enforce_tent_capacity_trigger
BEFORE INSERT OR UPDATE OF tent_id, user_id, role ON public.tent_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_tent_capacity();

CREATE OR REPLACE FUNCTION public.assign_cadet_to_tent(p_tent_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadet_limit integer;
  v_cadet_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can assign cadets to tents.';
  END IF;

  PERFORM 1 FROM public.tents tent WHERE tent.id = p_tent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = p_user_id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'User is not an active cadet.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tent_members member
    WHERE member.user_id = p_user_id AND member.tent_id <> p_tent_id
  ) THEN
    RAISE EXCEPTION 'This cadet already belongs to another tent. Remove that membership before assigning a new one.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tent_members member
    WHERE member.user_id = p_user_id AND member.tent_id = p_tent_id
  ) THEN
    RETURN true;
  END IF;

  v_cadet_limit := public.tent_cadet_limit(p_tent_id);
  v_cadet_count := public.tent_cadet_count(p_tent_id);
  IF v_cadet_count >= v_cadet_limit THEN
    RAISE EXCEPTION 'Tent is full (maximum % cadets plus its sentry).', v_cadet_limit;
  END IF;

  INSERT INTO public.tent_members(tent_id, user_id, role)
  VALUES (p_tent_id, p_user_id, 'cadet');

  UPDATE public.tent_join_requests request
  SET status = CASE WHEN request.tent_id = p_tent_id THEN 'approved' ELSE 'cancelled' END,
      reviewed_by = auth.uid(),
      reviewed_at = coalesce(request.reviewed_at, now())
  WHERE request.user_id = p_user_id AND request.status = 'pending';
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.sentry_assign_cadet_to_tent(
  p_tent_id uuid,
  p_cadet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_tent public.tents%ROWTYPE;
  v_existing_tent_id uuid;
  v_cadet_limit integer;
  v_cadet_count integer;
  v_receipt jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before adding a cadet to a tent.';
  END IF;

  SELECT tent.* INTO v_tent
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  IF NOT (
    public.is_instructor(v_actor_id)
    OR v_tent.sentry_id = v_actor_id
    OR EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.tent_id = p_tent_id
        AND member.user_id = v_actor_id
        AND member.role = 'sentry'
    )
  ) THEN
    RAISE EXCEPTION 'You can only add cadets to the tent currently assigned to you.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = p_cadet_id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'That user is not an active cadet.';
  END IF;

  SELECT member.tent_id INTO v_existing_tent_id
  FROM public.tent_members member
  WHERE member.user_id = p_cadet_id
  ORDER BY member.joined_at DESC NULLS LAST, member.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_tent_id IS NOT NULL AND v_existing_tent_id <> p_tent_id THEN
    RAISE EXCEPTION 'This cadet already belongs to another tent.';
  END IF;

  IF v_existing_tent_id IS NULL THEN
    v_cadet_limit := public.tent_cadet_limit(p_tent_id);
    v_cadet_count := public.tent_cadet_count(p_tent_id);
    IF v_cadet_count >= v_cadet_limit THEN
      RAISE EXCEPTION 'Tent is full (maximum % cadets plus its sentry).', v_cadet_limit;
    END IF;

    INSERT INTO public.tent_members(tent_id, user_id, role)
    VALUES (p_tent_id, p_cadet_id, 'cadet')
    ON CONFLICT (user_id) DO UPDATE
    SET tent_id = EXCLUDED.tent_id,
        role = 'cadet';
  ELSE
    UPDATE public.tent_members member
    SET role = 'cadet'
    WHERE member.user_id = p_cadet_id
      AND member.tent_id = p_tent_id;
  END IF;

  UPDATE public.tent_join_requests request
  SET status = CASE WHEN request.tent_id = p_tent_id THEN 'approved' ELSE 'cancelled' END,
      reviewed_by = v_actor_id,
      reviewed_at = coalesce(request.reviewed_at, now())
  WHERE request.user_id = p_cadet_id
    AND request.status = 'pending';

  SELECT jsonb_build_object(
    'success', true,
    'user_id', member.user_id,
    'tent_id', member.tent_id,
    'tent_name', tent.name,
    'tent_house_id', tent.tent_house_id,
    'role', member.role
  ) INTO v_receipt
  FROM public.tent_members member
  JOIN public.tents tent ON tent.id = member.tent_id
  WHERE member.user_id = p_cadet_id
    AND member.tent_id = p_tent_id;

  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'Tent assignment could not be verified.';
  END IF;
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sentry_addable_cadets(p_sentry_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tent_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only list cadets from your own sentry account.';
  END IF;

  SELECT tent.id INTO v_tent_id
  FROM public.tents tent
  WHERE tent.sentry_id = p_sentry_id
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    SELECT member.tent_id INTO v_tent_id
    FROM public.tent_members member
    WHERE member.user_id = p_sentry_id AND member.role = 'sentry'
    ORDER BY member.joined_at DESC NULLS LAST, member.id DESC
    LIMIT 1;
  END IF;

  IF v_tent_id IS NULL OR public.tent_cadet_count(v_tent_id) >= public.tent_cadet_limit(v_tent_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (profile.id)
    profile.id,
    profile.display_name,
    profile.avatar_url
  FROM public.profiles profile
  JOIN public.role_assignments assignment ON assignment.user_id = profile.id
  WHERE assignment.role = 'cadet'
    AND assignment.status IN ('active', 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM public.tent_members member WHERE member.user_id = profile.id
    )
  ORDER BY profile.id, profile.display_name ASC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_default_tent_join_direction(p_tent_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can choose the camp-wide tour tent.';
  END IF;

  IF p_tent_id IS NULL THEN
    DELETE FROM public.tent_join_guidance_settings WHERE setting_key = 'camp_default';
    UPDATE public.tent_join_requests request
    SET status = 'cancelled', reviewed_at = now()
    WHERE request.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM public.tent_join_directions direction
        WHERE direction.user_id = request.user_id
      );
    RETURN true;
  END IF;

  PERFORM 1 FROM public.tents tent WHERE tent.id = p_tent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;
  IF public.tent_cadet_count(p_tent_id) >= public.tent_cadet_limit(p_tent_id) THEN
    RAISE EXCEPTION 'This tent already has 10 cadets. Choose another tent.';
  END IF;

  INSERT INTO public.tent_join_guidance_settings(setting_key, tent_id, updated_by)
  VALUES ('camp_default', p_tent_id, auth.uid())
  ON CONFLICT (setting_key) DO UPDATE
    SET tent_id = EXCLUDED.tent_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  UPDATE public.tent_join_requests request
  SET status = 'cancelled', reviewed_at = now()
  WHERE request.status = 'pending'
    AND request.tent_id <> p_tent_id
    AND NOT EXISTS (
      SELECT 1 FROM public.tent_join_directions direction
      WHERE direction.user_id = request.user_id
    );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tent_join_direction(
  p_user_id uuid,
  p_tent_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tent_name text;
  v_cadet_name text;
  v_fallback_tent_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can direct a cadet to a tent.';
  END IF;

  PERFORM 1 FROM public.profiles profile WHERE profile.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadet not found.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = p_user_id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only an active cadet can receive a tent direction.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = p_user_id) THEN
    RAISE EXCEPTION 'This cadet already belongs to a tent.';
  END IF;

  IF p_tent_id IS NULL THEN
    DELETE FROM public.tent_join_directions direction WHERE direction.user_id = p_user_id;
    v_fallback_tent_id := public.resolve_tent_join_direction(p_user_id);
    UPDATE public.tent_join_requests request
    SET status = 'cancelled', reviewed_at = now()
    WHERE request.user_id = p_user_id
      AND request.status = 'pending'
      AND (v_fallback_tent_id IS NULL OR request.tent_id IS DISTINCT FROM v_fallback_tent_id);
    RETURN true;
  END IF;

  SELECT tent.name INTO v_tent_name
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;
  IF public.tent_cadet_count(p_tent_id) >= public.tent_cadet_limit(p_tent_id) THEN
    RAISE EXCEPTION 'This tent already has 10 cadets. Choose another tent.';
  END IF;

  INSERT INTO public.tent_join_directions(user_id, tent_id, directed_by)
  VALUES (p_user_id, p_tent_id, auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET tent_id = EXCLUDED.tent_id,
        directed_by = EXCLUDED.directed_by,
        updated_at = now();

  UPDATE public.tent_join_requests request
  SET status = 'cancelled', reviewed_at = now()
  WHERE request.user_id = p_user_id
    AND request.status = 'pending'
    AND request.tent_id <> p_tent_id;

  SELECT profile.display_name INTO v_cadet_name
  FROM public.profiles profile WHERE profile.id = p_user_id;
  PERFORM public.notify_user(
    p_user_id,
    auth.uid(),
    'tent_direction',
    'Your tent is ready',
    'The instructor directed you to ' || coalesce(v_tent_name, 'an available tent') || '. Follow the hand to send your request.',
    'tent',
    jsonb_build_object('tent_id', p_tent_id, 'cadet_name', v_cadet_name)
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_to_join_tent(p_tent_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_tent_name text;
  v_applicant_name text;
  v_sentry_id uuid;
  v_directed_tent_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to request a tent.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You already belong to a tent.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only cadets who are not yet in a tent can apply.';
  END IF;

  v_directed_tent_id := public.resolve_tent_join_direction(auth.uid());
  IF v_directed_tent_id IS NULL THEN
    RAISE EXCEPTION 'Wait for the instructor to direct you to an available tent.';
  END IF;
  IF v_directed_tent_id IS DISTINCT FROM p_tent_id THEN
    RAISE EXCEPTION 'Your instructor directed you to another tent. Follow the hand to the selected tent.';
  END IF;

  SELECT tent.name INTO v_tent_name
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;
  IF public.tent_cadet_count(p_tent_id) >= public.tent_cadet_limit(p_tent_id) THEN
    RAISE EXCEPTION 'This tent already has 10 cadets. The instructor must direct you to another tent.';
  END IF;

  UPDATE public.tent_join_requests request
  SET status = 'cancelled', reviewed_at = now()
  WHERE request.user_id = auth.uid() AND request.status = 'pending';

  INSERT INTO public.tent_join_requests(tent_id, user_id)
  VALUES (p_tent_id, auth.uid())
  RETURNING id INTO v_request_id;

  SELECT profile.display_name INTO v_applicant_name
  FROM public.profiles profile WHERE profile.id = auth.uid();
  FOR v_sentry_id IN
    SELECT DISTINCT sentry.user_id
    FROM (
      SELECT tent.sentry_id AS user_id FROM public.tents tent WHERE tent.id = p_tent_id
      UNION ALL
      SELECT member.user_id FROM public.tent_members member
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
  v_tent_name text;
BEGIN
  SELECT * INTO v_request
  FROM public.tent_join_requests request
  WHERE request.id = p_request_id AND request.status = 'pending'
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

  SELECT tent.name INTO v_tent_name FROM public.tents tent WHERE tent.id = v_request.tent_id;
  IF p_approve THEN
    PERFORM 1 FROM public.tents tent WHERE tent.id = v_request.tent_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.user_id = v_request.user_id
        AND member.tent_id <> v_request.tent_id
    ) THEN
      RAISE EXCEPTION 'This cadet already belongs to another tent.';
    END IF;
    IF public.resolve_tent_join_direction(v_request.user_id) IS DISTINCT FROM v_request.tent_id THEN
      RAISE EXCEPTION 'The instructor has not directed this cadet to this tent.';
    END IF;
    IF public.tent_cadet_count(v_request.tent_id) >= public.tent_cadet_limit(v_request.tent_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.tent_members member
         WHERE member.user_id = v_request.user_id AND member.tent_id = v_request.tent_id
       ) THEN
      RAISE EXCEPTION 'This tent is full (maximum 10 cadets plus its sentry).';
    END IF;

    INSERT INTO public.tent_members(tent_id, user_id, role)
    VALUES (v_request.tent_id, v_request.user_id, 'cadet')
    ON CONFLICT (user_id) DO UPDATE
      SET role = CASE
        WHEN public.tent_members.tent_id = EXCLUDED.tent_id THEN 'cadet'
        ELSE public.tent_members.role
      END;
  END IF;

  UPDATE public.tent_join_requests request
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE request.id = p_request_id;

  IF p_approve THEN
    UPDATE public.tent_join_requests request
    SET status = 'cancelled', reviewed_at = now()
    WHERE request.user_id = v_request.user_id
      AND request.id <> p_request_id
      AND request.status = 'pending';
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

REVOKE ALL ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sentry_assign_cadet_to_tent(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sentry_addable_cadets(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_default_tent_join_direction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tent_join_direction(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_to_join_tent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_tent_join_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sentry_assign_cadet_to_tent(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sentry_addable_cadets(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_default_tent_join_direction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tent_join_direction(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_to_join_tent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tent_join_request(uuid, boolean) TO authenticated;

DO $$
DECLARE
  v_shana_id uuid;
  v_square_a0_id uuid;
  v_shana_matches integer;
  v_tent_matches integer;
BEGIN
  SELECT count(*)::integer, min(profile.id::text)::uuid
  INTO v_shana_matches, v_shana_id
  FROM public.profiles profile
  WHERE regexp_replace(lower(btrim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE 'shana%'
    AND EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.role = 'cadet'
        AND assignment.status IN ('active', 'approved')
    );

  SELECT count(*)::integer, min(tent.id::text)::uuid
  INTO v_tent_matches, v_square_a0_id
  FROM public.tents tent
  WHERE regexp_replace(lower(btrim(tent.name)), '[^a-z0-9]+', '', 'g') IN ('squarea0', 'squaresa0', 'a0')
    AND (tent.tent_house_id = 'squares' OR regexp_replace(lower(btrim(tent.name)), '[^a-z0-9]+', '', 'g') <> 'a0');

  IF v_shana_matches = 1
     AND v_tent_matches = 1
     AND NOT EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = v_shana_id)
     AND public.tent_cadet_count(v_square_a0_id) < public.tent_cadet_limit(v_square_a0_id)
  THEN
    INSERT INTO public.tent_members(tent_id, user_id, role)
    VALUES (v_square_a0_id, v_shana_id, 'cadet');

    UPDATE public.tent_join_requests request
    SET status = CASE WHEN request.tent_id = v_square_a0_id THEN 'approved' ELSE 'cancelled' END,
        reviewed_at = coalesce(request.reviewed_at, now())
    WHERE request.user_id = v_shana_id AND request.status = 'pending';
  END IF;
END;
$$;
