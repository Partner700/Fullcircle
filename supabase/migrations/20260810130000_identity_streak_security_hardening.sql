/*
 * Identity and streak integrity hardening.
 *
 * Role changes, attendance, and streak-bearing daily records are privileged
 * outcomes. Browser clients may read the rows they are entitled to, but must
 * use the validated RPCs below to change them.
 */

-- A user must never be able to grant themselves a role or change streak fields
-- by writing the underlying tables directly.
DROP POLICY IF EXISTS "insert_own_role_assignment" ON public.role_assignments;
DROP POLICY IF EXISTS "insert_meditation_own" ON public.daily_records;
DROP POLICY IF EXISTS "update_meditation_own" ON public.daily_records;
DROP POLICY IF EXISTS "update_attendance_sentry" ON public.daily_records;

-- Keep the generic instructor role-assignment path as the only UI entry point.
CREATE OR REPLACE FUNCTION public.promote_to_sentry(p_user_id uuid, p_approver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_approver_id THEN
    RAISE EXCEPTION 'The signed-in instructor must approve this promotion.';
  END IF;

  IF NOT public.is_instructor(v_caller) THEN
    RAISE EXCEPTION 'Only instructors can promote cadets.';
  END IF;

  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'An instructor cannot promote their own account to sentry.';
  END IF;

  UPDATE public.role_assignments
  SET status = 'promoted', end_date = CURRENT_DATE
  WHERE user_id = p_user_id
    AND role = 'cadet'
    AND status IN ('active', 'approved');

  INSERT INTO public.role_assignments (user_id, role, status, approver_id, start_date, end_date)
  VALUES (p_user_id, 'sentry', 'active', v_caller, CURRENT_DATE, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    approver_id = v_caller,
    start_date = EXCLUDED.start_date,
    end_date = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_to_instructor(
  p_new_instructor_id uuid,
  p_current_instructor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_current_instructor_id THEN
    RAISE EXCEPTION 'Only the signed-in instructor can hand over this role.';
  END IF;

  IF NOT public.is_instructor(v_caller) THEN
    RAISE EXCEPTION 'Only the current instructor can hand over.';
  END IF;

  IF NOT public.is_sentry(p_new_instructor_id) THEN
    RAISE EXCEPTION 'Only an active sentry can be promoted to instructor.';
  END IF;

  UPDATE public.role_assignments
  SET status = 'removed', end_date = CURRENT_DATE
  WHERE user_id = v_caller
    AND role = 'instructor'
    AND status IN ('active', 'approved');

  UPDATE public.role_assignments
  SET status = 'promoted', end_date = CURRENT_DATE
  WHERE user_id = p_new_instructor_id
    AND role = 'sentry'
    AND status IN ('active', 'approved');

  INSERT INTO public.role_assignments (user_id, role, status, approver_id, start_date, end_date)
  VALUES (p_new_instructor_id, 'instructor', 'active', v_caller, CURRENT_DATE, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    approver_id = v_caller,
    start_date = EXCLUDED.start_date,
    end_date = NULL;
END;
$$;

-- Save the entire daily meditation in one transaction. This prevents a partial
-- save where the meditation succeeds but the best verse or quote disappears.
CREATE OR REPLACE FUNCTION public.submit_daily_meditation(
  p_record_date date,
  p_meditation_text text,
  p_best_verse text,
  p_daily_quote text
)
RETURNS public.daily_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_day_type text;
  v_record public.daily_records%ROWTYPE;
  v_meditation_words integer;
  v_quote_words integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_record_date IS DISTINCT FROM v_local_now::date THEN
    RAISE EXCEPTION 'Meditations can only be submitted for today.';
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM p_record_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM p_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;

  IF v_day_type = 'sunday' THEN
    RAISE EXCEPTION 'Sunday is the day of rest; no meditation is required.';
  END IF;

  IF v_local_now::time >= time '21:00' THEN
    RAISE EXCEPTION 'Streak submissions close at 9:00 PM.';
  END IF;

  v_meditation_words := cardinality(regexp_split_to_array(btrim(coalesce(p_meditation_text, '')), '\s+'));
  v_quote_words := cardinality(regexp_split_to_array(btrim(coalesce(p_daily_quote, '')), '\s+'));

  IF btrim(coalesce(p_best_verse, '')) = '' THEN
    RAISE EXCEPTION 'Select your best verse before submitting.';
  END IF;
  IF v_meditation_words < 50 THEN
    RAISE EXCEPTION 'Meditation of the Day must contain at least 50 words.';
  END IF;
  IF btrim(coalesce(p_daily_quote, '')) = '' OR v_quote_words < 1 OR v_quote_words > 10 THEN
    RAISE EXCEPTION 'Quote of the Day must contain between 1 and 10 words.';
  END IF;

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, meditation_submitted,
    meditation_submitted_at, meditation_text, best_verse, daily_quote,
    streak_valid
  ) VALUES (
    v_user_id, p_record_date, v_day_type, true,
    now(), btrim(p_meditation_text), btrim(p_best_verse), btrim(p_daily_quote),
    CASE
      WHEN v_day_type = 'weekday' THEN false
      ELSE false
    END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    meditation_submitted = true,
    meditation_submitted_at = now(),
    meditation_text = EXCLUDED.meditation_text,
    best_verse = EXCLUDED.best_verse,
    daily_quote = EXCLUDED.daily_quote,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'weekday' THEN
        coalesce(public.daily_records.attendance_status, 'unmarked') = 'present'
      ELSE coalesce(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

-- Preserve the old RPC signatures for installed clients, but bind them to the
-- signed-in user so they cannot be used to alter another person's streak.
CREATE OR REPLACE FUNCTION public.record_meditation_streak(
  p_user_id uuid,
  p_date date,
  p_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_day_type text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only submit your own meditation.';
  END IF;
  IF p_date IS DISTINCT FROM v_local_now::date THEN
    RAISE EXCEPTION 'Meditations can only be submitted for today.';
  END IF;
  IF v_local_now::time >= time '21:00' THEN
    RAISE EXCEPTION 'Streak submissions close at 9:00 PM.';
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM p_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM p_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  IF v_day_type = 'sunday' THEN
    RAISE EXCEPTION 'Sunday is the day of rest; no meditation is required.';
  END IF;

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, meditation_submitted,
    meditation_submitted_at, meditation_text, streak_valid
  ) VALUES (
    p_user_id, p_date, v_day_type, true, now(), p_text, false
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    meditation_submitted = true,
    meditation_submitted_at = now(),
    meditation_text = coalesce(p_text, public.daily_records.meditation_text),
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'weekday' THEN
        coalesce(public.daily_records.attendance_status, 'unmarked') = 'present'
      ELSE coalesce(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_meditation_streak(
  p_user_id uuid,
  p_date text,
  p_meditation_text text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid meditation date.';
  END IF;
  PERFORM public.record_meditation_streak(p_user_id, p_date::date, p_meditation_text);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_daily_meditation(date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_meditation_streak(uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_meditation_streak(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_to_sentry(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_to_instructor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_daily_meditation(date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_meditation_streak(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_meditation_streak(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_to_sentry(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_to_instructor(uuid, uuid) TO authenticated;
