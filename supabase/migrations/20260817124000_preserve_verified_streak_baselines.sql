/* Rebuild incomplete legacy history from the last verified positive board state.
   This repairs accounts such as Sentinel Vedette whose published streak existed
   before every earning action was represented by durable daily evidence. */

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date;
  v_check date;
  v_baseline_date date;
  v_baseline_current integer := 0;
  v_baseline_longest integer := 0;
  v_eligible boolean;
  v_complete boolean;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
BEGIN
  SELECT LEAST(
    COALESCE((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    COALESCE((
      SELECT min(record.record_date)
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
    ), v_today)
  )
  INTO v_start
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

  IF v_start IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  -- A positive value already published by the platform is verified earned
  -- history. Prefer the strongest state, then the latest occurrence of it.
  SELECT
    snapshot.snapshot_date,
    coalesce(snapshot.current_streak, 0),
    greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
  INTO v_baseline_date, v_baseline_current, v_baseline_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id
    AND coalesce(snapshot.current_streak, 0) > 0
    AND snapshot.snapshot_date <= v_today
  ORDER BY snapshot.current_streak DESC, snapshot.snapshot_date DESC, snapshot.created_at DESC
  LIMIT 1;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    -- The snapshot is the authoritative end-of-day state. Resume calculation
    -- on the following date instead of trying to reinterpret old partial rows.
    IF v_baseline_date IS NOT NULL AND v_check = v_baseline_date THEN
      v_current := greatest(v_current, v_baseline_current);
      v_longest := greatest(v_longest, v_baseline_longest, v_current);
      v_consecutive := 0;
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    v_complete := public.streak_requirement_met(p_user_id, v_check);

    IF NOT v_complete THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.streak_freezers restoration
        WHERE restoration.user_id = p_user_id
          AND restoration.used_at IS NULL
          AND restoration.applied_to_date = v_check
          AND (restoration.expires_at IS NULL OR restoration.expires_at::date >= v_check)
          AND restoration.source IN ('relic', 'redemption', 'thiefs_request')
      ) INTO v_complete;
    END IF;

    v_eligible := CASE
      WHEN extract(dow FROM v_check) = 0 THEN v_complete
      WHEN extract(dow FROM v_check) = 6 THEN EXISTS (
        SELECT 1
        FROM public.quiz_sessions session
        WHERE session.session_date = v_check
          AND session.quiz_type = 'saturday'
      ) OR v_complete
      ELSE true
    END;

    IF NOT v_eligible THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    IF NOT v_complete AND v_current > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.streak_freezers protection
        WHERE protection.user_id = p_user_id
          AND protection.used_at IS NULL
          AND protection.applied_to_date = v_check
          AND (protection.expires_at IS NULL OR protection.expires_at::date >= v_check)
          AND extract(dow FROM v_check) BETWEEN 1 AND 5
      ) INTO v_complete;
    END IF;

    IF v_complete THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSE
      v_current := 0;
      v_consecutive := v_consecutive + 1;
      v_cumulative := v_cumulative + 1;
    END IF;

    v_check := v_check + 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;

DO $$
DECLARE
  v_profile_id uuid;
  v_streak record;
BEGIN
  FOR v_profile_id IN SELECT profile.id FROM public.profiles profile LOOP
    SELECT * INTO v_streak
    FROM public.get_authoritative_streak(v_profile_id)
    LIMIT 1;

    INSERT INTO public.streakboard_snapshots (
      snapshot_date, user_id, current_streak, longest_streak
    ) VALUES (
      timezone('Africa/Douala', now())::date,
      v_profile_id,
      coalesce(v_streak.current_streak, 0),
      coalesce(v_streak.longest_streak, 0)
    );
  END LOOP;
END;
$$;
