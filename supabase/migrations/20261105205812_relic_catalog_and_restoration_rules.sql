-- Retain referenced inventory and audit records, while withdrawing these relics
-- from the active catalogue and preventing further purchases or consumption.
ALTER TABLE public.relic_types ADD COLUMN is_active boolean NOT NULL DEFAULT true;
UPDATE public.relic_types SET is_active=false,denarii_cost=NULL,money_price_xaf=NULL,money_price_usd=NULL
WHERE slug IN ('eliminate','hint','talking-donkey','simons-coin');
UPDATE public.relic_types SET denarii_cost=CASE slug
 WHEN 'thieves-request' THEN 100000 WHEN 'redemption-coin' THEN 300000
 WHEN 'sword-goliath' THEN 6000 WHEN 'freeze-timer' THEN 600 END
WHERE slug IN ('thieves-request','redemption-coin','sword-goliath','freeze-timer');
UPDATE public.relic_types SET description='Restores all streak days you previously earned and lost. It does not grant days you never earned.' WHERE slug='thieves-request';
UPDATE public.relic_types SET description='Restores your streak to every day from your Full Circle joining date through today, including days you missed.' WHERE slug='redemption-coin';

CREATE FUNCTION public.guard_retired_relic_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.quantity>0) OR (TG_OP='UPDATE' AND NEW.quantity IS DISTINCT FROM OLD.quantity) THEN
  IF EXISTS(SELECT 1 FROM public.relic_types WHERE id=NEW.relic_type_id AND NOT is_active) THEN
   RAISE EXCEPTION 'This relic has been removed from the catalogue and can no longer be purchased or used.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_retired_relic_inventory() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_retired_relic_inventory BEFORE INSERT OR UPDATE ON public.relic_inventory
 FOR EACH ROW EXECUTE FUNCTION public.guard_retired_relic_inventory();

CREATE FUNCTION public.use_streak_recovery_relic(p_relic_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 uid uuid:=auth.uid(); v_today date:=timezone('Africa/Douala',now())::date;
 v_join date; v_relic public.relic_types; v_current integer; v_longest integer;
 v_target integer; v_earned integer; v_baseline integer; v_anchor date;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_relic_slug NOT IN ('thieves-request','redemption-coin') OR p_relic_slug IS NULL THEN RAISE EXCEPTION 'Choose a streak recovery relic.'; END IF;
 SELECT timezone('Africa/Douala',created_at)::date INTO v_join FROM public.profiles WHERE id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found.'; END IF;
 SELECT * INTO v_relic FROM public.relic_types WHERE slug=p_relic_slug AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.relic_inventory WHERE user_id=uid AND relic_type_id=v_relic.id AND quantity>0) THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
 SELECT current_streak,longest_streak INTO v_current,v_longest FROM public.compute_strict_streak(uid);
 v_current:=coalesce(v_current,0);v_longest:=coalesce(v_longest,0);
 IF p_relic_slug='redemption-coin' THEN
  v_target:=greatest(1,v_today-v_join+1);
 ELSE
  -- Count each genuinely earned/verified day once, across every broken streak.
  WITH earned_dates AS (
   SELECT achievement_date AS day FROM public.streak_achievement_days WHERE user_id=uid AND source_kind IN ('earned','restored') AND achievement_date<=v_today
   UNION
   SELECT day::date FROM generate_series(v_join,v_today,interval '1 day') day WHERE public.streak_requirement_met(uid,day::date)
  ) SELECT count(*)::integer INTO v_earned FROM earned_dates;
  -- Reviewed pre-ledger evidence establishes a minimum, never an account-age
  -- restoration or a purchased-day balance.
  SELECT minimum_qualifying_days,effective_date INTO v_baseline,v_anchor
  FROM public.streak_achievement_baselines WHERE user_id=uid
   AND coalesce(source_reference,'') !~* 'redemption|purchased|simons|simon.s|thief';
  IF FOUND THEN
   WITH earned_dates AS (
    SELECT achievement_date AS day FROM public.streak_achievement_days WHERE user_id=uid AND source_kind IN ('earned','restored') AND achievement_date<=v_today
    UNION SELECT day::date FROM generate_series(v_join,v_today,interval '1 day') day WHERE public.streak_requirement_met(uid,day::date)
   ) SELECT greatest(v_earned,v_baseline+count(*)::integer) INTO v_earned FROM earned_dates WHERE day>v_anchor;
  END IF;
  v_target:=v_earned;
 END IF;
 IF v_target<=v_current THEN
  RETURN jsonb_build_object('success',false,'restored_days',0,'message','There are no additional streak days to restore. Your relic was not used.');
 END IF;
 UPDATE public.relic_inventory SET quantity=quantity-1 WHERE user_id=uid AND relic_type_id=v_relic.id AND quantity>0;
 INSERT INTO public.streak_manual_adjustments(user_id,effective_date,current_streak,longest_streak,reason,created_at)
 VALUES(uid,v_today,v_target,greatest(v_target,v_longest),CASE WHEN p_relic_slug='redemption-coin' THEN 'Redemption Coin restored streak to Full Circle account age' ELSE 'The Thief''s Request restored previously earned streak days' END,clock_timestamp())
 ON CONFLICT(user_id) DO UPDATE SET effective_date=EXCLUDED.effective_date,current_streak=EXCLUDED.current_streak,
 longest_streak=greatest(public.streak_manual_adjustments.longest_streak,EXCLUDED.longest_streak),reason=EXCLUDED.reason,created_at=EXCLUDED.created_at;
 INSERT INTO public.relic_usage_log(user_id,relic_type_id,effect_applied)
 VALUES(uid,v_relic.id,CASE WHEN p_relic_slug='redemption-coin' THEN 'restore_join_streak:' ELSE 'restore_earned_streak:' END||v_target);
 PERFORM public.refresh_user_streak_snapshot(uid);
 RETURN jsonb_build_object('success',true,'effect',CASE WHEN p_relic_slug='redemption-coin' THEN 'restore_join_streak' ELSE 'restore_earned_streak' END,
  'current_streak',v_target,'restored_days',v_target-v_current,'denarii_awarded',0,
  'message',v_relic.name||' restored your streak to '||v_target||' days.');
END $$;
REVOKE ALL ON FUNCTION public.use_streak_recovery_relic(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.use_streak_recovery_relic(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inventory public.relic_inventory%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_today date := timezone('Africa/Douala', now())::date;
  v_join_date date;
  v_last_recoverable_date date;
  v_lost_streak_date date;
  v_recover_date date;
  v_restored_days integer := 0;
  v_days_on_platform integer := 0;
  v_retroactive_denarii integer := 0;
  v_talent_denarii integer := 6000;
  v_saturday_date date;
  v_protected_date date;
  v_inserted_days integer := 0;
  v_row_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics.';
  END IF;

  IF p_relic_slug IN ('thieves-request','redemption-coin') THEN
    RETURN public.use_streak_recovery_relic(p_relic_slug);
  END IF;

  IF p_relic_slug = 'simons-purse' THEN
    RETURN public.activate_simons_purse(p_user_id);
  END IF;

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  IF v_relic.effect_type NOT IN (
    'revive_lost_streak',
    'resurrect_lost_streak',
    'restore_join_streak',
    'streak_shield_week',
    'grant_one_talent'
  ) THEN
    RAISE EXCEPTION 'This relic is used inside a game or quiz, not from the Market.';
  END IF;

  SELECT * INTO v_inventory
  FROM public.relic_inventory
  WHERE user_id = p_user_id
    AND relic_type_id = v_relic.id
    AND quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;

  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles profile
  WHERE profile.id = p_user_id;
  v_join_date := COALESCE(v_join_date, v_today);
  v_last_recoverable_date := v_today
    - CASE WHEN timezone('Africa/Douala', now())::time >= time '21:00' THEN 0 ELSE 1 END;

  IF v_relic.effect_type IN ('revive_lost_streak', 'resurrect_lost_streak') THEN
    v_lost_streak_date := public.find_latest_recoverable_streak_gap(
      p_user_id,
      v_last_recoverable_date
    );

    IF v_lost_streak_date IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', v_relic.effect_type,
        'streak_revived', false,
        'message', 'No unrepaired streak-breaking day was found. Your relic was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inventory.id;

    INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
    SELECT p_user_id, 'weekly', 'relic', v_lost_streak_date
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.streak_freezers existing
      WHERE existing.user_id = p_user_id
        AND existing.used_at IS NULL
        AND existing.applied_to_date = v_lost_streak_date
    );

    IF v_relic.effect_type = 'revive_lost_streak' THEN
      v_days_on_platform := greatest(v_last_recoverable_date - v_join_date, 0);
      v_retroactive_denarii := v_days_on_platform * 650;
      IF v_retroactive_denarii > 0 THEN
        INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
        VALUES (p_user_id, v_retroactive_denarii, 'relic_reward', v_relic.name || ': retroactive reward');
      END IF;
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (p_user_id, v_talent_denarii, 'relic_reward', v_relic.name || ': one talent awarded');
    END IF;

    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (p_user_id, v_relic.id, v_relic.effect_type || ':' || v_lost_streak_date::text);

    RETURN jsonb_build_object(
      'success', true,
      'effect', v_relic.effect_type,
      'streak_revived', true,
      'revived_date', v_lost_streak_date,
      'denarii_awarded', CASE
        WHEN v_relic.effect_type = 'revive_lost_streak' THEN v_retroactive_denarii + v_talent_denarii
        ELSE 0
      END,
      'message', v_relic.name || ' repaired the streak-breaking day of '
        || to_char(v_lost_streak_date, 'DD Mon YYYY') || '.'
    );
  END IF;

  IF v_relic.effect_type = 'restore_join_streak' THEN
    FOR v_recover_date IN
      SELECT day::date
      FROM generate_series(v_join_date, v_last_recoverable_date, interval '1 day') AS day
      WHERE (
        extract(dow FROM day) BETWEEN 1 AND 5
        OR (
          extract(dow FROM day) = 6
          AND EXISTS (
            SELECT 1 FROM public.quiz_sessions session
            WHERE session.session_date = day::date
              AND session.quiz_type = 'saturday'
          )
        )
      )
      AND NOT public.streak_requirement_met(p_user_id, day::date)
      AND NOT EXISTS (
        SELECT 1 FROM public.streak_freezers saved
        WHERE saved.user_id = p_user_id
          AND saved.used_at IS NULL
          AND saved.applied_to_date = day::date
      )
    LOOP
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'redemption', v_recover_date);
      v_restored_days := v_restored_days + 1;
    END LOOP;

    IF v_restored_days = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', 'restore_join_streak',
        'restored_days', 0,
        'message', 'There are no eligible missed streak days to restore. Your coin was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (p_user_id, v_relic.id, 'restore_join_streak:' || v_restored_days::text);

    RETURN jsonb_build_object(
      'success', true,
      'effect', 'restore_join_streak',
      'restored_days', v_restored_days,
      'message', 'Redemption Coin restored ' || v_restored_days
        || ' eligible streak day(s) from your Full Circle history.'
    );
  END IF;

  IF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := v_today + ((6 - extract(dow FROM v_today)::integer + 7) % 7);
    IF v_saturday_date = v_today THEN v_saturday_date := v_today + 7; END IF;
    v_protected_date := v_today;
    WHILE v_inserted_days < 5 LOOP
      v_protected_date := v_protected_date + 1;
      EXIT WHEN v_protected_date >= v_saturday_date;
      IF extract(dow FROM v_protected_date) BETWEEN 1 AND 5 THEN
        INSERT INTO public.streak_freezers (
          user_id, freezer_type, source, applied_to_date, expires_at
        )
        SELECT
          p_user_id, 'daily', 'relic', v_protected_date, v_saturday_date
        WHERE NOT EXISTS (
          SELECT 1 FROM public.streak_freezers existing
          WHERE existing.user_id = p_user_id
            AND existing.used_at IS NULL
            AND existing.applied_to_date = v_protected_date
        );
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_inserted_days := v_inserted_days + v_row_count;
      END IF;
    END LOOP;

    IF v_inserted_days = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', 'streak_shield_week',
        'protected_days', 0,
        'message', 'There are no unprotected weekdays before Saturday. Your relic was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (p_user_id, v_relic.id, 'streak_shield_week:' || v_inserted_days::text);

    RETURN jsonb_build_object(
      'success', true,
      'effect', 'streak_shield_week',
      'protected_days', v_inserted_days,
      'message', 'Simon''s Purse protected up to five upcoming weekdays.'
    );
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inventory.id;
  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Master''s Reward: one talent awarded');
  INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
  VALUES (p_user_id, v_relic.id, 'grant_one_talent');

  RETURN jsonb_build_object(
    'success', true,
    'effect', 'grant_one_talent',
    'denarii_awarded', v_talent_denarii,
    'message', 'The Master''s Reward awarded one talent.'
  );
END;
$function$

