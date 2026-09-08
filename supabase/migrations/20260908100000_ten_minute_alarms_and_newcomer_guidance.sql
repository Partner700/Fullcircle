/*
  Make Scripture alarms punctual and newcomer-aware.

  Each alarm exists for one ten-minute window only. It is delivered once by
  Web Push, cannot be recreated as a catch-up alarm, and becomes missed when
  its window closes. New cadets are excluded until their guided tour is done.
  This migration deliberately does not write daily_records or streak evidence.
*/

CREATE TABLE IF NOT EXISTS public.newcomer_guidance (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_step text NOT NULL DEFAULT 'choose_tent' CHECK (current_step IN (
    'choose_tent',
    'dashboard_after_tent',
    'daily_scriptures',
    'scroll_reading',
    'best_verse',
    'meditation',
    'daily_quote',
    'dashboard_games',
    'daily_games',
    'daily_trivia',
    'complete'
  )),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((current_step = 'complete') = (completed_at IS NOT NULL))
);

ALTER TABLE public.newcomer_guidance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.newcomer_guidance FROM PUBLIC, anon, authenticated;

-- Existing camp members keep their current experience. Cadets who joined
-- today receive the guide; active non-cadet roles do not need a tent tour.
INSERT INTO public.newcomer_guidance(user_id, current_step, started_at, completed_at, updated_at)
SELECT
  profile.id,
  CASE
    WHEN timezone('Africa/Douala', profile.created_at)::date < timezone('Africa/Douala', now())::date
      OR EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.role IN ('sentry', 'instructor')
          AND assignment.status IN ('active', 'approved', 'promoted')
      )
    THEN 'complete'
    ELSE 'choose_tent'
  END,
  coalesce(profile.created_at, now()),
  CASE
    WHEN timezone('Africa/Douala', profile.created_at)::date < timezone('Africa/Douala', now())::date
      OR EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.role IN ('sentry', 'instructor')
          AND assignment.status IN ('active', 'approved', 'promoted')
      )
    THEN coalesce(profile.created_at, now() - interval '1 day')
    ELSE NULL
  END,
  now()
FROM public.profiles profile
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.initialize_newcomer_guidance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.newcomer_guidance(user_id, current_step, started_at)
  VALUES (NEW.id, 'choose_tent', coalesce(NEW.created_at, now()))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_newcomer_guidance ON public.profiles;
CREATE TRIGGER initialize_newcomer_guidance
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.initialize_newcomer_guidance();

CREATE OR REPLACE FUNCTION private.complete_non_cadet_guidance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.role IN ('sentry', 'instructor')
     AND NEW.status IN ('active', 'approved', 'promoted')
  THEN
    INSERT INTO public.newcomer_guidance(user_id, current_step, completed_at, updated_at)
    VALUES (NEW.user_id, 'complete', now(), now())
    ON CONFLICT (user_id) DO UPDATE
      SET current_step = 'complete',
          completed_at = coalesce(public.newcomer_guidance.completed_at, now()),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complete_non_cadet_guidance ON public.role_assignments;
CREATE TRIGGER complete_non_cadet_guidance
AFTER INSERT OR UPDATE OF role, status ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION private.complete_non_cadet_guidance();

CREATE OR REPLACE FUNCTION public.get_my_newcomer_guidance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_guidance public.newcomer_guidance%ROWTYPE;
  v_non_cadet boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role IN ('sentry', 'instructor')
      AND assignment.status IN ('active', 'approved', 'promoted')
  ) INTO v_non_cadet;

  INSERT INTO public.newcomer_guidance(user_id, current_step, completed_at)
  VALUES (
    v_user_id,
    CASE WHEN v_non_cadet THEN 'complete' ELSE 'choose_tent' END,
    CASE WHEN v_non_cadet THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF v_non_cadet THEN
    UPDATE public.newcomer_guidance
    SET current_step = 'complete',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    WHERE user_id = v_user_id
      AND completed_at IS NULL;
  END IF;

  -- Recover a request made just before the guide UI reported its step.
  UPDATE public.newcomer_guidance guidance
  SET current_step = 'dashboard_after_tent', updated_at = now()
  WHERE guidance.user_id = v_user_id
    AND guidance.current_step = 'choose_tent'
    AND (
      EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = v_user_id)
      OR EXISTS (
        SELECT 1 FROM public.tent_join_requests request
        WHERE request.user_id = v_user_id AND request.status = 'pending'
      )
    );

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'current_step', v_guidance.current_step,
    'completed', v_guidance.completed_at IS NOT NULL,
    'completed_at', v_guidance.completed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_my_newcomer_guidance(p_completed_step text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_guidance public.newcomer_guidance%ROWTYPE;
  v_next_step text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  INSERT INTO public.newcomer_guidance(user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_guidance
  FROM public.newcomer_guidance guidance
  WHERE guidance.user_id = v_user_id
  FOR UPDATE;

  IF v_guidance.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'current_step', 'complete',
      'completed', true,
      'completed_at', v_guidance.completed_at
    );
  END IF;
  IF v_guidance.current_step <> p_completed_step THEN
    RETURN jsonb_build_object(
      'current_step', v_guidance.current_step,
      'completed', false,
      'completed_at', NULL
    );
  END IF;
  IF p_completed_step = 'choose_tent' AND NOT (
    EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = v_user_id)
    OR EXISTS (
      SELECT 1 FROM public.tent_join_requests request
      WHERE request.user_id = v_user_id AND request.status = 'pending'
    )
  ) THEN
    RAISE EXCEPTION 'Choose a tent before continuing.';
  END IF;

  v_next_step := CASE p_completed_step
    WHEN 'choose_tent' THEN 'dashboard_after_tent'
    WHEN 'dashboard_after_tent' THEN 'daily_scriptures'
    WHEN 'daily_scriptures' THEN 'scroll_reading'
    WHEN 'scroll_reading' THEN 'best_verse'
    WHEN 'best_verse' THEN 'meditation'
    WHEN 'meditation' THEN 'daily_quote'
    WHEN 'daily_quote' THEN 'dashboard_games'
    WHEN 'dashboard_games' THEN 'daily_games'
    WHEN 'daily_games' THEN 'daily_trivia'
    WHEN 'daily_trivia' THEN 'complete'
    ELSE v_guidance.current_step
  END;

  UPDATE public.newcomer_guidance
  SET current_step = v_next_step,
      completed_at = CASE WHEN v_next_step = 'complete' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING * INTO v_guidance;

  RETURN jsonb_build_object(
    'current_step', v_guidance.current_step,
    'completed', v_guidance.completed_at IS NOT NULL,
    'completed_at', v_guidance.completed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.user_is_scripture_alarm_eligible(
  p_user_id uuid,
  p_alarm_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.newcomer_guidance guidance
    WHERE guidance.user_id = p_user_id
      AND guidance.completed_at IS NOT NULL
      AND timezone('Africa/Douala', guidance.completed_at)::date < p_alarm_date
  ) AND EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = p_user_id
      AND assignment.status IN ('active', 'approved', 'promoted')
  );
$$;

ALTER TABLE public.scripture_alarm_occurrences
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS missed_at timestamptz;

UPDATE public.scripture_alarm_occurrences
SET expires_at = triggered_at + interval '10 minutes'
WHERE expires_at IS NULL;

ALTER TABLE public.scripture_alarm_occurrences
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '10 minutes'),
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.scripture_alarm_occurrences
  DROP CONSTRAINT IF EXISTS scripture_alarm_occurrences_status_check;
ALTER TABLE public.scripture_alarm_occurrences
  ADD CONSTRAINT scripture_alarm_occurrences_status_check
  CHECK (status IN ('pending', 'cleared', 'missed'));

CREATE INDEX IF NOT EXISTS scripture_alarm_occurrences_expiry
  ON public.scripture_alarm_occurrences(expires_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION private.expire_stale_scripture_alarms(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_expired integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.scripture_alarm_occurrences alarm
    SET status = 'missed',
        missed_at = coalesce(alarm.missed_at, now()),
        question_source_type = NULL,
        question_source_id = NULL,
        question_payload = NULL,
        correct_answer = NULL,
        accepted_answers = '[]'::jsonb,
        updated_at = now()
    WHERE alarm.status = 'pending'
      AND (
        alarm.expires_at <= now()
        OR NOT private.user_is_scripture_alarm_eligible(alarm.user_id, alarm.alarm_date)
      )
      AND (p_user_id IS NULL OR alarm.user_id = p_user_id)
    RETURNING alarm.id, alarm.user_id
  ), marked_notifications AS (
    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.notification_type = 'scripture_alarm'
      AND EXISTS (
        SELECT 1
        FROM expired
        WHERE expired.user_id = notification.recipient_id
          AND notification.metadata->>'alarm_id' = expired.id::text
      )
    RETURNING notification.id
  )
  SELECT count(*)::integer INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

CREATE OR REPLACE FUNCTION private.scripture_alarm_public_payload(p_alarm_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT jsonb_build_object(
    'id', alarm.id,
    'alarm_date', alarm.alarm_date,
    'alarm_slot', alarm.alarm_slot,
    'triggered_at', alarm.triggered_at,
    'expires_at', alarm.expires_at,
    'question_text', alarm.question_payload->>'question_text',
    'question_type', coalesce(alarm.question_payload->>'question_type', 'standard_text'),
    'options', coalesce(alarm.question_payload->'options', '[]'::jsonb),
    'reference', alarm.question_payload->>'reference',
    'attempt_count', alarm.attempt_count
  )
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.id = p_alarm_id
    AND alarm.status = 'pending'
    AND alarm.triggered_at <= now()
    AND alarm.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION private.create_scripture_alarm_for_user(
  p_user_id uuid,
  p_alarm_date date,
  p_alarm_slot text,
  p_triggered_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_alarm_id uuid;
  v_label text;
  v_body text;
  v_expires_at timestamptz := p_triggered_at + interval '10 minutes';
BEGIN
  IF p_alarm_slot NOT IN ('morning', 'midday', 'evening', 'final') THEN
    RAISE EXCEPTION 'Unsupported Scripture alarm slot.';
  END IF;
  IF now() < p_triggered_at OR now() >= v_expires_at THEN
    RETURN false;
  END IF;
  IF NOT private.user_is_scripture_alarm_eligible(p_user_id, p_alarm_date) THEN
    RETURN false;
  END IF;
  IF p_alarm_slot <> 'morning'
     AND private.daily_meditation_is_submitted(p_user_id, p_alarm_date)
  THEN
    PERFORM private.clear_completed_meditation_alarms(p_user_id, p_alarm_date);
    RETURN false;
  END IF;

  INSERT INTO public.scripture_alarm_occurrences(
    user_id, alarm_date, alarm_slot, triggered_at, expires_at
  )
  VALUES (p_user_id, p_alarm_date, p_alarm_slot, p_triggered_at, v_expires_at)
  ON CONFLICT (user_id, alarm_date, alarm_slot) DO NOTHING
  RETURNING id INTO v_alarm_id;

  IF v_alarm_id IS NULL THEN RETURN false; END IF;

  PERFORM private.assign_scripture_alarm_question(v_alarm_id);
  v_label := CASE p_alarm_slot
    WHEN 'morning' THEN 'Morning Scripture alarm'
    WHEN 'midday' THEN 'Midday meditation alarm'
    WHEN 'evening' THEN 'Evening meditation alarm'
    ELSE 'Final meditation alarm'
  END;
  v_body := CASE p_alarm_slot
    WHEN 'morning' THEN 'Answer the Scripture question to silence the morning alarm.'
    ELSE 'Finish and send your daily meditation. Answer the Scripture question to silence this alarm.'
  END;

  PERFORM public.notify_user(
    p_user_id,
    NULL,
    'scripture_alarm',
    v_label,
    v_body || ' Available for 10 minutes.',
    'dashboard',
    jsonb_build_object(
      'alarm_id', v_alarm_id,
      'alarm_date', p_alarm_date,
      'alarm_slot', p_alarm_slot,
      'expires_at', v_expires_at
    )
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_scripture_alarm(p_alarm_slot text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_now_local timestamp := timezone('Africa/Douala', now());
  v_today date := v_now_local::date;
  v_due_time time;
  v_triggered_at timestamptz;
  v_profile record;
  v_created integer := 0;
BEGIN
  IF p_alarm_slot NOT IN ('morning', 'midday', 'evening', 'final') THEN
    RAISE EXCEPTION 'Unsupported Scripture alarm slot.';
  END IF;
  IF extract(isodow FROM v_today)::integer NOT BETWEEN 1 AND 5 THEN RETURN 0; END IF;

  v_due_time := CASE p_alarm_slot
    WHEN 'morning' THEN time '05:59'
    WHEN 'midday' THEN time '12:00'
    WHEN 'evening' THEN time '18:00'
    ELSE time '20:30'
  END;
  v_triggered_at := ((v_today + v_due_time) AT TIME ZONE 'Africa/Douala');
  IF now() < v_triggered_at OR now() >= v_triggered_at + interval '10 minutes' THEN RETURN 0; END IF;

  PERFORM private.expire_stale_scripture_alarms();
  FOR v_profile IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE private.user_is_scripture_alarm_eligible(profile.id, v_today)
      AND (
        p_alarm_slot = 'morning'
        OR NOT private.daily_meditation_is_submitted(profile.id, v_today)
      )
  LOOP
    IF private.create_scripture_alarm_for_user(v_profile.id, v_today, p_alarm_slot, v_triggered_at) THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_due_scripture_alarms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now_local timestamp := timezone('Africa/Douala', now());
  v_today date := v_now_local::date;
  v_has_meditation boolean := false;
  v_triggered_at timestamptz;
  v_created integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM private.expire_stale_scripture_alarms(v_user_id);
  IF extract(isodow FROM v_today)::integer NOT BETWEEN 1 AND 5
     OR NOT private.user_is_scripture_alarm_eligible(v_user_id, v_today)
  THEN
    RETURN 0;
  END IF;

  v_has_meditation := private.daily_meditation_is_submitted(v_user_id, v_today);
  IF v_has_meditation THEN
    PERFORM private.clear_completed_meditation_alarms(v_user_id, v_today);
  END IF;

  v_triggered_at := ((v_today + time '05:59') AT TIME ZONE 'Africa/Douala');
  IF now() >= v_triggered_at AND now() < v_triggered_at + interval '10 minutes'
     AND private.create_scripture_alarm_for_user(v_user_id, v_today, 'morning', v_triggered_at)
  THEN v_created := v_created + 1; END IF;

  v_triggered_at := ((v_today + time '12:00') AT TIME ZONE 'Africa/Douala');
  IF NOT v_has_meditation AND now() >= v_triggered_at AND now() < v_triggered_at + interval '10 minutes'
     AND private.create_scripture_alarm_for_user(v_user_id, v_today, 'midday', v_triggered_at)
  THEN v_created := v_created + 1; END IF;

  v_triggered_at := ((v_today + time '18:00') AT TIME ZONE 'Africa/Douala');
  IF NOT v_has_meditation AND now() >= v_triggered_at AND now() < v_triggered_at + interval '10 minutes'
     AND private.create_scripture_alarm_for_user(v_user_id, v_today, 'evening', v_triggered_at)
  THEN v_created := v_created + 1; END IF;

  v_triggered_at := ((v_today + time '20:30') AT TIME ZONE 'Africa/Douala');
  IF NOT v_has_meditation AND now() >= v_triggered_at AND now() < v_triggered_at + interval '10 minutes'
     AND private.create_scripture_alarm_for_user(v_user_id, v_today, 'final', v_triggered_at)
  THEN v_created := v_created + 1; END IF;

  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_scripture_alarm()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := timezone('Africa/Douala', now())::date;
  v_alarm_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  PERFORM private.expire_stale_scripture_alarms(v_user_id);
  PERFORM public.ensure_my_due_scripture_alarms();
  PERFORM private.clear_completed_meditation_alarms(v_user_id, v_today);

  SELECT alarm.id INTO v_alarm_id
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.user_id = v_user_id
    AND alarm.status = 'pending'
    AND alarm.triggered_at <= now()
    AND alarm.expires_at > now()
  ORDER BY alarm.triggered_at, alarm.created_at
  LIMIT 1;

  IF v_alarm_id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.scripture_alarm_occurrences alarm
    WHERE alarm.id = v_alarm_id AND alarm.question_payload IS NOT NULL
  ) THEN
    PERFORM private.assign_scripture_alarm_question(v_alarm_id);
  END IF;
  RETURN private.scripture_alarm_public_payload(v_alarm_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_scripture_alarm_answer(
  p_alarm_id uuid,
  p_answer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_alarm public.scripture_alarm_occurrences%ROWTYPE;
  v_normalized text;
  v_is_correct boolean;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_alarm_id IS NULL OR NULLIF(btrim(coalesce(p_answer, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Choose or enter an answer first.';
  END IF;

  SELECT alarm.* INTO v_alarm
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.id = p_alarm_id AND alarm.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_alarm.status <> 'pending' THEN
    RETURN jsonb_build_object('is_correct', false, 'cleared', true);
  END IF;
  IF v_alarm.expires_at <= now() THEN
    UPDATE public.scripture_alarm_occurrences
    SET status = 'missed', missed_at = now(), question_source_type = NULL,
        question_source_id = NULL, question_payload = NULL, correct_answer = NULL,
        accepted_answers = '[]'::jsonb, updated_at = now()
    WHERE id = v_alarm.id;
    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.recipient_id = v_user_id
      AND notification.notification_type = 'scripture_alarm'
      AND notification.metadata->>'alarm_id' = v_alarm.id::text;
    RETURN jsonb_build_object('is_correct', false, 'cleared', true, 'missed', true);
  END IF;
  IF v_alarm.question_source_id IS NULL OR v_alarm.question_payload IS NULL THEN
    PERFORM private.assign_scripture_alarm_question(v_alarm.id);
    SELECT alarm.* INTO v_alarm
    FROM public.scripture_alarm_occurrences alarm
    WHERE alarm.id = p_alarm_id
    FOR UPDATE;
  END IF;

  v_normalized := public.normalize_dove_question_answer(p_answer);
  v_is_correct := v_normalized = public.normalize_dove_question_answer(v_alarm.correct_answer)
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(v_alarm.accepted_answers, '[]'::jsonb)) accepted(value)
      WHERE v_normalized = public.normalize_dove_question_answer(accepted.value)
    );

  INSERT INTO public.scripture_alarm_attempts(
    alarm_id, user_id, question_source_type, question_source_id, submitted_answer, is_correct
  ) VALUES (
    v_alarm.id, v_user_id, v_alarm.question_source_type, v_alarm.question_source_id,
    btrim(p_answer), v_is_correct
  );

  IF v_is_correct THEN
    UPDATE public.scripture_alarm_occurrences
    SET status = 'cleared', attempt_count = attempt_count + 1,
        last_answered_at = now(), cleared_at = now(), question_payload = NULL,
        correct_answer = NULL, accepted_answers = '[]'::jsonb, updated_at = now()
    WHERE id = v_alarm.id;
    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.recipient_id = v_user_id
      AND notification.notification_type = 'scripture_alarm'
      AND notification.metadata->>'alarm_id' = v_alarm.id::text;
    RETURN jsonb_build_object('is_correct', true, 'cleared', true);
  END IF;

  UPDATE public.scripture_alarm_occurrences
  SET attempt_count = attempt_count + 1, last_answered_at = now(),
      question_source_type = NULL, question_source_id = NULL, question_payload = NULL,
      correct_answer = NULL, accepted_answers = '[]'::jsonb, updated_at = now()
  WHERE id = v_alarm.id;
  PERFORM private.assign_scripture_alarm_question(v_alarm.id);

  RETURN jsonb_build_object(
    'is_correct', false,
    'cleared', false,
    'alarm', private.scripture_alarm_public_payload(v_alarm.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION private.initialize_newcomer_guidance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.complete_non_cadet_guidance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.user_is_scripture_alarm_eligible(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.expire_stale_scripture_alarms(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.scripture_alarm_public_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_scripture_alarm_for_user(uuid, date, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_newcomer_guidance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_newcomer_guidance() TO authenticated;
REVOKE ALL ON FUNCTION public.advance_my_newcomer_guidance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_my_newcomer_guidance(text) TO authenticated;
REVOKE ALL ON FUNCTION public.dispatch_scripture_alarm(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_scripture_alarm(text) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_my_due_scripture_alarms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_due_scripture_alarms() TO authenticated;
REVOKE ALL ON FUNCTION public.get_pending_scripture_alarm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_scripture_alarm() TO authenticated;
REVOKE ALL ON FUNCTION public.submit_scripture_alarm_answer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_scripture_alarm_answer(uuid, text) TO authenticated;

SELECT private.expire_stale_scripture_alarms();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-scripture-alarm-expiry')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-expiry'
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-expiry',
      '* * * * *',
      $job$SELECT private.expire_stale_scripture_alarms();$job$
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;
