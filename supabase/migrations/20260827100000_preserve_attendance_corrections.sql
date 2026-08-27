/*
  Preserve the first morning-call mark when a sentry corrects a status later.

  A same-day absent -> present correction previously replaced the original
  morning timestamp with the correction time. The authoritative streak rule
  then treated the attendance as late even when the first mark happened on
  time. Status corrections now retain the first attendance evidence.

  Courage Webnjoh's 27 August correction is repaired only when the stored row
  confirms both present attendance and a devotion submitted before 21:00.
*/

CREATE OR REPLACE FUNCTION public.mark_cadet_attendance(
  p_sentry_id uuid,
  p_cadet_id uuid,
  p_record_date text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_record_date date;
  v_day_type text;
  v_attendance_late boolean;
  v_record public.daily_records%ROWTYPE;
  v_reward_awarded boolean := false;
  v_reward_removed boolean := false;
  v_reward_id uuid;
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only mark attendance from your own account.';
  END IF;
  IF p_record_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid attendance date.';
  END IF;
  v_record_date := p_record_date::date;
  IF v_record_date IS DISTINCT FROM v_local_now::date THEN
    RAISE EXCEPTION 'Attendance can only be marked for today.';
  END IF;
  IF p_status NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'Attendance status must be present or absent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tent_members cadet_member
    JOIN public.tents tent ON tent.id = cadet_member.tent_id
    LEFT JOIN public.tent_members sentry_member
      ON sentry_member.tent_id = tent.id
      AND sentry_member.user_id = v_caller
      AND sentry_member.role = 'sentry'
    WHERE cadet_member.user_id = p_cadet_id
      AND cadet_member.role = 'cadet'
      AND (tent.sentry_id = v_caller OR sentry_member.id IS NOT NULL)
  )
  AND NOT public.is_instructor(v_caller) THEN
    RAISE EXCEPTION 'You can only mark attendance for cadets in your assigned tent.';
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM v_record_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  v_attendance_late := v_local_now::time >= time '12:00';

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, attendance_status,
    attendance_marked_at, attendance_marked_by, attendance_late,
    meditation_submitted, streak_valid
  ) VALUES (
    p_cadet_id, v_record_date, v_day_type, p_status,
    now(), v_caller, v_attendance_late, false,
    CASE WHEN v_day_type = 'sunday' THEN NULL ELSE false END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    attendance_status = EXCLUDED.attendance_status,
    attendance_marked_at = CASE
      WHEN public.daily_records.attendance_marked_at IS NOT NULL
      THEN public.daily_records.attendance_marked_at
      ELSE EXCLUDED.attendance_marked_at
    END,
    attendance_marked_by = EXCLUDED.attendance_marked_by,
    attendance_late = CASE
      WHEN public.daily_records.attendance_marked_at IS NOT NULL
      THEN coalesce(public.daily_records.attendance_late, false)
      ELSE EXCLUDED.attendance_late
    END,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'sunday' THEN NULL
      WHEN EXCLUDED.day_type = 'weekday' THEN
        EXCLUDED.attendance_status = 'present'
        AND coalesce(public.daily_records.meditation_submitted, false)
        AND (
          public.daily_records.meditation_submitted_at IS NULL
          OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
        )
      ELSE coalesce(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  -- Marking at least one cadet before midday supplies the sentry's attendance
  -- half. Their own meditation completes the weekday streak immediately.
  IF v_day_type = 'weekday' AND NOT v_attendance_late AND public.is_sentry(v_caller) THEN
    INSERT INTO public.daily_records (
      user_id, record_date, day_type, attendance_status,
      attendance_marked_at, attendance_marked_by, attendance_late,
      meditation_submitted, streak_valid
    ) VALUES (
      v_caller, v_record_date, v_day_type, 'present',
      now(), v_caller, false, false, false
    )
    ON CONFLICT (user_id, record_date) DO UPDATE SET
      day_type = EXCLUDED.day_type,
      attendance_status = CASE
        WHEN coalesce(public.daily_records.attendance_status, 'unmarked') <> 'absent' THEN 'present'
        ELSE public.daily_records.attendance_status
      END,
      attendance_marked_at = coalesce(public.daily_records.attendance_marked_at, EXCLUDED.attendance_marked_at),
      attendance_marked_by = EXCLUDED.attendance_marked_by,
      attendance_late = false,
      streak_valid = CASE
        WHEN coalesce(public.daily_records.attendance_status, 'unmarked') <> 'absent'
          AND coalesce(public.daily_records.meditation_submitted, false)
          AND (
            public.daily_records.meditation_submitted_at IS NULL
            OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
          )
        THEN true
        ELSE coalesce(public.daily_records.streak_valid, false)
      END;
  END IF;

  IF p_status = 'present' THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    )
    SELECT p_cadet_id, 200, 'attendance', v_record_date::text, 'Attendance reward'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = p_cadet_id
        AND entry.source_type = 'attendance'
        AND entry.source_reference = v_record_date::text
        AND entry.amount = 200
    )
    RETURNING id INTO v_reward_id;
    v_reward_awarded := v_reward_id IS NOT NULL;
  ELSE
    WITH deleted AS (
      DELETE FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = p_cadet_id
        AND entry.source_type = 'attendance'
        AND entry.source_reference = v_record_date::text
        AND entry.amount = 200
      RETURNING entry.id
    )
    SELECT EXISTS(SELECT 1 FROM deleted) INTO v_reward_removed;
  END IF;

  RETURN jsonb_build_object(
    'record_id', v_record.id,
    'attendance_status', v_record.attendance_status,
    'attendance_late', v_record.attendance_late,
    'reward_awarded', v_reward_awarded,
    'reward_removed', v_reward_removed,
    'devotion_submitted', coalesce(v_record.meditation_submitted, false),
    'streak_valid', v_record.streak_valid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_cadet_attendance(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_cadet_attendance(uuid, uuid, text, text)
  TO authenticated;

/* The original on-time absent mark was already overwritten before this fix
   existed. Repair only the reported user/day and only with complete evidence. */
WITH courage AS (
  SELECT profile.id AS user_id
  FROM public.profiles profile
  WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
    AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
), repaired AS (
  UPDATE public.daily_records record
  SET attendance_marked_at = timestamp '2026-08-27 11:59:59' AT TIME ZONE 'Africa/Douala',
      attendance_late = false,
      streak_valid = true
  FROM courage
  WHERE record.user_id = courage.user_id
    AND record.record_date = date '2026-08-27'
    AND extract(dow FROM record.record_date) BETWEEN 1 AND 5
    AND record.attendance_status = 'present'
    AND coalesce(record.meditation_submitted, false)
    AND record.meditation_submitted_at IS NOT NULL
    AND (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
    AND (
      record.attendance_marked_at IS NULL
      OR (record.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time >= time '12:00'
      OR coalesce(record.attendance_late, false)
    )
  RETURNING record.user_id
)
SELECT count(*) FROM repaired;

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT profile.id
    FROM public.profiles profile
    JOIN public.daily_records record
      ON record.user_id = profile.id
     AND record.record_date = date '2026-08-27'
    WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
      AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
      AND record.attendance_status = 'present'
      AND record.attendance_marked_at IS NOT NULL
      AND (record.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
      AND coalesce(record.meditation_submitted, false)
      AND record.meditation_submitted_at IS NOT NULL
      AND (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
  LOOP
    PERFORM public.record_verified_streak_restoration(
      v_user_id,
      date '2026-08-27',
      'Verified devotion plus corrected morning attendance; initial absent mark was a sentry error',
      NULL
    );
    PERFORM public.refresh_user_streak_snapshot(v_user_id);
  END LOOP;
END;
$$;
