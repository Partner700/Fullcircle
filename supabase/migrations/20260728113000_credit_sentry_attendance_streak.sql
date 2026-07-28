/*
# Credit sentries for on-time attendance duty

When a sentry marks cadet attendance before midday, their own daily record should
carry the attendance half of the streak requirement. Their meditation submission
then completes the day immediately through the existing streak logic.
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
  v_record_date date := p_record_date::date;
  v_day_type text;
  v_attendance_late boolean;
  v_record public.daily_records%ROWTYPE;
  v_reward_awarded boolean := false;
  v_reward_removed boolean := false;
  v_reward_id uuid;
BEGIN
  IF p_status NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'Attendance status must be present or absent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tent_members cm
    JOIN public.tents t ON t.id = cm.tent_id
    LEFT JOIN public.tent_members sm
      ON sm.tent_id = t.id
      AND sm.user_id = p_sentry_id
      AND sm.role = 'sentry'
    WHERE cm.user_id = p_cadet_id
      AND cm.role = 'cadet'
      AND (t.sentry_id = p_sentry_id OR sm.id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    WHERE ra.user_id = p_sentry_id
      AND ra.role = 'instructor'
      AND ra.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'You can only mark attendance for cadets in your assigned tent.';
  END IF;

  v_day_type := CASE
    WHEN EXTRACT(DOW FROM v_record_date) = 0 THEN 'sunday'
    WHEN EXTRACT(DOW FROM v_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  v_attendance_late := ((now() AT TIME ZONE 'Africa/Douala')::time >= time '12:00');

  INSERT INTO public.daily_records (
    user_id,
    record_date,
    day_type,
    attendance_status,
    attendance_marked_at,
    attendance_marked_by,
    attendance_late,
    meditation_submitted,
    streak_valid
  )
  VALUES (
    p_cadet_id,
    v_record_date,
    v_day_type,
    p_status,
    now(),
    p_sentry_id,
    v_attendance_late,
    false,
    CASE
      WHEN v_day_type = 'sunday' THEN NULL
      WHEN v_day_type = 'weekday' THEN false
      ELSE false
    END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    attendance_status = EXCLUDED.attendance_status,
    attendance_marked_at = EXCLUDED.attendance_marked_at,
    attendance_marked_by = EXCLUDED.attendance_marked_by,
    attendance_late = EXCLUDED.attendance_late,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'sunday' THEN NULL
      WHEN EXCLUDED.day_type = 'weekday' THEN
        EXCLUDED.attendance_status = 'present'
        AND COALESCE(public.daily_records.meditation_submitted, false) = true
        AND (
          public.daily_records.meditation_submitted_at IS NULL
          OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
        )
      ELSE COALESCE(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  IF v_day_type = 'weekday' AND NOT v_attendance_late THEN
    INSERT INTO public.daily_records (
      user_id,
      record_date,
      day_type,
      attendance_status,
      attendance_marked_at,
      attendance_marked_by,
      attendance_late,
      meditation_submitted,
      streak_valid
    )
    VALUES (
      p_sentry_id,
      v_record_date,
      v_day_type,
      'present',
      now(),
      p_sentry_id,
      false,
      false,
      false
    )
    ON CONFLICT (user_id, record_date) DO UPDATE SET
      day_type = EXCLUDED.day_type,
      attendance_status = CASE
        WHEN COALESCE(public.daily_records.attendance_status, 'unmarked') <> 'absent' THEN 'present'
        ELSE public.daily_records.attendance_status
      END,
      attendance_marked_at = COALESCE(public.daily_records.attendance_marked_at, EXCLUDED.attendance_marked_at),
      attendance_marked_by = EXCLUDED.attendance_marked_by,
      attendance_late = false,
      streak_valid = CASE
        WHEN COALESCE(public.daily_records.attendance_status, 'unmarked') <> 'absent'
          AND COALESCE(public.daily_records.meditation_submitted, false) = true
          AND (
            public.daily_records.meditation_submitted_at IS NULL
            OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
          )
        THEN true
        ELSE COALESCE(public.daily_records.streak_valid, false)
      END;
  END IF;

  IF p_status = 'present' THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
    SELECT p_cadet_id, 200, 'attendance', v_record_date::text, 'Attendance reward'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries dle
      WHERE dle.user_id = p_cadet_id
        AND dle.source_type = 'attendance'
        AND dle.source_reference = v_record_date::text
        AND dle.amount = 200
    )
    RETURNING id INTO v_reward_id;

    v_reward_awarded := v_reward_id IS NOT NULL;
  ELSE
    WITH deleted AS (
      DELETE FROM public.denarii_ledger_entries dle
      WHERE dle.user_id = p_cadet_id
        AND dle.source_type = 'attendance'
        AND dle.source_reference = v_record_date::text
        AND dle.amount = 200
      RETURNING dle.id
    )
    SELECT EXISTS(SELECT 1 FROM deleted) INTO v_reward_removed;
  END IF;

  RETURN jsonb_build_object(
    'record_id', v_record.id,
    'attendance_status', v_record.attendance_status,
    'attendance_late', v_record.attendance_late,
    'reward_awarded', v_reward_awarded,
    'reward_removed', v_reward_removed,
    'devotion_submitted', COALESCE(v_record.meditation_submitted, false),
    'streak_valid', v_record.streak_valid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_cadet_attendance(uuid, uuid, text, text) TO authenticated;
