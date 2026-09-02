/*
  Instructor-authored Dove Questions.

  The browser only receives a sanitized pending-question payload. Answer
  checking, entry-cost collection, and rewards are settled atomically here.
*/

ALTER TABLE public.denarii_ledger_entries
  DROP CONSTRAINT IF EXISTS denarii_ledger_entries_source_type_check;

ALTER TABLE public.denarii_ledger_entries
  ADD CONSTRAINT denarii_ledger_entries_source_type_check
  CHECK (source_type IN (
    'game_level', 'game_blitz', 'quiz_reward', 'fortune_quiz_reward',
    'relic_purchase', 'relic_reward', 'admin_adjustment',
    'hint_purchase', 'answer_reveal', 'freezer_daily', 'freezer_weekly',
    'attendance', 'arena_stake', 'arena_fee', 'arena_reward',
    'mobile_money', 'campay_payment', 'notification_opt_in',
    'challenge_submission', 'dove_question_cost', 'dove_question_reward'
  ));

CREATE TABLE IF NOT EXISTS public.dove_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_text text NOT NULL CHECK (length(btrim(question_text)) BETWEEN 1 AND 2000),
  question_type text NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false', 'fill_blank', 'standard_text')),
  options text[] NOT NULL DEFAULT ARRAY[]::text[],
  correct_answer text NOT NULL,
  accepted_answers text[] NOT NULL DEFAULT ARRAY[]::text[],
  explanation text,
  entry_cost_denarii integer NOT NULL DEFAULT 0 CHECK (entry_cost_denarii BETWEEN 0 AND 100000000),
  reward_denarii integer NOT NULL DEFAULT 0 CHECK (reward_denarii BETWEEN 0 AND 100000000),
  delivery_mode text NOT NULL DEFAULT 'optional' CHECK (delivery_mode IN ('optional', 'required')),
  sound_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dove_questions_active
  ON public.dove_questions(status, published_at DESC);

CREATE TABLE IF NOT EXISTS public.dove_question_targets (
  question_id uuid NOT NULL REFERENCES public.dove_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'answered')),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  answered_at timestamptz,
  PRIMARY KEY (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dove_question_targets_pending
  ON public.dove_question_targets(user_id, status, delivered_at);

CREATE TABLE IF NOT EXISTS public.dove_question_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.dove_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submitted_answer text NOT NULL,
  is_correct boolean NOT NULL,
  cost_paid integer NOT NULL DEFAULT 0 CHECK (cost_paid >= 0),
  cost_waived boolean NOT NULL DEFAULT false,
  reward_paid integer NOT NULL DEFAULT 0 CHECK (reward_paid >= 0),
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dove_question_answers_question
  ON public.dove_question_answers(question_id, answered_at);

/* Safe public projection for the small participant portraits. */
CREATE TABLE IF NOT EXISTS public.dove_question_participants (
  question_id uuid NOT NULL REFERENCES public.dove_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dove_question_participants_question
  ON public.dove_question_participants(question_id, answered_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dove_question_ledger_settlement
  ON public.denarii_ledger_entries(user_id, source_type, source_reference)
  WHERE source_type IN ('dove_question_cost', 'dove_question_reward');

ALTER TABLE public.dove_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dove_question_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dove_question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dove_question_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dove_questions_select_instructors ON public.dove_questions;
CREATE POLICY dove_questions_select_instructors
  ON public.dove_questions FOR SELECT TO authenticated
  USING (public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS dove_question_targets_select_own_or_instructor ON public.dove_question_targets;
CREATE POLICY dove_question_targets_select_own_or_instructor
  ON public.dove_question_targets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS dove_question_answers_select_own_or_instructor ON public.dove_question_answers;
CREATE POLICY dove_question_answers_select_own_or_instructor
  ON public.dove_question_answers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS dove_question_participants_select_authenticated ON public.dove_question_participants;
CREATE POLICY dove_question_participants_select_authenticated
  ON public.dove_question_participants FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.dove_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dove_question_targets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dove_question_answers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dove_question_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dove_questions TO authenticated;
GRANT SELECT ON TABLE public.dove_question_targets TO authenticated;
GRANT SELECT ON TABLE public.dove_question_answers TO authenticated;
GRANT SELECT ON TABLE public.dove_question_participants TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_dove_question_answer(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.publish_dove_question(
  p_question_text text,
  p_question_type text DEFAULT 'multiple_choice',
  p_options text[] DEFAULT ARRAY[]::text[],
  p_correct_answer text DEFAULT '',
  p_accepted_answers text[] DEFAULT ARRAY[]::text[],
  p_explanation text DEFAULT NULL,
  p_entry_cost_denarii integer DEFAULT 0,
  p_reward_denarii integer DEFAULT 0,
  p_delivery_mode text DEFAULT 'optional',
  p_sound_url text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_question_id uuid;
  v_options text[] := ARRAY[]::text[];
  v_accepted text[] := ARRAY[]::text[];
  v_recipient_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only an instructor can send a Dove Question.';
  END IF;

  IF length(btrim(coalesce(p_question_text, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Enter a question between 1 and 2000 characters.';
  END IF;
  IF p_question_type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'standard_text') THEN
    RAISE EXCEPTION 'Choose a supported question type.';
  END IF;
  IF p_delivery_mode NOT IN ('optional', 'required') THEN
    RAISE EXCEPTION 'Choose optional or obligatory delivery.';
  END IF;
  IF coalesce(p_entry_cost_denarii, -1) NOT BETWEEN 0 AND 100000000
     OR coalesce(p_reward_denarii, -1) NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Cost and reward must be valid non-negative Denarii amounts.';
  END IF;
  IF NULLIF(btrim(coalesce(p_correct_answer, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A correct answer is required.';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'The expiry time must be in the future.';
  END IF;
  IF NULLIF(btrim(coalesce(p_sound_url, '')), '') IS NOT NULL
     AND btrim(p_sound_url) !~* '^https?://' THEN
    RAISE EXCEPTION 'The question sound must use a valid web address.';
  END IF;

  SELECT coalesce(array_agg(cleaned.value ORDER BY cleaned.ordinality), ARRAY[]::text[])
  INTO v_options
  FROM (
    SELECT btrim(item.value) AS value, item.ordinality
    FROM unnest(coalesce(p_options, ARRAY[]::text[])) WITH ORDINALITY AS item(value, ordinality)
    WHERE NULLIF(btrim(item.value), '') IS NOT NULL
  ) cleaned;

  SELECT coalesce(array_agg(cleaned.value ORDER BY cleaned.ordinality), ARRAY[]::text[])
  INTO v_accepted
  FROM (
    SELECT btrim(item.value) AS value, item.ordinality
    FROM unnest(coalesce(p_accepted_answers, ARRAY[]::text[])) WITH ORDINALITY AS item(value, ordinality)
    WHERE NULLIF(btrim(item.value), '') IS NOT NULL
  ) cleaned;

  IF p_question_type = 'true_false' THEN
    v_options := ARRAY['True', 'False'];
  ELSIF p_question_type = 'multiple_choice' AND cardinality(v_options) < 2 THEN
    RAISE EXCEPTION 'Multiple-choice questions need at least two options.';
  END IF;

  IF p_question_type IN ('multiple_choice', 'true_false') AND NOT EXISTS (
    SELECT 1
    FROM unnest(v_options) AS option_value
    WHERE public.normalize_dove_question_answer(option_value)
      = public.normalize_dove_question_answer(p_correct_answer)
  ) THEN
    RAISE EXCEPTION 'The correct answer must match one of the choices.';
  END IF;

  INSERT INTO public.dove_questions (
    instructor_id,
    question_text,
    question_type,
    options,
    correct_answer,
    accepted_answers,
    explanation,
    entry_cost_denarii,
    reward_denarii,
    delivery_mode,
    sound_url,
    expires_at
  ) VALUES (
    v_actor,
    btrim(p_question_text),
    p_question_type,
    v_options,
    btrim(p_correct_answer),
    v_accepted,
    NULLIF(btrim(coalesce(p_explanation, '')), ''),
    p_entry_cost_denarii,
    p_reward_denarii,
    p_delivery_mode,
    NULLIF(btrim(coalesce(p_sound_url, '')), ''),
    p_expires_at
  )
  RETURNING id INTO v_question_id;

  INSERT INTO public.dove_question_targets (question_id, user_id)
  SELECT v_question_id, profile.id
  FROM public.profiles profile
  WHERE profile.id <> v_actor
    AND EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.status IN ('active', 'approved')
    )
  ON CONFLICT (question_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_recipient_count = ROW_COUNT;

  INSERT INTO public.user_notifications (
    recipient_id,
    actor_id,
    notification_type,
    title,
    body,
    action_key,
    metadata
  )
  SELECT
    target.user_id,
    v_actor,
    'dove_question',
    'A Dove Question has arrived',
    CASE
      WHEN p_delivery_mode = 'required' THEN 'Answer this obligatory question to continue in Full Circle.'
      ELSE 'A new optional question is waiting for you.'
    END,
    'dashboard',
    jsonb_build_object(
      'dove_question_id', v_question_id,
      'delivery_mode', p_delivery_mode,
      'recipient_count', v_recipient_count
    )
  FROM public.dove_question_targets target
  WHERE target.question_id = v_question_id;

  RETURN v_question_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_dove_question()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_question public.dove_questions%ROWTYPE;
  v_balance bigint := 0;
  v_participant_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT question.*
  INTO v_question
  FROM public.dove_questions question
  JOIN public.dove_question_targets target
    ON target.question_id = question.id
   AND target.user_id = v_user_id
  WHERE target.status = 'pending'
    AND question.status = 'active'
    AND (question.expires_at IS NULL OR question.expires_at > now())
  ORDER BY
    CASE question.delivery_mode WHEN 'required' THEN 0 ELSE 1 END,
    question.published_at,
    question.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(entry.amount), 0)::bigint
  INTO v_balance
  FROM public.denarii_ledger_entries entry
  WHERE entry.user_id = v_user_id;

  SELECT count(*)::integer
  INTO v_participant_count
  FROM public.dove_question_participants participant
  WHERE participant.question_id = v_question.id;

  RETURN jsonb_build_object(
    'id', v_question.id,
    'question_text', v_question.question_text,
    'question_type', v_question.question_type,
    'options', to_jsonb(v_question.options),
    'entry_cost_denarii', v_question.entry_cost_denarii,
    'reward_denarii', v_question.reward_denarii,
    'delivery_mode', v_question.delivery_mode,
    'sound_url', v_question.sound_url,
    'published_at', v_question.published_at,
    'expires_at', v_question.expires_at,
    'participant_count', v_participant_count,
    'wallet_denarii', v_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dove_question_participants(p_question_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  answered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT public.is_instructor(v_user_id) AND NOT EXISTS (
    SELECT 1
    FROM public.dove_question_targets target
    WHERE target.question_id = p_question_id
      AND target.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'This Dove Question is not available to you.';
  END IF;

  RETURN QUERY
  SELECT
    participant.user_id,
    profile.display_name,
    profile.avatar_url,
    participant.answered_at
  FROM public.dove_question_participants participant
  JOIN public.profiles profile ON profile.id = participant.user_id
  WHERE participant.question_id = p_question_id
  ORDER BY participant.answered_at, participant.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dove_question_participants_for_instructor(p_question_ids uuid[])
RETURNS TABLE (
  question_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  answered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only an instructor can view the full Dove Question response list.';
  END IF;

  RETURN QUERY
  SELECT
    participant.question_id,
    participant.user_id,
    profile.display_name,
    profile.avatar_url,
    participant.answered_at
  FROM public.dove_question_participants participant
  JOIN public.profiles profile ON profile.id = participant.user_id
  WHERE participant.question_id = ANY(coalesce(p_question_ids, ARRAY[]::uuid[]))
  ORDER BY participant.answered_at, participant.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_dove_question_answer(
  p_question_id uuid,
  p_answer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_question public.dove_questions%ROWTYPE;
  v_target public.dove_question_targets%ROWTYPE;
  v_existing public.dove_question_answers%ROWTYPE;
  v_normalized_answer text;
  v_is_correct boolean := false;
  v_balance bigint := 0;
  v_cost_paid integer := 0;
  v_cost_waived boolean := false;
  v_reward_paid integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_question_id IS NULL OR NULLIF(btrim(coalesce(p_answer, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Choose or enter an answer first.';
  END IF;

  SELECT * INTO v_target
  FROM public.dove_question_targets
  WHERE question_id = p_question_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This Dove Question was not sent to your account.';
  END IF;

  SELECT * INTO v_question
  FROM public.dove_questions
  WHERE id = p_question_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This Dove Question is no longer available.';
  END IF;

  SELECT * INTO v_existing
  FROM public.dove_question_answers
  WHERE question_id = p_question_id
    AND user_id = v_user_id;

  IF FOUND THEN
    SELECT coalesce(sum(entry.amount), 0)::bigint INTO v_balance
    FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = v_user_id;

    RETURN jsonb_build_object(
      'question_id', p_question_id,
      'submitted_answer', v_existing.submitted_answer,
      'is_correct', v_existing.is_correct,
      'correct_answer', v_question.correct_answer,
      'explanation', v_question.explanation,
      'cost_paid', v_existing.cost_paid,
      'cost_waived', v_existing.cost_waived,
      'reward_paid', v_existing.reward_paid,
      'wallet_denarii', v_balance,
      'already_answered', true
    );
  END IF;

  IF v_target.status <> 'pending' THEN
    RAISE EXCEPTION 'This Dove Question has already been settled.';
  END IF;
  IF v_question.status <> 'active'
     OR (v_question.expires_at IS NOT NULL AND v_question.expires_at <= now()) THEN
    RAISE EXCEPTION 'This Dove Question has closed.';
  END IF;

  v_normalized_answer := public.normalize_dove_question_answer(p_answer);
  v_is_correct := v_normalized_answer = public.normalize_dove_question_answer(v_question.correct_answer)
    OR EXISTS (
      SELECT 1
      FROM unnest(v_question.accepted_answers) AS accepted_answer
      WHERE v_normalized_answer = public.normalize_dove_question_answer(accepted_answer)
    );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('full-circle-wallet:' || v_user_id::text, 0)
  );

  SELECT coalesce(sum(entry.amount), 0)::bigint
  INTO v_balance
  FROM public.denarii_ledger_entries entry
  WHERE entry.user_id = v_user_id;

  IF v_question.entry_cost_denarii > 0 THEN
    IF v_balance >= v_question.entry_cost_denarii THEN
      v_cost_paid := v_question.entry_cost_denarii;
      INSERT INTO public.denarii_ledger_entries (
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_user_id,
        -v_cost_paid,
        'dove_question_cost',
        v_question.id::text,
        'Dove Question entry cost'
      );
      v_balance := v_balance - v_cost_paid;
    ELSIF v_question.delivery_mode = 'required' THEN
      /* A mandatory question must never lock a low-balance user out forever. */
      v_cost_waived := true;
    ELSE
      RAISE EXCEPTION 'You need % Denarii to answer this question. Your balance is %.',
        v_question.entry_cost_denarii,
        v_balance;
    END IF;
  END IF;

  IF v_is_correct AND v_question.reward_denarii > 0 THEN
    v_reward_paid := v_question.reward_denarii;
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id,
      v_reward_paid,
      'dove_question_reward',
      v_question.id::text,
      'Correct Dove Question answer'
    );
    v_balance := v_balance + v_reward_paid;
  END IF;

  INSERT INTO public.dove_question_answers (
    question_id,
    user_id,
    submitted_answer,
    is_correct,
    cost_paid,
    cost_waived,
    reward_paid
  ) VALUES (
    v_question.id,
    v_user_id,
    btrim(p_answer),
    v_is_correct,
    v_cost_paid,
    v_cost_waived,
    v_reward_paid
  );

  INSERT INTO public.dove_question_participants (question_id, user_id)
  VALUES (v_question.id, v_user_id)
  ON CONFLICT (question_id, user_id) DO NOTHING;

  UPDATE public.dove_question_targets
  SET status = 'answered',
      answered_at = now()
  WHERE question_id = v_question.id
    AND user_id = v_user_id;

  UPDATE public.user_notifications
  SET read_at = coalesce(read_at, now())
  WHERE recipient_id = v_user_id
    AND notification_type = 'dove_question'
    AND metadata->>'dove_question_id' = v_question.id::text;

  RETURN jsonb_build_object(
    'question_id', v_question.id,
    'submitted_answer', btrim(p_answer),
    'is_correct', v_is_correct,
    'correct_answer', v_question.correct_answer,
    'explanation', v_question.explanation,
    'cost_paid', v_cost_paid,
    'cost_waived', v_cost_waived,
    'reward_paid', v_reward_paid,
    'wallet_denarii', v_balance,
    'already_answered', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_dove_question(p_question_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_mode text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT question.delivery_mode
  INTO v_mode
  FROM public.dove_questions question
  JOIN public.dove_question_targets target
    ON target.question_id = question.id
   AND target.user_id = v_user_id
  WHERE question.id = p_question_id
    AND target.status = 'pending'
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_mode = 'required' THEN
    RAISE EXCEPTION 'This obligatory question must be answered before continuing.';
  END IF;

  UPDATE public.dove_question_targets
  SET status = 'dismissed',
      dismissed_at = now()
  WHERE question_id = p_question_id
    AND user_id = v_user_id
    AND status = 'pending';

  UPDATE public.user_notifications
  SET read_at = coalesce(read_at, now())
  WHERE recipient_id = v_user_id
    AND notification_type = 'dove_question'
    AND metadata->>'dove_question_id' = p_question_id::text;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_dove_question(p_question_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only an instructor can close a Dove Question.';
  END IF;

  UPDATE public.dove_questions
  SET status = 'closed',
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  WHERE id = p_question_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.dove_question_targets
  SET status = 'dismissed',
      dismissed_at = now()
  WHERE question_id = p_question_id
    AND status = 'pending';

  UPDATE public.user_notifications
  SET read_at = coalesce(read_at, now())
  WHERE notification_type = 'dove_question'
    AND metadata->>'dove_question_id' = p_question_id::text;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_dove_question_answer(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_dove_question(text, text, text[], text, text[], text, integer, integer, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pending_dove_question() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dove_question_participants(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dove_question_participants_for_instructor(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_dove_question_answer(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dismiss_dove_question(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_dove_question(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_pending_dove_question() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dove_question_participants(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dove_question_participants_for_instructor(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_dove_question_answer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_dove_question(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_dove_question(text, text, text[], text, text[], text, integer, integer, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_dove_question(uuid) TO authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dove_questions',
    'dove_question_targets',
    'dove_question_participants'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables publication_table
      WHERE publication_table.pubname = 'supabase_realtime'
        AND publication_table.schemaname = 'public'
        AND publication_table.tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
