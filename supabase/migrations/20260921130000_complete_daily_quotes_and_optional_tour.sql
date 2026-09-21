/*
  Show every available quote from the current day while retaining the three
  ranked weekend highlights. Tent choice remains part of onboarding, but every
  action after that choice is an optional guide that the resident may dismiss.
*/

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 100)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text,
  current_streak integer,
  total_figs integer,
  rhudes integer,
  role text,
  tent_house_id text,
  tent_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT
      timezone('Africa/Douala', now())::date AS today,
      extract(isodow FROM timezone('Africa/Douala', now()))::integer AS iso_day,
      date_trunc('week', timezone('Africa/Douala', now()))::date AS week_start
  ),
  active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id,
      CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
      CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
      assignment.start_date DESC NULLS LAST,
      assignment.created_at DESC
  ),
  active_tents AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      tents.tent_house_id,
      tents.name AS tent_name
    FROM public.tent_members member
    JOIN public.tents tents ON tents.id = member.tent_id
    ORDER BY member.user_id, member.joined_at DESC
  ),
  strict AS (
    SELECT profile.id AS user_id,
      COALESCE((SELECT current_streak FROM public.compute_strict_streak(profile.id) LIMIT 1), 0)::integer AS current_streak
    FROM public.profiles profile
  ),
  reaction_totals AS (
    SELECT reaction.quote_user_id AS user_id,
      reaction.quote_record_date AS record_date,
      count(*)::integer AS reaction_count
    FROM public.daily_quote_reactions reaction
    GROUP BY reaction.quote_user_id, reaction.quote_record_date
  ),
  comment_totals AS (
    SELECT comment.quote_user_id AS user_id,
      comment.quote_record_date AS record_date,
      count(*)::integer AS comment_count
    FROM public.daily_quote_comments comment
    GROUP BY comment.quote_user_id, comment.quote_record_date
  ),
  eligible AS (
    SELECT
      dr.record_date,
      dr.daily_quote,
      dr.user_id,
      profile.display_name,
      profile.avatar_url,
      GREATEST(COALESCE(marks.current_streak, 0), COALESCE(strict.current_streak, 0))::integer AS current_streak,
      COALESCE(marks.total_figs, 0)::integer AS total_figs,
      COALESCE(marks.rhudes, 0)::integer AS rhudes,
      COALESCE(roles.role, 'cadet')::text AS role,
      tents.tent_house_id,
      tents.tent_name,
      COALESCE(reactions.reaction_count, 0) + COALESCE(comments.comment_count, 0) AS interaction_count,
      dr.meditation_submitted_at,
      clock.iso_day
    FROM public.daily_records dr
    JOIN public.profiles profile ON profile.id = dr.user_id
    LEFT JOIN public.get_marks_board_live() marks ON marks.user_id = dr.user_id
    LEFT JOIN strict ON strict.user_id = dr.user_id
    LEFT JOIN active_roles roles ON roles.user_id = dr.user_id
    LEFT JOIN active_tents tents ON tents.user_id = dr.user_id
    LEFT JOIN reaction_totals reactions ON reactions.user_id = dr.user_id AND reactions.record_date = dr.record_date
    LEFT JOIN comment_totals comments ON comments.user_id = dr.user_id AND comments.record_date = dr.record_date
    CROSS JOIN clock
    WHERE dr.meditation_submitted = true
      AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
      AND (
        (clock.iso_day IN (6, 7) AND dr.record_date BETWEEN clock.week_start AND clock.today)
        OR (clock.iso_day NOT IN (6, 7) AND dr.record_date = clock.today)
      )
  )
  SELECT
    eligible.record_date,
    eligible.daily_quote,
    eligible.user_id,
    eligible.display_name,
    eligible.avatar_url,
    eligible.current_streak,
    eligible.total_figs,
    eligible.rhudes,
    eligible.role,
    eligible.tent_house_id,
    eligible.tent_name
  FROM eligible
  ORDER BY
    CASE WHEN eligible.iso_day IN (6, 7) THEN eligible.interaction_count END DESC,
    CASE WHEN eligible.iso_day IN (6, 7) THEN eligible.record_date END DESC,
    eligible.meditation_submitted_at DESC NULLS LAST,
    eligible.display_name ASC
  LIMIT CASE
    WHEN (SELECT iso_day FROM clock) IN (6, 7) THEN 3
    ELSE LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250)
  END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_quote_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.dismiss_my_newcomer_guidance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_my_newcomer_guidance() TO authenticated;
