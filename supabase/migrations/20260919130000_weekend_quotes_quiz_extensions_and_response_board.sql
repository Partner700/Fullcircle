/*
  Keep the week's strongest quotes visible through the weekend and give the
  instructor an authoritative way to extend or reopen a launched quiz. The
  quiz response board exposes participation only, never answers or scores.
*/

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
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
    ELSE LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30)
  END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_quote_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.extend_quiz_session(
  p_quiz_session_id uuid,
  p_additional_minutes integer
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can extend a quiz.';
  END IF;
  IF p_additional_minutes IS NULL OR p_additional_minutes < 1 OR p_additional_minutes > 1440 THEN
    RAISE EXCEPTION 'Choose an extension between 1 minute and 24 hours.';
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;
  IF v_session.status = 'scheduled' THEN
    RAISE EXCEPTION 'Launch this quiz before extending its live window.';
  END IF;

  UPDATE public.quiz_sessions
  SET live_closes_at = greatest(coalesce(live_closes_at, now()), now())
        + make_interval(mins => p_additional_minutes),
      status = 'live'
  WHERE id = p_quiz_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_quiz_session(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_quiz_session(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_quiz_response_board(p_quiz_session_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  competitor_role text,
  tent_house_id text,
  answered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quiz_sessions session WHERE session.id = p_quiz_session_id) THEN
    RAISE EXCEPTION 'Quiz session not found.';
  END IF;

  RETURN QUERY
  WITH active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role::text AS role
    FROM public.role_assignments assignment
    WHERE assignment.status IN ('active', 'approved')
      AND assignment.role IN ('cadet', 'sentry')
    ORDER BY assignment.user_id,
      CASE assignment.role WHEN 'sentry' THEN 1 ELSE 2 END,
      assignment.created_at DESC
  ),
  active_tents AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      tent.tent_house_id
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    ORDER BY member.user_id, member.joined_at DESC
  ),
  completed AS (
    SELECT DISTINCT ON (attempt.user_id)
      attempt.user_id,
      attempt.submitted_at
    FROM public.quiz_attempts attempt
    WHERE attempt.quiz_session_id = p_quiz_session_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.question_responses response
        WHERE response.quiz_attempt_id = attempt.id
      )
    ORDER BY attempt.user_id, attempt.submitted_at DESC
  )
  SELECT
    profile.id,
    COALESCE(NULLIF(btrim(profile.display_name), ''), 'Full Circle member'),
    profile.avatar_url,
    role.role,
    tent.tent_house_id,
    completed.submitted_at
  FROM active_roles role
  JOIN public.profiles profile ON profile.id = role.user_id
  LEFT JOIN active_tents tent ON tent.user_id = role.user_id
  LEFT JOIN completed ON completed.user_id = role.user_id
  ORDER BY tent.tent_house_id NULLS LAST, profile.display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_response_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_response_board(uuid) TO authenticated, service_role;

/* Reassert the complete avatar path so older partial deployments cannot leave
   a phone able to choose a photo but unable to attach it to its profile. */
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 26214400, NULL)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), EXCLUDED.file_size_limit),
    allowed_mime_types = NULL;

DROP POLICY IF EXISTS "avatar_read_all" ON storage.objects;
CREATE POLICY "avatar_read_all" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_upload_own" ON storage.objects;
CREATE POLICY "avatar_upload_own" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatar_update_own" ON storage.objects;
CREATE POLICY "avatar_update_own" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.save_own_avatar(p_avatar_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_url text := btrim(coalesce(p_avatar_url, ''));
  v_object_path text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF v_url = '' OR v_url !~* '^https?://' THEN RAISE EXCEPTION 'The uploaded profile photo URL is invalid.'; END IF;

  v_object_path := split_part(split_part(v_url, '/storage/v1/object/public/avatars/', 2), '?', 1);
  IF v_object_path = '' OR split_part(v_object_path, '/', 1) <> v_user_id::text THEN
    RAISE EXCEPTION 'A profile can only use a photo uploaded by its owner.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET avatar_url = v_url WHERE id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  RETURN v_url;
END;
$$;

REVOKE ALL ON FUNCTION public.save_own_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_own_avatar(text) TO authenticated, service_role;
