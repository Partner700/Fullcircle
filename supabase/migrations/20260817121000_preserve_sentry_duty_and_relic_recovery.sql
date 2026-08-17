/* Preserve earned sentry duty independently of later tent membership changes,
   then refresh affected sentry and Thief's Request streak snapshots. */

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
  -- Never reinterpret a day the platform had already confirmed before the
  -- current evidence rules were introduced.
  IF p_record_date < date '2026-08-10' AND EXISTS (
    SELECT 1
    FROM public.daily_records historical
    WHERE historical.user_id = p_user_id
      AND historical.record_date = p_record_date
      AND historical.streak_valid IS TRUE
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
          -- attendance_marked_by is immutable historical evidence. Do not
          -- join current tent membership here: moving a cadet later must not
          -- erase the sentry's already-earned day.
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

-- Re-run each historical request after the corrected sentry evidence rule.
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
              LIKE '%thievesrequest%'
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

-- Publish a fresh authoritative snapshot for every sentry and every recorded
-- Thief's Request user. This includes Sentinel Vedette, Victoire, Courage,
-- and Linda Karen without relying on spelling their display names exactly.
DO $$
DECLARE
  v_user_id uuid;
  v_streak record;
BEGIN
  FOR v_user_id IN
    WITH affected AS (
      SELECT DISTINCT assignment.user_id
      FROM public.role_assignments assignment
      WHERE assignment.role = 'sentry'
        AND assignment.status IN ('active', 'approved')

      UNION

      SELECT DISTINCT usage.user_id
      FROM public.relic_usage_log usage
      LEFT JOIN public.relic_types relic ON relic.id = usage.relic_type_id
      WHERE regexp_replace(lower(coalesce(relic.slug, relic.name, usage.effect_applied, '')), '[^a-z0-9]+', '', 'g')
              LIKE ANY (ARRAY['%thiefsrequest%', '%thievesrequest%', '%reviveloststreak%', '%resurrectloststreak%'])

      UNION

      SELECT DISTINCT ledger.user_id
      FROM public.denarii_ledger_entries ledger
      WHERE regexp_replace(lower(coalesce(ledger.description, '')), '[^a-z0-9]+', '', 'g')
              LIKE ANY (ARRAY['%thiefsrequest%', '%thievesrequest%'])
    )
    SELECT affected.user_id FROM affected
  LOOP
    SELECT * INTO v_streak
    FROM public.get_authoritative_streak(v_user_id)
    LIMIT 1;

    INSERT INTO public.streakboard_snapshots (
      snapshot_date, user_id, current_streak, longest_streak
    ) VALUES (
      timezone('Africa/Douala', now())::date,
      v_user_id,
      coalesce(v_streak.current_streak, 0),
      coalesce(v_streak.longest_streak, 0)
    );
  END LOOP;
END;
$$;
