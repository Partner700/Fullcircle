/* Recover delayed CamPay subscriptions and make public reading/quiz sharing
   follow the same authoritative state as the signed-in application. */

/* Repair any provider-confirmed subscription that predates a successful
   delivery write. This is intentionally idempotent per payment. */
DO $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_existing_end timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  FOR v_payment IN
    SELECT payment.*
    FROM public.mobile_money_payments payment
    WHERE payment.purchase_kind = 'subscription'
      AND lower(payment.status) = 'confirmed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscription_payment_deliveries delivery
        WHERE delivery.payment_id = payment.id
      )
    ORDER BY payment.user_id, payment.created_at, payment.id
  LOOP
    SELECT plan.* INTO v_plan
    FROM public.subscription_plans plan
    WHERE plan.id = coalesce(nullif(v_payment.purchase_metadata->>'plan_id', ''), 'monthly');

    IF FOUND THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(v_payment.user_id::text, 0));
      SELECT subscription.current_period_end INTO v_existing_end
      FROM public.subscriptions subscription
      WHERE subscription.user_id = v_payment.user_id
      FOR UPDATE;

      v_period_start := greatest(now(), coalesce(v_existing_end, now()));
      v_period_end := v_period_start + make_interval(days => v_plan.duration_days);

      INSERT INTO public.subscription_payment_deliveries(
        payment_id, user_id, plan_id, period_start, period_end
      ) VALUES (
        v_payment.id, v_payment.user_id, v_plan.id, v_period_start, v_period_end
      ) ON CONFLICT (payment_id) DO NOTHING;

      IF FOUND THEN
        INSERT INTO public.subscriptions(
          user_id, status, trial_started_at, trial_ends_at, current_period_end,
          payment_method, payment_reference, amount, currency
        ) VALUES (
          v_payment.user_id, 'active', now(), now(), v_period_end,
          v_payment.payment_method, v_payment.reference,
          v_payment.amount_local, upper(v_payment.currency_code)
        )
        ON CONFLICT (user_id) DO UPDATE
        SET status = 'active',
            current_period_end = greatest(
              coalesce(public.subscriptions.current_period_end, EXCLUDED.current_period_end),
              EXCLUDED.current_period_end
            ),
            payment_method = EXCLUDED.payment_method,
            payment_reference = EXCLUDED.payment_reference,
            amount = EXCLUDED.amount,
            currency = EXCLUDED.currency,
            updated_at = now();

        PERFORM public.notify_user(
          v_payment.user_id,
          NULL,
          'payment',
          'Subscription restored',
          'Your confirmed CamPay subscription is active through '
            || to_char(v_period_end AT TIME ZONE 'Africa/Douala', 'Mon DD, YYYY') || '.',
          'subscription',
          jsonb_build_object(
            'payment_id', v_payment.id,
            'plan_id', v_plan.id,
            'period_end', v_period_end,
            'recovered', true
          )
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

/* A launched quiz becomes publicly playable from its scheduled opening time;
   no browser or instructor action has to flip countdown to live. */
ALTER TABLE public.public_quiz_attempts
  ADD COLUMN IF NOT EXISTS claimed_by_user_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS public_quiz_attempts_member_claim_uidx
  ON public.public_quiz_attempts(quiz_session_id, claimed_by_user_id)
  WHERE claimed_by_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_shared_quiz(p_quiz_session_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'session', jsonb_build_object(
      'id', session.id,
      'title', session.title,
      'session_date', session.session_date,
      'live_opens_at', session.live_opens_at,
      'live_closes_at', session.live_closes_at,
      'status', CASE
        WHEN session.status <> 'scheduled'
          AND now() >= session.live_opens_at
          AND now() < session.live_closes_at
        THEN 'live'
        ELSE session.status
      END
    ),
    'questions', CASE
      WHEN session.status <> 'scheduled'
        AND now() >= session.live_opens_at
        AND now() < session.live_closes_at
      THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', question.id,
          'question_index', question.question_index,
          'question_payload', question.question_payload
            - 'correct_answer' - 'accepted_answers' - 'explanation'
        ) ORDER BY question.question_index)
        FROM public.generated_questions question
        WHERE question.quiz_session_id = session.id
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  )
  FROM public.quiz_sessions session
  WHERE session.id = p_quiz_session_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.save_shared_quiz_answer(
  p_quiz_session_id uuid,
  p_guest_key text,
  p_question_id uuid,
  p_answer jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'A valid guest session is required.';
  END IF;
  IF p_answer IS NULL OR p_answer = 'null'::jsonb THEN
    RAISE EXCEPTION 'Choose or enter an answer first.';
  END IF;

  SELECT session.* INTO v_session
  FROM public.quiz_sessions session
  WHERE session.id = p_quiz_session_id;
  IF NOT FOUND OR v_session.status = 'scheduled'
     OR now() < v_session.live_opens_at OR now() >= v_session.live_closes_at THEN
    RAISE EXCEPTION 'This quiz is not accepting answers right now.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.generated_questions question
    WHERE question.id = p_question_id
      AND question.quiz_session_id = p_quiz_session_id
  ) THEN
    RAISE EXCEPTION 'That question does not belong to this quiz.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.public_quiz_attempts attempt
    WHERE attempt.quiz_session_id = p_quiz_session_id
      AND attempt.guest_key = btrim(p_guest_key)
      AND attempt.status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'This guest attempt has already been submitted.';
  END IF;

  INSERT INTO public.public_quiz_attempts AS attempt(
    quiz_session_id, guest_key, answers, updated_at
  ) VALUES (
    p_quiz_session_id,
    btrim(p_guest_key),
    jsonb_build_object(p_question_id::text, p_answer),
    now()
  )
  ON CONFLICT (quiz_session_id, guest_key) DO UPDATE
  SET answers = attempt.answers || jsonb_build_object(p_question_id::text, p_answer),
      updated_at = now();
  RETURN true;
END;
$$;

/* Possession of the browser's guest key lets a newly joined member bind that
   submitted attempt to exactly one account. Marks and answers remain sealed
   until the same release time used by the in-app weekly quiz. */
CREATE OR REPLACE FUNCTION public.claim_shared_quiz_result(
  p_quiz_session_id uuid,
  p_guest_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.public_quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_release_at timestamptz;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_figs integer := 0;
  v_answer_sheet jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Join Full Circle to see this result.'; END IF;
  IF char_length(btrim(coalesce(p_guest_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The guest quiz key is missing or invalid.';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM public.public_quiz_attempts attempt
  WHERE attempt.quiz_session_id = p_quiz_session_id
    AND attempt.guest_key = btrim(p_guest_key)
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'submitted' THEN
    RAISE EXCEPTION 'No submitted guest quiz was found on this device.';
  END IF;
  IF v_attempt.claimed_by_user_id IS NOT NULL
     AND v_attempt.claimed_by_user_id <> v_user_id THEN
    RAISE EXCEPTION 'This guest quiz has already been claimed by another account.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.public_quiz_attempts claimed
    WHERE claimed.quiz_session_id = p_quiz_session_id
      AND claimed.claimed_by_user_id = v_user_id
      AND claimed.id <> v_attempt.id
  ) THEN
    RAISE EXCEPTION 'This account has already claimed a guest attempt for this quiz.';
  END IF;

  UPDATE public.public_quiz_attempts
  SET claimed_by_user_id = v_user_id,
      claimed_at = coalesce(claimed_at, now()),
      updated_at = now()
  WHERE id = v_attempt.id;

  SELECT session.* INTO v_session
  FROM public.quiz_sessions session
  WHERE session.id = p_quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  v_release_at := CASE
    WHEN v_session.quiz_type = 'saturday'
      THEN (v_session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala'
    ELSE v_session.live_closes_at
  END;

  IF now() < v_release_at THEN
    RETURN jsonb_build_object(
      'quiz_session_id', v_session.id,
      'title', v_session.title,
      'released', false,
      'release_at', v_release_at
    );
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE public.quiz_answer_is_correct(
        v_attempt.answers -> question.id::text,
        question.question_payload
      )
    )::integer,
    coalesce(sum(CASE
      WHEN public.quiz_answer_is_correct(
        v_attempt.answers -> question.id::text,
        question.question_payload
      ) THEN CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END
      ELSE 0
    END), 0)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', question.id,
      'question_index', question.question_index,
      'question_text', coalesce(
        question.question_payload->>'question',
        question.question_payload->>'question_text'
      ),
      'options', coalesce(question.question_payload->'options', '[]'::jsonb),
      'selected_answer', v_attempt.answers -> question.id::text,
      'correct_answer', question.question_payload->'correct_answer',
      'is_correct', public.quiz_answer_is_correct(
        v_attempt.answers -> question.id::text,
        question.question_payload
      )
    ) ORDER BY question.question_index), '[]'::jsonb)
  INTO v_question_count, v_correct_count, v_figs, v_answer_sheet
  FROM public.generated_questions question
  WHERE question.quiz_session_id = p_quiz_session_id;

  RETURN jsonb_build_object(
    'quiz_session_id', v_session.id,
    'title', v_session.title,
    'released', true,
    'release_at', v_release_at,
    'correct_count', v_correct_count,
    'question_count', v_question_count,
    'figs', v_figs,
    'questions', v_answer_sheet
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_shared_quiz(
  p_quiz_session_id uuid,
  p_guest_key text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.public_quiz_attempts%ROWTYPE;
  v_question_count integer;
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'A valid guest session is required.';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM public.public_quiz_attempts attempt
  WHERE attempt.quiz_session_id = p_quiz_session_id
    AND attempt.guest_key = btrim(p_guest_key)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Start the quiz before submitting it.'; END IF;
  IF v_attempt.status = 'submitted' THEN RETURN true; END IF;

  SELECT count(*)::integer INTO v_question_count
  FROM public.generated_questions question
  WHERE question.quiz_session_id = p_quiz_session_id;
  IF jsonb_object_length(v_attempt.answers) < v_question_count THEN
    RAISE EXCEPTION 'Answer every question before submitting.';
  END IF;

  UPDATE public.public_quiz_attempts
  SET status = 'submitted', updated_at = now()
  WHERE id = v_attempt.id;
  RETURN true;
END;
$$;

/* One sanitized reaction object is shared by the public reading response.
   Guest keys remain hashed; each guest is represented only as a Dove actor. */
CREATE OR REPLACE FUNCTION public.public_scripture_reaction_summary(
  p_insight_id uuid,
  p_reaction_type text,
  p_guest_key_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'count',
      (SELECT count(*) FROM public.scripture_insight_reactions reaction
       WHERE reaction.insight_id = p_insight_id
         AND reaction.reaction_type = p_reaction_type)
      +
      (SELECT count(*) FROM public.public_scripture_insight_reactions reaction
       WHERE reaction.insight_id = p_insight_id
         AND reaction.reaction_type = p_reaction_type),
    'reacted', p_guest_key_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.public_scripture_insight_reactions reaction
      WHERE reaction.insight_id = p_insight_id
        AND reaction.reaction_type = p_reaction_type
        AND reaction.guest_key_hash = p_guest_key_hash
    ),
    'actors', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', actor.user_id,
        'display_name', actor.display_name,
        'avatar_url', actor.avatar_url,
        'is_guest', actor.is_guest,
        'is_current_guest', actor.is_current_guest
      ) ORDER BY actor.created_at DESC)
      FROM (
        SELECT
          reactor.id::text AS user_id,
          reactor.display_name,
          reactor.avatar_url,
          false AS is_guest,
          false AS is_current_guest,
          reaction.created_at
        FROM public.scripture_insight_reactions reaction
        JOIN public.profiles reactor ON reactor.id = reaction.reactor_user_id
        WHERE reaction.insight_id = p_insight_id
          AND reaction.reaction_type = p_reaction_type

        UNION ALL

        SELECT
          'guest:' || left(reaction.guest_key_hash, 16),
          'Guest reader',
          NULL::text,
          true,
          reaction.guest_key_hash = p_guest_key_hash,
          reaction.created_at
        FROM public.public_scripture_insight_reactions reaction
        WHERE reaction.insight_id = p_insight_id
          AND reaction.reaction_type = p_reaction_type
      ) actor
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.public_reading_insight_threads(
  p_narrative_ids uuid[],
  p_guest_key_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', insight.id,
    'narrative_id', insight.narrative_id,
    'verse_reference', insight.verse_reference,
    'body', insight.body,
    'created_at', insight.created_at,
    'user_id', insight.user_id,
    'profiles', jsonb_build_object(
      'display_name', author.display_name,
      'avatar_url', author.avatar_url
    ),
    'comments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', comment.id,
        'insight_id', comment.insight_id,
        'user_id', comment.user_id,
        'parent_comment_id', comment.parent_comment_id,
        'body', comment.body,
        'created_at', comment.created_at,
        'profile', jsonb_build_object(
          'display_name', commenter.display_name,
          'avatar_url', commenter.avatar_url
        )
      ) ORDER BY comment.created_at)
      FROM public.scripture_insight_comments comment
      JOIN public.profiles commenter ON commenter.id = comment.user_id
      WHERE comment.insight_id = insight.id
    ), '[]'::jsonb),
    'reactions', jsonb_build_object(
      'heart', public.public_scripture_reaction_summary(
        insight.id, 'heart', p_guest_key_hash
      ),
      'lightbulb', public.public_scripture_reaction_summary(
        insight.id, 'lightbulb', p_guest_key_hash
      )
    )
  ) ORDER BY insight.created_at DESC), '[]'::jsonb)
  FROM public.scripture_verse_insights insight
  JOIN public.profiles author ON author.id = insight.user_id
  WHERE insight.narrative_id = ANY(coalesce(p_narrative_ids, ARRAY[]::uuid[]));
$$;

/* Signed-in reading views use the same combined counts and actors. */
CREATE OR REPLACE FUNCTION public.get_scripture_insight_reaction_summaries(
  p_insight_ids uuid[]
)
RETURNS TABLE (
  insight_id uuid,
  reaction_type text,
  reaction_count bigint,
  reacted boolean,
  actors jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor_rows AS (
    SELECT
      reaction.insight_id,
      reaction.reaction_type,
      reactor.id::text AS user_id,
      reactor.display_name,
      reactor.avatar_url,
      false AS is_guest,
      reaction.reactor_user_id = auth.uid() AS reacted_by_me,
      reaction.created_at
    FROM public.scripture_insight_reactions reaction
    JOIN public.profiles reactor ON reactor.id = reaction.reactor_user_id
    WHERE reaction.insight_id = ANY(coalesce(p_insight_ids, ARRAY[]::uuid[]))

    UNION ALL

    SELECT
      reaction.insight_id,
      reaction.reaction_type,
      'guest:' || left(reaction.guest_key_hash, 16),
      'Guest reader',
      NULL::text,
      true,
      false,
      reaction.created_at
    FROM public.public_scripture_insight_reactions reaction
    WHERE reaction.insight_id = ANY(coalesce(p_insight_ids, ARRAY[]::uuid[]))
  )
  SELECT
    actor.insight_id,
    actor.reaction_type,
    count(*) AS reaction_count,
    bool_or(actor.reacted_by_me) AS reacted,
    jsonb_agg(jsonb_build_object(
      'user_id', actor.user_id,
      'display_name', actor.display_name,
      'avatar_url', actor.avatar_url,
      'is_guest', actor.is_guest,
      'is_current_guest', false
    ) ORDER BY actor.created_at DESC) AS actors
  FROM actor_rows actor
  GROUP BY actor.insight_id, actor.reaction_type;
$$;

REVOKE ALL ON FUNCTION public.get_shared_quiz(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_shared_quiz_answer(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_shared_quiz(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_shared_quiz_result(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_scripture_reaction_summary(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_reading_insight_threads(uuid[], text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_scripture_insight_reaction_summaries(uuid[])
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_shared_quiz(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_shared_quiz_answer(uuid, text, uuid, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_shared_quiz(uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_shared_quiz_result(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_scripture_insight_reaction_summaries(uuid[])
  TO authenticated, service_role;
