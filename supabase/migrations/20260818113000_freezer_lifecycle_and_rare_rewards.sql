/*
  Authoritative freezer lifecycle and rare gameplay rewards.

  - Daily protection activates at 21:00 Africa/Douala for 24 hours.
  - Weekly protection activates only when no daily freezer is available and
    protects seven consecutive dates.
  - The protected date remains part of the streak after the visible activation
    window closes; otherwise the streak would disappear a day later.
  - Game and Arena reward rolls are deterministic and idempotent.
*/

ALTER TABLE public.streak_freezers
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS protection_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS protected_through_date date;

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;
ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN (
    'denarii', 'payment', 'relic', 'redemption', 'simons_purse',
    'thiefs_request', 'game_reward', 'arena_reward'
  ));

ALTER TABLE public.denarii_purchases
  DROP CONSTRAINT IF EXISTS denarii_purchases_purchase_type_check;
ALTER TABLE public.denarii_purchases
  ADD CONSTRAINT denarii_purchases_purchase_type_check
  CHECK (purchase_type IN ('hint', 'answer_reveal', 'freezer_daily', 'freezer_weekly'));

UPDATE public.streak_freezers
SET protected_through_date = coalesce(protected_through_date, applied_to_date)
WHERE applied_to_date IS NOT NULL;

UPDATE public.streak_freezers
SET activated_at = coalesce(activated_at, purchased_at),
    protection_ends_at = coalesce(
      protection_ends_at,
      CASE
        WHEN expires_at IS NOT NULL THEN (expires_at::timestamp + time '23:59:59') AT TIME ZONE 'Africa/Douala'
        ELSE purchased_at + interval '7 days'
      END
    ),
    protected_through_date = coalesce(
      protected_through_date,
      applied_to_date,
      expires_at::date
    )
WHERE source = 'simons_purse';

CREATE OR REPLACE FUNCTION public.streak_day_is_protected(p_user_id uuid, p_record_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.streak_freezers protection
    WHERE protection.user_id = p_user_id
      AND protection.used_at IS NULL
      AND protection.applied_to_date IS NOT NULL
      AND p_record_date BETWEEN protection.applied_to_date
        AND coalesce(protection.protected_through_date, protection.applied_to_date)
  );
$$;

REVOKE ALL ON FUNCTION public.streak_day_is_protected(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_day_is_protected(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_streak_freezer_for_date(p_user_id uuid, p_record_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz := (p_record_date::timestamp + time '21:00') AT TIME ZONE 'Africa/Douala';
  v_freezer public.streak_freezers%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR extract(dow FROM p_record_date) NOT BETWEEN 1 AND 5 THEN RETURN false; END IF;
  -- Toolbar/stat RPCs can arrive together. Serialize activation per user so
  -- concurrent reads cannot consume two freezers for the same missed day.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  IF now() < v_deadline OR public.streak_requirement_met(p_user_id, p_record_date) THEN RETURN false; END IF;
  IF public.streak_day_is_protected(p_user_id, p_record_date) THEN RETURN true; END IF;

  -- Daily freezers always have priority.
  SELECT * INTO v_freezer
  FROM public.streak_freezers freezer
  WHERE freezer.user_id = p_user_id
    AND freezer.freezer_type = 'daily'
    AND freezer.used_at IS NULL
    AND freezer.applied_to_date IS NULL
    AND freezer.purchased_at <= v_deadline
  ORDER BY freezer.purchased_at, freezer.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.streak_freezers
    SET applied_to_date = p_record_date,
        protected_through_date = p_record_date,
        activated_at = v_deadline,
        protection_ends_at = v_deadline + interval '24 hours',
        expires_at = (p_record_date + 1)
    WHERE id = v_freezer.id;
    RETURN true;
  END IF;

  -- A weekly freezer is used only when no daily freezer can protect this day.
  SELECT * INTO v_freezer
  FROM public.streak_freezers freezer
  WHERE freezer.user_id = p_user_id
    AND freezer.freezer_type = 'weekly'
    AND freezer.used_at IS NULL
    AND freezer.applied_to_date IS NULL
    AND freezer.purchased_at <= v_deadline
  ORDER BY freezer.purchased_at, freezer.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.streak_freezers
    SET applied_to_date = p_record_date,
        protected_through_date = p_record_date + 6,
        activated_at = v_deadline,
        protection_ends_at = v_deadline + interval '7 days',
        expires_at = p_record_date + 7
    WHERE id = v_freezer.id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_streak_freezer_for_date(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_streak_freezer_for_date(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date; v_check date; v_baseline_date date;
  v_baseline_current integer := 0; v_baseline_longest integer := 0;
  v_eligible boolean; v_complete boolean;
  v_current integer := 0; v_longest integer := 0;
  v_consecutive integer := 0; v_cumulative integer := 0;
BEGIN
  SELECT LEAST(
    coalesce((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    coalesce((SELECT min(record.record_date) FROM public.daily_records record
      WHERE record.user_id = p_user_id), v_today)
  ) INTO v_start FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_start IS NULL THEN RETURN QUERY SELECT 0, 0, 0, 0; RETURN; END IF;

  SELECT snapshot.snapshot_date, coalesce(snapshot.current_streak, 0),
    greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
  INTO v_baseline_date, v_baseline_current, v_baseline_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id AND coalesce(snapshot.current_streak, 0) > 0
    AND snapshot.snapshot_date < v_today
  ORDER BY snapshot.current_streak DESC, snapshot.snapshot_date DESC, snapshot.created_at DESC
  LIMIT 1;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    IF v_baseline_date IS NOT NULL AND v_check = v_baseline_date THEN
      v_current := greatest(v_current, v_baseline_current);
      v_longest := greatest(v_longest, v_baseline_longest, v_current);
      v_consecutive := 0; v_check := v_check + 1; CONTINUE;
    END IF;

    v_complete := public.streak_requirement_met(p_user_id, v_check);
    IF NOT v_complete THEN
      v_complete := public.streak_day_is_protected(p_user_id, v_check);
    END IF;

    v_eligible := CASE
      WHEN extract(dow FROM v_check) = 0 THEN v_complete
      WHEN extract(dow FROM v_check) = 6 THEN EXISTS (SELECT 1 FROM public.quiz_sessions session
        WHERE session.session_date = v_check AND session.quiz_type = 'saturday') OR v_complete
      ELSE true
    END;
    IF NOT v_eligible THEN v_check := v_check + 1; CONTINUE; END IF;
    IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
      v_check := v_check + 1; CONTINUE;
    END IF;

    IF NOT v_complete AND v_current > 0 AND extract(dow FROM v_check) BETWEEN 1 AND 5 THEN
      v_complete := public.activate_streak_freezer_for_date(p_user_id, v_check);
    END IF;

    IF v_complete THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSE
      v_current := 0;
      v_consecutive := v_consecutive + 1;
      v_cumulative := v_cumulative + 1;
    END IF;
    v_check := v_check + 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_authoritative_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now())::date AS today,
      timezone('Africa/Douala', now())::time AS local_time
  ), strict AS (
    SELECT * FROM public.compute_strict_streak(p_user_id) LIMIT 1
  ), baseline AS (
    SELECT snapshot.snapshot_date, snapshot.current_streak, snapshot.longest_streak
    FROM public.streakboard_snapshots snapshot CROSS JOIN clock
    WHERE snapshot.user_id = p_user_id AND snapshot.snapshot_date >= clock.today - 30
      AND snapshot.snapshot_date < clock.today
    ORDER BY snapshot.current_streak DESC, snapshot.snapshot_date DESC, snapshot.created_at DESC LIMIT 1
  ), post_days AS (
    SELECT day::date AS record_date FROM baseline CROSS JOIN clock
    CROSS JOIN LATERAL generate_series(baseline.snapshot_date + 1, clock.today, interval '1 day') day
  ), day_state AS (
    SELECT post_days.record_date,
      (extract(dow FROM post_days.record_date) BETWEEN 1 AND 5
        OR (extract(dow FROM post_days.record_date) = 0 AND post_days.record_date >= date '2026-08-02')
        OR (extract(dow FROM post_days.record_date) = 6 AND EXISTS (SELECT 1 FROM public.quiz_sessions session
          WHERE session.session_date = post_days.record_date AND session.quiz_type = 'saturday'))) AS eligible,
      (public.streak_requirement_met(p_user_id, post_days.record_date)
        OR public.streak_day_is_protected(p_user_id, post_days.record_date)) AS credited
    FROM post_days
  ), post_summary AS (
    SELECT count(*) FILTER (WHERE day_state.eligible AND day_state.credited)::integer AS credited_days,
      bool_or(day_state.eligible AND NOT day_state.credited AND
        (day_state.record_date < clock.today OR clock.local_time >= time '21:00')) AS has_break
    FROM day_state CROSS JOIN clock
  ), resolved AS (
    SELECT CASE WHEN baseline.snapshot_date IS NOT NULL AND NOT coalesce(post_summary.has_break, false)
      THEN greatest(coalesce(strict.current_streak, 0),
        coalesce(baseline.current_streak, 0) + coalesce(post_summary.credited_days, 0))
      ELSE coalesce(strict.current_streak, 0) END::integer AS current_streak,
      coalesce(strict.longest_streak, 0)::integer AS strict_longest,
      coalesce(baseline.longest_streak, 0)::integer AS baseline_longest,
      coalesce(strict.consecutive_inactive, 0)::integer AS consecutive_inactive,
      coalesce(strict.cumulative_inactive, 0)::integer AS cumulative_inactive
    FROM (VALUES (1)) seed(value) LEFT JOIN strict ON true LEFT JOIN baseline ON true LEFT JOIN post_summary ON true
  )
  SELECT resolved.current_streak,
    greatest(resolved.strict_longest, resolved.baseline_longest, resolved.current_streak)::integer,
    resolved.consecutive_inactive, resolved.cumulative_inactive FROM resolved;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_streak(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_streak_protection_state()
RETURNS TABLE(
  active boolean,
  protection_kind text,
  freezer_type text,
  activated_at timestamptz,
  protection_ends_at timestamptz,
  applied_to_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.compute_strict_streak(v_user_id);
  RETURN QUERY
  SELECT true,
    CASE WHEN freezer.source = 'simons_purse' THEN 'simons_purse' ELSE 'freezer' END,
    freezer.freezer_type, freezer.activated_at, freezer.protection_ends_at, freezer.applied_to_date
  FROM public.streak_freezers freezer
  WHERE freezer.user_id = v_user_id
    AND freezer.applied_to_date IS NOT NULL
    AND freezer.protection_ends_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM generate_series(
        freezer.applied_to_date + 1,
        timezone('Africa/Douala', now())::date,
        interval '1 day'
      ) day
      WHERE public.streak_requirement_met(v_user_id, day::date)
    )
  ORDER BY CASE WHEN freezer.source = 'simons_purse' THEN 0 ELSE 1 END,
    freezer.activated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::date;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_streak_protection_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_streak_protection_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_daily_freezer_secure()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid := auth.uid(); v_cost integer := 6000; v_balance bigint; v_freezer_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO v_balance FROM public.denarii_ledger_entries WHERE user_id = v_user_id;
  IF v_balance < v_cost THEN RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_cost, v_balance; END IF;
  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, description)
  VALUES (v_user_id, -v_cost, 'freezer_daily', 'Daily streak freezer purchased');
  INSERT INTO public.streak_freezers(user_id, freezer_type, source)
  VALUES (v_user_id, 'daily', 'denarii') RETURNING id INTO v_freezer_id;
  INSERT INTO public.denarii_purchases(user_id, purchase_type, amount, reference_id)
  VALUES (v_user_id, 'freezer_daily', v_cost, v_freezer_id::text);
  RETURN jsonb_build_object('success', true, 'freezer_id', v_freezer_id, 'cost', v_cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_weekly_freezer_secure()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid := auth.uid(); v_cost integer := 18000; v_balance bigint; v_freezer_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO v_balance FROM public.denarii_ledger_entries WHERE user_id = v_user_id;
  IF v_balance < v_cost THEN RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_cost, v_balance; END IF;
  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, description)
  VALUES (v_user_id, -v_cost, 'freezer_weekly', 'Weekly streak freezer purchased');
  INSERT INTO public.streak_freezers(user_id, freezer_type, source)
  VALUES (v_user_id, 'weekly', 'denarii') RETURNING id INTO v_freezer_id;
  INSERT INTO public.denarii_purchases(user_id, purchase_type, amount, reference_id)
  VALUES (v_user_id, 'freezer_weekly', v_cost, v_freezer_id::text);
  RETURN jsonb_build_object('success', true, 'freezer_id', v_freezer_id, 'cost', v_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_daily_freezer_secure() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_weekly_freezer_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_daily_freezer_secure() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_weekly_freezer_secure() TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_daily_freezer_for_cadet(p_sentry_id uuid, p_cadet_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance numeric; v_cost integer := 6000; v_cadet_name text;
BEGIN
  PERFORM public.assert_sentry_can_gift_cadet(p_sentry_id, p_cadet_id);
  SELECT coalesce(sum(amount), 0) INTO v_balance FROM public.denarii_ledger_entries WHERE user_id = p_sentry_id;
  IF v_balance < v_cost THEN RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_cost, v_balance; END IF;
  SELECT display_name INTO v_cadet_name FROM public.profiles WHERE id = p_cadet_id;
  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, description)
  VALUES (p_sentry_id, -v_cost, 'freezer_daily', 'Gifted a daily freezer to ' || coalesce(v_cadet_name, 'cadet'));
  INSERT INTO public.streak_freezers(user_id, freezer_type, source) VALUES (p_cadet_id, 'daily', 'denarii');
  INSERT INTO public.denarii_purchases(user_id, purchase_type, amount) VALUES (p_sentry_id, 'freezer_daily', v_cost);
  PERFORM public.notify_user(p_cadet_id, p_sentry_id, 'streak', 'Freezer gift received',
    'Your sentry gifted you a daily streak freezer.', 'streak', jsonb_build_object('gifted_by', p_sentry_id));
  RETURN jsonb_build_object('success', true, 'recipient_id', p_cadet_id, 'freezer_type', 'daily');
END;
$$;
GRANT EXECUTE ON FUNCTION public.purchase_daily_freezer_for_cadet(uuid, uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.gameplay_relic_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  context_type text NOT NULL CHECK (context_type IN ('daily_game', 'arena')),
  context_id uuid NOT NULL,
  reward_slug text NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(context_type, context_id, user_id)
);
ALTER TABLE public.gameplay_relic_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gameplay_relic_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gameplay_relic_rewards TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_rare_gameplay_reward(
  p_user_id uuid, p_context_type text, p_context_id uuid
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roll integer;
  v_slug text;
  v_relic public.relic_types%ROWTYPE;
  v_threshold_daily integer;
  v_threshold_weekly integer;
  v_threshold_sword integer;
  v_threshold_thief integer;
BEGIN
  IF p_user_id IS NULL OR p_context_type NOT IN ('daily_game', 'arena') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.gameplay_relic_rewards reward
    WHERE reward.context_type = p_context_type AND reward.context_id = p_context_id AND reward.user_id = p_user_id) THEN
    RETURN NULL;
  END IF;
  v_roll := mod(hashtext(p_context_type || ':' || p_context_id::text || ':' || p_user_id::text)::bigint + 2147483648, 10000)::integer;
  IF p_context_type = 'arena' THEN
    v_threshold_daily := 1000; v_threshold_weekly := 1300; v_threshold_sword := 1350; v_threshold_thief := 1370;
  ELSE
    v_threshold_daily := 500; v_threshold_weekly := 650; v_threshold_sword := 675; v_threshold_thief := 685;
  END IF;
  v_slug := CASE
    WHEN v_roll < v_threshold_daily THEN 'daily-freezer'
    WHEN v_roll < v_threshold_weekly THEN 'weekly-freezer'
    WHEN v_roll < v_threshold_sword THEN 'sword-goliath'
    WHEN v_roll < v_threshold_thief THEN 'thieves-request'
    ELSE NULL END;
  IF v_slug IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.gameplay_relic_rewards(user_id, context_type, context_id, reward_slug)
  VALUES (p_user_id, p_context_type, p_context_id, v_slug)
  ON CONFLICT (context_type, context_id, user_id) DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_slug IN ('daily-freezer', 'weekly-freezer') THEN
    INSERT INTO public.streak_freezers(user_id, freezer_type, source)
    VALUES (p_user_id, CASE WHEN v_slug = 'daily-freezer' THEN 'daily' ELSE 'weekly' END, p_context_type || '_reward');
  ELSE
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = v_slug;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
    VALUES (p_user_id, v_relic.id, 1, initcap(replace(p_context_type, '_', ' ')) || ' rare reward')
    ON CONFLICT (user_id, relic_type_id) DO UPDATE
      SET quantity = public.relic_inventory.quantity + 1,
          source_description = EXCLUDED.source_description;
  END IF;

  PERFORM public.notify_user(p_user_id, NULL, 'reward', 'Rare reward found',
    CASE v_slug WHEN 'daily-freezer' THEN 'You found a Daily Freezer.'
      WHEN 'weekly-freezer' THEN 'You found a Weekly Freezer.'
      WHEN 'sword-goliath' THEN 'A rare Sword of Goliath was added to your relics.'
      ELSE 'A very rare Thief''s Request was added to your relics.' END,
    'store', jsonb_build_object('context_type', p_context_type, 'context_id', p_context_id, 'reward_slug', v_slug));
  RETURN v_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_rare_gameplay_reward(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_rare_gameplay_reward(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.award_daily_game_relic_drop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'passed' AND NEW.mode <> 'practice' THEN
    PERFORM public.grant_rare_gameplay_reward(NEW.user_id, 'daily_game', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS award_daily_game_relic_drop ON public.game_attempts;
CREATE TRIGGER award_daily_game_relic_drop AFTER INSERT ON public.game_attempts
FOR EACH ROW EXECUTE FUNCTION public.award_daily_game_relic_drop();

CREATE OR REPLACE FUNCTION public.award_arena_relic_drop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.winner_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'completed')
    ) THEN
    PERFORM public.grant_rare_gameplay_reward(NEW.winner_id, 'arena', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS award_arena_relic_drop ON public.arena_rooms;
DROP TRIGGER IF EXISTS award_arena_relic_drop_insert ON public.arena_rooms;
DROP TRIGGER IF EXISTS award_arena_relic_drop_update ON public.arena_rooms;
CREATE TRIGGER award_arena_relic_drop_insert AFTER INSERT ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.award_arena_relic_drop();
CREATE TRIGGER award_arena_relic_drop_update AFTER UPDATE OF status, winner_id ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.award_arena_relic_drop();
