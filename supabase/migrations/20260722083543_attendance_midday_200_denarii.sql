/*
# Attendance: midday cutoff + 200 denarii reward

1. Changes
   - Update attendance logic: cutoff changes from 7 AM to 12 PM (midday)
   - Attendance no longer counts toward streak (already the case — streak is meditation-only)
   - Attendance now grants 200 denarii via ledger entry with source_type='attendance'

2. New RPC: reward_attendance
   - Inserts 200 denarii into ledger with source_type='attendance'
   - Idempotent: checks if attendance reward already given for this user+date
*/

CREATE OR REPLACE FUNCTION reward_attendance(p_user_id uuid, p_record_date text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing uuid;
BEGIN
  -- Check if attendance reward already given for this date
  SELECT id INTO v_existing FROM denarii_ledger_entries
    WHERE user_id = p_user_id
      AND source_type = 'attendance'
      AND source_reference = p_record_date
    LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
    VALUES (p_user_id, 200, 'attendance', p_record_date, 'Attendance reward');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reward_attendance(uuid, text) TO authenticated;
