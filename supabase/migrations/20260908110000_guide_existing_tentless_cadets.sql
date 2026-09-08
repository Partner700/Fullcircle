/*
  Extend the hand-pointer tour to established cadets who still have no tent.

  The first guidance migration deliberately auto-completed older accounts.
  Those records have matching started/completed timestamps, which lets this
  migration reopen only the automatically skipped tour. A tour a person has
  genuinely completed is never restarted while their application is pending.
*/

WITH tentless_cadets AS (
  SELECT
    profile.id AS user_id,
    EXISTS (
      SELECT 1
      FROM public.tent_join_requests request
      WHERE request.user_id = profile.id
        AND request.status = 'pending'
    ) AS has_pending_request
  FROM public.profiles profile
  WHERE EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = profile.id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.role IN ('sentry', 'instructor')
        AND assignment.status IN ('active', 'approved', 'promoted')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.tent_members member
      WHERE member.user_id = profile.id
    )
), inserted AS (
  INSERT INTO public.newcomer_guidance(user_id, current_step, started_at, updated_at)
  SELECT
    cadet.user_id,
    CASE WHEN cadet.has_pending_request THEN 'dashboard_after_tent' ELSE 'choose_tent' END,
    now(),
    now()
  FROM tentless_cadets cadet
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id
)
UPDATE public.newcomer_guidance guidance
SET current_step = CASE
      WHEN cadet.has_pending_request THEN 'dashboard_after_tent'
      ELSE 'choose_tent'
    END,
    started_at = now(),
    completed_at = NULL,
    updated_at = now()
FROM tentless_cadets cadet
WHERE guidance.user_id = cadet.user_id
  AND guidance.completed_at IS NOT NULL
  AND guidance.completed_at = guidance.started_at;

CREATE OR REPLACE FUNCTION public.get_my_newcomer_guidance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_guidance public.newcomer_guidance%ROWTYPE;
  v_non_cadet boolean := false;
  v_active_cadet boolean := false;
  v_has_tent boolean := false;
  v_has_pending_request boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role IN ('sentry', 'instructor')
      AND assignment.status IN ('active', 'approved', 'promoted')
  ) INTO v_non_cadet;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) INTO v_active_cadet;

  SELECT EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.user_id = v_user_id
  ) INTO v_has_tent;

  SELECT EXISTS (
    SELECT 1
    FROM public.tent_join_requests request
    WHERE request.user_id = v_user_id
      AND request.status = 'pending'
  ) INTO v_has_pending_request;

  INSERT INTO public.newcomer_guidance(user_id, current_step, completed_at)
  VALUES (
    v_user_id,
    CASE
      WHEN v_non_cadet THEN 'complete'
      WHEN v_has_tent OR v_has_pending_request THEN 'dashboard_after_tent'
      ELSE 'choose_tent'
    END,
    CASE WHEN v_non_cadet THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF v_non_cadet THEN
    UPDATE public.newcomer_guidance
    SET current_step = 'complete',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    WHERE user_id = v_user_id
      AND completed_at IS NULL;
  ELSIF v_active_cadet AND NOT v_has_tent THEN
    -- Reopen only a legacy auto-completed row. A genuinely finished tour has
    -- different start and completion timestamps and remains complete.
    UPDATE public.newcomer_guidance
    SET current_step = CASE
          WHEN v_has_pending_request THEN 'dashboard_after_tent'
          ELSE 'choose_tent'
        END,
        started_at = now(),
        completed_at = NULL,
        updated_at = now()
    WHERE user_id = v_user_id
      AND completed_at IS NOT NULL
      AND completed_at = started_at;
  END IF;

  -- Recover a tent choice made just before the guide reported its next step.
  UPDATE public.newcomer_guidance guidance
  SET current_step = 'dashboard_after_tent', updated_at = now()
  WHERE guidance.user_id = v_user_id
    AND guidance.current_step = 'choose_tent'
    AND (v_has_tent OR v_has_pending_request);

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'current_step', v_guidance.current_step,
    'completed', v_guidance.completed_at IS NOT NULL,
    'completed_at', v_guidance.completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_newcomer_guidance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_newcomer_guidance() TO authenticated;

