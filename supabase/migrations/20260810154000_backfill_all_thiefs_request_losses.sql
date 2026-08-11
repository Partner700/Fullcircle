/*
  Backfill every missed streak day covered by historical Thief's Request uses.

  The previous repairs looked for one recoverable gap. That still missed users
  whose failed relic use was recorded differently, or whose lost history had
  more than one missed eligible day. This pass restores every eligible missed
  day up to the original use time, never a loss that happened afterward.
*/

CREATE TABLE IF NOT EXISTS public.relic_recovery_repairs (
  usage_ledger_id uuid PRIMARY KEY REFERENCES public.denarii_ledger_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  applied_to_date date,
  outcome text NOT NULL CHECK (outcome IN ('restored', 'no_recoverable_gap', 'already_restored')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.relic_recovery_repairs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_usage record;
  v_join_date date;
  v_cutoff_date date;
  v_restore_date date;
  v_restored_days integer;
BEGIN
  FOR v_usage IN
    WITH ledger_uses AS (
      SELECT
        DISTINCT ON (ledger.user_id, date_trunc('second', ledger.created_at))
        ledger.id,
        ledger.user_id,
        ledger.created_at
      FROM public.denarii_ledger_entries ledger
      WHERE ledger.source_type = 'relic_reward'
        AND ledger.description ILIKE '%Thief''s Request%'
      ORDER BY
        ledger.user_id,
        date_trunc('second', ledger.created_at),
        ledger.created_at,
        ledger.id
    ),
    logged_uses AS (
      SELECT
        log.id,
        log.user_id,
        log.created_at
      FROM public.relic_usage_log log
      JOIN public.relic_types relic ON relic.id = log.relic_type_id
      WHERE relic.slug = 'thieves-request'
         OR log.effect_applied ILIKE '%revive_lost_streak%'
         OR log.effect_applied ILIKE '%resurrect_lost_streak%'
    )
    SELECT DISTINCT ON (candidate.user_id, date_trunc('second', candidate.created_at))
      candidate.id,
      candidate.user_id,
      candidate.created_at
    FROM (
      SELECT * FROM ledger_uses
      UNION ALL
      SELECT * FROM logged_uses
    ) candidate
    ORDER BY
      candidate.user_id,
      date_trunc('second', candidate.created_at),
      candidate.created_at,
      candidate.id
  LOOP
    SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
    INTO v_join_date
    FROM public.profiles profile
    WHERE profile.id = v_usage.user_id;

    IF v_join_date IS NULL THEN
      CONTINUE;
    END IF;

    v_cutoff_date := (v_usage.created_at AT TIME ZONE 'Africa/Douala')::date
      - CASE
          WHEN (v_usage.created_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00'
          THEN 0
          ELSE 1
        END;

    IF v_cutoff_date < v_join_date THEN
      CONTINUE;
    END IF;

    v_restored_days := 0;

    FOR v_restore_date IN
      SELECT day::date
      FROM generate_series(v_join_date, v_cutoff_date, interval '1 day') AS day
      WHERE (
        extract(dow FROM day) BETWEEN 1 AND 5
        OR (
          extract(dow FROM day) = 6
          AND EXISTS (
            SELECT 1
            FROM public.quiz_sessions session
            WHERE session.session_date = day::date
              AND session.quiz_type = 'saturday'
          )
        )
      )
      AND NOT public.streak_requirement_met(v_usage.user_id, day::date)
      AND NOT EXISTS (
        SELECT 1
        FROM public.streak_freezers protected
        WHERE protected.user_id = v_usage.user_id
          AND protected.used_at IS NULL
          AND protected.applied_to_date = day::date
      )
      ORDER BY day::date
    LOOP
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (v_usage.user_id, 'weekly', 'relic', v_restore_date);

      v_restored_days := v_restored_days + 1;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries ledger
      WHERE ledger.id = v_usage.id
    ) THEN
      INSERT INTO public.relic_recovery_repairs (
        usage_ledger_id,
        user_id,
        applied_to_date,
        outcome
      ) VALUES (
        v_usage.id,
        v_usage.user_id,
        public.find_latest_recoverable_streak_gap(v_usage.user_id, v_cutoff_date),
        CASE WHEN v_restored_days > 0 THEN 'restored' ELSE 'already_restored' END
      )
      ON CONFLICT (usage_ledger_id) DO UPDATE
      SET applied_to_date = EXCLUDED.applied_to_date,
          outcome = CASE
            WHEN v_restored_days > 0 THEN 'restored'
            ELSE public.relic_recovery_repairs.outcome
          END;
    END IF;
  END LOOP;
END;
$$;
