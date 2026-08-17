/* Make Sunday an optional bonus day and materialize every repaired streak day.
   Opening Today's Reading on Sunday adds one day; not opening it is neutral. */

-- A restitution must remain valid even if protection rows are later consumed,
-- reclassified, or read by an older client path.
INSERT INTO public.daily_records (
  user_id,
  record_date,
  day_type,
  attendance_status,
  meditation_submitted,
  streak_valid
)
SELECT
  protection.user_id,
  protection.applied_to_date,
  CASE extract(dow FROM protection.applied_to_date)
    WHEN 0 THEN 'sunday'
    WHEN 6 THEN 'saturday'
    ELSE 'weekday'
  END,
  'unmarked',
  false,
  true
FROM public.streak_freezers protection
WHERE protection.source = 'thiefs_request'
  AND protection.applied_to_date IS NOT NULL
ON CONFLICT (user_id, record_date) DO UPDATE
SET streak_valid = true;

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

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    v_complete := public.streak_requirement_met(p_user_id, v_check);

    -- A dated restoration is authoritative and can rebuild a chain from zero.
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
      -- Sunday is a bonus/rest day: opening the reading adds a day, while an
      -- unopened Sunday neither adds nor breaks the chain.
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

    -- Do not count an unfinished current day as a loss before its deadline.
    IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    -- Daily/weekly freezers preserve an existing weekday chain. The explicit
    -- restoration sources above are deliberately allowed to rebuild from zero.
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

-- Refresh every current snapshot so toolbars and boards receive the corrected
-- Sunday/restitution result immediately instead of showing an older zero row.
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
