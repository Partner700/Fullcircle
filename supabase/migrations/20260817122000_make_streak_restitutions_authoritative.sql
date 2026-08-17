/* Make previously awarded days and Thief's Request restitutions authoritative.
   A later genuine missed day can still end the current streak. */

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;
ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN (
    'denarii', 'payment', 'relic', 'redemption', 'simons_purse', 'thiefs_request'
  ));

CREATE OR REPLACE FUNCTION public.streak_requirement_met(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Once the platform awarded a day, a later calculator deployment must not
  -- erase it. This applies on both sides of the August rules transition.
  IF EXISTS (
    SELECT 1
    FROM public.daily_records historical
    WHERE historical.user_id = p_user_id
      AND historical.record_date = p_record_date
      AND historical.streak_valid IS TRUE
  ) THEN
    RETURN true;
  END IF;

  -- Thief's Request is restitution, not an ordinary freezer. The repaired
  -- date itself is complete even if it was the first missing day in a chain.
  IF EXISTS (
    SELECT 1
    FROM public.streak_freezers restitution
    WHERE restitution.user_id = p_user_id
      AND restitution.source = 'thiefs_request'
      AND restitution.used_at IS NULL
      AND restitution.applied_to_date = p_record_date
  ) THEN
    RETURN true;
  END IF;

  IF extract(dow FROM p_record_date) = 0 THEN
    IF p_record_date < date '2026-08-02' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
        AND record.record_date = p_record_date
        AND record.sunday_reading_opened_at IS NOT NULL
        AND (record.sunday_reading_opened_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
    );
  END IF;

  IF extract(dow FROM p_record_date) = 6 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.quiz_attempts attempt
      JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
      WHERE attempt.user_id = p_user_id
        AND session.session_date = p_record_date
        AND session.quiz_type = 'saturday'
        AND attempt.status IN ('submitted', 'timed_out')
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.daily_records record
    WHERE record.user_id = p_user_id
      AND record.record_date = p_record_date
      AND COALESCE(record.meditation_submitted, false)
      AND (
        record.meditation_submitted_at IS NULL
        OR (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
      )
      AND (
        COALESCE(record.attendance_status, 'unmarked') = 'present'
        OR EXISTS (
          SELECT 1
          FROM public.daily_records marked
          WHERE marked.record_date = p_record_date
            AND marked.attendance_marked_by = p_user_id
            AND marked.attendance_marked_at IS NOT NULL
            AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.streak_requirement_met(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_requirement_met(uuid, date)
  TO service_role;

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
    v_eligible := (
      extract(dow FROM v_check) BETWEEN 1 AND 5
      OR (extract(dow FROM v_check) = 0 AND v_check >= date '2026-08-02')
      OR (
        extract(dow FROM v_check) = 6
        AND EXISTS (
          SELECT 1 FROM public.quiz_sessions session
          WHERE session.session_date = v_check
            AND session.quiz_type = 'saturday'
        )
      )
    );

    IF NOT v_eligible THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    v_complete := public.streak_requirement_met(p_user_id, v_check);

    -- Do not count an unfinished current day as a loss before its deadline.
    IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    -- Ordinary freezers preserve an existing chain. Explicit restitution is
    -- already handled above and can repair the first missing day in a chain.
    IF NOT v_complete AND v_current > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.streak_freezers protection
        WHERE protection.user_id = p_user_id
          AND protection.used_at IS NULL
          AND protection.applied_to_date = v_check
          AND (protection.expires_at IS NULL OR protection.expires_at::date >= v_check)
          AND (
            extract(dow FROM v_check) BETWEEN 1 AND 5
            OR (
              extract(dow FROM v_check) = 6
              AND protection.freezer_type = 'weekly'
              AND protection.source IN ('relic', 'redemption')
            )
          )
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

CREATE OR REPLACE FUNCTION public.restore_thiefs_request_history(
  p_user_id uuid,
  p_cutoff_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_join_date date;
  v_restore_date date;
  v_restored integer := 0;
BEGIN
  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_join_date IS NULL OR p_cutoff_date < v_join_date THEN RETURN 0; END IF;

  FOR v_restore_date IN
    SELECT day::date
    FROM generate_series(v_join_date, p_cutoff_date, interval '1 day') day
    WHERE (
      extract(dow FROM day) BETWEEN 1 AND 5
      OR (extract(dow FROM day) = 0 AND day::date >= date '2026-08-02')
      OR (
        extract(dow FROM day) = 6
        AND EXISTS (
          SELECT 1 FROM public.quiz_sessions session
          WHERE session.session_date = day::date AND session.quiz_type = 'saturday'
        )
      )
    )
      AND NOT public.streak_requirement_met(p_user_id, day::date)
    ORDER BY day::date
  LOOP
    UPDATE public.streak_freezers protection
    SET source = 'thiefs_request'
    WHERE protection.id = (
      SELECT existing.id
      FROM public.streak_freezers existing
      WHERE existing.user_id = p_user_id
        AND existing.used_at IS NULL
        AND existing.applied_to_date = v_restore_date
      ORDER BY existing.purchased_at
      LIMIT 1
    );

    IF NOT FOUND THEN
      INSERT INTO public.streak_freezers(user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'thiefs_request', v_restore_date);
    END IF;
    v_restored := v_restored + 1;
  END LOOP;
  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_thiefs_request_history(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_thiefs_request_history(uuid, date)
  TO service_role;

-- Replay every historical use using its original cutoff. Later missed days are
-- intentionally outside that cutoff and therefore remain genuine losses.
DO $$
DECLARE
  v_use record;
  v_cutoff date;
BEGIN
  FOR v_use IN
    WITH recorded_uses AS (
      SELECT usage.user_id, usage.created_at AS used_at
      FROM public.relic_usage_log usage
      LEFT JOIN public.relic_types relic ON relic.id = usage.relic_type_id
      WHERE regexp_replace(lower(coalesce(relic.slug, relic.name, '')), '[^a-z0-9]+', '', 'g')
              LIKE ANY (ARRAY['%thiefsrequest%', '%thievesrequest%'])
         OR regexp_replace(lower(coalesce(usage.effect_applied, '')), '[^a-z0-9]+', '', 'g')
              LIKE ANY (ARRAY['%reviveloststreak%', '%resurrectloststreak%'])
      UNION ALL
      SELECT ledger.user_id, ledger.created_at
      FROM public.denarii_ledger_entries ledger
      WHERE regexp_replace(lower(coalesce(ledger.description, '')), '[^a-z0-9]+', '', 'g')
              LIKE ANY (ARRAY['%thiefsrequest%', '%thievesrequest%'])
    )
    SELECT recorded.user_id, max(recorded.used_at) AS used_at
    FROM recorded_uses recorded
    GROUP BY recorded.user_id
  LOOP
    v_cutoff := (v_use.used_at AT TIME ZONE 'Africa/Douala')::date
      - CASE
          WHEN (v_use.used_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0
          ELSE 1
        END;
    PERFORM public.restore_thiefs_request_history(v_use.user_id, v_cutoff);
  END LOOP;
END;
$$;

-- Refresh the board cache for every account. The live functions remain the
-- source of truth; this prevents an older zero snapshot from flashing first.
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
