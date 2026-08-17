/* Complete historical Thief's Request repairs and lock premium streak relics
   to Denarii-only pricing. */

UPDATE public.relic_types
SET denarii_cost = 60000,
    money_price_usd = NULL,
    money_price_xaf = NULL,
    stripe_product_id = NULL,
    stripe_price_id = NULL,
    description = CASE slug
      WHEN 'simons-purse' THEN
        'Adds protected streak days during an absence for up to five weekdays before Saturday. Denarii only.'
      ELSE
        'Restores the eligible streak history lost before this relic was used. Denarii only.'
    END
WHERE slug IN ('simons-purse', 'thieves-request');

-- Earlier clients wrote several punctuation variants of "Thief's Request".
-- Re-audit each recorded use using a normalized identifier and preserve the
-- original use-date cutoff, so a genuinely missed later day is not repaired.
DO $$
DECLARE
  v_use record;
  v_cutoff date;
BEGIN
  FOR v_use IN
    WITH recorded_uses AS (
      SELECT usage.user_id, usage.created_at AS used_at
      FROM public.relic_usage_log usage
      LEFT JOIN public.relic_types relic ON relic.id = usage.relic_type_id
      WHERE regexp_replace(lower(coalesce(relic.slug, relic.name, '')), '[^a-z0-9]+', '', 'g')
              LIKE '%thievesrequest%'
         OR regexp_replace(lower(coalesce(usage.effect_applied, '')), '[^a-z0-9]+', '', 'g')
              LIKE ANY (ARRAY['%reviveloststreak%', '%resurrectloststreak%'])

      UNION ALL

      SELECT ledger.user_id, ledger.created_at
      FROM public.denarii_ledger_entries ledger
      WHERE regexp_replace(lower(coalesce(ledger.description, '')), '[^a-z0-9]+', '', 'g')
              LIKE '%thiefsrequest%'
         OR regexp_replace(lower(coalesce(ledger.description, '')), '[^a-z0-9]+', '', 'g')
              LIKE '%thievesrequest%'
    )
    SELECT recorded.user_id, max(recorded.used_at) AS used_at
    FROM recorded_uses recorded
    GROUP BY recorded.user_id
  LOOP
    v_cutoff := (v_use.used_at AT TIME ZONE 'Africa/Douala')::date
      - CASE
          WHEN (v_use.used_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0
          ELSE 1
        END;
    PERFORM public.restore_thiefs_request_history(v_use.user_id, v_cutoff);
  END LOOP;
END;
$$;

-- Preserve a confirmed board streak and advance it for every credited day
-- after that snapshot. The earlier version preserved the old number but did
-- not add Sunday/weekday progress earned afterward.
CREATE OR REPLACE FUNCTION public.get_authoritative_streak(p_user_id uuid)
RETURNS TABLE (
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT
      timezone('Africa/Douala', now())::date AS today,
      timezone('Africa/Douala', now())::time AS local_time
  ),
  strict AS (
    SELECT * FROM public.compute_strict_streak(p_user_id) LIMIT 1
  ),
  baseline AS (
    SELECT snapshot.snapshot_date, snapshot.current_streak, snapshot.longest_streak
    FROM public.streakboard_snapshots snapshot
    CROSS JOIN clock
    WHERE snapshot.user_id = p_user_id
      AND snapshot.snapshot_date >= clock.today - 30
    ORDER BY snapshot.current_streak DESC, snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  ),
  post_days AS (
    SELECT day::date AS record_date
    FROM baseline
    CROSS JOIN clock
    CROSS JOIN LATERAL generate_series(
      baseline.snapshot_date + 1,
      clock.today,
      interval '1 day'
    ) day
  ),
  day_state AS (
    SELECT
      post_days.record_date,
      (
        extract(dow FROM post_days.record_date) BETWEEN 1 AND 5
        OR (extract(dow FROM post_days.record_date) = 0 AND post_days.record_date >= date '2026-08-02')
        OR (
          extract(dow FROM post_days.record_date) = 6
          AND EXISTS (
            SELECT 1 FROM public.quiz_sessions session
            WHERE session.session_date = post_days.record_date
              AND session.quiz_type = 'saturday'
          )
        )
      ) AS eligible,
      (
        public.streak_requirement_met(p_user_id, post_days.record_date)
        OR EXISTS (
          SELECT 1 FROM public.streak_freezers protection
          WHERE protection.user_id = p_user_id
            AND protection.used_at IS NULL
            AND protection.applied_to_date = post_days.record_date
            AND (protection.expires_at IS NULL OR protection.expires_at::date >= post_days.record_date)
            AND (
              (extract(dow FROM post_days.record_date) BETWEEN 1 AND 5)
              OR (
                extract(dow FROM post_days.record_date) = 6
                AND protection.freezer_type = 'weekly'
                AND protection.source IN ('relic', 'redemption')
              )
            )
        )
      ) AS credited
    FROM post_days
  ),
  post_summary AS (
    SELECT
      count(*) FILTER (WHERE day_state.eligible AND day_state.credited)::integer AS credited_days,
      bool_or(
        day_state.eligible
        AND NOT day_state.credited
        AND (
          day_state.record_date < clock.today
          OR clock.local_time >= time '21:00'
        )
      ) AS has_break
    FROM day_state
    CROSS JOIN clock
  ),
  resolved AS (
    SELECT
      CASE
        WHEN baseline.snapshot_date IS NOT NULL AND NOT coalesce(post_summary.has_break, false)
          THEN greatest(
            coalesce(strict.current_streak, 0),
            coalesce(baseline.current_streak, 0) + coalesce(post_summary.credited_days, 0)
          )
        ELSE coalesce(strict.current_streak, 0)
      END::integer AS current_streak,
      coalesce(strict.longest_streak, 0)::integer AS strict_longest,
      coalesce(baseline.longest_streak, 0)::integer AS baseline_longest,
      coalesce(strict.consecutive_inactive, 0)::integer AS consecutive_inactive,
      coalesce(strict.cumulative_inactive, 0)::integer AS cumulative_inactive
    FROM (VALUES (1)) seed(value)
    LEFT JOIN strict ON true
    LEFT JOIN baseline ON true
    LEFT JOIN post_summary ON true
  )
  SELECT
    resolved.current_streak,
    greatest(resolved.strict_longest, resolved.baseline_longest, resolved.current_streak)::integer,
    resolved.consecutive_inactive,
    resolved.cumulative_inactive
  FROM resolved;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_streak(uuid) TO authenticated, service_role;

-- Refresh today's snapshots for the specifically reported accounts after the
-- repair. The live calculator remains authoritative for every other account.
DO $$
DECLARE
  v_profile record;
  v_streak record;
BEGIN
  FOR v_profile IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE regexp_replace(lower(coalesce(profile.display_name, '')), '[^a-z0-9]+', '', 'g')
      LIKE ANY (ARRAY['%victoire%', '%courage%', '%lindakaren%'])
  LOOP
    SELECT * INTO v_streak FROM public.get_authoritative_streak(v_profile.id) LIMIT 1;
    INSERT INTO public.streakboard_snapshots (
      snapshot_date, user_id, current_streak, longest_streak
    ) VALUES (
      timezone('Africa/Douala', now())::date,
      v_profile.id,
      coalesce(v_streak.current_streak, 0),
      coalesce(v_streak.longest_streak, 0)
    );
  END LOOP;
END;
$$;
