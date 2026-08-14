/* Challenge submissions are now first-class rewarded events.
   A secure RPC saves evidence, awards 1000 Denarii once per active submission,
   and notifies the cadet's sentry plus all instructors for immediate review. */

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
    'challenge_submission'
  ));

CREATE OR REPLACE FUNCTION public.submit_challenge_submission_secure(
  p_user_id uuid,
  p_narrative_date date,
  p_proof_text text,
  p_proof_type text DEFAULT 'text'
)
RETURNS public.challenge_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.challenge_submissions%ROWTYPE;
  v_display_name text;
  v_reviewer uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only submit your own challenge evidence.';
  END IF;

  IF p_narrative_date IS NULL OR NULLIF(btrim(COALESCE(p_proof_text, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Challenge evidence is required.';
  END IF;

  SELECT * INTO v_submission
  FROM public.challenge_submissions
  WHERE user_id = p_user_id
    AND narrative_date = p_narrative_date
    AND status <> 'rejected'
  ORDER BY submitted_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_submission.status = 'approved' THEN
    RETURN v_submission;
  ELSIF FOUND THEN
    UPDATE public.challenge_submissions
    SET proof_text = btrim(p_proof_text),
        proof_type = COALESCE(NULLIF(btrim(p_proof_type), ''), 'text'),
        status = 'pending',
        rejection_reason = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        submitted_at = now()
    WHERE id = v_submission.id
    RETURNING * INTO v_submission;
  ELSE
    DELETE FROM public.challenge_submissions
    WHERE user_id = p_user_id
      AND narrative_date = p_narrative_date
      AND status = 'rejected';

    INSERT INTO public.challenge_submissions (
      user_id,
      narrative_date,
      proof_text,
      proof_type,
      status,
      submitted_at
    )
    VALUES (
      p_user_id,
      p_narrative_date,
      btrim(p_proof_text),
      COALESCE(NULLIF(btrim(p_proof_type), ''), 'text'),
      'pending',
      now()
    )
    RETURNING * INTO v_submission;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = p_user_id
      AND entry.source_type = 'challenge_submission'
      AND entry.source_reference = v_submission.id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id,
      amount,
      source_type,
      source_reference,
      description
    )
    VALUES (
      p_user_id,
      1000,
      'challenge_submission',
      v_submission.id::text,
      'Daily challenge submitted'
    );
  END IF;

  SELECT COALESCE(NULLIF(display_name, ''), 'A cadet')
  INTO v_display_name
  FROM public.profiles
  WHERE id = p_user_id;

  FOR v_reviewer IN
    SELECT DISTINCT tent.sentry_id
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    WHERE member.user_id = p_user_id
      AND tent.sentry_id IS NOT NULL
      AND tent.sentry_id <> p_user_id
  LOOP
    PERFORM public.notify_user(
      v_reviewer,
      p_user_id,
      'challenge',
      'Challenge evidence submitted',
      COALESCE(v_display_name, 'A cadet') || ' submitted challenge evidence for review.',
      'challenges',
      jsonb_build_object('challenge_submission_id', v_submission.id, 'narrative_date', v_submission.narrative_date)
    );
  END LOOP;

  FOR v_reviewer IN
    SELECT DISTINCT assignment.user_id
    FROM public.role_assignments assignment
    WHERE assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
      AND assignment.user_id <> p_user_id
  LOOP
    PERFORM public.notify_user(
      v_reviewer,
      p_user_id,
      'challenge',
      'Challenge evidence submitted',
      COALESCE(v_display_name, 'A user') || ' submitted challenge evidence for review.',
      'challenges',
      jsonb_build_object('challenge_submission_id', v_submission.id, 'narrative_date', v_submission.narrative_date)
    );
  END LOOP;

  RETURN v_submission;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_challenge_submission_secure(uuid, date, text, text) TO authenticated;
