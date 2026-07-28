/*
# Quiz figs and fixed rewards

- One correct quiz answer equals one fig.
- A perfect full quiz awards one talent (6,000 Denarii).
- Every submitted imperfect quiz awards 1,000 Denarii.
- Quiz rewards are settled once per attempt and are safe to retry.
- Existing submitted attempts and rewards are reconciled to the new rule.
*/

CREATE OR REPLACE FUNCTION public.settle_quiz_attempt_reward(
  p_attempt_id uuid,
  p_status text DEFAULT 'submitted'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
  v_quiz_type text;
  v_figs integer := 0;
  v_max_figs integer := 0;
  v_reward integer := 0;
  v_perfect boolean := false;
  v_source_type text;
  v_description text;
  v_reward_id uuid;
BEGIN
  IF p_status NOT IN ('submitted', 'timed_out') THEN
    RAISE EXCEPTION 'Quiz status must be submitted or timed_out.';
  END IF;

  SELECT qa.*
  INTO v_attempt
  FROM public.quiz_attempts qa
  WHERE qa.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz attempt not found.';
  END IF;

  SELECT qs.quiz_type
  INTO v_quiz_type
  FROM public.quiz_sessions qs
  WHERE qs.id = v_attempt.quiz_session_id;

  IF auth.uid() IS NOT NULL AND auth.uid() <> v_attempt.user_id THEN
    RAISE EXCEPTION 'You can only settle your own quiz attempt.';
  END IF;

  SELECT
    COUNT(gq.id)::integer,
    COUNT(gq.id) FILTER (
      WHERE qr.answer = gq.question_payload->'correct_answer'
    )::integer
  INTO v_max_figs, v_figs
  FROM public.generated_questions gq
  LEFT JOIN public.question_responses qr
    ON qr.quiz_attempt_id = v_attempt.id
   AND qr.question_id = gq.id
  WHERE gq.quiz_session_id = v_attempt.quiz_session_id;

  IF v_max_figs <= 0 THEN
    RAISE EXCEPTION 'This quiz has no questions to score.';
  END IF;

  v_perfect := v_figs = v_max_figs;
  v_reward := CASE WHEN v_perfect THEN 6000 ELSE 1000 END;
  v_source_type := CASE
    WHEN v_quiz_type = 'fortune' THEN 'fortune_quiz_reward'
    ELSE 'quiz_reward'
  END;
  v_description := CASE
    WHEN v_perfect THEN
      format('Quiz: %s/%s figs · perfect score · 1 talent', v_figs, v_max_figs)
    ELSE
      format('Quiz: %s/%s figs · imperfect score · 1,000 denarii', v_figs, v_max_figs)
  END;

  UPDATE public.quiz_attempts
  SET
    status = p_status,
    talents_scored = v_figs,
    submitted_at = COALESCE(submitted_at, now())
  WHERE id = v_attempt.id;

  SELECT dle.id
  INTO v_reward_id
  FROM public.denarii_ledger_entries dle
  WHERE dle.user_id = v_attempt.user_id
    AND dle.source_reference = v_attempt.id::text
    AND dle.source_type IN ('quiz_reward', 'fortune_quiz_reward')
  ORDER BY dle.created_at, dle.id
  LIMIT 1;

  IF v_reward_id IS NULL THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id,
      amount,
      source_type,
      source_reference,
      description
    )
    VALUES (
      v_attempt.user_id,
      v_reward,
      v_source_type,
      v_attempt.id::text,
      v_description
    );
  ELSE
    UPDATE public.denarii_ledger_entries
    SET
      amount = v_reward,
      source_type = v_source_type,
      description = v_description
    WHERE id = v_reward_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'figs', v_figs,
    'max_figs', v_max_figs,
    'perfect', v_perfect,
    'reward_denarii', v_reward
  );
END;
$$;

WITH ranked_rewards AS (
  SELECT
    dle.id,
    ROW_NUMBER() OVER (
      PARTITION BY dle.user_id, dle.source_reference
      ORDER BY dle.created_at, dle.id
    ) AS reward_number
  FROM public.denarii_ledger_entries dle
  WHERE dle.source_type IN ('quiz_reward', 'fortune_quiz_reward')
    AND dle.source_reference IS NOT NULL
)
DELETE FROM public.denarii_ledger_entries dle
USING ranked_rewards rr
WHERE dle.id = rr.id
  AND rr.reward_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS quiz_reward_once_per_attempt
  ON public.denarii_ledger_entries (user_id, source_reference)
  WHERE source_type IN ('quiz_reward', 'fortune_quiz_reward')
    AND source_reference IS NOT NULL;

WITH scored_attempts AS (
  SELECT
    qa.id AS attempt_id,
    qa.user_id,
    qs.quiz_type,
    COUNT(gq.id)::integer AS max_figs,
    COUNT(gq.id) FILTER (
      WHERE qr.answer = gq.question_payload->'correct_answer'
    )::integer AS figs
  FROM public.quiz_attempts qa
  JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
  JOIN public.generated_questions gq ON gq.quiz_session_id = qa.quiz_session_id
  LEFT JOIN public.question_responses qr
    ON qr.quiz_attempt_id = qa.id
   AND qr.question_id = gq.id
  WHERE qa.status IN ('submitted', 'timed_out')
  GROUP BY qa.id, qa.user_id, qs.quiz_type
)
UPDATE public.quiz_attempts qa
SET talents_scored = sa.figs
FROM scored_attempts sa
WHERE qa.id = sa.attempt_id;

WITH scored_attempts AS (
  SELECT
    qa.id AS attempt_id,
    qa.user_id,
    qs.quiz_type,
    COUNT(gq.id)::integer AS max_figs,
    COUNT(gq.id) FILTER (
      WHERE qr.answer = gq.question_payload->'correct_answer'
    )::integer AS figs
  FROM public.quiz_attempts qa
  JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
  JOIN public.generated_questions gq ON gq.quiz_session_id = qa.quiz_session_id
  LEFT JOIN public.question_responses qr
    ON qr.quiz_attempt_id = qa.id
   AND qr.question_id = gq.id
  WHERE qa.status IN ('submitted', 'timed_out')
  GROUP BY qa.id, qa.user_id, qs.quiz_type
)
UPDATE public.denarii_ledger_entries dle
SET
  amount = CASE WHEN sa.figs = sa.max_figs THEN 6000 ELSE 1000 END,
  source_type = CASE WHEN sa.quiz_type = 'fortune' THEN 'fortune_quiz_reward' ELSE 'quiz_reward' END,
  description = CASE
    WHEN sa.figs = sa.max_figs THEN
      format('Quiz: %s/%s figs · perfect score · 1 talent', sa.figs, sa.max_figs)
    ELSE
      format('Quiz: %s/%s figs · imperfect score · 1,000 denarii', sa.figs, sa.max_figs)
  END
FROM scored_attempts sa
WHERE dle.user_id = sa.user_id
  AND dle.source_reference = sa.attempt_id::text
  AND dle.source_type IN ('quiz_reward', 'fortune_quiz_reward');

WITH scored_attempts AS (
  SELECT
    qa.id AS attempt_id,
    qa.user_id,
    qs.quiz_type,
    COUNT(gq.id)::integer AS max_figs,
    COUNT(gq.id) FILTER (
      WHERE qr.answer = gq.question_payload->'correct_answer'
    )::integer AS figs
  FROM public.quiz_attempts qa
  JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
  JOIN public.generated_questions gq ON gq.quiz_session_id = qa.quiz_session_id
  LEFT JOIN public.question_responses qr
    ON qr.quiz_attempt_id = qa.id
   AND qr.question_id = gq.id
  WHERE qa.status IN ('submitted', 'timed_out')
  GROUP BY qa.id, qa.user_id, qs.quiz_type
)
INSERT INTO public.denarii_ledger_entries (
  user_id,
  amount,
  source_type,
  source_reference,
  description
)
SELECT
  sa.user_id,
  CASE WHEN sa.figs = sa.max_figs THEN 6000 ELSE 1000 END,
  CASE WHEN sa.quiz_type = 'fortune' THEN 'fortune_quiz_reward' ELSE 'quiz_reward' END,
  sa.attempt_id::text,
  CASE
    WHEN sa.figs = sa.max_figs THEN
      format('Quiz: %s/%s figs · perfect score · 1 talent', sa.figs, sa.max_figs)
    ELSE
      format('Quiz: %s/%s figs · imperfect score · 1,000 denarii', sa.figs, sa.max_figs)
  END
FROM scored_attempts sa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.denarii_ledger_entries dle
  WHERE dle.user_id = sa.user_id
    AND dle.source_reference = sa.attempt_id::text
    AND dle.source_type IN ('quiz_reward', 'fortune_quiz_reward')
);

GRANT EXECUTE ON FUNCTION public.settle_quiz_attempt_reward(uuid, text) TO authenticated;
