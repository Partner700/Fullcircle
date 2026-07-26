/*
# Instructor Mobile Money, Sentry, Leaderboard, and Builder Fixes

1. Fix Mobile Money RLS by using the canonical is_instructor() role helper.
2. Add payout settings and payout tracking columns.
3. Add trusted RPCs for saving Mobile Money settings and assigning cadets to tents.
4. Include active sentries in the live denarii board.
5. Keep The Thief's Request from creating a streak revival where no lost streak exists.
*/

-- Mobile Money payout settings and payment payout tracking
ALTER TABLE public.mobile_money_settings
  ADD COLUMN IF NOT EXISTS payout_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payout_provider_name text,
  ADD COLUMN IF NOT EXISTS payout_phone_number text,
  ADD COLUMN IF NOT EXISTS payout_account_name text,
  ADD COLUMN IF NOT EXISTS payout_max_amount_xaf integer;

UPDATE public.mobile_money_settings
SET
  payout_provider_name = COALESCE(payout_provider_name, provider_name),
  payout_phone_number = COALESCE(payout_phone_number, phone_number),
  payout_account_name = COALESCE(payout_account_name, account_name)
WHERE id = 1;

ALTER TABLE public.mobile_money_payments
  ADD COLUMN IF NOT EXISTS payout_status text DEFAULT 'not_attempted',
  ADD COLUMN IF NOT EXISTS payout_reference text,
  ADD COLUMN IF NOT EXISTS payout_amount_xaf integer,
  ADD COLUMN IF NOT EXISTS payout_error text,
  ADD COLUMN IF NOT EXISTS payout_attempted_at timestamptz;

ALTER TABLE public.mobile_money_payments
  DROP CONSTRAINT IF EXISTS mobile_money_payments_payout_status_check;
ALTER TABLE public.mobile_money_payments
  ADD CONSTRAINT mobile_money_payments_payout_status_check
  CHECK (payout_status IS NULL OR payout_status IN ('not_attempted', 'pending', 'successful', 'failed'));

-- Correct Mobile Money policies. Earlier policies looked for instructors inside tent_members.
DROP POLICY IF EXISTS "select_own_mobile_payments" ON public.mobile_money_payments;
CREATE POLICY "select_own_mobile_payments" ON public.mobile_money_payments FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS "instructor_update_mobile_payments" ON public.mobile_money_payments;
CREATE POLICY "instructor_update_mobile_payments" ON public.mobile_money_payments FOR UPDATE
  TO authenticated USING (public.is_instructor(auth.uid()))
  WITH CHECK (public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS "instructor_insert_mobile_money_settings" ON public.mobile_money_settings;
CREATE POLICY "instructor_insert_mobile_money_settings" ON public.mobile_money_settings FOR INSERT
  TO authenticated WITH CHECK (public.is_instructor(auth.uid()));

DROP POLICY IF EXISTS "instructor_update_mobile_money_settings" ON public.mobile_money_settings;
CREATE POLICY "instructor_update_mobile_money_settings" ON public.mobile_money_settings FOR UPDATE
  TO authenticated USING (public.is_instructor(auth.uid()))
  WITH CHECK (public.is_instructor(auth.uid()));

CREATE OR REPLACE FUNCTION public.save_mobile_money_settings(
  p_provider_name text,
  p_phone_number text,
  p_account_name text,
  p_instructions text DEFAULT NULL,
  p_payout_enabled boolean DEFAULT true,
  p_payout_provider_name text DEFAULT NULL,
  p_payout_phone_number text DEFAULT NULL,
  p_payout_account_name text DEFAULT NULL,
  p_payout_max_amount_xaf integer DEFAULT NULL
)
RETURNS public.mobile_money_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.mobile_money_settings%ROWTYPE;
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can save Mobile Money settings';
  END IF;

  INSERT INTO public.mobile_money_settings (
    id,
    provider_name,
    phone_number,
    account_name,
    instructions,
    payout_enabled,
    payout_provider_name,
    payout_phone_number,
    payout_account_name,
    payout_max_amount_xaf,
    updated_at
  )
  VALUES (
    1,
    COALESCE(NULLIF(trim(p_provider_name), ''), 'MTN MoMo'),
    COALESCE(trim(p_phone_number), ''),
    COALESCE(trim(p_account_name), ''),
    NULLIF(trim(COALESCE(p_instructions, '')), ''),
    COALESCE(p_payout_enabled, true),
    COALESCE(NULLIF(trim(COALESCE(p_payout_provider_name, '')), ''), COALESCE(NULLIF(trim(p_provider_name), ''), 'MTN MoMo')),
    COALESCE(NULLIF(trim(COALESCE(p_payout_phone_number, '')), ''), COALESCE(trim(p_phone_number), '')),
    COALESCE(NULLIF(trim(COALESCE(p_payout_account_name, '')), ''), COALESCE(trim(p_account_name), '')),
    CASE WHEN COALESCE(p_payout_max_amount_xaf, 0) > 0 THEN p_payout_max_amount_xaf ELSE NULL END,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    provider_name = EXCLUDED.provider_name,
    phone_number = EXCLUDED.phone_number,
    account_name = EXCLUDED.account_name,
    instructions = EXCLUDED.instructions,
    payout_enabled = EXCLUDED.payout_enabled,
    payout_provider_name = EXCLUDED.payout_provider_name,
    payout_phone_number = EXCLUDED.payout_phone_number,
    payout_account_name = EXCLUDED.payout_account_name,
    payout_max_amount_xaf = EXCLUDED.payout_max_amount_xaf,
    updated_at = now()
  RETURNING * INTO v_settings;

  RETURN v_settings;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_mobile_money_settings(text, text, text, text, boolean, text, text, text, integer) TO authenticated;

-- Trusted cadet-to-tent assignment. Keeps one cadet membership per cadet and enforces tent capacity.
ALTER TABLE public.tents ADD COLUMN IF NOT EXISTS max_cadets int NOT NULL DEFAULT 5;

CREATE OR REPLACE FUNCTION public.assign_cadet_to_tent(p_tent_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_cadets integer;
  v_current_cadets integer;
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can assign cadets to tents';
  END IF;

  SELECT COALESCE(max_cadets, 5) INTO v_max_cadets
  FROM public.tents
  WHERE id = p_tent_id;
  IF v_max_cadets IS NULL THEN
    RAISE EXCEPTION 'Tent not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments
    WHERE user_id = p_user_id
      AND role = 'cadet'
      AND status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'User is not an active cadet';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tent_members
    WHERE tent_id = p_tent_id AND user_id = p_user_id AND role = 'cadet'
  ) THEN
    RETURN true;
  END IF;

  DELETE FROM public.tent_members
  WHERE user_id = p_user_id AND role = 'cadet';

  SELECT count(*) INTO v_current_cadets
  FROM public.tent_members
  WHERE tent_id = p_tent_id AND role = 'cadet';

  IF v_current_cadets >= v_max_cadets THEN
    RAISE EXCEPTION 'Tent is full (max % cadets)', v_max_cadets;
  END IF;

  INSERT INTO public.tent_members (tent_id, user_id, role)
  VALUES (p_tent_id, p_user_id, 'cadet')
  ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'cadet';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_cadet_to_tent(p_tent_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assign_cadet_to_tent(p_tent_id, p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_cadet_to_tent(uuid, uuid) TO authenticated;

-- Live leaderboard: include sentries too so thin cohorts do not look empty.
DROP FUNCTION IF EXISTS public.get_leaderboard_live();
CREATE OR REPLACE FUNCTION public.get_leaderboard_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  role text,
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  total_denarii bigint,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_people AS (
    SELECT DISTINCT ON (ra.user_id)
      ra.user_id,
      ra.role
    FROM public.role_assignments ra
    WHERE ra.role IN ('cadet', 'sentry')
      AND ra.status IN ('active', 'approved')
    ORDER BY ra.user_id, CASE WHEN ra.role = 'sentry' THEN 0 ELSE 1 END, ra.created_at DESC
  ),
  totals AS (
    SELECT
      ap.user_id,
      p.display_name,
      ap.role,
      tm.tent_id,
      t.name AS tent_name,
      t.tent_house_id,
      public.get_user_denarii_total(ap.user_id)::bigint AS total_denarii
    FROM active_people ap
    JOIN public.profiles p ON p.id = ap.user_id
    LEFT JOIN LATERAL (
      SELECT tm2.tent_id
      FROM public.tent_members tm2
      WHERE tm2.user_id = ap.user_id
      ORDER BY CASE WHEN tm2.role = 'sentry' THEN 0 ELSE 1 END, tm2.joined_at DESC
      LIMIT 1
    ) tm ON true
    LEFT JOIN public.tents t ON t.id = tm.tent_id
  )
  SELECT
    totals.user_id,
    totals.display_name,
    totals.role,
    totals.tent_id,
    totals.tent_name,
    totals.tent_house_id,
    totals.total_denarii,
    RANK() OVER (ORDER BY totals.total_denarii DESC, totals.display_name ASC)::integer AS rank
  FROM totals
  ORDER BY total_denarii DESC, display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_live() TO authenticated;

-- Thief's Request: do not create protection for a streak that never existed.
CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_relic RECORD;
  v_result jsonb;
  v_days_on_platform integer := 0;
  v_retroactive_denarii integer := 0;
  v_talent_denarii integer := 6000;
  v_first_record_date date;
  v_lost_streak_date date;
  v_saturday_date date;
BEGIN
  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relic not found';
  END IF;

  SELECT * INTO v_inv
  FROM public.relic_inventory
  WHERE user_id = p_user_id AND relic_type_id = v_relic.id AND quantity > 0
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this relic';
  END IF;

  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inv.id;

  IF v_relic.effect_type = 'revive_lost_streak' THEN
    SELECT MIN(record_date::date) INTO v_first_record_date
    FROM public.daily_records
    WHERE user_id = p_user_id;

    IF v_first_record_date IS NOT NULL THEN
      v_days_on_platform := CURRENT_DATE - v_first_record_date;
      v_retroactive_denarii := GREATEST(v_days_on_platform, 0) * 650;
    END IF;

    IF v_retroactive_denarii > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (
        p_user_id,
        v_retroactive_denarii,
        'relic_reward',
        'Thief''s Request: retroactive ' || v_days_on_platform || ' days at perfect score'
      );
    END IF;

    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Thief''s Request: one talent awarded');

    SELECT MAX(d.record_date::date) INTO v_lost_streak_date
    FROM public.daily_records d
    WHERE d.user_id = p_user_id
      AND COALESCE(d.meditation_submitted, false) = false
      AND EXISTS (
        SELECT 1
        FROM public.daily_records prior
        WHERE prior.user_id = p_user_id
          AND prior.record_date < d.record_date
          AND COALESCE(prior.meditation_submitted, false) = true
      );

    IF v_lost_streak_date IS NOT NULL THEN
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', v_lost_streak_date);
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'revive_lost_streak',
      'retroactive_denarii', v_retroactive_denarii,
      'talent_denarii', v_talent_denarii,
      'denarii_awarded', v_retroactive_denarii + v_talent_denarii,
      'days_on_platform', v_days_on_platform,
      'streak_revived', v_lost_streak_date IS NOT NULL,
      'revived_date', v_lost_streak_date,
      'message',
        CASE
          WHEN v_lost_streak_date IS NOT NULL THEN 'The Thief''s Request revived a lost streak and awarded one talent.'
          ELSE 'The Thief''s Request awarded one talent. No lost streak was found to revive.'
        END
    );

  ELSIF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := CURRENT_DATE + ((6 - EXTRACT(DOW FROM CURRENT_DATE)::int + 7) % 7);
    IF v_saturday_date = CURRENT_DATE THEN
      v_saturday_date := CURRENT_DATE + 7;
    END IF;

    INSERT INTO public.streak_freezers (user_id, freezer_type, source, expires_at)
    SELECT p_user_id, 'daily', 'relic', v_saturday_date FROM generate_series(1, 7);

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'streak_shield_week',
      'expires_on', v_saturday_date::text,
      'message', 'Simon''s Purse added seven daily freezers.'
    );

  ELSIF v_relic.effect_type = 'grant_one_talent' THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Master''s Reward: one talent awarded');

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'grant_one_talent',
      'denarii_awarded', v_talent_denarii,
      'message', 'The Master''s Reward awarded one talent.'
    );

  ELSE
    v_result := jsonb_build_object('success', true, 'effect', v_relic.effect_type);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
