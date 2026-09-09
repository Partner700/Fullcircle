/*
  Guarantee the hand-pointer tour for every cadet-facing account that has not
  joined a tent. Versioning makes this a one-time reopening for existing
  accounts, while rejected or cancelled tent requests return the person to the
  tent-choice step without repeatedly restarting a completed tour.
*/

ALTER TABLE public.newcomer_guidance
  ADD COLUMN IF NOT EXISTS guide_version integer;

UPDATE public.newcomer_guidance
SET guide_version = 1
WHERE guide_version IS NULL;

ALTER TABLE public.newcomer_guidance
  ALTER COLUMN guide_version SET DEFAULT 2,
  ALTER COLUMN guide_version SET NOT NULL;

ALTER TABLE public.newcomer_guidance
  DROP CONSTRAINT IF EXISTS newcomer_guidance_guide_version_check;
ALTER TABLE public.newcomer_guidance
  ADD CONSTRAINT newcomer_guidance_guide_version_check
  CHECK (guide_version >= 1);

WITH tentless_users AS (
  SELECT
    profile.id AS user_id,
    EXISTS (
      SELECT 1
      FROM public.tent_join_requests request
      WHERE request.user_id = profile.id
        AND request.status = 'pending'
    ) AS has_pending_request
  FROM public.profiles profile
  WHERE NOT EXISTS (
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
), reset_existing AS (
  UPDATE public.newcomer_guidance guidance
  SET current_step = CASE
        WHEN person.has_pending_request THEN 'dashboard_after_tent'
        ELSE 'choose_tent'
      END,
      started_at = now(),
      completed_at = NULL,
      updated_at = now(),
      guide_version = 2
  FROM tentless_users person
  WHERE guidance.user_id = person.user_id
    AND guidance.guide_version < 2
  RETURNING guidance.user_id
)
INSERT INTO public.newcomer_guidance(
  user_id,
  current_step,
  started_at,
  completed_at,
  updated_at,
  guide_version
)
SELECT
  person.user_id,
  CASE
    WHEN person.has_pending_request THEN 'dashboard_after_tent'
    ELSE 'choose_tent'
  END,
  now(),
  NULL,
  now(),
  2
FROM tentless_users person
ON CONFLICT (user_id) DO NOTHING;

UPDATE public.newcomer_guidance
SET guide_version = 2
WHERE guide_version < 2;

CREATE OR REPLACE FUNCTION private.initialize_newcomer_guidance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.newcomer_guidance(
    user_id,
    current_step,
    started_at,
    guide_version
  )
  VALUES (NEW.id, 'choose_tent', coalesce(NEW.created_at, now()), 2)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.complete_non_cadet_guidance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.role IN ('sentry', 'instructor')
     AND NEW.status IN ('active', 'approved', 'promoted')
  THEN
    INSERT INTO public.newcomer_guidance(
      user_id,
      current_step,
      completed_at,
      updated_at,
      guide_version
    )
    VALUES (NEW.user_id, 'complete', now(), now(), 2)
    ON CONFLICT (user_id) DO UPDATE
      SET current_step = 'complete',
          completed_at = coalesce(public.newcomer_guidance.completed_at, now()),
          updated_at = now(),
          guide_version = 2;
  END IF;
  RETURN NEW;
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role IN ('sentry', 'instructor')
      AND assignment.status IN ('active', 'approved', 'promoted')
  ) INTO v_non_cadet;

  SELECT EXISTS (
    SELECT 1
    FROM public.tent_members member
    WHERE member.user_id = v_user_id
  ) INTO v_has_tent;

  SELECT EXISTS (
    SELECT 1
    FROM public.tent_join_requests request
    WHERE request.user_id = v_user_id
      AND request.status = 'pending'
  ) INTO v_has_pending_request;

  INSERT INTO public.newcomer_guidance(
    user_id,
    current_step,
    completed_at,
    guide_version
  )
  VALUES (
    v_user_id,
    CASE
      WHEN v_non_cadet THEN 'complete'
      WHEN v_has_tent OR v_has_pending_request THEN 'dashboard_after_tent'
      ELSE 'choose_tent'
    END,
    CASE WHEN v_non_cadet THEN now() ELSE NULL END,
    2
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF v_non_cadet THEN
    UPDATE public.newcomer_guidance
    SET current_step = 'complete',
        completed_at = coalesce(completed_at, now()),
        updated_at = now(),
        guide_version = 2
    WHERE user_id = v_user_id
      AND completed_at IS NULL;
  ELSE
    -- Every account skipped by the earlier tour receives version 2 exactly
    -- once, including people who already have a pending tent request.
    UPDATE public.newcomer_guidance
    SET current_step = CASE
          WHEN v_has_tent OR v_has_pending_request THEN 'dashboard_after_tent'
          ELSE 'choose_tent'
        END,
        started_at = now(),
        completed_at = NULL,
        updated_at = now(),
        guide_version = 2
    WHERE user_id = v_user_id
      AND guide_version < 2;

    -- A declined or cancelled request must expose the four tent choices again.
    UPDATE public.newcomer_guidance
    SET current_step = 'choose_tent',
        started_at = now(),
        completed_at = NULL,
        updated_at = now()
    WHERE user_id = v_user_id
      AND NOT v_has_tent
      AND NOT v_has_pending_request
      AND (current_step <> 'choose_tent' OR completed_at IS NOT NULL);

    -- Recover a tent choice or assignment made immediately before this read.
    UPDATE public.newcomer_guidance
    SET current_step = 'dashboard_after_tent',
        updated_at = now()
    WHERE user_id = v_user_id
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

REVOKE ALL ON FUNCTION private.initialize_newcomer_guidance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.complete_non_cadet_guidance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_newcomer_guidance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_newcomer_guidance() TO authenticated;
