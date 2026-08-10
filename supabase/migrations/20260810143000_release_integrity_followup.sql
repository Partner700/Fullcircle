/* Final release integrity follow-up: exclusive roles, sealed Saturday scores,
 * controlled payment creation, and bounded quiz waiting-room chat. */

-- Keep exactly one active/approved role per account. Existing duplicate roles
-- are resolved by preserving the highest-authority active assignment.
WITH ranked_roles AS (
  SELECT
    assignment.id,
    assignment.role,
    row_number() OVER (
      PARTITION BY assignment.user_id
      ORDER BY
        CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
        CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
        assignment.start_date DESC NULLS LAST,
        assignment.created_at DESC
    ) AS position
  FROM public.role_assignments assignment
  WHERE assignment.status IN ('active', 'approved')
)
UPDATE public.role_assignments assignment
SET
  status = CASE WHEN assignment.role IN ('cadet', 'sentry') THEN 'promoted' ELSE 'removed' END,
  end_date = COALESCE(assignment.end_date, CURRENT_DATE)
FROM ranked_roles ranked
WHERE assignment.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_one_active_role_per_user
  ON public.role_assignments(user_id)
  WHERE status IN ('active', 'approved');

-- Self-service signup always creates a cadet. Higher roles are deliberately
-- assigned through the instructor-only promotion functions, never from a
-- browser-supplied role value.
CREATE OR REPLACE FUNCTION public.complete_signup(
  p_display_name text,
  p_role text,
  p_matricule text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to complete signup.';
  END IF;

  IF length(btrim(coalesce(p_display_name, ''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Display name must contain between 2 and 80 characters.';
  END IF;

  IF p_role IS DISTINCT FROM 'cadet' THEN
    RAISE EXCEPTION 'New accounts must join as cadets. An instructor can assign a higher role later.';
  END IF;

  INSERT INTO public.profiles (id, display_name, email)
  SELECT v_user_id, btrim(p_display_name), auth_user.email
  FROM auth.users auth_user
  WHERE auth_user.id = v_user_id
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email = COALESCE(public.profiles.email, EXCLUDED.email);

  IF EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RETURN true;
  END IF;

  INSERT INTO public.role_assignments (user_id, role, status, start_date, end_date)
  VALUES (v_user_id, 'cadet', 'active', CURRENT_DATE, NULL)
  ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved')
  DO UPDATE SET
    status = 'active',
    start_date = COALESCE(public.role_assignments.start_date, EXCLUDED.start_date),
    end_date = NULL;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_signup(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_signup(text, text, text) TO authenticated;

-- Browser profile edits are limited to genuine user-editable fields. Email and
-- identity columns remain owned by Supabase Auth and trusted server functions.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  display_name, avatar_url, country_code, whatsapp_number,
  language_code, timezone, onboarding_completed
) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_profile_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_should_validate boolean := false;
BEGIN
  IF NEW.onboarding_completed THEN
    IF TG_OP = 'INSERT' THEN
      v_should_validate := true;
    ELSIF NOT COALESCE(OLD.onboarding_completed, false) THEN
      v_should_validate := true;
    END IF;
  END IF;

  IF v_should_validate THEN
    IF btrim(coalesce(NEW.country_code, '')) = ''
      OR length(regexp_replace(coalesce(NEW.whatsapp_number, ''), '\D', '', 'g')) < 8
      OR btrim(coalesce(NEW.language_code, '')) = ''
      OR btrim(coalesce(NEW.timezone, '')) = '' THEN
      RAISE EXCEPTION 'Country, WhatsApp number, language, and timezone are required to finish signup.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_profile_onboarding_trigger ON public.profiles;
CREATE TRIGGER validate_profile_onboarding_trigger
BEFORE INSERT OR UPDATE OF onboarding_completed ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_onboarding();

REVOKE ALL ON FUNCTION public.validate_profile_onboarding() FROM PUBLIC, anon, authenticated;

-- Balance totals feed the platform's denarii, tent-house, and tent boards.
-- Keep them available to active platform members, but never anonymously.
CREATE OR REPLACE FUNCTION public.get_user_denarii_total(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_caller IS DISTINCT FROM p_user_id
    AND NOT public.is_instructor(v_caller)
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = v_caller
        AND assignment.status IN ('active', 'approved')
        AND assignment.role IN ('cadet', 'sentry')
    ) THEN
    RAISE EXCEPTION 'You cannot view this balance.';
  END IF;

  RETURN (
    SELECT COALESCE(sum(entry.amount), 0)::bigint
    FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_denarii_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_denarii_total(uuid) TO authenticated, service_role;

-- Notifications are generated by trusted triggers and server workflows. A
-- browser cannot impersonate another actor or send arbitrary notifications.
REVOKE ALL ON FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb)
  TO service_role;

-- Authoritative state changes happen through the validated RPCs above and the
-- payment/game Edge Functions. Remove legacy direct-write privileges.
REVOKE INSERT, UPDATE, DELETE ON public.denarii_ledger_entries FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_attempts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quiz_attempts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_records FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_assignments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.relic_inventory FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.mobile_money_payments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.question_responses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_game_runs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_game_responses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_game_question_aids FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.arena_question_decks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.arena_trivia_responses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.arena_machine_trivia_responses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.relic_usage_log FROM anon, authenticated;

-- A Saturday participant may restore their own in-progress answers, but their
-- score remains sealed until the 3 PM release. Instructors retain answer-sheet
-- access through the existing instructor policy and RPCs.
CREATE OR REPLACE FUNCTION public.get_my_quiz_attempt(p_quiz_session_id uuid)
RETURNS public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id
    AND quiz_session_id = p_quiz_session_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id;

  IF COALESCE(v_session.quiz_type, 'saturday') = 'saturday'
    AND timezone('Africa/Douala', now()) < v_session.session_date::timestamp + time '15:00'
    AND v_attempt.status IN ('submitted', 'timed_out', 'forfeited') THEN
    v_attempt.talents_scored := 0;
  END IF;

  RETURN v_attempt;
END;
$$;

DROP POLICY IF EXISTS "read_quiz_attempts" ON public.quiz_attempts;
CREATE POLICY "read_quiz_attempts"
ON public.quiz_attempts FOR SELECT TO authenticated
USING (
  public.is_instructor(auth.uid())
  OR (
    user_id = auth.uid()
    AND (
      status IN ('not_started', 'in_progress')
      OR EXISTS (
        SELECT 1
        FROM public.quiz_sessions session
        WHERE session.id = quiz_attempts.quiz_session_id
          AND (
            COALESCE(session.quiz_type, 'saturday') <> 'saturday'
            OR timezone('Africa/Douala', now()) >= session.session_date::timestamp + time '15:00'
          )
      )
    )
  )
);

REVOKE ALL ON FUNCTION public.get_my_quiz_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_quiz_attempt(uuid) TO authenticated;

-- Payment rows must originate from the authenticated checkout Edge Function.
DROP POLICY IF EXISTS "insert_own_mobile_payments" ON public.mobile_money_payments;
DROP POLICY IF EXISTS "insert_mobile_money_payment" ON public.mobile_money_payments;
REVOKE INSERT, UPDATE, DELETE ON public.mobile_money_payments FROM anon, authenticated;

-- Waiting-room chat is available to active platform members. New messages are
-- accepted only while the corresponding quiz has not closed.
DROP POLICY IF EXISTS "authenticated users read quiz waiting chat" ON public.quiz_waiting_messages;
CREATE POLICY "active users read quiz waiting chat"
ON public.quiz_waiting_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.status IN ('active', 'approved')
  )
);

DROP POLICY IF EXISTS "authenticated users write quiz waiting chat" ON public.quiz_waiting_messages;
CREATE POLICY "active users write open quiz waiting chat"
ON public.quiz_waiting_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid()
      AND assignment.status IN ('active', 'approved')
  )
  AND EXISTS (
    SELECT 1 FROM public.quiz_sessions session
    WHERE session.id = quiz_waiting_messages.quiz_session_id
      AND session.status <> 'closed'
  )
);
