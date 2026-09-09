/*
  Extend the newcomer hand-pointer tour through the Welcome Panel's community
  actions. Reactions and comments are verified against committed interaction
  rows, so a failed write cannot silently advance the guide.
*/

ALTER TABLE public.newcomer_guidance
  DROP CONSTRAINT IF EXISTS newcomer_guidance_current_step_check;
ALTER TABLE public.newcomer_guidance
  ADD CONSTRAINT newcomer_guidance_current_step_check
  CHECK (current_step IN (
    'choose_tent',
    'dashboard_after_tent',
    'daily_scriptures',
    'scroll_reading',
    'best_verse',
    'meditation',
    'daily_quote',
    'dashboard_games',
    'welcome_swipe_to_verse',
    'welcome_like_verse',
    'welcome_comment_verse',
    'welcome_swipe_to_quote',
    'welcome_like_quote',
    'welcome_comment_quote',
    'daily_games',
    'daily_trivia',
    'complete'
  ));

ALTER TABLE public.newcomer_guidance
  ALTER COLUMN guide_version SET DEFAULT 3;

-- Unfinished tours already at the games learn the newly inserted social steps
-- first. Tours that were already completed are deliberately not reopened.
UPDATE public.newcomer_guidance
SET current_step = 'welcome_swipe_to_verse',
    updated_at = now(),
    guide_version = 3
WHERE completed_at IS NULL
  AND current_step IN ('daily_games', 'daily_trivia')
  AND guide_version < 3;

UPDATE public.newcomer_guidance
SET guide_version = 3
WHERE guide_version < 3;

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
  VALUES (NEW.id, 'choose_tent', coalesce(NEW.created_at, now()), 3)
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
    VALUES (NEW.user_id, 'complete', now(), now(), 3)
    ON CONFLICT (user_id) DO UPDATE
      SET current_step = 'complete',
          completed_at = coalesce(public.newcomer_guidance.completed_at, now()),
          updated_at = now(),
          guide_version = 3;
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
    3
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF v_non_cadet THEN
    UPDATE public.newcomer_guidance
    SET current_step = 'complete',
        completed_at = coalesce(completed_at, now()),
        updated_at = now(),
        guide_version = 3
    WHERE user_id = v_user_id
      AND completed_at IS NULL;
  ELSE
    UPDATE public.newcomer_guidance
    SET guide_version = 3
    WHERE user_id = v_user_id
      AND guide_version < 3;

    -- A declined request returns an unfinished tour to the four tent choices.
    UPDATE public.newcomer_guidance
    SET current_step = 'choose_tent',
        started_at = now(),
        updated_at = now()
    WHERE user_id = v_user_id
      AND completed_at IS NULL
      AND current_step = 'dashboard_after_tent'
      AND NOT v_has_tent
      AND NOT v_has_pending_request;

    -- Recover a tent choice or assignment made immediately before this read.
    UPDATE public.newcomer_guidance
    SET current_step = 'dashboard_after_tent',
        updated_at = now()
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

CREATE OR REPLACE FUNCTION public.advance_my_newcomer_guidance(p_completed_step text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_guidance public.newcomer_guidance%ROWTYPE;
  v_next_step text;
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  INSERT INTO public.newcomer_guidance(user_id, guide_version)
  VALUES (v_user_id, 3)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance guidance
  WHERE guidance.user_id = v_user_id
  FOR UPDATE;

  IF v_guidance.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'current_step', 'complete',
      'completed', true,
      'completed_at', v_guidance.completed_at,
      'guide_version', v_guidance.guide_version
    );
  END IF;

  IF v_guidance.current_step <> p_completed_step THEN
    RETURN jsonb_build_object(
      'current_step', v_guidance.current_step,
      'completed', false,
      'completed_at', NULL,
      'guide_version', v_guidance.guide_version
    );
  END IF;

  IF p_completed_step = 'choose_tent' AND NOT (
    EXISTS (
      SELECT 1
      FROM public.tent_members member
      WHERE member.user_id = v_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.tent_join_requests request
      WHERE request.user_id = v_user_id
        AND request.status = 'pending'
    )
  ) THEN
    RAISE EXCEPTION 'Choose a tent before continuing.';
  END IF;

  IF p_completed_step = 'welcome_like_verse' AND NOT EXISTS (
    SELECT 1
    FROM public.daily_verse_reactions reaction
    WHERE reaction.reactor_user_id = v_user_id
      AND reaction.narrative_date = v_today
      AND reaction.created_at >= v_guidance.updated_at
  ) THEN
    RAISE EXCEPTION 'React to today''s Daily Verse before continuing.';
  END IF;

  IF p_completed_step = 'welcome_comment_verse' AND NOT EXISTS (
    SELECT 1
    FROM public.daily_verse_comments verse_comment
    WHERE verse_comment.commenter_user_id = v_user_id
      AND verse_comment.narrative_date = v_today
      AND verse_comment.created_at >= v_guidance.updated_at
  ) THEN
    RAISE EXCEPTION 'Comment on today''s Daily Verse before continuing.';
  END IF;

  IF p_completed_step = 'welcome_like_quote' AND EXISTS (
    SELECT 1
    FROM public.daily_records daily_record
    WHERE daily_record.user_id <> v_user_id
      AND daily_record.record_date = v_today
      AND daily_record.meditation_submitted = true
      AND nullif(btrim(coalesce(daily_record.daily_quote, '')), '') IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.daily_quote_reactions reaction
    WHERE reaction.reactor_user_id = v_user_id
      AND reaction.quote_user_id <> v_user_id
      AND reaction.created_at >= v_guidance.updated_at
  ) THEN
    RAISE EXCEPTION 'React to another person''s quote before continuing.';
  END IF;

  IF p_completed_step = 'welcome_comment_quote' AND EXISTS (
    SELECT 1
    FROM public.daily_records daily_record
    WHERE daily_record.user_id <> v_user_id
      AND daily_record.record_date = v_today
      AND daily_record.meditation_submitted = true
      AND nullif(btrim(coalesce(daily_record.daily_quote, '')), '') IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.daily_quote_comments quote_comment
    WHERE quote_comment.commenter_user_id = v_user_id
      AND quote_comment.quote_user_id <> v_user_id
      AND quote_comment.created_at >= v_guidance.updated_at
  ) THEN
    RAISE EXCEPTION 'Comment on another person''s quote before continuing.';
  END IF;

  v_next_step := CASE p_completed_step
    WHEN 'choose_tent' THEN 'dashboard_after_tent'
    WHEN 'dashboard_after_tent' THEN 'daily_scriptures'
    WHEN 'daily_scriptures' THEN 'scroll_reading'
    WHEN 'scroll_reading' THEN 'best_verse'
    WHEN 'best_verse' THEN 'meditation'
    WHEN 'meditation' THEN 'daily_quote'
    WHEN 'daily_quote' THEN 'dashboard_games'
    WHEN 'dashboard_games' THEN 'welcome_swipe_to_verse'
    WHEN 'welcome_swipe_to_verse' THEN 'welcome_like_verse'
    WHEN 'welcome_like_verse' THEN 'welcome_comment_verse'
    WHEN 'welcome_comment_verse' THEN 'welcome_swipe_to_quote'
    WHEN 'welcome_swipe_to_quote' THEN 'welcome_like_quote'
    WHEN 'welcome_like_quote' THEN 'welcome_comment_quote'
    WHEN 'welcome_comment_quote' THEN 'daily_games'
    WHEN 'daily_games' THEN 'daily_trivia'
    WHEN 'daily_trivia' THEN 'complete'
    ELSE v_guidance.current_step
  END;

  UPDATE public.newcomer_guidance
  SET current_step = v_next_step,
      completed_at = CASE WHEN v_next_step = 'complete' THEN now() ELSE NULL END,
      updated_at = now(),
      guide_version = 3
  WHERE user_id = v_user_id
  RETURNING * INTO v_guidance;

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
REVOKE ALL ON FUNCTION public.advance_my_newcomer_guidance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_my_newcomer_guidance(text) TO authenticated;
