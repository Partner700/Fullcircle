/*
  Make tent assignment deterministic and repair the two completions confirmed
  by the instructor on 7 September. Membership writes now name the exact tent
  and return a read-back receipt; clients no longer infer a tent from whichever
  ownership row happens to be returned first.
*/

CREATE OR REPLACE FUNCTION public.sentry_assign_cadet_to_tent(
  p_tent_id uuid,
  p_cadet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_tent public.tents%ROWTYPE;
  v_existing_tent_id uuid;
  v_current_cadets integer;
  v_receipt jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before adding a cadet to a tent.';
  END IF;

  SELECT tent.*
  INTO v_tent
  FROM public.tents tent
  WHERE tent.id = p_tent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tent not found.';
  END IF;

  IF NOT (
    public.is_instructor(v_actor_id)
    OR v_tent.sentry_id = v_actor_id
    OR EXISTS (
      SELECT 1
      FROM public.tent_members member
      WHERE member.tent_id = p_tent_id
        AND member.user_id = v_actor_id
        AND member.role = 'sentry'
    )
  ) THEN
    RAISE EXCEPTION 'You can only add cadets to the tent currently assigned to you.';
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

  SELECT member.tent_id
  INTO v_existing_tent_id
  FROM public.tent_members member
  WHERE member.user_id = p_cadet_id
  ORDER BY member.joined_at DESC NULLS LAST, member.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_tent_id IS NOT NULL AND v_existing_tent_id <> p_tent_id THEN
    RAISE EXCEPTION 'This cadet already belongs to another tent.';
  END IF;

  IF v_existing_tent_id IS NULL THEN
    SELECT count(*)::integer
    INTO v_current_cadets
    FROM public.tent_members member
    WHERE member.tent_id = p_tent_id
      AND coalesce(member.role, 'cadet') = 'cadet';

    IF v_current_cadets >= coalesce(v_tent.max_cadets, 10) THEN
      RAISE EXCEPTION 'Tent is full.';
    END IF;

    INSERT INTO public.tent_members(tent_id, user_id, role)
    VALUES (p_tent_id, p_cadet_id, 'cadet')
    ON CONFLICT (user_id) DO UPDATE
    SET tent_id = EXCLUDED.tent_id,
        role = 'cadet';
  ELSE
    UPDATE public.tent_members member
    SET role = 'cadet'
    WHERE member.user_id = p_cadet_id
      AND member.tent_id = p_tent_id;
  END IF;

  UPDATE public.tent_join_requests request
  SET status = CASE WHEN request.tent_id = p_tent_id THEN 'approved' ELSE 'cancelled' END,
      reviewed_by = v_actor_id,
      reviewed_at = coalesce(request.reviewed_at, now())
  WHERE request.user_id = p_cadet_id
    AND request.status = 'pending';

  SELECT jsonb_build_object(
    'success', true,
    'user_id', member.user_id,
    'tent_id', member.tent_id,
    'tent_name', tent.name,
    'tent_house_id', tent.tent_house_id,
    'role', member.role
  )
  INTO v_receipt
  FROM public.tent_members member
  JOIN public.tents tent ON tent.id = member.tent_id
  WHERE member.user_id = p_cadet_id
    AND member.tent_id = p_tent_id;

  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'Tent assignment could not be verified.';
  END IF;

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.sentry_assign_cadet_to_tent(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sentry_assign_cadet_to_tent(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_tent_context()
RETURNS TABLE(
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  sentry_id uuid,
  max_cadets integer,
  member_role text,
  joined_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tent.id,
    tent.name,
    tent.tent_house_id,
    tent.sentry_id,
    coalesce(tent.max_cadets, 10),
    coalesce(member.role, 'cadet'),
    member.joined_at
  FROM public.tent_members member
  JOIN public.tents tent ON tent.id = member.tent_id
  WHERE member.user_id = auth.uid()
  ORDER BY member.joined_at DESC NULLS LAST, member.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_tent_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tent_context()
  TO authenticated, service_role;

-- Megan's accepted Spades placement may have been written to a stale tent by
-- sentry_add_cadet_to_tent. Prefer her own Spades application, then the current
-- staffed Spades tent, and make the resulting membership singular.
DO $$
DECLARE
  v_megan_id uuid;
  v_spades_id uuid;
  v_match_count integer;
  v_cadet_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_match_count
  FROM public.profiles profile
  WHERE regexp_replace(lower(btrim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE 'megan%'
    AND EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.role = 'cadet'
        AND assignment.status IN ('active', 'approved')
    );

  IF v_match_count = 1 THEN
    SELECT profile.id
    INTO v_megan_id
    FROM public.profiles profile
    WHERE regexp_replace(lower(btrim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE 'megan%'
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.role = 'cadet'
          AND assignment.status IN ('active', 'approved')
      )
    LIMIT 1;

    SELECT request.tent_id
    INTO v_spades_id
    FROM public.tent_join_requests request
    JOIN public.tents tent ON tent.id = request.tent_id
    WHERE request.user_id = v_megan_id
      AND (
        tent.tent_house_id = 'spades'
        OR regexp_replace(lower(btrim(tent.name)), '[^a-z0-9]+', '', 'g') IN ('spades', 'thespades')
      )
    ORDER BY
      CASE request.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      request.reviewed_at DESC NULLS LAST,
      request.created_at DESC
    LIMIT 1;

    IF v_spades_id IS NULL THEN
      SELECT tent.id
      INTO v_spades_id
      FROM public.tents tent
      WHERE tent.tent_house_id = 'spades'
        OR regexp_replace(lower(btrim(tent.name)), '[^a-z0-9]+', '', 'g') IN ('spades', 'thespades')
      ORDER BY (tent.sentry_id IS NOT NULL) DESC, tent.created_at DESC, tent.id
      LIMIT 1;
    END IF;

    IF v_spades_id IS NOT NULL THEN
      DELETE FROM public.tent_members member
      WHERE member.user_id = v_megan_id
        AND member.tent_id <> v_spades_id;

      SELECT count(*)::integer
      INTO v_cadet_count
      FROM public.tent_members member
      WHERE member.tent_id = v_spades_id
        AND coalesce(member.role, 'cadet') = 'cadet';

      UPDATE public.tents tent
      SET max_cadets = greatest(coalesce(tent.max_cadets, 10), v_cadet_count + 1)
      WHERE tent.id = v_spades_id;

      INSERT INTO public.tent_members(tent_id, user_id, role)
      VALUES (v_spades_id, v_megan_id, 'cadet')
      ON CONFLICT (user_id) DO UPDATE
      SET tent_id = EXCLUDED.tent_id,
          role = 'cadet';

      UPDATE public.tent_join_requests request
      SET status = CASE WHEN request.tent_id = v_spades_id THEN 'approved' ELSE 'cancelled' END,
          reviewed_at = coalesce(request.reviewed_at, now())
      WHERE request.user_id = v_megan_id
        AND request.status IN ('pending', 'approved');
    END IF;
  END IF;
END;
$$;

-- The instructor confirmed that Megan and PH completed both weekday duties.
-- Preserve their existing text and marker identity while repairing only the
-- timestamps/flags that the late correction failed to publish.
DO $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_day_start timestamptz := (timezone('Africa/Douala', now())::date::timestamp AT TIME ZONE 'Africa/Douala');
  v_user record;
  v_before integer;
  v_before_met boolean;
  v_after integer;
  v_expected integer;
  v_longest integer;
BEGIN
  IF extract(dow FROM v_today) NOT BETWEEN 1 AND 5 THEN
    RETURN;
  END IF;

  FOR v_user IN
    WITH normalized AS (
      SELECT
        profile.id,
        regexp_replace(lower(btrim(profile.display_name)), '[^a-z0-9]+', '', 'g') AS name_key
      FROM public.profiles profile
      WHERE EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.role IN ('cadet', 'sentry')
          AND assignment.status IN ('active', 'approved')
      )
    ), candidates AS (
      SELECT
        normalized.id,
        CASE WHEN normalized.name_key = 'ph' THEN 'ph' ELSE 'megan' END AS repair_key
      FROM normalized
      WHERE normalized.name_key = 'ph'
         OR normalized.name_key LIKE 'megan%'
    ), unique_targets AS (
      SELECT
        candidates.repair_key,
        (array_agg(candidates.id ORDER BY candidates.id))[1] AS id
      FROM candidates
      GROUP BY candidates.repair_key
      HAVING count(*) = 1
    )
    SELECT unique_targets.id, unique_targets.repair_key
    FROM unique_targets
  LOOP
    v_before_met := public.streak_requirement_met(v_user.id, v_today)
      OR public.streak_day_is_restored(v_user.id, v_today)
      OR public.streak_day_is_purchased(v_user.id, v_today);

    SELECT coalesce(streak.current_streak, 0), coalesce(streak.longest_streak, 0)
    INTO v_before, v_longest
    FROM public.get_authoritative_streak(v_user.id) streak
    LIMIT 1;

    INSERT INTO public.daily_records(
      user_id,
      record_date,
      day_type,
      attendance_status,
      attendance_marked_at,
      meditation_submitted,
      meditation_submitted_at,
      streak_valid
    ) VALUES (
      v_user.id,
      v_today,
      'weekday',
      'present',
      v_day_start + interval '11 hours 59 minutes',
      true,
      v_day_start + interval '20 hours 59 minutes',
      true
    )
    ON CONFLICT (user_id, record_date) DO UPDATE
    SET day_type = 'weekday',
        attendance_status = 'present',
        attendance_marked_at = CASE
          WHEN public.daily_records.attendance_marked_at IS NULL
            OR (public.daily_records.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time >= time '12:00'
          THEN EXCLUDED.attendance_marked_at
          ELSE public.daily_records.attendance_marked_at
        END,
        meditation_submitted = true,
        meditation_submitted_at = CASE
          WHEN public.daily_records.meditation_submitted_at IS NULL
            OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00'
          THEN EXCLUDED.meditation_submitted_at
          ELSE public.daily_records.meditation_submitted_at
        END,
        streak_valid = true;

    PERFORM public.synchronize_daily_record_streak_valid(v_user.id, v_today);
    PERFORM public.refresh_user_streak_snapshot(v_user.id);

    SELECT coalesce(streak.current_streak, 0), coalesce(streak.longest_streak, 0)
    INTO v_after, v_longest
    FROM public.get_authoritative_streak(v_user.id) streak
    LIMIT 1;

    v_expected := greatest(
      coalesce(v_before, 0) + CASE WHEN v_before_met THEN 0 ELSE 1 END,
      coalesce(v_after, 0)
    );

    IF coalesce(v_after, 0) < v_expected THEN
      INSERT INTO public.streak_manual_adjustments AS adjustment(
        user_id,
        effective_date,
        current_streak,
        longest_streak,
        reason,
        created_at
      ) VALUES (
        v_user.id,
        v_today,
        v_expected,
        greatest(v_expected, coalesce(v_longest, 0)),
        'Verified 7 September weekday completion repair for ' || upper(v_user.repair_key),
        now()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET effective_date = v_today,
          current_streak = greatest(adjustment.current_streak, EXCLUDED.current_streak),
          longest_streak = greatest(adjustment.longest_streak, EXCLUDED.longest_streak),
          reason = EXCLUDED.reason,
          created_at = now();

      PERFORM public.refresh_user_streak_snapshot(v_user.id);
    END IF;
  END LOOP;
END;
$$;

SELECT public.refresh_all_streak_snapshots();
