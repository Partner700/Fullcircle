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
    SELECT count(DISTINCT person.user_id)::integer
    INTO v_member_count
    FROM (
      SELECT member.user_id
      FROM public.tent_members member
      WHERE member.tent_id = NEW.tent_id
        AND member.id <> OLD.id
      UNION ALL
      SELECT tent.sentry_id
      FROM public.tents tent
      WHERE tent.id = NEW.tent_id
        AND tent.sentry_id IS NOT NULL
      UNION ALL
      SELECT NEW.user_id
    ) person;
  ELSE
    SELECT count(DISTINCT person.user_id)::integer
    INTO v_member_count
    FROM (
      SELECT member.user_id
      FROM public.tent_members member
      WHERE member.tent_id = NEW.tent_id
      UNION ALL
      SELECT tent.sentry_id
      FROM public.tents tent
      WHERE tent.id = NEW.tent_id
        AND tent.sentry_id IS NOT NULL
      UNION ALL
      SELECT NEW.user_id
    ) person;
  END IF;

  IF coalesce(v_member_count, 0) > 10 THEN
    RAISE EXCEPTION 'This tent is full (maximum 10 people).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_tent_capacity_trigger ON public.tent_members;
CREATE TRIGGER enforce_tent_capacity_trigger
BEFORE INSERT OR UPDATE OF tent_id, user_id ON public.tent_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_tent_capacity();

CREATE TABLE IF NOT EXISTS public.tent_join_directions (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tent_id uuid NOT NULL REFERENCES public.tents(id) ON DELETE CASCADE,
  directed_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tent_join_directions_tent_idx
  ON public.tent_join_directions(tent_id);

ALTER TABLE public.tent_join_directions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tent_join_directions_read_own_or_instructor ON public.tent_join_directions;
CREATE POLICY tent_join_directions_read_own_or_instructor
  ON public.tent_join_directions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_instructor(auth.uid()));

REVOKE ALL ON TABLE public.tent_join_directions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tent_join_directions TO authenticated;

CREATE OR REPLACE FUNCTION public.set_tent_join_direction(p_user_id uuid, p_tent_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_count integer;
  v_tent_name text;
  v_cadet_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can direct a cadet to a tent.';
  END IF;

  PERFORM 1
  FROM public.profiles profile
  WHERE profile.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadet not found.'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
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
    UPDATE public.tent_join_requests
    SET status = 'cancelled', reviewed_at = now()
    WHERE user_id = p_user_id AND status = 'pending';
    RETURN true;
  END IF;

  SELECT tent.name
  INTO v_tent_name
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  SELECT count(DISTINCT person.user_id)::integer
  INTO v_member_count
  FROM (
    SELECT member.user_id
    FROM public.tent_members member
    WHERE member.tent_id = p_tent_id
    UNION ALL
    SELECT tent.sentry_id
    FROM public.tents tent
    WHERE tent.id = p_tent_id
      AND tent.sentry_id IS NOT NULL
  ) person;
  IF coalesce(v_member_count, 0) >= 10 THEN
    RAISE EXCEPTION 'This tent is full (maximum 10 people). Choose another tent.';
  END IF;

  INSERT INTO public.tent_join_directions(user_id, tent_id, directed_by)
  VALUES (p_user_id, p_tent_id, auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET tent_id = EXCLUDED.tent_id,
        directed_by = EXCLUDED.directed_by,
        updated_at = now();

  UPDATE public.tent_join_requests
  SET status = 'cancelled', reviewed_at = now()
  WHERE user_id = p_user_id
    AND status = 'pending'
    AND tent_id <> p_tent_id;

  SELECT profile.display_name INTO v_cadet_name
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

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

CREATE OR REPLACE FUNCTION public.clear_tent_join_direction_on_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.tent_join_directions direction WHERE direction.user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_tent_join_direction_on_membership_trigger ON public.tent_members;
CREATE TRIGGER clear_tent_join_direction_on_membership_trigger
AFTER INSERT OR UPDATE OF tent_id, user_id ON public.tent_members
FOR EACH ROW EXECUTE FUNCTION public.clear_tent_join_direction_on_membership();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables publication_table
       WHERE publication_table.pubname = 'supabase_realtime'
         AND publication_table.schemaname = 'public'
         AND publication_table.tablename = 'tent_join_directions'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tent_join_directions;
  END IF;
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
  v_member_count integer;
  v_tent_name text;
  v_applicant_name text;
  v_sentry_id uuid;
  v_directed_tent_id uuid;
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

  SELECT direction.tent_id
  INTO v_directed_tent_id
  FROM public.tent_join_directions direction
  WHERE direction.user_id = auth.uid();
  IF v_directed_tent_id IS NULL THEN
    RAISE EXCEPTION 'Wait for the instructor to direct you to an available tent.';
  END IF;
  IF v_directed_tent_id IS DISTINCT FROM p_tent_id THEN
    RAISE EXCEPTION 'Your instructor directed you to another tent. Follow the hand to the selected tent.';
  END IF;

  SELECT tent.name
  INTO v_tent_name
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  SELECT count(DISTINCT person.user_id)::integer
  INTO v_member_count
  FROM (
    SELECT member.user_id
    FROM public.tent_members member
    WHERE member.tent_id = p_tent_id
    UNION ALL
    SELECT tent.sentry_id
    FROM public.tents tent
    WHERE tent.id = p_tent_id
      AND tent.sentry_id IS NOT NULL
  ) person;
  IF coalesce(v_member_count, 0) >= 10 THEN
    RAISE EXCEPTION 'This tent already has 10 people. The instructor must direct you to another tent.';
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

    IF NOT EXISTS (
      SELECT 1
      FROM public.tent_join_directions direction
      WHERE direction.user_id = v_request.user_id
        AND direction.tent_id = v_request.tent_id
    ) THEN
      RAISE EXCEPTION 'The instructor has not directed this cadet to this tent.';
    END IF;

    SELECT count(DISTINCT person.user_id)::integer
    INTO v_member_count
    FROM (
      SELECT member.user_id
      FROM public.tent_members member
      WHERE member.tent_id = v_request.tent_id
      UNION ALL
      SELECT tent.sentry_id
      FROM public.tents tent
      WHERE tent.id = v_request.tent_id
        AND tent.sentry_id IS NOT NULL
    ) person;
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

-- Existing applications must match a current instructor direction and an
-- available tent before they remain actionable for a sentry.
UPDATE public.tent_join_requests request
SET status = 'cancelled', reviewed_at = now()
WHERE request.status = 'pending'
  AND (
    NOT EXISTS (
      SELECT 1
      FROM public.tent_join_directions direction
      WHERE direction.user_id = request.user_id
        AND direction.tent_id = request.tent_id
    )
    OR (
      SELECT count(DISTINCT person.user_id)
      FROM (
        SELECT member.user_id
        FROM public.tent_members member
        WHERE member.tent_id = request.tent_id
        UNION ALL
        SELECT tent.sentry_id
        FROM public.tents tent
        WHERE tent.id = request.tent_id
          AND tent.sentry_id IS NOT NULL
      ) person
    ) >= 10
  );

REVOKE ALL ON FUNCTION public.set_tent_join_direction(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_to_join_tent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_tent_join_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tent_join_direction(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_to_join_tent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tent_join_request(uuid, boolean) TO authenticated;
