-- Stabilize Simon's Purse delivery, challenge review visibility, sentry tent
-- assignment, and arena invitees for cadets + sentries.

ALTER TABLE public.tents
  ADD COLUMN IF NOT EXISTS max_cadets integer NOT NULL DEFAULT 10;

UPDATE public.tents
SET max_cadets = GREATEST(COALESCE(max_cadets, 10), 10);

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;

ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN ('denarii', 'payment', 'relic', 'redemption', 'simons_purse'));

CREATE OR REPLACE FUNCTION public.activate_simons_purse(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.relic_inventory%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_today date := timezone('Africa/Douala', now())::date;
  v_saturday date;
  v_protected_date date;
  v_protected_days integer := 0;
  v_row_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics.';
  END IF;

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = 'simons-purse';
  IF NOT FOUND THEN RAISE EXCEPTION 'Simon''s Purse was not found.'; END IF;

  SELECT * INTO v_inventory
  FROM public.relic_inventory
  WHERE user_id = p_user_id
    AND relic_type_id = v_relic.id
    AND quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own Simon''s Purse.'; END IF;

  v_saturday := v_today + ((6 - extract(dow FROM v_today)::integer + 7) % 7);
  IF v_saturday = v_today THEN v_saturday := v_today + 7; END IF;
  v_protected_date := v_today;

  WHILE v_protected_date < v_saturday AND v_protected_days < 5 LOOP
    IF extract(dow FROM v_protected_date) BETWEEN 1 AND 5 THEN
      SELECT id INTO v_row_id
      FROM public.streak_freezers
      WHERE user_id = p_user_id
        AND applied_to_date = v_protected_date
        AND used_at IS NULL
      ORDER BY CASE WHEN source = 'simons_purse' THEN 0 ELSE 1 END, purchased_at DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.streak_freezers
        SET source = 'simons_purse',
            freezer_type = 'daily',
            expires_at = v_saturday
        WHERE id = v_row_id;
      ELSE
        INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date, expires_at)
        VALUES (p_user_id, 'daily', 'simons_purse', v_protected_date, v_saturday);
      END IF;

      v_protected_days := v_protected_days + 1;
    END IF;
    v_protected_date := v_protected_date + 1;
  END LOOP;

  IF v_protected_days = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'effect', 'streak_shield_week',
      'protected_days', 0,
      'message', 'Simon''s Purse works on weekdays before Saturday. Your relic was not used.'
    );
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inventory.id;

  INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
  VALUES (p_user_id, v_relic.id, 'streak_shield_week:' || v_protected_days::text || ':immediate');

  RETURN jsonb_build_object(
    'success', true,
    'effect', 'streak_shield_week',
    'protected_days', v_protected_days,
    'message', 'Simon''s Purse has counted today and protected the remaining weekdays before Saturday.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_simons_purse(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_challenge_submissions_for_reviewer(p_reviewer_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  narrative_date date,
  proof_text text,
  proof_type text,
  status text,
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  submitted_at timestamptz,
  profiles jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_instructor boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_reviewer_id THEN
    RAISE EXCEPTION 'You can only review from your own account.';
  END IF;

  v_is_instructor := public.is_instructor(p_reviewer_id);

  RETURN QUERY
  SELECT
    submission.id,
    submission.user_id,
    submission.narrative_date,
    submission.proof_text,
    submission.proof_type::text,
    submission.status::text,
    submission.rejection_reason,
    submission.reviewed_at,
    submission.reviewed_by,
    submission.submitted_at,
    jsonb_build_object(
      'display_name', profile.display_name,
      'avatar_url', profile.avatar_url
    ) AS profiles
  FROM public.challenge_submissions submission
  JOIN public.profiles profile ON profile.id = submission.user_id
  WHERE v_is_instructor
     OR public.is_sentry_for_cadet(p_reviewer_id, submission.user_id)
  ORDER BY submission.submitted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_challenge_submissions_for_reviewer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_challenge_submission_as_reviewer(
  p_submission_id uuid,
  p_status text,
  p_rejection_reason text DEFAULT NULL,
  p_reviewer_id uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.challenge_submissions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_reviewer_id THEN
    RAISE EXCEPTION 'You can only review from your own account.';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid challenge status.';
  END IF;

  SELECT * INTO v_submission
  FROM public.challenge_submissions
  WHERE id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge submission not found.'; END IF;

  IF NOT public.is_instructor(p_reviewer_id)
     AND NOT public.is_sentry_for_cadet(p_reviewer_id, v_submission.user_id) THEN
    RAISE EXCEPTION 'You cannot review this cadet''s challenge.';
  END IF;

  UPDATE public.challenge_submissions
  SET status = p_status,
      rejection_reason = CASE WHEN p_status = 'rejected' THEN NULLIF(btrim(p_rejection_reason), '') ELSE NULL END,
      reviewed_at = now(),
      reviewed_by = p_reviewer_id
  WHERE id = p_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_challenge_submission_as_reviewer(uuid, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sentry_add_cadet_to_tent(p_sentry_id uuid, p_cadet_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tent_id uuid;
  v_max_cadets integer;
  v_current_cadets integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only add cadets from your own sentry account.';
  END IF;

  SELECT tent.id, COALESCE(tent.max_cadets, 10)
  INTO v_tent_id, v_max_cadets
  FROM public.tents tent
  WHERE tent.sentry_id = p_sentry_id
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    SELECT member.tent_id, COALESCE(tent.max_cadets, 10)
    INTO v_tent_id, v_max_cadets
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    WHERE member.user_id = p_sentry_id
      AND member.role = 'sentry'
    LIMIT 1;
  END IF;

  IF v_tent_id IS NULL THEN RAISE EXCEPTION 'No tent found for this sentry.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = p_cadet_id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'That user is not an active cadet.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tent_members member
    WHERE member.user_id = p_cadet_id
      AND member.role = 'cadet'
  ) THEN
    RAISE EXCEPTION 'This cadet already belongs to a tent. Ask the instructor to move them.';
  END IF;

  SELECT count(*) INTO v_current_cadets
  FROM public.tent_members member
  WHERE member.tent_id = v_tent_id
    AND member.role = 'cadet';

  IF v_current_cadets >= GREATEST(v_max_cadets, 10) THEN
    RAISE EXCEPTION 'Tent is full. A sentry can keep up to 10 cadets.';
  END IF;

  INSERT INTO public.tent_members (tent_id, user_id, role)
  VALUES (v_tent_id, p_cadet_id, 'cadet')
  ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'cadet';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sentry_add_cadet_to_tent(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_arena_invitees()
RETURNS TABLE (
  role_assignment_id uuid,
  user_id uuid,
  role text,
  status text,
  start_date date,
  end_date date,
  approver_id uuid,
  created_at timestamptz,
  display_name text,
  avatar_url text,
  profile_created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (assignment.user_id)
    assignment.user_id AS role_assignment_id,
    assignment.user_id,
    assignment.role,
    assignment.status,
    assignment.start_date,
    assignment.end_date,
    assignment.approver_id,
    assignment.created_at,
    profile.display_name,
    profile.avatar_url,
    profile.created_at
  FROM public.role_assignments assignment
  JOIN public.profiles profile ON profile.id = assignment.user_id
  WHERE assignment.role IN ('cadet', 'sentry')
    AND assignment.status IN ('active', 'approved')
  ORDER BY assignment.user_id,
    CASE assignment.role WHEN 'sentry' THEN 0 ELSE 1 END,
    assignment.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_arena_invitees() TO authenticated;
