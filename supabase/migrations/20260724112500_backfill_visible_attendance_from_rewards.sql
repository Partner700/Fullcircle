/*
# Backfill visible attendance from attendance rewards

Some reward rows were created before attendance marking was transactional. If a
cadet already received the 200D attendance reward, make the matching daily row
show as present unless it was explicitly marked absent.
*/

INSERT INTO public.daily_records (
  user_id,
  record_date,
  day_type,
  attendance_status,
  attendance_marked_at,
  attendance_late,
  meditation_submitted,
  streak_valid
)
SELECT
  dle.user_id,
  dle.source_reference::date,
  CASE
    WHEN EXTRACT(DOW FROM dle.source_reference::date) = 0 THEN 'sunday'
    WHEN EXTRACT(DOW FROM dle.source_reference::date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END,
  'present',
  dle.created_at,
  ((dle.created_at AT TIME ZONE 'Africa/Douala')::time >= time '12:00'),
  false,
  false
FROM public.denarii_ledger_entries dle
WHERE dle.source_type = 'attendance'
  AND dle.amount = 200
  AND dle.source_reference ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ON CONFLICT (user_id, record_date) DO UPDATE SET
  attendance_status = CASE
    WHEN public.daily_records.attendance_status = 'absent' THEN public.daily_records.attendance_status
    ELSE 'present'
  END,
  attendance_marked_at = COALESCE(public.daily_records.attendance_marked_at, EXCLUDED.attendance_marked_at),
  attendance_late = COALESCE(public.daily_records.attendance_late, EXCLUDED.attendance_late),
  streak_valid = CASE
    WHEN public.daily_records.day_type = 'sunday' THEN NULL
    WHEN public.daily_records.day_type = 'weekday' THEN
      CASE
        WHEN public.daily_records.attendance_status = 'absent' THEN false
        ELSE COALESCE(public.daily_records.meditation_submitted, false) = true
      END
    ELSE COALESCE(public.daily_records.quiz_attempt_id IS NOT NULL, false)
  END;
