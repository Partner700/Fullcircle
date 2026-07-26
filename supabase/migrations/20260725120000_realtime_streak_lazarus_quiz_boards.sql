/*
# Realtime streak support, Lazarus Coin, and quiz boards

- Allows relics to explicitly have no cash price.
- Adds The Lazarus Coin as a 60,000D denarii-only streak resurrection relic.
- Blocks non-denarii purchases for relics with no real-money price.
- Adds a Saturday 3 PM quiz scoreboard.
- Updates tent-house standings to include cadet streak totals.
*/

ALTER TABLE public.relic_types
  ALTER COLUMN money_price_xaf DROP NOT NULL;

ALTER TABLE public.relic_types
  DROP CONSTRAINT IF EXISTS relic_types_money_price_xaf_positive;

ALTER TABLE public.relic_types
  DROP CONSTRAINT IF EXISTS relic_types_money_price_xaf_non_negative;

ALTER TABLE public.relic_types
  ADD CONSTRAINT relic_types_money_price_xaf_non_negative
  CHECK (money_price_xaf IS NULL OR money_price_xaf >= 0);

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
  'lazarus-coin',
  'The Lazarus Coin',
  'A denarii-only relic that resurrects a lost streak. It has no real-money equivalent.',
  'resurrect_lost_streak',
  'resurrect_lost_streak',
  'legendary',
  60000,
  NULL,
  NULL,
  'single_use',
  'coin'
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

CREATE OR REPLACE FUNCTION public.purchase_relic(p_user_id uuid, p_relic_slug text, p_currency text DEFAULT 'denarii')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  ELSE
    IF v_relic.money_price_xaf IS NULL OR v_relic.money_price_xaf <= 0 THEN
      RAISE EXCEPTION '% cannot be bought with real money.', v_relic.name;
    END IF;
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
        v_relic.name || ': retroactive ' || v_days_on_platform || ' days at perfect score'
      );
    END IF;

    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', v_relic.name || ': one talent awarded');

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
          WHEN v_lost_streak_date IS NOT NULL THEN v_relic.name || ' revived a lost streak and awarded one talent.'
          ELSE v_relic.name || ' awarded one talent. No lost streak was found to revive.'
        END
    );

  ELSIF v_relic.effect_type = 'resurrect_lost_streak' THEN
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
      'effect', 'resurrect_lost_streak',
      'streak_revived', v_lost_streak_date IS NOT NULL,
      'revived_date', v_lost_streak_date,
      'message',
        CASE
          WHEN v_lost_streak_date IS NOT NULL THEN 'The Lazarus Coin resurrected a lost streak.'
          ELSE 'The Lazarus Coin was used, but no lost streak was found to resurrect.'
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

GRANT EXECUTE ON FUNCTION public.purchase_relic(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_quiz_scoreboard();
CREATE OR REPLACE FUNCTION public.get_quiz_scoreboard()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  tent_house_id text,
  daily_game_score bigint,
  random_quiz_score numeric,
  saturday_quiz_score numeric,
  total_score numeric,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now()) AS local_now
  ),
  release AS (
    SELECT
      local_now,
      (local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::date AS week_start,
      (
        (local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::timestamp
        + time '15:00'
      ) AS released_at
    FROM clock
  ),
  cadets AS (
    SELECT DISTINCT ON (p.id)
      p.id AS user_id,
      p.display_name,
      t.tent_house_id
    FROM public.role_assignments ra
    JOIN public.profiles p ON p.id = ra.user_id
    LEFT JOIN public.tent_members tm ON tm.user_id = p.id AND tm.role = 'cadet'
    LEFT JOIN public.tents t ON t.id = tm.tent_id
    WHERE ra.role = 'cadet'
      AND ra.status IN ('active', 'approved')
    ORDER BY p.id, tm.joined_at DESC NULLS LAST
  ),
  game_scores AS (
    SELECT
      ga.user_id,
      COALESCE(SUM(ga.score), 0)::bigint AS score
    FROM public.game_attempts ga
    CROSS JOIN release r
    WHERE ga.completed_at IS NOT NULL
      AND ga.status IN ('passed', 'failed')
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY ga.user_id
  ),
  quiz_scores AS (
    SELECT
      qa.user_id,
      COALESCE(SUM(CASE WHEN qs.quiz_type = 'fortune' THEN qa.talents_scored ELSE 0 END), 0)::numeric AS random_score,
      COALESCE(SUM(CASE WHEN qs.quiz_type = 'saturday' THEN qa.talents_scored ELSE 0 END), 0)::numeric AS saturday_score
    FROM public.quiz_attempts qa
    JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
    CROSS JOIN release r
    WHERE qa.status IN ('submitted', 'timed_out')
      AND qa.submitted_at IS NOT NULL
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY qa.user_id
  ),
  totals AS (
    SELECT
      c.user_id,
      c.display_name,
      c.tent_house_id,
      COALESCE(gs.score, 0)::bigint AS daily_game_score,
      COALESCE(qs.random_score, 0)::numeric AS random_quiz_score,
      COALESCE(qs.saturday_score, 0)::numeric AS saturday_quiz_score,
      (COALESCE(gs.score, 0)::numeric + COALESCE(qs.random_score, 0) + COALESCE(qs.saturday_score, 0))::numeric AS total_score
    FROM cadets c
    LEFT JOIN game_scores gs ON gs.user_id = c.user_id
    LEFT JOIN quiz_scores qs ON qs.user_id = c.user_id
  )
  SELECT
    totals.user_id,
    totals.display_name,
    totals.tent_house_id,
    totals.daily_game_score,
    totals.random_quiz_score,
    totals.saturday_quiz_score,
    totals.total_score,
    RANK() OVER (ORDER BY totals.total_score DESC, totals.display_name ASC)::integer AS rank
  FROM totals
  CROSS JOIN release r
  WHERE r.local_now >= r.released_at
    AND totals.total_score > 0
  ORDER BY total_score DESC, display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_quiz_scoreboard() TO authenticated;

DROP FUNCTION IF EXISTS public.get_tent_house_leaderboard();
CREATE OR REPLACE FUNCTION public.get_tent_house_leaderboard()
RETURNS TABLE (
  tent_house_id text,
  tent_house_name text,
  total_denarii bigint,
  total_streak bigint,
  combined_score bigint,
  cadet_count integer,
  sentry_names text[],
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH house_cadets AS (
    SELECT DISTINCT
      t.tent_house_id,
      tm.user_id
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    WHERE tm.role = 'cadet'
  ),
  cadet_metrics AS (
    SELECT
      hc.tent_house_id,
      hc.user_id,
      COALESCE(public.get_user_denarii_total(hc.user_id), 0)::bigint AS total_denarii,
      COALESCE(ss.current_streak, 0)::bigint AS current_streak
    FROM house_cadets hc
    LEFT JOIN LATERAL public.compute_strict_streak(hc.user_id) ss ON true
  ),
  cadet_totals AS (
    SELECT
      cm.tent_house_id,
      COALESCE(SUM(cm.total_denarii), 0)::bigint AS total_denarii,
      COALESCE(SUM(cm.current_streak), 0)::bigint AS total_streak,
      COUNT(DISTINCT cm.user_id)::integer AS cadet_count
    FROM cadet_metrics cm
    GROUP BY cm.tent_house_id
  ),
  sentry_lists AS (
    SELECT
      t.tent_house_id,
      ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS sentry_names
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.role = 'sentry'
    GROUP BY t.tent_house_id
  ),
  standings AS (
    SELECT
      th.id AS tent_house_id,
      th.name AS tent_house_name,
      COALESCE(ct.total_denarii, 0)::bigint AS total_denarii,
      COALESCE(ct.total_streak, 0)::bigint AS total_streak,
      (COALESCE(ct.total_denarii, 0) + COALESCE(ct.total_streak, 0) * 1000)::bigint AS combined_score,
      COALESCE(ct.cadet_count, 0)::integer AS cadet_count,
      COALESCE(sl.sentry_names, ARRAY[]::text[]) AS sentry_names
    FROM public.tent_houses th
    LEFT JOIN cadet_totals ct ON ct.tent_house_id = th.id
    LEFT JOIN sentry_lists sl ON sl.tent_house_id = th.id
  )
  SELECT
    standings.tent_house_id,
    standings.tent_house_name,
    standings.total_denarii,
    standings.total_streak,
    standings.combined_score,
    standings.cadet_count,
    standings.sentry_names,
    RANK() OVER (ORDER BY standings.combined_score DESC, standings.tent_house_name ASC)::integer AS rank
  FROM standings
  ORDER BY combined_score DESC, tent_house_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_tent_house_leaderboard() TO authenticated;
