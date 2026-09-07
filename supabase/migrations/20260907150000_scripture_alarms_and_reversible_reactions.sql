/*
  Weekday Scripture alarms.

  Alarm state is durable and server-authoritative. A browser refresh, app
  restart, or failed answer cannot dismiss a pending alarm.
*/

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.scripture_alarm_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alarm_date date NOT NULL,
  alarm_slot text NOT NULL CHECK (alarm_slot IN ('morning', 'midday', 'evening', 'final')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared')),
  triggered_at timestamptz NOT NULL,
  question_source_type text,
  question_source_id uuid,
  question_payload jsonb,
  correct_answer text,
  accepted_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_answered_at timestamptz,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alarm_date, alarm_slot),
  CHECK (jsonb_typeof(accepted_answers) = 'array')
);

CREATE INDEX IF NOT EXISTS scripture_alarm_occurrences_pending
  ON public.scripture_alarm_occurrences(user_id, status, triggered_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.scripture_alarm_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_id uuid NOT NULL REFERENCES public.scripture_alarm_occurrences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_source_type text NOT NULL,
  question_source_id uuid NOT NULL,
  submitted_answer text NOT NULL,
  is_correct boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scripture_alarm_attempts_alarm
  ON public.scripture_alarm_attempts(alarm_id, attempted_at);

ALTER TABLE public.scripture_alarm_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scripture_alarm_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scripture_alarm_occurrences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.scripture_alarm_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.assign_scripture_alarm_question(p_alarm_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_source_type text;
  v_source_id uuid;
  v_question_payload jsonb;
  v_correct_answer text;
  v_accepted_answers jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.scripture_alarm_occurrences alarm
    WHERE alarm.id = p_alarm_id
      AND alarm.status = 'pending'
  ) THEN
    RETURN;
  END IF;

  SELECT
    pool.source_type,
    pool.source_id,
    pool.question_payload,
    pool.correct_answer,
    pool.accepted_answers
  INTO
    v_source_type,
    v_source_id,
    v_question_payload,
    v_correct_answer,
    v_accepted_answers
  FROM (
    SELECT
      'daily_trivia'::text AS source_type,
      question.id AS source_id,
      jsonb_build_object(
        'question_text', question.question_text,
        'question_type', CASE
          WHEN question.question_type = 'true_false' THEN 'true_false'
          WHEN jsonb_typeof(question.options) = 'array' AND jsonb_array_length(question.options) >= 2
            THEN 'multiple_choice'
          ELSE 'standard_text'
        END,
        'options', CASE
          WHEN question.question_type = 'true_false' THEN jsonb_build_array('True', 'False')
          WHEN jsonb_typeof(question.options) = 'array' THEN question.options
          ELSE '[]'::jsonb
        END,
        'reference', question.scripture_reference
      ) AS question_payload,
      question.correct_answer::text AS correct_answer,
      coalesce(question.accepted_answers, '[]'::jsonb) AS accepted_answers,
      CASE
        WHEN question.narrative_date BETWEEN timezone('Africa/Douala', now())::date - 7
          AND timezone('Africa/Douala', now())::date
        THEN 0 ELSE 1
      END AS age_priority,
      0 AS source_priority
    FROM public.custom_questions question
    WHERE question.is_approved = true
      AND question.question_type IN (
        'multiple_choice', 'true_false', 'fill_blank', 'standard_text',
        'scriptorium', 'cloze', 'comprehension'
      )

    UNION ALL

    SELECT
      'weekly_quiz'::text AS source_type,
      question.id AS source_id,
      jsonb_build_object(
        'question_text', coalesce(question.question_payload->>'question', question.question_payload->>'question_text'),
        'question_type', CASE
          WHEN jsonb_typeof(question.question_payload->'options') = 'array'
            AND jsonb_array_length(question.question_payload->'options') >= 2
          THEN 'multiple_choice'
          ELSE 'standard_text'
        END,
        'options', CASE
          WHEN jsonb_typeof(question.question_payload->'options') = 'array'
          THEN question.question_payload->'options'
          ELSE '[]'::jsonb
        END,
        'reference', question.question_payload->>'reference'
      ) AS question_payload,
      question.question_payload->>'correct_answer' AS correct_answer,
      CASE
        WHEN jsonb_typeof(question.question_payload->'accepted_answers') = 'array'
        THEN question.question_payload->'accepted_answers'
        ELSE '[]'::jsonb
      END AS accepted_answers,
      CASE
        WHEN question.source_narrative_date BETWEEN timezone('Africa/Douala', now())::date - 7
          AND timezone('Africa/Douala', now())::date
        THEN 0 ELSE 1
      END AS age_priority,
      1 AS source_priority
    FROM public.generated_questions question
    WHERE coalesce(question.question_payload->>'type', 'standard_text') IN (
        'multiple_choice', 'true_false', 'fill_blank', 'standard_text',
        'scriptorium', 'cloze', 'comprehension'
      )
      AND NULLIF(btrim(question.question_payload->>'correct_answer'), '') IS NOT NULL

    UNION ALL

    SELECT
      fallback.source_type,
      fallback.source_id,
      fallback.question_payload,
      fallback.correct_answer,
      '[]'::jsonb AS accepted_answers,
      2 AS age_priority,
      2 AS source_priority
    FROM (VALUES
      ('scripture_fallback'::text, '51000000-0000-4000-8000-000000000001'::uuid,
        jsonb_build_object('question_text', 'Who built the ark?', 'question_type', 'multiple_choice', 'options', jsonb_build_array('Noah', 'Moses', 'David', 'Peter'), 'reference', 'Genesis 6'), 'Noah'::text),
      ('scripture_fallback'::text, '51000000-0000-4000-8000-000000000002'::uuid,
        jsonb_build_object('question_text', 'Who defeated Goliath?', 'question_type', 'multiple_choice', 'options', jsonb_build_array('David', 'Saul', 'Samuel', 'Solomon'), 'reference', '1 Samuel 17'), 'David'::text),
      ('scripture_fallback'::text, '51000000-0000-4000-8000-000000000003'::uuid,
        jsonb_build_object('question_text', 'In which town was Jesus born?', 'question_type', 'multiple_choice', 'options', jsonb_build_array('Bethlehem', 'Nazareth', 'Jericho', 'Capernaum'), 'reference', 'Matthew 2'), 'Bethlehem'::text),
      ('scripture_fallback'::text, '51000000-0000-4000-8000-000000000004'::uuid,
        jsonb_build_object('question_text', 'Who was swallowed by a great fish?', 'question_type', 'multiple_choice', 'options', jsonb_build_array('Jonah', 'Elijah', 'Isaiah', 'Amos'), 'reference', 'Jonah 1'), 'Jonah'::text),
      ('scripture_fallback'::text, '51000000-0000-4000-8000-000000000005'::uuid,
        jsonb_build_object('question_text', 'What is the first book of the Bible?', 'question_type', 'multiple_choice', 'options', jsonb_build_array('Genesis', 'Exodus', 'Psalms', 'Matthew'), 'reference', 'Genesis 1'), 'Genesis'::text),
      ('scripture_fallback'::text, '51000000-0000-4000-8000-000000000006'::uuid,
        jsonb_build_object('question_text', 'Who led Israel out of Egypt?', 'question_type', 'multiple_choice', 'options', jsonb_build_array('Moses', 'Joshua', 'Aaron', 'Joseph'), 'reference', 'Exodus 12'), 'Moses'::text)
    ) AS fallback(source_type, source_id, question_payload, correct_answer)
  ) pool
  WHERE NULLIF(btrim(coalesce(pool.question_payload->>'question_text', '')), '') IS NOT NULL
    AND NULLIF(btrim(coalesce(pool.correct_answer, '')), '') IS NOT NULL
  ORDER BY
    EXISTS (
      SELECT 1
      FROM public.scripture_alarm_attempts attempt
      WHERE attempt.alarm_id = p_alarm_id
        AND attempt.question_source_type = pool.source_type
        AND attempt.question_source_id = pool.source_id
    ),
    pool.age_priority,
    pool.source_priority,
    random()
  LIMIT 1;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'A Scripture question could not be prepared.';
  END IF;

  UPDATE public.scripture_alarm_occurrences
  SET question_source_type = v_source_type,
      question_source_id = v_source_id,
      question_payload = v_question_payload,
      correct_answer = v_correct_answer,
      accepted_answers = coalesce(v_accepted_answers, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_alarm_id
    AND status = 'pending';
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
    'question_text', alarm.question_payload->>'question_text',
    'question_type', coalesce(alarm.question_payload->>'question_type', 'standard_text'),
    'options', coalesce(alarm.question_payload->'options', '[]'::jsonb),
    'reference', alarm.question_payload->>'reference',
    'attempt_count', alarm.attempt_count
  )
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.id = p_alarm_id
    AND alarm.status = 'pending';
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
BEGIN
  INSERT INTO public.scripture_alarm_occurrences(user_id, alarm_date, alarm_slot, triggered_at)
  VALUES (p_user_id, p_alarm_date, p_alarm_slot, p_triggered_at)
  ON CONFLICT (user_id, alarm_date, alarm_slot) DO NOTHING
  RETURNING id INTO v_alarm_id;

  IF v_alarm_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM private.assign_scripture_alarm_question(v_alarm_id);
  v_label := CASE p_alarm_slot
    WHEN 'morning' THEN 'Morning Scripture alarm'
    WHEN 'midday' THEN 'Midday meditation alarm'
    WHEN 'evening' THEN 'Evening meditation alarm'
    ELSE 'Final meditation alarm'
  END;

  PERFORM public.notify_user(
    p_user_id,
    NULL,
    'scripture_alarm',
    v_label,
    'Answer the Scripture question to silence this alarm.',
    'dashboard',
    jsonb_build_object(
      'alarm_id', v_alarm_id,
      'alarm_date', p_alarm_date,
      'alarm_slot', p_alarm_slot
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
  IF extract(isodow FROM v_today)::integer NOT BETWEEN 1 AND 5 THEN
    RETURN 0;
  END IF;

  v_due_time := CASE p_alarm_slot
    WHEN 'morning' THEN time '05:59'
    WHEN 'midday' THEN time '12:00'
    WHEN 'evening' THEN time '18:00'
    ELSE time '20:30'
  END;
  IF v_now_local::time < v_due_time THEN
    RETURN 0;
  END IF;
  v_triggered_at := ((v_today + v_due_time) AT TIME ZONE 'Africa/Douala');

  FOR v_profile IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.status IN ('active', 'approved')
    )
      AND (
        p_alarm_slot = 'morning'
        OR NOT EXISTS (
          SELECT 1
          FROM public.daily_records record
          WHERE record.user_id = profile.id
            AND record.record_date = v_today
            AND coalesce(record.meditation_submitted, false)
        )
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
  v_created integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF extract(isodow FROM v_today)::integer NOT BETWEEN 1 AND 5 THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.daily_records record
    WHERE record.user_id = v_user_id
      AND record.record_date = v_today
      AND coalesce(record.meditation_submitted, false)
  ) INTO v_has_meditation;

  IF v_now_local::time >= time '05:59'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'morning', ((v_today + time '05:59') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;
  IF NOT v_has_meditation AND v_now_local::time >= time '12:00'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'midday', ((v_today + time '12:00') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;
  IF NOT v_has_meditation AND v_now_local::time >= time '18:00'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'evening', ((v_today + time '18:00') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;
  IF NOT v_has_meditation AND v_now_local::time >= time '20:30'
     AND private.create_scripture_alarm_for_user(
       v_user_id, v_today, 'final', ((v_today + time '20:30') AT TIME ZONE 'Africa/Douala')
     ) THEN
    v_created := v_created + 1;
  END IF;

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
  v_alarm_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.ensure_my_due_scripture_alarms();

  SELECT alarm.id INTO v_alarm_id
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.user_id = v_user_id
    AND alarm.status = 'pending'
  ORDER BY alarm.triggered_at, alarm.created_at
  LIMIT 1;

  IF v_alarm_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scripture_alarm_occurrences alarm
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_alarm_id IS NULL OR NULLIF(btrim(coalesce(p_answer, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Choose or enter an answer first.';
  END IF;

  SELECT alarm.* INTO v_alarm
  FROM public.scripture_alarm_occurrences alarm
  WHERE alarm.id = p_alarm_id
    AND alarm.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_alarm.status <> 'pending' THEN
    RETURN jsonb_build_object('is_correct', true, 'cleared', true);
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
    alarm_id,
    user_id,
    question_source_type,
    question_source_id,
    submitted_answer,
    is_correct
  ) VALUES (
    v_alarm.id,
    v_user_id,
    v_alarm.question_source_type,
    v_alarm.question_source_id,
    btrim(p_answer),
    v_is_correct
  );

  IF v_is_correct THEN
    UPDATE public.scripture_alarm_occurrences
    SET status = 'cleared',
        attempt_count = attempt_count + 1,
        last_answered_at = now(),
        cleared_at = now(),
        question_payload = NULL,
        correct_answer = NULL,
        accepted_answers = '[]'::jsonb,
        updated_at = now()
    WHERE id = v_alarm.id;

    UPDATE public.user_notifications notification
    SET read_at = coalesce(notification.read_at, now())
    WHERE notification.recipient_id = v_user_id
      AND notification.notification_type = 'scripture_alarm'
      AND notification.metadata->>'alarm_id' = v_alarm.id::text;

    RETURN jsonb_build_object('is_correct', true, 'cleared', true);
  END IF;

  UPDATE public.scripture_alarm_occurrences
  SET attempt_count = attempt_count + 1,
      last_answered_at = now(),
      question_source_type = NULL,
      question_source_id = NULL,
      question_payload = NULL,
      correct_answer = NULL,
      accepted_answers = '[]'::jsonb,
      updated_at = now()
  WHERE id = v_alarm.id;

  PERFORM private.assign_scripture_alarm_question(v_alarm.id);

  RETURN jsonb_build_object(
    'is_correct', false,
    'cleared', false,
    'alarm', private.scripture_alarm_public_payload(v_alarm.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION private.assign_scripture_alarm_question(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.scripture_alarm_public_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_scripture_alarm_for_user(uuid, date, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_scripture_alarm(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_scripture_alarm(text) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_my_due_scripture_alarms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_due_scripture_alarms() TO authenticated;
REVOKE ALL ON FUNCTION public.get_pending_scripture_alarm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_scripture_alarm() TO authenticated;
REVOKE ALL ON FUNCTION public.submit_scripture_alarm_answer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_scripture_alarm_answer(uuid, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-scripture-alarm-morning')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-morning');
    PERFORM cron.unschedule('full-circle-scripture-alarm-midday')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-midday');
    PERFORM cron.unschedule('full-circle-scripture-alarm-evening')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-evening');
    PERFORM cron.unschedule('full-circle-scripture-alarm-final')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-scripture-alarm-final');

    PERFORM cron.schedule(
      'full-circle-scripture-alarm-morning',
      '59 4 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('morning');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-midday',
      '0 11 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('midday');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-evening',
      '0 17 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('evening');$job$
    );
    PERFORM cron.schedule(
      'full-circle-scripture-alarm-final',
      '30 19 * * 1-5',
      $job$SELECT public.dispatch_scripture_alarm('final');$job$
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;

SELECT public.dispatch_scripture_alarm('morning');
SELECT public.dispatch_scripture_alarm('midday');
SELECT public.dispatch_scripture_alarm('evening');
SELECT public.dispatch_scripture_alarm('final');
