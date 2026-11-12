CREATE TABLE public.valediction_results (
  attempt_id uuid PRIMARY KEY REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  admitted_streak integer NOT NULL CHECK (admitted_streak >= 100),
  admitted_figs numeric NOT NULL CHECK (admitted_figs > 10000),
  correct_count integer,
  question_count integer,
  passed boolean NOT NULL DEFAULT false,
  graded_at timestamptz,
  CHECK (NOT passed OR (graded_at IS NOT NULL AND question_count > 0 AND correct_count * 100 >= question_count * 90))
);
ALTER TABLE public.valediction_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.valediction_results FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.valediction_results TO authenticated;
CREATE POLICY valediction_read_results ON public.valediction_results FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_instructor((SELECT auth.uid())));

CREATE FUNCTION public.get_my_valediction_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_streak integer; v_figs numeric; v_sentry boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to view Valediction eligibility.'; END IF;
  SELECT coalesce(current_streak,0) INTO v_streak FROM public.compute_strict_streak(auth.uid()) LIMIT 1;
  SELECT coalesce((SELECT sum(score) FROM public.game_attempts WHERE user_id=auth.uid()),0)
    + coalesce((SELECT sum(talents_scored) FROM public.quiz_attempts WHERE user_id=auth.uid()),0)
    + coalesce((SELECT sum(score) FROM public.arena_participants WHERE user_id=auth.uid()),0) INTO v_figs;
  SELECT EXISTS(SELECT 1 FROM public.role_assignments WHERE user_id=auth.uid() AND role='sentry' AND status IN ('active','approved')) INTO v_sentry;
  RETURN jsonb_build_object('eligible',coalesce(v_streak,0)>=100 AND v_figs>10000 AND NOT v_sentry,
    'streak',coalesce(v_streak,0),'figs',v_figs,'required_streak',100,'required_figs',10001,'is_sentry',v_sentry);
END; $$;
REVOKE ALL ON FUNCTION public.get_my_valediction_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_valediction_status() TO authenticated;
-- Valediction admission and grading are enforced in the database.
CREATE OR REPLACE FUNCTION public.process_automatic_sentry_promotion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := timezone('Africa/Douala', statement_timestamp())::date;
  v_week_key text;
  v_streak integer := 0;
  v_figs numeric := 0;
  v_relic_id uuid;
  v_is_sentry boolean := false;
  v_was_promoted boolean := false;
  v_weekly_granted boolean := false;
  v_grant_key text;
  v_grant_rows integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND coalesce(auth.role(), '') <> 'service_role'
     AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Only the account owner can process automatic promotion';
  END IF;

  v_week_key := to_char(v_today, 'IYYY-IW');

  SELECT coalesce(current_streak, 0) INTO v_streak
  FROM public.compute_strict_streak(p_user_id) LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = p_user_id AND role = 'sentry' AND status IN ('active', 'approved')
  ) INTO v_is_sentry;

  SELECT coalesce((SELECT sum(score) FROM public.game_attempts WHERE user_id = p_user_id), 0)
       + coalesce((SELECT sum(talents_scored) FROM public.quiz_attempts WHERE user_id = p_user_id), 0)
       + coalesce((SELECT sum(score) FROM public.arena_participants WHERE user_id = p_user_id), 0)
    INTO v_figs;

  IF NOT v_is_sentry AND NOT EXISTS (
    SELECT 1 FROM public.valediction_results WHERE user_id = p_user_id AND passed AND graded_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('eligible', v_streak >= 100 AND v_figs > 10000,
      'requires_valediction', true, 'promoted', false, 'streak', v_streak, 'figs', v_figs,
      'required_streak', 100, 'required_figs', 10001);
  END IF;

  IF NOT v_is_sentry THEN
    UPDATE public.role_assignments
    SET status = 'removed'
    WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active', 'approved');

    INSERT INTO public.role_assignments(user_id, role, status, approver_id, start_date)
    VALUES (p_user_id, 'sentry', 'active', NULL, v_today)
    ON CONFLICT DO NOTHING;

    v_is_sentry := true;
    v_was_promoted := true;
  END IF;

  SELECT id INTO v_relic_id
  FROM public.relic_types
  WHERE slug = 'masters-reward'
  LIMIT 1;

  IF v_relic_id IS NOT NULL THEN
    IF v_was_promoted THEN
      INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
      VALUES (p_user_id, 'promotion-masters-reward')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
      IF v_grant_rows > 0 THEN
        INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
        VALUES (p_user_id, v_relic_id, 5, 'Valediction Sentry promotion reward')
        ON CONFLICT (user_id, relic_type_id) DO UPDATE
          SET quantity = public.relic_inventory.quantity + 5,
              source_description = EXCLUDED.source_description;
      END IF;
    END IF;

    v_grant_key := 'weekly-masters-reward-' || v_week_key;
    INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
    VALUES (p_user_id, v_grant_key)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
    IF v_grant_rows > 0 THEN
      INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (p_user_id, v_relic_id, 3, 'Weekly Sentry Master''s Reward grant')
      ON CONFLICT (user_id, relic_type_id) DO UPDATE
        SET quantity = public.relic_inventory.quantity + 3,
            source_description = EXCLUDED.source_description;
      v_weekly_granted := true;
    END IF;
  END IF;

  v_grant_key := 'weekly-daily-freezers-' || v_week_key;
  INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
  VALUES (p_user_id, v_grant_key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
  IF v_grant_rows > 0 THEN
    INSERT INTO public.streak_freezers(user_id, freezer_type, source)
    SELECT p_user_id, 'daily', 'relic'
    FROM generate_series(1, 3);
    v_weekly_granted := true;
  END IF;

  IF v_was_promoted THEN
    PERFORM public.notify_user(
      p_user_id, NULL, 'promotion', 'You are now a Sentry',
      'You passed the Valediction quiz with at least 90% and are now a Sentry.',
      'dashboard', '{}'::jsonb
    );
  END IF;

  IF v_weekly_granted THEN
    PERFORM public.notify_user(
      p_user_id, NULL, 'relic_reward', 'Your weekly Sentry benefits are ready',
      'Three Daily Freezers and three Master''s Rewards are reserved for your service this week.',
      'store', jsonb_build_object('week', v_week_key, 'daily_freezers', 3, 'masters_rewards', 3)
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'promoted', v_was_promoted,
    'weekly_granted', v_weekly_granted,
    'streak', v_streak,
    'figs', v_figs,
    'required_streak', 100,
    'required_figs', 10001
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt_secure(p_attempt_id uuid, p_status text DEFAULT 'submitted'::text, p_use_goliath boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_figs integer := 0;
  v_reward integer := 0;
  v_perfect boolean := false;
  v_source_type text;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_day_type text;
  v_release_at timestamptz;
  v_results_released boolean := true;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_status NOT IN ('submitted', 'timed_out') THEN RAISE EXCEPTION 'Invalid completion status.'; END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz attempt not found.'; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  IF v_session.quiz_type = 'saturday' THEN
    v_release_at := (v_session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala';
    v_results_released := now() >= v_release_at;
  END IF;

  IF v_attempt.status IN ('submitted', 'timed_out') THEN
    IF v_session.quiz_type = 'saturday' AND v_results_released THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'attempt', to_jsonb(v_attempt),
      'already_submitted', true,
      'results_released', v_results_released,
      'release_at', v_release_at
    );
  END IF;
  IF v_attempt.status <> 'in_progress' THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE public.quiz_answer_is_correct(response.answer, question.question_payload)
    )::integer,
    coalesce(sum(CASE
      WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
        AND NOT coalesce(response.assisted_by_relic, false)
      THEN CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END
      ELSE 0
    END), 0)::integer
  INTO v_question_count, v_correct_count, v_figs
  FROM public.generated_questions question
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id
    AND response.quiz_attempt_id = v_attempt.id
  WHERE question.quiz_session_id = v_attempt.quiz_session_id;
  IF v_question_count = 0 THEN RAISE EXCEPTION 'This quiz has no questions.'; END IF;

  IF v_session.quiz_type = 'valediction' AND p_use_goliath THEN
    RAISE EXCEPTION 'Relics cannot be used in the Valediction quiz.';
  END IF;
  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory
    FROM public.relic_inventory
    WHERE user_id = v_user_id
      AND relic_type_id = v_relic.id
      AND quantity > 0
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;

    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, quiz_attempt_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_attempt.id, v_relic.id, 'perfect_quiz');
    v_correct_count := v_question_count;
    v_figs := 0;
  END IF;

  v_perfect := v_correct_count = v_question_count;
  v_reward := CASE
    WHEN v_perfect THEN coalesce(v_session.reward_perfect, 6000)
    WHEN v_correct_count > 0 THEN coalesce(v_session.reward_partial, 1000)
    ELSE 0
  END;
  IF v_session.quiz_type = 'valediction' THEN v_reward := 0; END IF;
  v_source_type := CASE
    WHEN v_session.quiz_type = 'fortune' THEN 'fortune_quiz_reward'
    ELSE 'quiz_reward'
  END;

  UPDATE public.quiz_attempts
  SET status = p_status,
      talents_scored = CASE WHEN v_session.quiz_type = 'saturday' THEN 0 ELSE v_figs END,
      highest_question_reached = greatest(highest_question_reached, v_question_count),
      submitted_at = now(),
      relics_used = CASE WHEN p_use_goliath
        THEN coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('slug', 'sword-goliath', 'used_at', now())
        )
        ELSE relics_used
      END
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_session.quiz_type = 'saturday' THEN
    INSERT INTO public.weekly_quiz_result_releases(
      attempt_id, user_id, quiz_session_id, correct_count, question_count,
      figs_earned, perfect, denarii_award, release_at
    ) VALUES (
      v_attempt.id, v_user_id, v_session.id, v_correct_count, v_question_count,
      v_figs, v_perfect, v_reward, v_release_at
    )
    ON CONFLICT (attempt_id) DO UPDATE
      SET correct_count = EXCLUDED.correct_count,
          question_count = EXCLUDED.question_count,
          figs_earned = EXCLUDED.figs_earned,
          perfect = EXCLUDED.perfect,
          denarii_award = EXCLUDED.denarii_award,
          release_at = EXCLUDED.release_at,
          released_at = NULL;

    IF v_results_released THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    END IF;
  ELSIF v_reward > 0 AND NOT EXISTS (
    SELECT 1
    FROM public.denarii_ledger_entries
    WHERE user_id = v_user_id
      AND source_type = v_source_type
      AND source_reference = v_attempt.id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries(
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id,
      v_reward,
      v_source_type,
      v_attempt.id::text,
      (CASE WHEN v_perfect
        THEN 'Perfect quiz score'
        ELSE v_correct_count || '/' || v_question_count || ' correct'
      END) || ' · ' || v_figs || ' figs'
    );
  END IF;

  IF v_session.quiz_type <> 'valediction' THEN
  v_day_type := CASE
    WHEN extract(dow FROM v_session.session_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_session.session_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  INSERT INTO public.daily_records(user_id, record_date, day_type, quiz_attempt_id, streak_valid)
  VALUES (
    v_user_id,
    v_session.session_date,
    v_day_type,
    v_attempt.id,
    CASE WHEN v_day_type = 'saturday' THEN true ELSE NULL END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE
    SET quiz_attempt_id = EXCLUDED.quiz_attempt_id,
        streak_valid = CASE
          WHEN EXCLUDED.day_type = 'saturday' THEN true
          ELSE public.daily_records.streak_valid
        END;

  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'attempt', to_jsonb(v_attempt),
    'results_released', v_results_released,
    'release_at', v_release_at,
    'correct_count', CASE WHEN v_results_released THEN v_correct_count ELSE NULL END,
    'question_count', CASE WHEN v_results_released THEN v_question_count ELSE NULL END,
    'figs', CASE WHEN v_results_released THEN v_figs ELSE NULL END,
    'perfect', CASE WHEN v_results_released THEN v_perfect ELSE NULL END,
    'denarii_awarded', CASE WHEN v_results_released THEN v_reward ELSE NULL END
  ));
END;
$function$;

-- No client can create admission or grading records directly.
CREATE FUNCTION public.enforce_valediction_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_type text; v_status jsonb;
BEGIN
  SELECT quiz_type INTO v_type FROM public.quiz_sessions WHERE id=NEW.quiz_session_id;
  IF v_type <> 'valediction' THEN RETURN NEW; END IF;
  IF auth.uid() IS DISTINCT FROM NEW.user_id OR NEW.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Start your Valediction quiz from your own account.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.role_assignments WHERE user_id=NEW.user_id AND role='cadet' AND status IN ('active','approved')) THEN
    RAISE EXCEPTION 'The Valediction quiz is for qualifying cadets.';
  END IF;
  v_status := public.get_my_valediction_status();
  IF NOT (v_status->>'eligible')::boolean THEN
    RAISE EXCEPTION 'Valediction requires 100 verified streak days and more than 10,000 figs.';
  END IF;
  INSERT INTO public.valediction_results(attempt_id,user_id,admitted_streak,admitted_figs)
  VALUES(NEW.id,NEW.user_id,(v_status->>'streak')::integer,(v_status->>'figs')::numeric);
  RETURN NEW;
END; $$;
CREATE TRIGGER valediction_admission AFTER INSERT ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.enforce_valediction_admission();
REVOKE ALL ON FUNCTION public.enforce_valediction_admission() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.grade_valediction_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total integer; v_correct integer;
BEGIN
  IF NEW.status NOT IN ('submitted','timed_out') OR OLD.status IN ('submitted','timed_out','forfeited') THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.quiz_sessions WHERE id=NEW.quiz_session_id AND quiz_type='valediction') THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.valediction_results WHERE attempt_id=NEW.id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Valediction admission was not verified.';
  END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE public.quiz_answer_is_correct(response.answer,question.question_payload)
    AND NOT coalesce(response.assisted_by_relic,false))::integer INTO v_total,v_correct
  FROM public.generated_questions question LEFT JOIN public.question_responses response
    ON response.question_id=question.id AND response.quiz_attempt_id=NEW.id
  WHERE question.quiz_session_id=NEW.quiz_session_id;
  IF v_total=0 THEN RAISE EXCEPTION 'Valediction has no questions.'; END IF;
  UPDATE public.valediction_results SET correct_count=v_correct,question_count=v_total,
    passed=(v_correct::numeric*100 >= v_total::numeric*90),graded_at=now() WHERE attempt_id=NEW.id;
  IF v_correct::numeric*100 >= v_total::numeric*90 THEN
    PERFORM public.process_automatic_sentry_promotion(NEW.user_id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER valediction_grading AFTER UPDATE OF status ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.grade_valediction_attempt();
REVOKE ALL ON FUNCTION public.grade_valediction_attempt() FROM PUBLIC, anon, authenticated;

-- Cover manual promotion RPCs and direct role writes as well as scheduled jobs.
CREATE FUNCTION public.require_valediction_for_sentry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.role='sentry' AND NEW.status IN ('active','approved') THEN
    IF TG_OP='UPDATE' AND OLD.user_id=NEW.user_id AND OLD.role='sentry' AND OLD.status IN ('active','approved') THEN RETURN NEW; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.valediction_results WHERE user_id=NEW.user_id AND passed AND graded_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Pass the Valediction quiz with at least 90%% before becoming a Sentry.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sentry_requires_valediction BEFORE INSERT OR UPDATE ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION public.require_valediction_for_sentry();
REVOKE ALL ON FUNCTION public.require_valediction_for_sentry() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.protect_valediction_session_type() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.quiz_type IS DISTINCT FROM NEW.quiz_type AND EXISTS(SELECT 1 FROM public.quiz_attempts WHERE quiz_session_id=NEW.id) THEN
    RAISE EXCEPTION 'A quiz type cannot change after attempts have started.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_valediction_type BEFORE UPDATE OF quiz_type ON public.quiz_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_valediction_session_type();
REVOKE ALL ON FUNCTION public.protect_valediction_session_type() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_current_quiz_session_for_type(p_quiz_type text)
RETURNS public.quiz_sessions LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT session FROM public.quiz_sessions session
  WHERE session.quiz_type=p_quiz_type AND p_quiz_type IN ('saturday','fortune','valediction') AND auth.uid() IS NOT NULL
  ORDER BY CASE WHEN session.status<>'scheduled' AND now()<session.live_closes_at THEN 0
    WHEN session.status='scheduled' AND session.session_date>=timezone('Africa/Douala',now())::date THEN 1 ELSE 2 END,
    CASE WHEN session.status<>'scheduled' THEN session.live_opens_at END DESC NULLS LAST,
    session.session_date DESC,session.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_current_quiz_session_for_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_quiz_session_for_type(text) TO authenticated;

CREATE FUNCTION public.block_valediction_relics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.quiz_attempts attempt JOIN public.quiz_sessions session ON session.id=attempt.quiz_session_id
    WHERE attempt.id=NEW.quiz_attempt_id AND session.quiz_type='valediction') THEN
    RAISE EXCEPTION 'Relics cannot be used in the Valediction quiz.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER no_valediction_relics BEFORE INSERT ON public.relic_usage_log
FOR EACH ROW EXECUTE FUNCTION public.block_valediction_relics();
REVOKE ALL ON FUNCTION public.block_valediction_relics() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.protect_valediction_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.quiz_session_id IS DISTINCT FROM NEW.quiz_session_id OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'An attempt cannot change its owner or quiz.';
  END IF;
  IF OLD.status IN ('submitted','timed_out','forfeited') AND NEW.status IS DISTINCT FROM OLD.status
    AND EXISTS(SELECT 1 FROM public.quiz_sessions WHERE id=OLD.quiz_session_id AND quiz_type='valediction') THEN
    RAISE EXCEPTION 'This Valediction attempt has ended. Wait for the next Valediction quiz.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER valediction_attempt_integrity BEFORE UPDATE ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.protect_valediction_attempt();
REVOKE ALL ON FUNCTION public.protect_valediction_attempt() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.process_automatic_sentry_promotion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_automatic_sentry_promotion(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_quiz_attempt_secure(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt_secure(uuid,text,boolean) TO authenticated;
