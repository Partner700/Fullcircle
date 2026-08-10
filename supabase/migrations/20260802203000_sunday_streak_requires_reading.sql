ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS sunday_reading_opened_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_sunday_reading_open(
  p_user_id uuid,
  p_record_date date DEFAULT timezone('Africa/Douala', now())::date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only record your own reading visit.';
  END IF;

  IF extract(dow FROM p_record_date) <> 0
    OR p_record_date <> timezone('Africa/Douala', now())::date THEN
    RETURN false;
  END IF;

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, attendance_status,
    meditation_submitted, streak_valid, sunday_reading_opened_at
  ) VALUES (
    p_user_id, p_record_date, 'sunday', 'unmarked',
    false, true, now()
  )
  ON CONFLICT (user_id, record_date) DO UPDATE
  SET day_type = 'sunday',
      streak_valid = true,
      sunday_reading_opened_at = COALESCE(public.daily_records.sunday_reading_opened_at, EXCLUDED.sunday_reading_opened_at);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sunday_reading_open(uuid, date) TO authenticated;

DO $$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.compute_strict_streak(uuid)'::regprocedure)
  INTO v_definition;
  v_original := v_definition;

  v_definition := replace(
    v_definition,
    E'    v_complete := extract(dow FROM v_check) = 0;',
    E'    v_complete := false;\n    IF extract(dow FROM v_check) = 0 THEN\n      SELECT EXISTS (\n        SELECT 1 FROM public.daily_records sunday_record\n        WHERE sunday_record.user_id = p_user_id\n          AND sunday_record.record_date = v_check\n          AND sunday_record.sunday_reading_opened_at IS NOT NULL\n      ) INTO v_complete;\n    END IF;'
  );

  IF v_definition = v_original
    OR position('sunday_reading_opened_at IS NOT NULL' in v_definition) = 0 THEN
    RAISE EXCEPTION 'The Sunday reading requirement could not safely update compute_strict_streak.';
  END IF;

  EXECUTE v_definition;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;
