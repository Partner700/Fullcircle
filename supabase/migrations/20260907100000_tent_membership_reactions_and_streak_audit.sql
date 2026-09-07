-- Keep tent membership singular, let tent sentries review applications, and
-- make social reactions reversible from every authenticated surface.

-- Repair sentries whose ownership row was not mirrored into tent_members.
INSERT INTO public.tent_members (tent_id, user_id, role)
SELECT tent.id, tent.sentry_id, 'sentry'
FROM public.tents tent
WHERE tent.sentry_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.user_id = tent.sentry_id
  )
ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'sentry';

-- Recover Megan from the durable approval record when an older client lost the
-- membership insert. This is deliberately evidence-based and never guesses a tent.
INSERT INTO public.tent_members (tent_id, user_id, role)
SELECT request.tent_id, profile.id, 'cadet'
FROM public.profiles profile
JOIN LATERAL (
  SELECT join_request.tent_id
  FROM public.tent_join_requests join_request
  WHERE join_request.user_id = profile.id
    AND join_request.status = 'approved'
  ORDER BY join_request.reviewed_at DESC NULLS LAST, join_request.created_at DESC
  LIMIT 1
) request ON true
WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'megan'
  AND NOT EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.user_id = profile.id
  )
ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'cadet';

-- Older functions could move users by deleting and reinserting membership. If
-- historical duplicates exist, retain the assigned sentry row first, otherwise
-- the latest membership, before enforcing the invariant globally.
WITH ranked_memberships AS (
  SELECT
    member.id,
    row_number() OVER (
      PARTITION BY member.user_id
      ORDER BY
        (tent.sentry_id = member.user_id) DESC,
        member.joined_at DESC NULLS LAST,
        member.id DESC
    ) AS keep_rank
  FROM public.tent_members member
  JOIN public.tents tent ON tent.id = member.tent_id
)
DELETE FROM public.tent_members member
USING ranked_memberships ranked
WHERE member.id = ranked.id
  AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS tent_members_one_tent_per_user
  ON public.tent_members(user_id);

CREATE OR REPLACE FUNCTION public.prevent_multiple_tent_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tent_members member
    WHERE member.user_id = NEW.user_id
      AND member.tent_id <> NEW.tent_id
      AND (TG_OP = 'INSERT' OR member.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'This user already belongs to another tent.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_multiple_tent_memberships ON public.tent_members;
CREATE TRIGGER prevent_multiple_tent_memberships
BEFORE INSERT OR UPDATE OF tent_id, user_id ON public.tent_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_multiple_tent_memberships();

CREATE OR REPLACE FUNCTION public.request_to_join_tent(p_tent_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_capacity integer;
  v_count integer;
  v_tent_name text;
  v_applicant_name text;
  v_sentry_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to request a tent.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You already belong to a tent.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.role = 'cadet'
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only cadets who are not yet in a tent can apply.';
  END IF;

  SELECT tent.max_cadets, tent.name
  INTO v_capacity, v_tent_name
  FROM public.tents tent
  WHERE tent.id = p_tent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;

  SELECT count(*) INTO v_count
  FROM public.tent_members member
  WHERE member.tent_id = p_tent_id AND member.role = 'cadet';
  IF v_count >= coalesce(v_capacity, 10) THEN RAISE EXCEPTION 'This tent is full.'; END IF;

  UPDATE public.tent_join_requests
  SET status = 'cancelled', reviewed_at = now()
  WHERE user_id = auth.uid() AND status = 'pending';

  INSERT INTO public.tent_join_requests(tent_id, user_id)
  VALUES (p_tent_id, auth.uid())
  RETURNING id INTO v_request_id;

  SELECT display_name INTO v_applicant_name FROM public.profiles WHERE id = auth.uid();
  FOR v_sentry_id IN
    SELECT DISTINCT sentry.user_id
    FROM (
      SELECT tent.sentry_id AS user_id FROM public.tents tent WHERE tent.id = p_tent_id
      UNION ALL
      SELECT member.user_id FROM public.tent_members member
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
  v_capacity integer;
  v_count integer;
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

  SELECT tent.max_cadets, tent.name INTO v_capacity, v_tent_name
  FROM public.tents tent WHERE tent.id = v_request.tent_id;

  IF p_approve THEN
    IF EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.user_id = v_request.user_id
        AND member.tent_id <> v_request.tent_id
    ) THEN
      RAISE EXCEPTION 'This cadet already belongs to another tent.';
    END IF;
    SELECT count(*) INTO v_count FROM public.tent_members member
    WHERE member.tent_id = v_request.tent_id AND member.role = 'cadet';
    IF v_count >= coalesce(v_capacity, 10) AND NOT EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.user_id = v_request.user_id AND member.tent_id = v_request.tent_id
    ) THEN
      RAISE EXCEPTION 'This tent is full.';
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
    WHERE user_id = v_request.user_id AND id <> p_request_id AND status = 'pending';
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

CREATE OR REPLACE FUNCTION public.get_my_tent_join_requests(p_tent_id uuid)
RETURNS TABLE (
  request_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_instructor(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tents tent WHERE tent.id = p_tent_id AND tent.sentry_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tent_members member
      WHERE member.tent_id = p_tent_id AND member.user_id = auth.uid() AND member.role = 'sentry'
    )
  ) THEN
    RAISE EXCEPTION 'You cannot review applications for this tent.';
  END IF;

  RETURN QUERY
  SELECT request.id, request.user_id, profile.display_name, profile.avatar_url, request.created_at
  FROM public.tent_join_requests request
  JOIN public.profiles profile ON profile.id = request.user_id
  WHERE request.tent_id = p_tent_id AND request.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = request.user_id)
  ORDER BY request.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_cadet_to_tent(p_tent_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_max_cadets integer; v_current_cadets integer;
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN RAISE EXCEPTION 'Only instructors can assign cadets to tents'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id = p_user_id AND tent_id <> p_tent_id) THEN
    RAISE EXCEPTION 'This cadet already belongs to another tent. Remove that membership before assigning a new one.';
  END IF;
  SELECT coalesce(max_cadets, 10) INTO v_max_cadets FROM public.tents WHERE id = p_tent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'User is not an active cadet'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE tent_id = p_tent_id AND user_id = p_user_id) THEN RETURN true; END IF;
  SELECT count(*) INTO v_current_cadets FROM public.tent_members WHERE tent_id = p_tent_id AND role = 'cadet';
  IF v_current_cadets >= v_max_cadets THEN RAISE EXCEPTION 'Tent is full (max % cadets)', v_max_cadets; END IF;
  INSERT INTO public.tent_members(tent_id, user_id, role) VALUES (p_tent_id, p_user_id, 'cadet');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.sentry_add_cadet_to_tent(p_sentry_id uuid, p_cadet_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tent_id uuid; v_current_cadets integer; v_max_cadets integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only add cadets from your own sentry account.';
  END IF;
  SELECT tent.id, coalesce(tent.max_cadets, 10) INTO v_tent_id, v_max_cadets
  FROM public.tents tent WHERE tent.sentry_id = p_sentry_id LIMIT 1;
  IF v_tent_id IS NULL THEN
    SELECT member.tent_id, coalesce(tent.max_cadets, 10) INTO v_tent_id, v_max_cadets
    FROM public.tent_members member JOIN public.tents tent ON tent.id = member.tent_id
    WHERE member.user_id = p_sentry_id AND member.role = 'sentry' LIMIT 1;
  END IF;
  IF v_tent_id IS NULL THEN RAISE EXCEPTION 'No tent found for this sentry.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = p_cadet_id AND role = 'cadet' AND status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'That user is not an active cadet.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id = p_cadet_id AND tent_id <> v_tent_id) THEN
    RAISE EXCEPTION 'This cadet already belongs to another tent.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id = p_cadet_id AND tent_id = v_tent_id) THEN RETURN true; END IF;
  SELECT count(*) INTO v_current_cadets FROM public.tent_members WHERE tent_id = v_tent_id AND role = 'cadet';
  IF v_current_cadets >= v_max_cadets THEN RAISE EXCEPTION 'Tent is full.'; END IF;
  INSERT INTO public.tent_members(tent_id, user_id, role) VALUES (v_tent_id, p_cadet_id, 'cadet');
  UPDATE public.tent_join_requests
  SET status = CASE WHEN tent_id = v_tent_id THEN 'approved' ELSE 'cancelled' END,
      reviewed_by = p_sentry_id, reviewed_at = now()
  WHERE user_id = p_cadet_id AND status = 'pending';
  RETURN true;
END;
$$;

-- Notify instructors when a new profile needs placement.
CREATE OR REPLACE FUNCTION public.notify_instructors_of_new_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_instructor_id uuid;
BEGIN
  FOR v_instructor_id IN
    SELECT DISTINCT assignment.user_id
    FROM public.role_assignments assignment
    WHERE assignment.role = 'instructor' AND assignment.status IN ('active', 'approved')
  LOOP
    PERFORM public.notify_user(
      v_instructor_id, NEW.id, 'new_member', 'New member needs a tent',
      coalesce(NEW.display_name, 'A new member') || ' joined Full Circle. Add them to a tent when their account is ready.',
      'cadets', jsonb_build_object('user_id', NEW.id)
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_instructors_of_new_member ON public.profiles;
CREATE TRIGGER notify_instructors_of_new_member
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_instructors_of_new_member();

-- Quote and verse reactions are toggles: tapping an active reaction removes it.
CREATE OR REPLACE FUNCTION public.react_to_daily_quote(
  p_quote_user_id uuid,
  p_quote_record_date date,
  p_reactor_user_id uuid,
  p_reaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_reactor_id uuid := auth.uid(); v_deleted integer := 0; v_reactor_name text;
BEGIN
  IF v_reactor_id IS NULL OR v_reactor_id IS DISTINCT FROM p_reactor_user_id THEN RAISE EXCEPTION 'You can only react as yourself.'; END IF;
  IF p_reaction_type NOT IN ('amen', 'spark', 'thoughtful') THEN RAISE EXCEPTION 'Unsupported reaction type.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_records
    WHERE user_id = p_quote_user_id AND record_date = p_quote_record_date
      AND nullif(btrim(coalesce(daily_quote, '')), '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'Quote not found.'; END IF;
  DELETE FROM public.daily_quote_reactions
  WHERE quote_user_id = p_quote_user_id AND quote_record_date = p_quote_record_date
    AND reactor_user_id = v_reactor_id AND reaction_type = p_reaction_type;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    INSERT INTO public.daily_quote_reactions(quote_user_id, quote_record_date, reactor_user_id, reaction_type)
    VALUES (p_quote_user_id, p_quote_record_date, v_reactor_id, p_reaction_type);
    IF p_quote_user_id <> v_reactor_id THEN
      SELECT display_name INTO v_reactor_name FROM public.profiles WHERE id = v_reactor_id;
      PERFORM public.notify_user(
        p_quote_user_id, v_reactor_id, 'social', 'Quote reaction',
        coalesce(v_reactor_name, 'Someone') || ' reacted to your quote.', 'dashboard',
        jsonb_build_object('quote_record_date', p_quote_record_date, 'reaction_type', p_reaction_type)
      );
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'reacted', v_deleted = 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.react_to_daily_verse(
  p_narrative_date date,
  p_reactor_user_id uuid,
  p_reaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_reactor_user_id THEN RAISE EXCEPTION 'You can only react as yourself.'; END IF;
  IF p_reaction_type NOT IN ('amen', 'spark', 'thoughtful') THEN RAISE EXCEPTION 'Unsupported reaction type.'; END IF;
  DELETE FROM public.daily_verse_reactions
  WHERE narrative_date = p_narrative_date AND reactor_user_id = p_reactor_user_id AND reaction_type = p_reaction_type;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    INSERT INTO public.daily_verse_reactions(narrative_date, reactor_user_id, reaction_type)
    VALUES (p_narrative_date, p_reactor_user_id, p_reaction_type);
  END IF;
  RETURN jsonb_build_object('success', true, 'reacted', v_deleted = 0);
END;
$$;

-- Avatar awards are intentionally restrained: the standing Vallum keeps the
-- Chi-Rho and the standing Centurion keeps a shield. No other award decorates
-- profile pictures.
CREATE OR REPLACE FUNCTION public.get_current_avatar_awards()
RETURNS TABLE (user_id uuid, award_type text, title text, cadence text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', statement_timestamp())::date AS today
  ), classified AS (
    SELECT
      award.*,
      CASE
        WHEN lower(btrim(award.award_type)) = 'vallum'
          OR (lower(btrim(award.title)) LIKE '%vallum%' AND lower(btrim(award.title)) NOT LIKE '%grand vallum%')
          THEN 'vallum'
        WHEN lower(btrim(award.award_type)) = 'centurion'
          OR lower(btrim(award.title)) LIKE '%centurion%'
          THEN 'centurion'
        ELSE NULL
      END AS avatar_type,
      coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END) AS recipient_id
    FROM public.awards award
    WHERE coalesce(award.award_target_type, 'cadet') <> 'tent'
  ), cycles AS (
    SELECT
      max(award_month) FILTER (
        WHERE avatar_type = 'vallum'
          AND award_month ~ '^[0-9]{4}-[0-9]{2}$'
          AND award_month <= to_char(clock.today, 'YYYY-MM')
      ) AS vallum_cycle,
      max(award_month) FILTER (
        WHERE avatar_type = 'centurion'
          AND award_month ~ '^[0-9]{4}-[0-9]{2}$'
          AND award_month <= to_char(clock.today, 'YYYY-MM')
      ) AS centurion_cycle
    FROM classified CROSS JOIN clock
    GROUP BY clock.today
  ), eligible AS (
    SELECT
      classified.recipient_id,
      classified.avatar_type,
      classified.title,
      row_number() OVER (
        PARTITION BY classified.recipient_id
        ORDER BY CASE classified.avatar_type WHEN 'vallum' THEN 2 ELSE 1 END DESC,
          classified.created_at DESC, classified.id DESC
      ) AS choice
    FROM classified CROSS JOIN cycles
    WHERE classified.recipient_id IS NOT NULL
      AND (
        (classified.avatar_type = 'vallum' AND classified.award_month = cycles.vallum_cycle)
        OR (classified.avatar_type = 'centurion' AND classified.award_month = cycles.centurion_cycle)
      )
  )
  SELECT eligible.recipient_id, eligible.avatar_type, eligible.title, 'monthly'::text
  FROM eligible
  WHERE eligible.choice = 1;
$$;

REVOKE ALL ON FUNCTION public.prevent_multiple_tent_memberships() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_instructors_of_new_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_to_join_tent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_tent_join_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_tent_join_requests(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sentry_add_cadet_to_tent(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.react_to_daily_quote(uuid, date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.react_to_daily_verse(date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_avatar_awards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_to_join_tent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tent_join_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tent_join_requests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sentry_add_cadet_to_tent(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.react_to_daily_quote(uuid, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.react_to_daily_verse(date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_avatar_awards() TO anon, authenticated, service_role;

-- Re-evaluate only the named users from canonical attendance/meditation evidence,
-- then publish fresh snapshots without inventing a streak value.
DO $$
DECLARE target record; record_day record;
BEGIN
  FOR target IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'megan'
       OR regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%wensl%'
  LOOP
    FOR record_day IN
      SELECT record.record_date FROM public.daily_records record
      WHERE record.user_id = target.id
        AND record.record_date >= timezone('Africa/Douala', now())::date - 45
    LOOP
      PERFORM public.synchronize_daily_record_streak_valid(target.id, record_day.record_date);
    END LOOP;
    PERFORM public.refresh_user_streak_snapshot(target.id);
  END LOOP;
END;
$$;
