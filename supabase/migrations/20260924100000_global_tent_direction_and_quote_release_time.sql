/*
  Give the instructor one camp-wide tent direction for every new or tentless
  cadet. A per-cadet direction remains an explicit override. The same resolver
  is used by reads, applications, and approvals so stale clients cannot join a
  different tent.

  Quote feeds also expose the authoritative meditation submission time so each
  quote can show when it was released.
*/

CREATE TABLE IF NOT EXISTS public.tent_join_guidance_settings (
  setting_key text PRIMARY KEY CHECK (setting_key = 'camp_default'),
  tent_id uuid REFERENCES public.tents(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tent_join_guidance_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tent_join_guidance_settings_read_authenticated
  ON public.tent_join_guidance_settings;
CREATE POLICY tent_join_guidance_settings_read_authenticated
  ON public.tent_join_guidance_settings
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.tent_join_guidance_settings
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tent_join_guidance_settings TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables publication_table
       WHERE publication_table.pubname = 'supabase_realtime'
         AND publication_table.schemaname = 'public'
         AND publication_table.tablename = 'tent_join_guidance_settings'
     )
  THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.tent_join_guidance_settings;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_tent_join_direction(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT direction.tent_id
      FROM public.tent_join_directions direction
      WHERE direction.user_id = p_user_id
    ),
    (
      SELECT setting.tent_id
      FROM public.tent_join_guidance_settings setting
      WHERE setting.setting_key = 'camp_default'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.resolve_tent_join_direction(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_default_tent_join_direction(
  p_tent_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only the instructor can choose the camp-wide tour tent.';
  END IF;

  IF p_tent_id IS NULL THEN
    DELETE FROM public.tent_join_guidance_settings
    WHERE setting_key = 'camp_default';

    UPDATE public.tent_join_requests request
    SET status = 'cancelled', reviewed_at = now()
    WHERE request.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM public.tent_join_directions direction
        WHERE direction.user_id = request.user_id
      );
    RETURN true;
  END IF;

  PERFORM 1
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

  INSERT INTO public.tent_join_guidance_settings(
    setting_key,
    tent_id,
    updated_by
  )
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
      SELECT 1
      FROM public.tent_join_directions direction
      WHERE direction.user_id = request.user_id
    );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_tent_join_direction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_tent_join_direction(uuid)
  TO authenticated;

-- Clearing an individual override now falls back to the camp-wide direction
-- instead of leaving the cadet without a valid route.
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
  v_member_count integer;
  v_tent_name text;
  v_cadet_name text;
  v_fallback_tent_id uuid;
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

  IF EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'This cadet already belongs to a tent.';
  END IF;

  IF p_tent_id IS NULL THEN
    DELETE FROM public.tent_join_directions direction
    WHERE direction.user_id = p_user_id;

    v_fallback_tent_id := public.resolve_tent_join_direction(p_user_id);
    UPDATE public.tent_join_requests request
    SET status = 'cancelled', reviewed_at = now()
    WHERE request.user_id = p_user_id
      AND request.status = 'pending'
      AND (
        v_fallback_tent_id IS NULL
        OR request.tent_id IS DISTINCT FROM v_fallback_tent_id
      );
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

  UPDATE public.tent_join_requests request
  SET status = 'cancelled', reviewed_at = now()
  WHERE request.user_id = p_user_id
    AND request.status = 'pending'
    AND request.tent_id <> p_tent_id;

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

REVOKE ALL ON FUNCTION public.set_tent_join_direction(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tent_join_direction(uuid, uuid)
  TO authenticated;

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

  v_directed_tent_id := public.resolve_tent_join_direction(auth.uid());
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

  UPDATE public.tent_join_requests request
  SET status = 'cancelled', reviewed_at = now()
  WHERE request.user_id = auth.uid() AND request.status = 'pending';

  INSERT INTO public.tent_join_requests(tent_id, user_id)
  VALUES (p_tent_id, auth.uid())
  RETURNING id INTO v_request_id;

  SELECT profile.display_name INTO v_applicant_name
  FROM public.profiles profile
  WHERE profile.id = auth.uid();

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
      jsonb_build_object(
        'request_id', v_request_id,
        'tent_id', p_tent_id,
        'applicant_id', auth.uid()
      )
    );
  END LOOP;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_tent_join_request(
  p_request_id uuid,
  p_approve boolean
)
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

    IF public.resolve_tent_join_direction(v_request.user_id)
       IS DISTINCT FROM v_request.tent_id THEN
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
    jsonb_build_object(
      'request_id', p_request_id,
      'tent_id', v_request.tent_id,
      'approved', p_approve
    )
  );
  RETURN true;
END;
$$;

UPDATE public.tent_join_requests request
SET status = 'cancelled', reviewed_at = now()
WHERE request.status = 'pending'
  AND (
    public.resolve_tent_join_direction(request.user_id)
      IS DISTINCT FROM request.tent_id
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

REVOKE ALL ON FUNCTION public.request_to_join_tent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_tent_join_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_to_join_tent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tent_join_request(uuid, boolean)
  TO authenticated;

DROP FUNCTION IF EXISTS public.get_daily_quote_feed(integer);

CREATE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 100)
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
  tent_name text,
  released_at timestamptz
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
  candidates AS MATERIALIZED (
    SELECT
      record.record_date,
      record.daily_quote,
      record.user_id,
      record.meditation_submitted_at,
      clock.iso_day
    FROM public.daily_records record
    CROSS JOIN clock
    WHERE record.meditation_submitted = true
      AND NULLIF(btrim(record.daily_quote), '') IS NOT NULL
      AND (
        (clock.iso_day IN (6, 7) AND record.record_date BETWEEN clock.week_start AND clock.today)
        OR (clock.iso_day NOT IN (6, 7) AND record.record_date = clock.today)
      )
  ),
  candidate_users AS MATERIALIZED (
    SELECT DISTINCT candidate.user_id
    FROM candidates candidate
  ),
  author_totals AS MATERIALIZED (
    SELECT
      author.user_id,
      COALESCE(public.get_user_lifetime_figs(author.user_id, NULL), 0)::integer AS total_figs,
      (
        SELECT count(*)::integer
        FROM public.arena_rooms room
        WHERE room.winner_id = author.user_id
          AND room.status = 'completed'
      ) AS rhudes
    FROM candidate_users author
  )
  SELECT
    candidate.record_date,
    candidate.daily_quote,
    candidate.user_id,
    profile.display_name,
    profile.avatar_url,
    COALESCE(streak.current_streak, 0)::integer,
    COALESCE(author_totals.total_figs, 0)::integer,
    COALESCE(author_totals.rhudes, 0)::integer,
    COALESCE(active_role.role, 'cadet')::text,
    active_tent.tent_house_id,
    active_tent.tent_name,
    candidate.meditation_submitted_at
  FROM candidates candidate
  JOIN public.profiles profile ON profile.id = candidate.user_id
  LEFT JOIN author_totals ON author_totals.user_id = candidate.user_id
  LEFT JOIN LATERAL (
    SELECT snapshot.current_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = candidate.user_id
    ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  ) streak ON true
  LEFT JOIN LATERAL (
    SELECT assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.user_id = candidate.user_id
      AND assignment.status IN ('active', 'approved')
    ORDER BY
      CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
      CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
      assignment.start_date DESC NULLS LAST,
      assignment.created_at DESC
    LIMIT 1
  ) active_role ON true
  LEFT JOIN LATERAL (
    SELECT tent.tent_house_id, tent.name AS tent_name
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    WHERE member.user_id = candidate.user_id
    ORDER BY member.joined_at DESC
    LIMIT 1
  ) active_tent ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS reaction_count
    FROM public.daily_quote_reactions reaction
    WHERE reaction.quote_user_id = candidate.user_id
      AND reaction.quote_record_date = candidate.record_date
  ) reactions ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS comment_count
    FROM public.daily_quote_comments comment
    WHERE comment.quote_user_id = candidate.user_id
      AND comment.quote_record_date = candidate.record_date
  ) comments ON true
  ORDER BY
    CASE WHEN candidate.iso_day IN (6, 7)
      THEN COALESCE(reactions.reaction_count, 0) + COALESCE(comments.comment_count, 0)
    END DESC,
    CASE WHEN candidate.iso_day IN (6, 7) THEN candidate.record_date END DESC,
    candidate.meditation_submitted_at DESC NULLS LAST,
    profile.display_name ASC
  LIMIT CASE
    WHEN (SELECT iso_day FROM clock) IN (6, 7) THEN 3
    ELSE LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250)
  END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_quote_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_daily_quotes(
  p_record_date date,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'record_date', quote.record_date,
        'daily_quote', quote.daily_quote,
        'user_id', quote.user_id,
        'display_name', quote.display_name,
        'avatar_url', quote.avatar_url,
        'current_streak', COALESCE(streak.current_streak, 0),
        'has_public_meditation', quote.has_public_meditation,
        'released_at', quote.meditation_submitted_at
      )
      ORDER BY quote.meditation_submitted_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      record.record_date,
      record.daily_quote,
      record.user_id,
      profile.display_name,
      profile.avatar_url,
      (
        record.meditation_public
        AND NULLIF(btrim(record.meditation_text), '') IS NOT NULL
      ) AS has_public_meditation,
      record.meditation_submitted_at
    FROM public.daily_records record
    JOIN public.profiles profile ON profile.id = record.user_id
    WHERE record.record_date = p_record_date
      AND record.meditation_submitted = true
      AND NULLIF(btrim(record.daily_quote), '') IS NOT NULL
    ORDER BY record.meditation_submitted_at DESC NULLS LAST
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30)
  ) quote
  LEFT JOIN LATERAL (
    SELECT snapshot.current_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = quote.user_id
    ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  ) streak ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_daily_quotes(date, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_daily_quotes(date, integer)
  TO anon, authenticated, service_role;
