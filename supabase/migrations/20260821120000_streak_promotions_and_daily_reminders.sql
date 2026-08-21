/* Server-authoritative streak celebrations, Sentry promotion rewards, and
   idempotent daily reminder announcements. */

ALTER TABLE public.scheduled_announcements
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_date date;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_announcements_daily_reminder_key
  ON public.scheduled_announcements(announcement_type, reminder_date)
  WHERE reminder_date IS NOT NULL;

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;
ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call', 'midday_reminder', 'evening_reminder',
      'daily_game_reminder', 'quote_of_day', 'streakboard_release',
      'general', 'birthday', 'weekly_background'
    )
    OR announcement_type LIKE 'panel_image_%'
    OR announcement_type LIKE 'sound_%'
  );

CREATE TABLE IF NOT EXISTS public.automatic_sentry_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  grant_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, grant_key)
);
ALTER TABLE public.automatic_sentry_grants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.rare_relic_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_key text NOT NULL UNIQUE,
  relic_type_id uuid NOT NULL REFERENCES public.relic_types(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.grant_rare_game_relic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_relic_id uuid;
  v_source text;
BEGIN
  IF TG_TABLE_NAME = 'game_attempts' THEN
    IF NEW.status <> 'passed' OR (TG_OP = 'UPDATE' AND OLD.status = 'passed') THEN RETURN NEW; END IF;
    v_source := 'game:' || NEW.id::text;
  ELSE
    IF NEW.finished_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.finished_at IS NOT NULL) THEN RETURN NEW; END IF;
    v_source := 'arena:' || NEW.id::text;
  END IF;
  IF random() > 0.01 THEN RETURN NEW; END IF;
  SELECT id INTO v_relic_id FROM public.relic_types
  WHERE slug IN ('daily-freezer', 'weekly-freezer', 'goliath-sword', 'thiefs-request', 'simons-purse')
  ORDER BY random() LIMIT 1;
  IF v_relic_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.rare_relic_grants(user_id, source_key, relic_type_id)
  VALUES (NEW.user_id, v_source, v_relic_id)
  ON CONFLICT (source_key) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
    VALUES (NEW.user_id, v_relic_id, 1, 'Rare reward from ' || split_part(v_source, ':', 1))
    ON CONFLICT (user_id, relic_type_id) DO UPDATE
      SET quantity = public.relic_inventory.quantity + 1,
          source_description = EXCLUDED.source_description;
    PERFORM public.notify_user(NEW.user_id, NULL, 'relic_reward', 'Rare relic reward', 'A rare relic has been added to your inventory.', 'store', jsonb_build_object('relic_type_id', v_relic_id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_attempt_rare_relic_reward ON public.game_attempts;
CREATE TRIGGER game_attempt_rare_relic_reward AFTER INSERT OR UPDATE ON public.game_attempts
FOR EACH ROW EXECUTE FUNCTION public.grant_rare_game_relic();
DROP TRIGGER IF EXISTS arena_participant_rare_relic_reward ON public.arena_participants;
CREATE TRIGGER arena_participant_rare_relic_reward AFTER INSERT OR UPDATE ON public.arena_participants
FOR EACH ROW EXECUTE FUNCTION public.grant_rare_game_relic();

CREATE OR REPLACE FUNCTION public.process_automatic_sentry_promotion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_streak integer := 0;
  v_figs numeric := 0;
  v_relic_id uuid;
  v_is_sentry boolean := false;
  v_was_promoted boolean := false;
  v_grant_key text;
  v_grant_rows integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND coalesce(auth.role(), '') <> 'service_role'
     AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Only the account owner can process automatic promotion';
  END IF;
  SELECT COALESCE(current_streak, 0) INTO v_streak
  FROM public.compute_strict_streak(p_user_id) LIMIT 1;
  SELECT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = p_user_id AND role = 'sentry' AND status IN ('active', 'approved')
  ) INTO v_is_sentry;
  SELECT COALESCE((SELECT SUM(score) FROM public.game_attempts WHERE user_id = p_user_id), 0)
       + COALESCE((SELECT SUM(talents_scored) FROM public.quiz_attempts WHERE user_id = p_user_id), 0)
       + COALESCE((SELECT SUM(score) FROM public.arena_participants WHERE user_id = p_user_id), 0)
    INTO v_figs;

  IF v_streak < 60 OR v_figs <= 10000 THEN
    RETURN jsonb_build_object('eligible', false, 'streak', v_streak, 'figs', v_figs);
  END IF;

  IF NOT v_is_sentry THEN
    UPDATE public.role_assignments
    SET status = 'removed'
    WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active', 'approved');
    INSERT INTO public.role_assignments(user_id, role, status, approver_id, start_date)
    VALUES (p_user_id, 'sentry', 'active', NULL, current_date)
    ON CONFLICT DO NOTHING;
    v_was_promoted := true;
  END IF;

  SELECT id INTO v_relic_id FROM public.relic_types WHERE slug = 'masters-reward' LIMIT 1;
  IF v_relic_id IS NOT NULL THEN
    IF v_was_promoted THEN
      INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
      VALUES (p_user_id, 'promotion-masters-reward')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
      IF v_grant_rows > 0 THEN
        INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
        VALUES (p_user_id, v_relic_id, 5, 'Automatic Sentry promotion reward')
        ON CONFLICT (user_id, relic_type_id) DO UPDATE
          SET quantity = public.relic_inventory.quantity + 5,
              source_description = EXCLUDED.source_description;
      END IF;
    END IF;
    v_grant_key := 'weekly-masters-reward-' || to_char(current_date, 'IYYY-IW');
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
    END IF;
  END IF;
  IF v_was_promoted THEN
    PERFORM public.notify_user(p_user_id, NULL, 'promotion', 'You are now a Sentry', 'Your reading discipline and 10,000+ figs have earned you Sentry status.', 'dashboard', '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('eligible', true, 'promoted', v_was_promoted, 'streak', v_streak, 'figs', v_figs);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_automatic_sentry_promotions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid;
BEGIN
  FOR v_user IN
    SELECT DISTINCT ra.user_id FROM public.role_assignments ra
    WHERE ra.role = 'cadet' AND ra.status IN ('active', 'approved')
  LOOP
    PERFORM public.process_automatic_sentry_promotion(v_user);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_daily_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_day date := timezone('Africa/Douala', now())::date;
BEGIN
  INSERT INTO public.scheduled_announcements(announcement_type, publish_at, expires_at, reminder_date, audience, content, is_active)
  VALUES
    ('morning_call', (v_day + time '00:00') AT TIME ZONE 'Africa/Douala', (v_day + time '07:00') AT TIME ZONE 'Africa/Douala', v_day, 'Join the morning call and begin today together.', true),
    ('midday_reminder', (v_day + time '07:01') AT TIME ZONE 'Africa/Douala', (v_day + time '21:00') AT TIME ZONE 'Africa/Douala', v_day, 'Submit your daily meditation before 9:00 PM.', true),
    ('daily_game_reminder', (v_day + time '15:00') AT TIME ZONE 'Africa/Douala', (v_day + interval '1 day') AT TIME ZONE 'Africa/Douala', v_day, 'The daily games are open. Come play today.', true)
  ON CONFLICT (announcement_type, reminder_date) DO UPDATE
    SET publish_at = EXCLUDED.publish_at, expires_at = EXCLUDED.expires_at, content = EXCLUDED.content, is_active = true;
  PERFORM public.process_automatic_sentry_promotions();
END;
$$;

REVOKE ALL ON FUNCTION public.process_automatic_sentry_promotion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_automatic_sentry_promotion(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_automatic_sentry_promotions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_automatic_sentry_promotions() TO service_role;
REVOKE ALL ON FUNCTION public.ensure_daily_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_daily_reminders() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-daily-reminders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-daily-reminders');
    PERFORM cron.schedule('full-circle-daily-reminders', '0 23 * * *', 'SELECT public.ensure_daily_reminders();');
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;
