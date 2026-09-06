/*
  Redemption Coin means account-age restoration.

  The original implementation materialized only streak-eligible historical
  days. That could produce a value based on the old streak calendar rather
  than the plain number of days the member has belonged to Full Circle. This
  trigger records an authoritative, audited baseline whenever a Redemption
  Coin is consumed. It also repairs Young Rabbi's already-consumed coin using
  the same rule and refreshes the public snapshot immediately.
*/

CREATE OR REPLACE FUNCTION public.apply_redemption_coin_account_age()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_join_date date;
  v_use_date date := (coalesce(NEW.created_at, now()) AT TIME ZONE 'Africa/Douala')::date;
  v_account_days integer;
BEGIN
  IF coalesce(NEW.effect_applied, '') NOT LIKE 'restore_join_streak:%' THEN
    RETURN NEW;
  END IF;

  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;

  IF v_join_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_account_days := greatest(1, v_use_date - v_join_date + 1);

  INSERT INTO public.streak_manual_adjustments AS adjustment (
    user_id,
    effective_date,
    current_streak,
    longest_streak,
    reason,
    created_at
  ) VALUES (
    NEW.user_id,
    v_use_date,
    v_account_days,
    v_account_days,
    'Redemption Coin restored streak to Full Circle account age',
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET effective_date = greatest(adjustment.effective_date, EXCLUDED.effective_date),
      current_streak = greatest(adjustment.current_streak, EXCLUDED.current_streak),
      longest_streak = greatest(
        adjustment.longest_streak,
        adjustment.current_streak,
        EXCLUDED.longest_streak,
        EXCLUDED.current_streak
      ),
      reason = CASE
        WHEN EXCLUDED.current_streak >= adjustment.current_streak THEN EXCLUDED.reason
        ELSE adjustment.reason
      END,
      created_at = now();

  PERFORM public.refresh_user_streak_snapshot(NEW.user_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_redemption_coin_account_age()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_redemption_coin_account_age()
  TO service_role;

DROP TRIGGER IF EXISTS apply_redemption_coin_account_age_after_use
  ON public.relic_usage_log;
CREATE TRIGGER apply_redemption_coin_account_age_after_use
AFTER INSERT ON public.relic_usage_log
FOR EACH ROW
EXECUTE FUNCTION public.apply_redemption_coin_account_age();

UPDATE public.relic_types
SET description = 'Restores your streak to the full number of days since you joined Full Circle. It cannot be bought with real money.'
WHERE slug = 'redemption-coin';

DO $$
DECLARE
  v_user_id uuid;
  v_join_date date;
  v_today date := timezone('Africa/Douala', now())::date;
  v_account_days integer;
BEGIN
  SELECT profile.id, (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_user_id, v_join_date
  FROM public.profiles profile
  WHERE regexp_replace(lower(btrim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'youngrabbi'
    AND EXISTS (
      SELECT 1
      FROM public.relic_usage_log usage
      JOIN public.relic_types relic ON relic.id = usage.relic_type_id
      WHERE usage.user_id = profile.id
        AND relic.slug = 'redemption-coin'
        AND coalesce(usage.effect_applied, '') LIKE 'restore_join_streak:%'
    )
  ORDER BY profile.created_at
  LIMIT 1;

  IF v_user_id IS NULL OR v_join_date IS NULL THEN
    RETURN;
  END IF;

  v_account_days := greatest(1, v_today - v_join_date + 1);

  INSERT INTO public.streak_manual_adjustments AS adjustment (
    user_id,
    effective_date,
    current_streak,
    longest_streak,
    reason,
    created_at
  ) VALUES (
    v_user_id,
    v_today,
    v_account_days,
    v_account_days,
    'Corrected Young Rabbi Redemption Coin to Full Circle account age',
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET effective_date = v_today,
      current_streak = greatest(adjustment.current_streak, v_account_days),
      longest_streak = greatest(adjustment.longest_streak, adjustment.current_streak, v_account_days),
      reason = 'Corrected Young Rabbi Redemption Coin to Full Circle account age',
      created_at = now();

  PERFORM public.refresh_user_streak_snapshot(v_user_id);
END;
$$;
