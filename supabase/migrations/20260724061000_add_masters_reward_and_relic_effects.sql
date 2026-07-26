/*
# Master's Reward and active relic effects

- Adds Master's Reward as a cash-only relic that awards one talent (6,000D).
- Redefines Sword of Goliath as a perfect-score relic for daily levels/quizzes.
- Adds one talent (6,000D) to The Thief's Request when used.
- Rejects Denarii purchases for cash-only relics at the RPC level.
*/

ALTER TABLE public.denarii_ledger_entries
  DROP CONSTRAINT IF EXISTS denarii_ledger_entries_source_type_check;

ALTER TABLE public.denarii_ledger_entries
  ADD CONSTRAINT denarii_ledger_entries_source_type_check
  CHECK (source_type IN (
    'game_level', 'game_blitz', 'quiz_reward', 'fortune_quiz_reward',
    'relic_purchase', 'relic_reward', 'admin_adjustment',
    'hint_purchase', 'answer_reveal', 'freezer_daily', 'freezer_weekly',
    'attendance', 'arena_stake', 'arena_fee', 'arena_reward',
    'mobile_money', 'campay_payment'
  ));

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;

ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN ('denarii', 'payment', 'relic'));

INSERT INTO public.relic_types (
  slug,
  name,
  description,
  effect,
  effect_type,
  rarity,
  denarii_cost,
  money_price_usd,
  money_price_xaf,
  effect_scope,
  icon
)
VALUES (
  'masters-reward',
  'The Master''s Reward',
  'Well done, good and faithful servant. Use this relic to receive one talent: 6,000 denarii.',
  'grant_one_talent',
  'grant_one_talent',
  'legendary',
  NULL,
  ROUND(25::numeric / 575, 2),
  25,
  'single_use',
  'trophy'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  effect = EXCLUDED.effect,
  effect_type = EXCLUDED.effect_type,
  rarity = EXCLUDED.rarity,
  denarii_cost = EXCLUDED.denarii_cost,
  money_price_usd = EXCLUDED.money_price_usd,
  money_price_xaf = EXCLUDED.money_price_xaf,
  effect_scope = EXCLUDED.effect_scope,
  icon = EXCLUDED.icon;

UPDATE public.relic_types
SET
  name = 'Sword of Goliath',
  description = 'No sword like it. Use it during a daily level or live quiz to receive a perfect score for that level or quiz.',
  effect = 'perfect_score',
  effect_type = 'perfect_score',
  effect_scope = 'level_or_quiz'
WHERE slug = 'sword-goliath';

UPDATE public.relic_types
SET
  description = 'Remember me when you come into your kingdom. Revives a lost streak and awards one talent: 6,000 denarii.',
  effect = 'revive_lost_streak',
  effect_type = 'revive_lost_streak'
WHERE slug = 'thieves-request';

CREATE OR REPLACE FUNCTION public.purchase_relic(p_user_id uuid, p_relic_slug text, p_currency text DEFAULT 'denarii')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_relic RECORD;
  v_balance numeric;
  v_existing RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relic not found';
  END IF;

  IF p_currency = 'denarii' THEN
    IF v_relic.denarii_cost IS NULL OR v_relic.denarii_cost <= 0 THEN
      RAISE EXCEPTION '% cannot be bought with denarii.', v_relic.name;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.denarii_ledger_entries
    WHERE user_id = p_user_id;

    IF v_balance < v_relic.denarii_cost THEN
      RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_relic.denarii_cost, v_balance;
    END IF;

    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, -v_relic.denarii_cost, 'relic_purchase', 'Purchased ' || v_relic.name);
  END IF;

  SELECT * INTO v_existing
  FROM public.relic_inventory
  WHERE user_id = p_user_id AND relic_type_id = v_relic.id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.relic_inventory SET quantity = quantity + 1 WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.relic_inventory (user_id, relic_type_id, quantity, source_description)
    VALUES (p_user_id, v_relic.id, 1, 'Purchased with ' || p_currency);
  END IF;

  v_result := jsonb_build_object('success', true, 'method', p_currency, 'relic_id', v_relic.id::text);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inv RECORD;
  v_relic RECORD;
  v_result jsonb;
  v_days_on_platform integer := 0;
  v_retroactive_denarii integer := 0;
  v_talent_denarii integer := 6000;
  v_first_record RECORD;
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
    SELECT MIN(record_date::date) INTO v_first_record
    FROM public.daily_records
    WHERE user_id = p_user_id;

    IF v_first_record IS NOT NULL THEN
      v_days_on_platform := CURRENT_DATE - v_first_record.record_date::date;
      v_retroactive_denarii := v_days_on_platform * 650;
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

    INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
    SELECT p_user_id, 'weekly', 'relic', d.record_date
    FROM public.daily_records d
    WHERE d.user_id = p_user_id
      AND d.meditation_submitted = false
      AND d.record_date = (
        SELECT MAX(record_date)
        FROM public.daily_records
        WHERE user_id = p_user_id AND meditation_submitted = false
      )
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', CURRENT_DATE - 1);
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'revive_lost_streak',
      'retroactive_denarii', v_retroactive_denarii,
      'talent_denarii', v_talent_denarii,
      'denarii_awarded', v_retroactive_denarii + v_talent_denarii,
      'days_on_platform', v_days_on_platform,
      'message', 'The Thief''s Request restored protection and awarded one talent.'
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

GRANT EXECUTE ON FUNCTION public.purchase_relic(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
