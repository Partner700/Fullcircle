-- Scan the complete eligible history so longest streaks and cumulative misses
-- remain accurate after a streak has already been broken.
CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date;
  v_check date;
  v_complete boolean;
  v_has_quiz boolean;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
  v_available_freezers integer := 0;
  v_used_freezers integer := 0;
  v_simons_purse boolean := false;
  v_simons_days integer := 0;
BEGIN
  SELECT LEAST(
    COALESCE((p.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    COALESCE((SELECT min(dr.record_date) FROM public.daily_records dr WHERE dr.user_id = p_user_id), v_today)
  )
  INTO v_start
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_start IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO v_available_freezers
  FROM public.streak_freezers sf
  WHERE sf.user_id = p_user_id
    AND sf.freezer_type = 'daily'
    AND sf.used_at IS NULL
    AND sf.applied_to_date IS NULL
    AND (sf.expires_at IS NULL OR sf.expires_at::date >= v_start);

  SELECT EXISTS (
    SELECT 1
    FROM public.relic_inventory ri
    JOIN public.relic_types rt ON rt.id = ri.relic_type_id
    WHERE ri.user_id = p_user_id
      AND rt.slug = 'simons-purse'
      AND ri.quantity > 0
  ) INTO v_simons_purse;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    -- Sunday is always a day of rest.
    IF extract(dow FROM v_check) = 0 THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    v_complete := false;

    IF extract(dow FROM v_check) = 6 THEN
      SELECT EXISTS (
        SELECT 1 FROM public.quiz_sessions qs
        WHERE qs.session_date = v_check AND qs.quiz_type = 'saturday'
      ) INTO v_has_quiz;

      -- A Saturday without a released quiz is not counted against anyone.
      IF NOT v_has_quiz THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.quiz_attempts qa
        JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
        WHERE qa.user_id = p_user_id
          AND qs.session_date = v_check
          AND qs.quiz_type = 'saturday'
          AND qa.status IN ('submitted', 'timed_out')
      ) INTO v_complete;

      IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.daily_records dr
        WHERE dr.user_id = p_user_id
          AND dr.record_date = v_check
          AND coalesce(dr.meditation_submitted, false)
          AND (
            dr.meditation_submitted_at IS NULL
            OR (dr.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
          )
          AND (
            coalesce(dr.attendance_status, 'unmarked') = 'present'
            OR EXISTS (
              SELECT 1
              FROM public.daily_records marked
              JOIN public.tent_members cm ON cm.user_id = marked.user_id AND cm.role = 'cadet'
              JOIN public.tents t ON t.id = cm.tent_id
              LEFT JOIN public.tent_members sm
                ON sm.tent_id = cm.tent_id AND sm.user_id = p_user_id AND sm.role = 'sentry'
              WHERE marked.record_date = v_check
                AND marked.attendance_marked_by = p_user_id
                AND marked.attendance_marked_at IS NOT NULL
                AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
                AND (t.sentry_id = p_user_id OR sm.id IS NOT NULL)
            )
          )
      ) INTO v_complete;

      IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    END IF;

    IF NOT v_complete AND v_current > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.streak_freezers sf
        WHERE sf.user_id = p_user_id
          AND sf.used_at IS NULL
          AND sf.applied_to_date = v_check
          AND (sf.expires_at IS NULL OR sf.expires_at::date >= v_check)
      ) THEN
        v_complete := true;
      ELSIF extract(dow FROM v_check) BETWEEN 1 AND 5
        AND v_simons_purse AND v_simons_days < 5 THEN
        v_complete := true;
        v_simons_days := v_simons_days + 1;
      ELSIF v_used_freezers < v_available_freezers THEN
        v_complete := true;
        v_used_freezers := v_used_freezers + 1;
      END IF;
    END IF;

    IF v_complete THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSE
      v_current := 0;
      v_consecutive := v_consecutive + 1;
      v_cumulative := v_cumulative + 1;
      v_simons_days := 0;
    END IF;

    v_check := v_check + 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;

-- A stored valid flag must obey the same 9 PM Africa/Douala deadline.
UPDATE public.daily_records
SET streak_valid = false
WHERE day_type = 'weekday'
  AND coalesce(meditation_submitted, false)
  AND meditation_submitted_at IS NOT NULL
  AND (meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00'
  AND coalesce(streak_valid, false) = true;

-- Keep valid-day volume separate from the longest consecutive run.
DROP FUNCTION IF EXISTS public.get_streakboard_live();
CREATE OR REPLACE FUNCTION public.get_streakboard_live()
RETURNS TABLE(
  id uuid,
  snapshot_date date,
  user_id uuid,
  tent_id uuid,
  tent_house_id text,
  volume integer,
  consistency integer,
  improvement numeric,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer,
  rank integer,
  profiles jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_cadets AS (
    SELECT DISTINCT ON (ra.user_id) ra.user_id
    FROM public.role_assignments ra
    WHERE ra.role = 'cadet' AND ra.status IN ('active', 'approved')
    ORDER BY ra.user_id, ra.created_at DESC
  ),
  member_tents AS (
    SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.tent_id, t.tent_house_id
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    WHERE tm.role = 'cadet'
    ORDER BY tm.user_id, tm.joined_at DESC NULLS LAST
  ),
  scored AS (
    SELECT
      ac.user_id,
      mt.tent_id,
      mt.tent_house_id,
      COALESCE((
        SELECT count(*)::integer
        FROM public.daily_records dr
        WHERE dr.user_id = ac.user_id AND COALESCE(dr.streak_valid, false)
      ), 0) AS volume,
      COALESCE(st.current_streak, 0)::integer AS current_streak,
      COALESCE(st.longest_streak, 0)::integer AS longest_streak,
      COALESCE(st.consecutive_inactive, 0)::integer AS consecutive_inactive,
      COALESCE(st.cumulative_inactive, 0)::integer AS cumulative_inactive,
      p.display_name,
      p.avatar_url
    FROM active_cadets ac
    JOIN public.profiles p ON p.id = ac.user_id
    LEFT JOIN member_tents mt ON mt.user_id = ac.user_id
    LEFT JOIN LATERAL public.compute_strict_streak(ac.user_id) st ON true
  )
  SELECT
    gen_random_uuid(),
    timezone('Africa/Douala', now())::date,
    scored.user_id,
    scored.tent_id,
    scored.tent_house_id,
    scored.volume,
    scored.longest_streak,
    0::numeric,
    scored.current_streak,
    scored.longest_streak,
    scored.consecutive_inactive,
    scored.cumulative_inactive,
    rank() OVER (
      ORDER BY scored.current_streak DESC, scored.longest_streak DESC, scored.volume DESC, scored.display_name ASC
    )::integer,
    jsonb_build_object('display_name', scored.display_name, 'avatar_url', scored.avatar_url)
  FROM scored
  ORDER BY 13, scored.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_streakboard_live() TO authenticated;
