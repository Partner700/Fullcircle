/*
  Challenge review and tent membership closure.

  - Instructor review sees cadet and sentry challenge submissions.
  - Sentry review sees all cadet submissions in their assigned tent, whether
    the assignment is recorded on tents.sentry_id or tent_members.
  - Sentries can add unassigned cadets to their own tent, up to 10 cadets.
  - Cadets who reach the existing removal threshold leave their tent
    automatically after daily record changes.
*/

CREATE OR REPLACE FUNCTION public.is_reviewer_for_challenge(p_reviewer_id uuid, p_submitter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_instructor(p_reviewer_id)
    OR EXISTS (
      SELECT 1
      FROM public.tent_members cadet_member
      JOIN public.tent_members sentry_member
        ON sentry_member.tent_id = cadet_member.tent_id
       AND sentry_member.role = 'sentry'
       AND sentry_member.user_id = p_reviewer_id
      WHERE cadet_member.user_id = p_submitter_id
        AND cadet_member.role = 'cadet'
    )
    OR EXISTS (
      SELECT 1
      FROM public.tent_members cadet_member
      JOIN public.tents tent
        ON tent.id = cadet_member.tent_id
       AND tent.sentry_id = p_reviewer_id
      WHERE cadet_member.user_id = p_submitter_id
        AND cadet_member.role = 'cadet'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_reviewer_for_challenge(uuid, uuid) TO authenticated;

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
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_reviewer_id THEN
    RAISE EXCEPTION 'You can only review from your own account.';
  END IF;

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
      'avatar_url', profile.avatar_url,
      'role', (
        SELECT assignment.role
        FROM public.role_assignments assignment
        WHERE assignment.user_id = submission.user_id
          AND assignment.status IN ('active', 'approved')
        ORDER BY CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END
        LIMIT 1
      )
    ) AS profiles
  FROM public.challenge_submissions submission
  JOIN public.profiles profile ON profile.id = submission.user_id
  WHERE public.is_reviewer_for_challenge(p_reviewer_id, submission.user_id)
  ORDER BY submission.submitted_at DESC NULLS LAST;
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge submission not found.';
  END IF;

  IF NOT public.is_reviewer_for_challenge(p_reviewer_id, v_submission.user_id) THEN
    RAISE EXCEPTION 'You cannot review this challenge.';
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
  v_current_cadets integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only add cadets from your own sentry account.';
  END IF;

  SELECT tent.id INTO v_tent_id
  FROM public.tents tent
  WHERE tent.sentry_id = p_sentry_id
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    SELECT member.tent_id INTO v_tent_id
    FROM public.tent_members member
    WHERE member.user_id = p_sentry_id
      AND member.role = 'sentry'
    LIMIT 1;
  END IF;

  IF v_tent_id IS NULL THEN
    RAISE EXCEPTION 'No tent found for this sentry.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = p_cadet_id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'That user is not an active cadet.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tent_members member
    WHERE member.user_id = p_cadet_id
      AND member.role = 'cadet'
  ) THEN
    RAISE EXCEPTION 'This cadet already belongs to a tent. Ask the instructor to move them.';
  END IF;

  SELECT count(*) INTO v_current_cadets
  FROM public.tent_members member
  WHERE member.tent_id = v_tent_id
    AND member.role = 'cadet';

  IF v_current_cadets >= 10 THEN
    RAISE EXCEPTION 'Tent is full. A sentry can keep up to 10 cadets.';
  END IF;

  INSERT INTO public.tent_members (tent_id, user_id, role)
  VALUES (v_tent_id, p_cadet_id, 'cadet')
  ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'cadet';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sentry_add_cadet_to_tent(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_cadets_at_tent_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_streak record;
BEGIN
  SELECT * INTO v_streak
  FROM public.compute_strict_streak(NEW.user_id)
  LIMIT 1;

  IF COALESCE(v_streak.consecutive_inactive, 0) >= 5
     OR COALESCE(v_streak.cumulative_inactive, 0) >= 10 THEN
    DELETE FROM public.tent_members
    WHERE user_id = NEW.user_id
      AND role = 'cadet';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remove_cadets_at_tent_limit ON public.daily_records;
CREATE TRIGGER trg_remove_cadets_at_tent_limit
  AFTER INSERT OR UPDATE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_cadets_at_tent_limit();
