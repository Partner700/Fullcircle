-- A restoration made before today's meditation must not swallow the next
-- genuinely earned day. Credit it once, without inventing any earned evidence.
CREATE TABLE scripture_games.thief_recovery_day_credits(
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 record_date date NOT NULL,
 restored_streak integer NOT NULL,
 credited boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,record_date)
);
ALTER TABLE scripture_games.thief_recovery_day_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scripture_games.thief_recovery_day_credits FROM PUBLIC,anon,authenticated;
GRANT ALL ON scripture_games.thief_recovery_day_credits TO service_role;

CREATE FUNCTION public.credit_earned_day_after_thief_recovery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target integer;
BEGIN
 IF NEW.source_kind IN ('earned','restored') AND public.streak_requirement_met(NEW.user_id,NEW.achievement_date) THEN
  UPDATE scripture_games.thief_recovery_day_credits SET credited=true
  WHERE user_id=NEW.user_id AND record_date=NEW.achievement_date AND NOT credited RETURNING restored_streak+1 INTO target;
  IF FOUND THEN
   UPDATE public.streak_manual_adjustments SET current_streak=greatest(current_streak,target),
    longest_streak=greatest(longest_streak,target),created_at=clock_timestamp()
   WHERE user_id=NEW.user_id AND effective_date=NEW.achievement_date
    AND reason='The Thief''s Request restored previously earned streak days';
   IF FOUND THEN PERFORM public.refresh_user_streak_snapshot(NEW.user_id); END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.credit_earned_day_after_thief_recovery() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER credit_earned_day_after_thief_recovery AFTER INSERT ON public.streak_achievement_days
 FOR EACH ROW EXECUTE FUNCTION public.credit_earned_day_after_thief_recovery();

CREATE OR REPLACE FUNCTION public.use_streak_recovery_relic(p_relic_slug text)
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
 IF p_relic_slug='thieves-request' AND NOT public.streak_requirement_met(uid,v_today)
  AND NOT EXISTS(SELECT 1 FROM public.streak_achievement_days WHERE user_id=uid AND achievement_date=v_today AND source_kind IN ('earned','restored')) THEN
  INSERT INTO scripture_games.thief_recovery_day_credits(user_id,record_date,restored_streak)
  VALUES(uid,v_today,v_target) ON CONFLICT(user_id,record_date) DO NOTHING;
 END IF;
 INSERT INTO public.relic_usage_log(user_id,relic_type_id,effect_applied)
 VALUES(uid,v_relic.id,CASE WHEN p_relic_slug='redemption-coin' THEN 'restore_join_streak:' ELSE 'restore_earned_streak:' END||v_target);
 PERFORM public.refresh_user_streak_snapshot(uid);
 RETURN jsonb_build_object('success',true,'effect',CASE WHEN p_relic_slug='redemption-coin' THEN 'restore_join_streak' ELSE 'restore_earned_streak' END,
  'current_streak',v_target,'restored_days',v_target-v_current,'denarii_awarded',0,
  'message',v_relic.name||' restored your streak to '||v_target||' days.');
END $$;
REVOKE ALL ON FUNCTION public.use_streak_recovery_relic(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.use_streak_recovery_relic(text) TO authenticated;
