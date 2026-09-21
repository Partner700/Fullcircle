/*
  A resident who dismisses the post-tent guide must stay free to use the app,
  even when an older profile-completion rule notices a missing avatar later.
*/

ALTER TABLE public.newcomer_guidance
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE OR REPLACE FUNCTION public.dismiss_my_newcomer_guidance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_guidance public.newcomer_guidance%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  INSERT INTO public.newcomer_guidance(user_id, guide_version)
  VALUES (v_user_id, 4)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance guidance
  WHERE guidance.user_id = v_user_id
  FOR UPDATE;

  IF v_guidance.current_step = 'choose_tent'
     AND NOT EXISTS (
       SELECT 1 FROM public.tent_members member WHERE member.user_id = v_user_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.tent_join_requests request
       WHERE request.user_id = v_user_id
         AND request.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'Choose a tent before dismissing the optional tour.';
  END IF;

  UPDATE public.newcomer_guidance
  SET current_step = 'complete',
      completed_at = COALESCE(completed_at, now()),
      dismissed_at = COALESCE(dismissed_at, now()),
      updated_at = now(),
      guide_version = GREATEST(guide_version, 4)
  WHERE user_id = v_user_id
  RETURNING * INTO v_guidance;

  RETURN jsonb_build_object(
    'current_step', 'complete',
    'completed', true,
    'completed_at', v_guidance.completed_at,
    'guide_version', v_guidance.guide_version
  );
END;
$$;

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
  v_has_tent boolean := false;
  v_has_pending_request boolean := false;
  v_missing_avatar boolean := true;
  v_current_streak integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role IN ('sentry', 'instructor')
      AND assignment.status IN ('active', 'approved', 'promoted')
  ) INTO v_non_cadet;

  SELECT EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.user_id = v_user_id
  ) INTO v_has_tent;

  SELECT EXISTS (
    SELECT 1 FROM public.tent_join_requests request
    WHERE request.user_id = v_user_id AND request.status = 'pending'
  ) INTO v_has_pending_request;

  SELECT nullif(btrim(coalesce(profile.avatar_url, '')), '') IS NULL
  INTO v_missing_avatar
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  INSERT INTO public.newcomer_guidance(user_id, current_step, completed_at, guide_version)
  VALUES (
    v_user_id,
    CASE
      WHEN v_non_cadet AND coalesce(v_missing_avatar, true) THEN 'profile_settings'
      WHEN v_non_cadet THEN 'complete'
      WHEN v_has_tent OR v_has_pending_request THEN 'dashboard_after_tent'
      ELSE 'choose_tent'
    END,
    CASE WHEN v_non_cadet AND NOT coalesce(v_missing_avatar, true) THEN now() ELSE NULL END,
    4
  )
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.newcomer_guidance
  SET guide_version = 4
  WHERE user_id = v_user_id AND guide_version < 4;

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance
  WHERE user_id = v_user_id;

  IF v_guidance.dismissed_at IS NOT NULL THEN
    IF v_guidance.current_step <> 'complete' OR v_guidance.completed_at IS NULL THEN
      UPDATE public.newcomer_guidance
      SET current_step = 'complete',
          completed_at = COALESCE(completed_at, dismissed_at, now()),
          updated_at = now()
      WHERE user_id = v_user_id
      RETURNING * INTO v_guidance;
    END IF;

    RETURN jsonb_build_object(
      'current_step', 'complete',
      'completed', true,
      'completed_at', COALESCE(v_guidance.completed_at, v_guidance.dismissed_at),
      'guide_version', v_guidance.guide_version
    );
  END IF;

  -- Profile completion remains a suggestion until explicitly dismissed.
  UPDATE public.newcomer_guidance
  SET current_step = 'profile_settings',
      completed_at = NULL,
      updated_at = now(),
      guide_version = 4
  WHERE user_id = v_user_id
    AND completed_at IS NOT NULL
    AND coalesce(v_missing_avatar, true);

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance
  WHERE user_id = v_user_id;

  IF v_guidance.current_step = 'await_first_streak' THEN
    SELECT coalesce(streak.current_streak, 0)
    INTO v_current_streak
    FROM public.compute_strict_streak(v_user_id) streak
    LIMIT 1;

    IF coalesce(v_current_streak, 0) >= 1 THEN
      UPDATE public.newcomer_guidance
      SET current_step = 'profile_settings', updated_at = now()
      WHERE user_id = v_user_id;
    END IF;
  END IF;

  IF v_guidance.current_step = 'profile_photo' AND NOT coalesce(v_missing_avatar, true) THEN
    UPDATE public.newcomer_guidance
    SET current_step = 'profile_details', updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  IF NOT v_non_cadet THEN
    UPDATE public.newcomer_guidance
    SET current_step = 'choose_tent', started_at = now(), updated_at = now()
    WHERE user_id = v_user_id
      AND completed_at IS NULL
      AND current_step = 'dashboard_after_tent'
      AND NOT v_has_tent
      AND NOT v_has_pending_request;

    UPDATE public.newcomer_guidance
    SET current_step = 'dashboard_after_tent', updated_at = now()
    WHERE user_id = v_user_id
      AND completed_at IS NULL
      AND current_step = 'choose_tent'
      AND (v_has_tent OR v_has_pending_request);
  END IF;

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'current_step', v_guidance.current_step,
    'completed', v_guidance.completed_at IS NOT NULL,
    'completed_at', v_guidance.completed_at,
    'guide_version', v_guidance.guide_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_my_newcomer_guidance() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_newcomer_guidance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_my_newcomer_guidance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_newcomer_guidance() TO authenticated;
