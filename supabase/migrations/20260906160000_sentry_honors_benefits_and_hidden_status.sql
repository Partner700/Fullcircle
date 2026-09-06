/* Keep the standing Vallum above weekly honors, grant every active Sentry's
   weekly role benefits exactly once, and expose creator-owned hidden-item
   placement/outcome summaries without exposing answers. */

CREATE OR REPLACE FUNCTION public.get_current_avatar_awards()
RETURNS TABLE (user_id uuid, award_type text, title text, cadence text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', statement_timestamp())::date AS today
  ), available_cycles AS (
    SELECT
      coalesce(
        max(award.award_month) FILTER (
          WHERE award.award_month ~ '^[0-9]{4}-[0-9]{2}$'
            AND award.award_month <= to_char(clock.today, 'YYYY-MM')
        ),
        to_char(clock.today, 'YYYY-MM')
      ) AS month_cycle,
      coalesce(
        max(award.award_month) FILTER (
          WHERE award.award_month ~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND award.award_month <= 'week-' || to_char(clock.today - (extract(isodow FROM clock.today)::integer - 1), 'YYYY-MM-DD')
        ),
        'week-' || to_char(clock.today - (extract(isodow FROM clock.today)::integer - 1), 'YYYY-MM-DD')
      ) AS week_cycle
    FROM clock
    LEFT JOIN public.awards award ON true
    GROUP BY clock.today
  ), standing_vallum AS (
    SELECT max(award.award_month) AS cycle
    FROM public.awards award
    CROSS JOIN clock
    WHERE award.award_month ~ '^[0-9]{4}-[0-9]{2}$'
      AND award.award_month <= to_char(clock.today, 'YYYY-MM')
      AND (
        lower(btrim(award.award_type)) = 'vallum'
        OR (
          lower(btrim(award.title)) LIKE '%vallum%'
          AND lower(btrim(award.title)) NOT LIKE '%grand vallum%'
        )
      )
  ), eligible AS (
    SELECT
      coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END) AS recipient_id,
      award.award_type,
      award.title,
      CASE WHEN award.award_month ~ '^[0-9]{4}-[0-9]{2}$' THEN 'monthly' ELSE 'weekly' END AS cadence,
      row_number() OVER (
        PARTITION BY coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END)
        ORDER BY
          CASE WHEN award.award_month ~ '^[0-9]{4}-[0-9]{2}$' THEN 2 ELSE 1 END DESC,
          CASE
            WHEN lower(btrim(award.title)) = 'grand vallum' THEN 110
            WHEN lower(btrim(award.title)) LIKE '%vallum%' THEN 100
            WHEN lower(btrim(award.title)) LIKE '%muralis%' THEN 92
            WHEN lower(btrim(award.title)) LIKE '%centurion%' THEN 90
            WHEN lower(btrim(award.title)) LIKE '%monthly scribe%' THEN 85
            WHEN lower(btrim(award.title)) LIKE '%monthly valley champion%' THEN 84
            WHEN lower(btrim(award.title)) LIKE '%angel%' THEN 70
            WHEN lower(btrim(award.title)) LIKE '%rumor%' THEN 68
            WHEN lower(btrim(award.title)) LIKE '%scribe%' THEN 66
            ELSE 50
          END DESC,
          award.created_at DESC,
          award.id DESC
      ) AS choice
    FROM public.awards award
    CROSS JOIN available_cycles cycles
    CROSS JOIN standing_vallum vallum
    WHERE coalesce(award.award_target_type, 'cadet') <> 'tent'
      AND (
        award.award_month IN (cycles.month_cycle, cycles.week_cycle)
        OR (
          award.award_month = vallum.cycle
          AND (
            lower(btrim(award.award_type)) = 'vallum'
            OR (
              lower(btrim(award.title)) LIKE '%vallum%'
              AND lower(btrim(award.title)) NOT LIKE '%grand vallum%'
            )
          )
        )
      )
      AND coalesce(award.user_id, award.award_target_id) IS NOT NULL
  )
  SELECT recipient_id, award_type, title, cadence
  FROM eligible
  WHERE choice = 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_avatar_awards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_avatar_awards() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_automatic_sentry_promotion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT v_is_sentry AND (v_streak < 60 OR v_figs <= 10000) THEN
    RETURN jsonb_build_object('eligible', false, 'streak', v_streak, 'figs', v_figs);
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
        VALUES (p_user_id, v_relic_id, 5, 'Automatic Sentry promotion reward')
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
      'Your reading discipline and 10,000+ figs have earned you Sentry status.',
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
    'figs', v_figs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_automatic_sentry_promotions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  FOR v_user IN
    SELECT DISTINCT assignment.user_id
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
  LOOP
    PERFORM public.process_automatic_sentry_promotion(v_user);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.process_automatic_sentry_promotion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_automatic_sentry_promotion(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_automatic_sentry_promotions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_automatic_sentry_promotions() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_hidden_challenge_status()
RETURNS TABLE (
  challenge_id uuid,
  claim_id uuid,
  item_type text,
  placement text,
  reference_key text,
  challenge_status text,
  claim_status text,
  created_at timestamptz,
  expires_at timestamptz,
  original_target_id uuid,
  original_target_name text,
  original_target_avatar_url text,
  current_target_id uuid,
  current_target_name text,
  current_target_avatar_url text,
  transfer_count integer,
  last_outcome text,
  latest_outcome text,
  latest_actor_name text,
  latest_answered_at timestamptz,
  denarii_paid integer,
  reward_denarii integer,
  reward_relic_name text,
  reward_relic_quantity integer,
  reward_freezer_type text,
  reward_freezer_quantity integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.expire_hidden_challenges(auth.uid());

  RETURN QUERY
  SELECT
    challenge.id,
    claim.id,
    challenge.item_type,
    claim.placement,
    claim.reference_key,
    challenge.status,
    claim.status,
    challenge.created_at,
    challenge.expires_at,
    claim.original_target_id,
    original_profile.display_name,
    original_profile.avatar_url,
    claim.current_target_id,
    current_profile.display_name,
    current_profile.avatar_url,
    claim.transfer_count,
    claim.last_outcome,
    latest.outcome,
    latest_profile.display_name,
    latest.answered_at,
    coalesce(latest.denarii_paid, 0),
    challenge.reward_denarii,
    relic.name,
    challenge.reward_relic_quantity,
    challenge.reward_freezer_type,
    challenge.reward_freezer_quantity
  FROM public.hidden_challenges challenge
  JOIN public.hidden_challenge_claims claim ON claim.challenge_id = challenge.id
  JOIN public.profiles original_profile ON original_profile.id = claim.original_target_id
  JOIN public.profiles current_profile ON current_profile.id = claim.current_target_id
  LEFT JOIN LATERAL (
    SELECT attempt.user_id, attempt.outcome, attempt.answered_at,
           attempt.denarii_paid, attempt.reward_denarii
    FROM public.hidden_challenge_attempts attempt
    WHERE attempt.claim_id = claim.id
    ORDER BY attempt.transfer_number DESC, attempt.answered_at DESC, attempt.id DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN public.profiles latest_profile ON latest_profile.id = latest.user_id
  LEFT JOIN public.relic_types relic ON relic.id = challenge.reward_relic_type_id
  WHERE challenge.creator_id = auth.uid()
  ORDER BY challenge.created_at DESC, claim.created_at, claim.id
  LIMIT 60;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_hidden_challenge_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_hidden_challenge_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_hidden_challenge_creator_of_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge public.hidden_challenges%ROWTYPE;
  v_claim public.hidden_challenge_claims%ROWTYPE;
  v_actor_name text;
  v_title text;
  v_body text;
BEGIN
  SELECT challenge.* INTO v_challenge
  FROM public.hidden_challenges challenge
  WHERE challenge.id = NEW.challenge_id;

  IF NOT FOUND OR v_challenge.creator_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT claim.* INTO v_claim
  FROM public.hidden_challenge_claims claim
  WHERE claim.id = NEW.claim_id;

  SELECT profile.display_name INTO v_actor_name
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;

  IF v_challenge.item_type = 'treasure' THEN
    IF NEW.outcome = 'correct' THEN
      v_title := 'Your Treasure was unlocked';
      v_body := coalesce(v_actor_name, 'A recipient') || ' answered correctly and received the Treasure.';
    ELSE
      v_title := 'Your Treasure was not unlocked';
      v_body := coalesce(v_actor_name, 'A recipient')
        || CASE NEW.outcome WHEN 'wrong' THEN ' answered incorrectly.' ELSE ' left the question.' END;
    END IF;
  ELSE
    IF NEW.outcome = 'correct' THEN
      v_title := 'Someone escaped your Mine';
      v_body := coalesce(v_actor_name, 'A recipient') || ' answered correctly and escaped without paying.';
    ELSE
      v_title := 'Your Mine was triggered';
      v_body := coalesce(v_actor_name, 'A recipient') || ' stepped on the Mine'
        || CASE WHEN NEW.denarii_paid > 0 THEN ' and paid ' || NEW.denarii_paid::text || ' Denarii.' ELSE '.' END;
    END IF;
  END IF;

  PERFORM public.notify_user(
    v_challenge.creator_id,
    NEW.user_id,
    v_challenge.item_type,
    v_title,
    v_body,
    'store',
    jsonb_build_object(
      'hidden_challenge_id', NEW.challenge_id,
      'hidden_challenge_claim_id', NEW.claim_id,
      'placement', v_claim.placement,
      'outcome', NEW.outcome,
      'denarii_paid', NEW.denarii_paid
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hidden_challenge_attempt_creator_notice ON public.hidden_challenge_attempts;
CREATE TRIGGER hidden_challenge_attempt_creator_notice
AFTER INSERT ON public.hidden_challenge_attempts
FOR EACH ROW EXECUTE FUNCTION public.notify_hidden_challenge_creator_of_attempt();

REVOKE ALL ON FUNCTION public.notify_hidden_challenge_creator_of_attempt() FROM PUBLIC, anon, authenticated;

/* Grant this week's missing benefits to existing Sentries at deployment. */
SELECT public.process_automatic_sentry_promotions();
