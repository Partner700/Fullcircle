/* Role-scoped boards, authoritative freezer semantics, and Simon's Coin. */

CREATE OR REPLACE FUNCTION public.get_leaderboard_live_for_role(p_role text)
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
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH people AS (
    SELECT DISTINCT ON (ra.user_id) ra.user_id, ra.role
    FROM public.role_assignments ra
    WHERE ra.role = p_role AND ra.status IN ('active', 'approved')
    ORDER BY ra.user_id, ra.created_at DESC
  ), totals AS (
    SELECT people.user_id, profile.display_name, people.role,
      member.tent_id, tent.name AS tent_name, tent.tent_house_id,
      public.get_user_denarii_total(people.user_id)::bigint AS total_denarii
    FROM people
    JOIN public.profiles profile ON profile.id = people.user_id
    LEFT JOIN LATERAL (
      SELECT tm.tent_id FROM public.tent_members tm
      WHERE tm.user_id = people.user_id AND (tm.role = p_role OR p_role = 'instructor')
      ORDER BY tm.joined_at DESC NULLS LAST LIMIT 1
    ) member ON true
    LEFT JOIN public.tents tent ON tent.id = member.tent_id
  )
  SELECT totals.user_id, totals.display_name, totals.role, totals.tent_id,
    totals.tent_name, totals.tent_house_id, totals.total_denarii,
    rank() OVER (ORDER BY totals.total_denarii DESC, totals.display_name)::integer
  FROM totals
  ORDER BY totals.total_denarii DESC, totals.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_live_for_role(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_instructor_challenge_board_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  narratives bigint,
  residents bigint,
  rank integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH instructors AS (
    SELECT DISTINCT ON (ra.user_id) ra.user_id
    FROM public.role_assignments ra
    WHERE ra.role = 'instructor' AND ra.status IN ('active', 'approved')
    ORDER BY ra.user_id, ra.created_at DESC
  ), totals AS (
    SELECT instructors.user_id, profile.display_name, profile.avatar_url,
      (SELECT count(*) FROM public.daily_narratives)::bigint AS narratives,
      (SELECT count(DISTINCT ra.user_id)
       FROM public.role_assignments ra
       WHERE ra.role IN ('cadet', 'sentry') AND ra.status IN ('active', 'approved'))::bigint AS residents
    FROM instructors
    JOIN public.profiles profile ON profile.id = instructors.user_id
  )
  SELECT totals.user_id, totals.display_name, totals.avatar_url,
    totals.narratives, totals.residents,
    rank() OVER (ORDER BY totals.narratives DESC, totals.residents DESC, totals.display_name)::integer
  FROM totals
  ORDER BY totals.narratives DESC, totals.residents DESC, totals.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_instructor_challenge_board_live() TO authenticated;

/* A missing morning mark must not be interpreted as attendance merely because
   an old row was left with attendance_status = present. */
CREATE OR REPLACE FUNCTION public.streak_requirement_met(p_user_id uuid, p_record_date date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF extract(dow FROM p_record_date) = 0 THEN
    RETURN p_record_date >= date '2026-08-02' AND EXISTS (
      SELECT 1 FROM public.daily_records record
      WHERE record.user_id = p_user_id AND record.record_date = p_record_date
        AND record.sunday_reading_opened_at IS NOT NULL
        AND (record.sunday_reading_opened_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
    );
  END IF;
  IF extract(dow FROM p_record_date) = 6 THEN
    RETURN EXISTS (
      SELECT 1 FROM public.quiz_attempts attempt
      JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
      WHERE attempt.user_id = p_user_id AND session.session_date = p_record_date
        AND session.quiz_type = 'saturday' AND attempt.status IN ('submitted', 'timed_out')
    );
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.daily_records record
    WHERE record.user_id = p_user_id AND record.record_date = p_record_date
      AND COALESCE(record.meditation_submitted, false)
      AND record.meditation_submitted_at IS NOT NULL
      AND (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
      AND COALESCE(record.attendance_status, 'unmarked') = 'present'
      AND record.attendance_marked_at IS NOT NULL
      AND (record.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date; v_check date; v_baseline_date date;
  v_baseline_current integer := 0; v_baseline_longest integer := 0;
  v_requirement_met boolean; v_protected boolean; v_eligible boolean;
  v_current integer := 0; v_longest integer := 0; v_consecutive integer := 0; v_cumulative integer := 0;
BEGIN
  SELECT least(coalesce((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    coalesce((SELECT min(record.record_date) FROM public.daily_records record WHERE record.user_id = p_user_id), v_today))
  INTO v_start FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_start IS NULL THEN RETURN QUERY SELECT 0, 0, 0, 0; RETURN; END IF;

  /* Only the latest published state can seed the live chain. Looking for the
     strongest historical snapshot lets an old positive streak leap over a
     later verified zero, which is how a missed user can appear to gain days. */
  SELECT snapshot.snapshot_date, coalesce(snapshot.current_streak, 0),
    greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
  INTO v_baseline_date, v_baseline_current, v_baseline_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id AND coalesce(snapshot.current_streak, 0) > 0
    AND snapshot.snapshot_date < v_today
    AND NOT EXISTS (
      SELECT 1 FROM public.streakboard_snapshots later
      WHERE later.user_id = snapshot.user_id
        AND later.snapshot_date > snapshot.snapshot_date
        AND later.snapshot_date < v_today
        AND coalesce(later.current_streak, 0) = 0
    )
  ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC LIMIT 1;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    IF v_baseline_date IS NOT NULL AND v_check = v_baseline_date THEN
      v_current := greatest(v_current, v_baseline_current);
      v_longest := greatest(v_longest, v_baseline_longest, v_current);
      v_consecutive := 0; v_check := v_check + 1; CONTINUE;
    END IF;

    v_requirement_met := public.streak_requirement_met(p_user_id, v_check);
    v_protected := false;
    IF NOT v_requirement_met THEN
      v_protected := public.streak_day_is_protected(p_user_id, v_check);
      IF NOT v_protected AND v_current > 0
         AND extract(dow FROM v_check) BETWEEN 1 AND 5
         AND (v_check < v_today OR v_local_time >= time '21:00') THEN
        v_protected := public.activate_streak_freezer_for_date(p_user_id, v_check);
      END IF;
    END IF;

    v_eligible := CASE
      WHEN extract(dow FROM v_check) = 0 THEN v_requirement_met OR v_protected
      WHEN extract(dow FROM v_check) = 6 THEN EXISTS (
        SELECT 1 FROM public.quiz_sessions session
        WHERE session.session_date = v_check AND session.quiz_type = 'saturday'
      ) OR v_requirement_met OR v_protected
      ELSE true
    END;
    IF NOT v_eligible OR (v_check = v_today AND NOT v_requirement_met AND NOT v_protected AND v_local_time < time '21:00') THEN
      v_check := v_check + 1; CONTINUE;
    END IF;

    /* A freezer preserves the chain at its prior value; it is not a free
       completed day and must never make the streak climb. */
    IF v_protected AND NOT v_requirement_met THEN
      v_consecutive := 0;
    ELSIF v_requirement_met THEN
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

REVOKE ALL ON FUNCTION public.streak_requirement_met(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_requirement_met(uuid, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated, service_role;

/* Do not add protected days a second time on top of the strict calculation.
   The older authoritative wrapper treated every protected date as a newly
   earned day, which made a freezer user climb while supposedly frozen. */
CREATE OR REPLACE FUNCTION public.get_authoritative_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT current_streak, longest_streak, consecutive_inactive, cumulative_inactive
  FROM public.compute_strict_streak(p_user_id)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_streak(uuid) TO authenticated, service_role;

ALTER TABLE public.streak_freezers DROP CONSTRAINT IF EXISTS streak_freezers_source_check;
ALTER TABLE public.streak_freezers ADD CONSTRAINT streak_freezers_source_check CHECK (source IN (
  'denarii', 'payment', 'relic', 'redemption', 'simons_purse', 'simons_coin',
  'thiefs_request', 'game_reward', 'arena_reward'
));

INSERT INTO public.relic_types (
  slug, name, description, effect, effect_type, rarity, denarii_cost,
  money_price_usd, money_price_xaf, effect_scope, icon
) VALUES (
  'simons-coin', 'Simon''s Coin',
  'Use one coin to hold today''s streak steady. One coin protects one day and costs 1,000 denarii.',
  'streak_coin_day', 'streak_coin_day', 'rare', 1000, NULL, NULL,
  'streak_protection', 'WalletCards'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, effect = EXCLUDED.effect,
  effect_type = EXCLUDED.effect_type, rarity = EXCLUDED.rarity,
  denarii_cost = EXCLUDED.denarii_cost, effect_scope = EXCLUDED.effect_scope, icon = EXCLUDED.icon;

/* Manual Simon's Coin deployment. It is deliberately separate from Simon's
   Purse: a coin is consumed only when the user presses Use. */
CREATE OR REPLACE FUNCTION public.use_simons_coin(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_relic_id uuid; v_inventory_id uuid; v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'You can only use your own relics.'; END IF;
  SELECT id INTO v_relic_id FROM public.relic_types WHERE slug = 'simons-coin';
  SELECT id INTO v_inventory_id FROM public.relic_inventory WHERE user_id = p_user_id AND relic_type_id = v_relic_id AND quantity > 0 FOR UPDATE;
  IF v_inventory_id IS NULL THEN RAISE EXCEPTION 'You do not own Simon''s Coin.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.streak_freezers protection
    WHERE protection.user_id = p_user_id AND protection.source = 'simons_purse'
      AND protection.applied_to_date = v_today AND protection.used_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'effect', 'streak_coin_day', 'protected_date', v_today,
      'message', 'Today is already protected. Simon''s Coin was not used.');
  END IF;
  IF public.streak_requirement_met(p_user_id, v_today) OR extract(dow FROM v_today) NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('success', false, 'effect', 'streak_coin_day', 'protected_date', v_today,
      'message', 'Simon''s Coin is only needed for an uncompleted weekday. Your coin was not used.');
  END IF;
  INSERT INTO public.streak_freezers(user_id, freezer_type, source, applied_to_date, activated_at, protection_ends_at, protected_through_date, expires_at)
  VALUES (p_user_id, 'daily', 'simons_coin', v_today, now(), now() + interval '24 hours', v_today, v_today + 1);
  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory_id;
  INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied) VALUES (p_user_id, v_relic_id, 'streak_coin_day:' || v_today::text);
  RETURN jsonb_build_object('success', true, 'effect', 'streak_coin_day', 'protected_date', v_today, 'message', 'Simon''s Coin is holding today''s streak steady.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_simons_coin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_streak_protection_state()
RETURNS TABLE(active boolean, protection_kind text, freezer_type text, activated_at timestamptz, protection_ends_at timestamptz, applied_to_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM 1 FROM public.compute_strict_streak(v_user_id);
  RETURN QUERY
  SELECT true,
    CASE WHEN freezer.source IN ('simons_purse', 'simons_coin') THEN freezer.source ELSE 'freezer' END,
    freezer.freezer_type, freezer.activated_at, freezer.protection_ends_at, freezer.applied_to_date
  FROM public.streak_freezers freezer
  WHERE freezer.user_id = v_user_id AND freezer.applied_to_date IS NOT NULL
    AND freezer.protection_ends_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM generate_series(freezer.applied_to_date + 1, timezone('Africa/Douala', now())::date, interval '1 day') day
      WHERE public.streak_requirement_met(v_user_id, day::date)
    )
  ORDER BY CASE WHEN freezer.source IN ('simons_purse', 'simons_coin') THEN 0 ELSE 1 END,
    freezer.activated_at DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::date;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_streak_protection_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_streak_protection_state() TO authenticated;
