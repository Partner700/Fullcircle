/*
  Make streak-revival relics durable in the forward-only streak engine.

  use_relic() records the repaired date before relic_usage_log is inserted.
  The previous after-insert trigger treated "no newly inserted repair rows" as
  "nothing to persist" and returned before establishing a manual forward
  anchor. The revival appeared briefly, then the next snapshot refresh returned
  to the pre-revival value.

  This materializer is deliberately idempotent. It derives the complete value
  covered by the recorded relic use, writes the forward anchor even when every
  restoration row already exists, and publishes the corrected snapshot in the
  same transaction.
*/

CREATE OR REPLACE FUNCTION public.materialize_revival_relic_streak(
  p_user_id uuid,
  p_used_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff date;
  v_join_date date;
  v_restored integer := 0;
  v_live_current integer := 0;
  v_live_longest integer := 0;
  v_recovered_current integer := 0;
  v_anchor_current integer := 0;
  v_anchor_longest integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_used_at IS NULL THEN
    RETURN jsonb_build_object('materialized', false, 'reason', 'missing_relic_use');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('full-circle-revival-relic:' || p_user_id::text, 0)
  );

  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

  IF v_join_date IS NULL THEN
    RETURN jsonb_build_object('materialized', false, 'reason', 'profile_not_found');
  END IF;

  v_cutoff := (p_used_at AT TIME ZONE 'Africa/Douala')::date
    - CASE
        WHEN (p_used_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0
        ELSE 1
      END;

  IF v_cutoff < v_join_date THEN
    RETURN jsonb_build_object('materialized', false, 'reason', 'no_eligible_day');
  END IF;

  SELECT
    coalesce(streak.current_streak, 0),
    coalesce(streak.longest_streak, 0)
  INTO v_live_current, v_live_longest
  FROM public.get_authoritative_streak(p_user_id) streak
  LIMIT 1;

  /* This may return zero when use_relic() already inserted the repaired row.
     Zero is an idempotent success, not a reason to skip the forward anchor. */
  v_restored := public.restore_thiefs_request_history(p_user_id, v_cutoff);

  SELECT count(*)::integer
  INTO v_recovered_current
  FROM generate_series(v_join_date, v_cutoff, interval '1 day') day(record_date)
  WHERE (
      extract(dow FROM day.record_date) BETWEEN 1 AND 5
      OR (
        extract(dow FROM day.record_date) = 0
        AND day.record_date::date >= date '2026-08-02'
      )
      OR (
        extract(dow FROM day.record_date) = 6
        AND EXISTS (
          SELECT 1
          FROM public.quiz_sessions session
          WHERE session.session_date = day.record_date::date
            AND session.quiz_type = 'saturday'
        )
      )
    )
    AND (
      public.streak_requirement_met(p_user_id, day.record_date::date)
      OR public.streak_day_is_restored(p_user_id, day.record_date::date)
      OR public.streak_day_is_purchased(p_user_id, day.record_date::date)
    );

  IF v_recovered_current <= 0 THEN
    RETURN jsonb_build_object(
      'materialized', false,
      'reason', 'no_recovered_streak',
      'restoration_rows_added', v_restored
    );
  END IF;

  INSERT INTO public.streak_manual_adjustments AS adjustment (
    user_id,
    effective_date,
    current_streak,
    longest_streak,
    reason,
    created_at
  ) VALUES (
    p_user_id,
    v_cutoff,
    v_recovered_current,
    greatest(v_live_longest, v_live_current, v_recovered_current),
    'Revival relic permanently restored the streak through ' || v_cutoff::text,
    clock_timestamp()
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
      created_at = clock_timestamp()
  RETURNING current_streak, longest_streak
  INTO v_anchor_current, v_anchor_longest;

  PERFORM public.refresh_user_streak_snapshot(p_user_id);

  RETURN jsonb_build_object(
    'materialized', true,
    'user_id', p_user_id,
    'cutoff_date', v_cutoff,
    'restoration_rows_added', v_restored,
    'current_streak', v_anchor_current,
    'longest_streak', v_anchor_longest
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_revival_relic_streak(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_revival_relic_streak(uuid, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_thiefs_request_after_use()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT relic.slug
  INTO v_slug
  FROM public.relic_types relic
  WHERE relic.id = NEW.relic_type_id;

  IF coalesce(v_slug, '') = 'thieves-request'
    OR coalesce(NEW.effect_applied, '') ILIKE '%revive_lost_streak%'
    OR coalesce(NEW.effect_applied, '') ILIKE '%resurrect_lost_streak%'
  THEN
    PERFORM public.materialize_revival_relic_streak(NEW.user_id, NEW.created_at);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_thiefs_request_after_use()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_complete_thiefs_request_after_use
  ON public.relic_usage_log;
CREATE TRIGGER trg_complete_thiefs_request_after_use
AFTER INSERT ON public.relic_usage_log
FOR EACH ROW
EXECUTE FUNCTION public.complete_thiefs_request_after_use();

/* Repair recorded uses affected since the forward-only cutover, including
   Courage's existing use. Never replay a relic across a later genuine loss. */
DO $$
DECLARE
  v_use record;
  v_cutoff date;
BEGIN
  FOR v_use IN
    SELECT log.user_id, log.created_at
    FROM public.relic_usage_log log
    JOIN public.relic_types relic ON relic.id = log.relic_type_id
    WHERE log.created_at >= timestamptz '2026-09-08 00:00:00+01'
      AND (
        relic.slug = 'thieves-request'
        OR coalesce(log.effect_applied, '') ILIKE '%revive_lost_streak%'
        OR coalesce(log.effect_applied, '') ILIKE '%resurrect_lost_streak%'
      )
    ORDER BY log.created_at, log.id
  LOOP
    v_cutoff := (v_use.created_at AT TIME ZONE 'Africa/Douala')::date
      - CASE
          WHEN (v_use.created_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0
          ELSE 1
        END;

    IF EXISTS (
      SELECT 1
      FROM public.streak_forward_daily_states state
      WHERE state.user_id = v_use.user_id
        AND state.record_date > v_cutoff
        AND state.outcome = 'missed'
        AND state.settled
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.materialize_revival_relic_streak(v_use.user_id, v_use.created_at);
  END LOOP;
END;
$$;
