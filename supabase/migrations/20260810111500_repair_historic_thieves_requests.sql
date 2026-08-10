/*
  One-time repair for Thief's Request uses that granted their denarii reward
  but did not create a streak-restoration row. A repair is pegged to the date
  of each historical use, so it never applies an old relic to a later streak
  loss.
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
  v_restore_date date;
  v_cutoff_date date;
BEGIN
  FOR v_usage IN
    SELECT DISTINCT ON (ledger.user_id, ledger.created_at)
      ledger.id,
      ledger.user_id,
      ledger.created_at
    FROM public.denarii_ledger_entries ledger
    WHERE ledger.source_type = 'relic_reward'
      AND ledger.description ILIKE 'The Thief''s Request:%'
    ORDER BY ledger.user_id, ledger.created_at, ledger.id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.relic_recovery_repairs repair
      WHERE repair.usage_ledger_id = v_usage.id
    ) THEN
      CONTINUE;
    END IF;

    /* A successful use already created a dated relic freezer near its use time. */
    IF EXISTS (
      SELECT 1
      FROM public.streak_freezers freezer
      WHERE freezer.user_id = v_usage.user_id
        AND freezer.source = 'relic'
        AND freezer.applied_to_date IS NOT NULL
        AND freezer.purchased_at BETWEEN v_usage.created_at - interval '10 minutes'
                                 AND v_usage.created_at + interval '10 minutes'
    ) THEN
      INSERT INTO public.relic_recovery_repairs (usage_ledger_id, user_id, outcome)
      VALUES (v_usage.id, v_usage.user_id, 'already_restored');
      CONTINUE;
    END IF;

    v_cutoff_date := (v_usage.created_at AT TIME ZONE 'Africa/Douala')::date;
    IF (v_usage.created_at AT TIME ZONE 'Africa/Douala')::time < time '21:00' THEN
      v_cutoff_date := v_cutoff_date - 1;
    END IF;

    SELECT max(candidate.record_date)
    INTO v_restore_date
    FROM generate_series(
      (SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date FROM public.profiles profile WHERE profile.id = v_usage.user_id),
      v_cutoff_date,
      interval '1 day'
    ) AS candidate(record_date)
    WHERE extract(dow FROM candidate.record_date) <> 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.streak_freezers protected_day
        WHERE protected_day.user_id = v_usage.user_id
          AND protected_day.applied_to_date = candidate.record_date::date
      )
      AND EXISTS (
        SELECT 1
        FROM public.daily_records prior
        WHERE prior.user_id = v_usage.user_id
          AND prior.record_date < candidate.record_date::date
          AND (
            COALESCE(prior.streak_valid, false)
            OR (
              COALESCE(prior.attendance_status, 'unmarked') = 'present'
              AND COALESCE(prior.meditation_submitted, false)
            )
          )
      )
      AND (
        (
          extract(dow FROM candidate.record_date) = 6
          AND EXISTS (
            SELECT 1
            FROM public.quiz_sessions session
            WHERE session.session_date = candidate.record_date::date
              AND session.quiz_type = 'saturday'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.quiz_attempts attempt
            JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
            WHERE attempt.user_id = v_usage.user_id
              AND session.session_date = candidate.record_date::date
              AND session.quiz_type = 'saturday'
              AND attempt.status IN ('submitted', 'timed_out')
          )
        )
        OR (
          extract(dow FROM candidate.record_date) BETWEEN 1 AND 5
          AND NOT EXISTS (
            SELECT 1
            FROM public.daily_records record
            WHERE record.user_id = v_usage.user_id
              AND record.record_date = candidate.record_date::date
              AND COALESCE(record.attendance_status, 'unmarked') = 'present'
              AND COALESCE(record.meditation_submitted, false)
          )
        )
      );

    IF v_restore_date IS NULL THEN
      INSERT INTO public.relic_recovery_repairs (usage_ledger_id, user_id, outcome)
      VALUES (v_usage.id, v_usage.user_id, 'no_recoverable_gap');
    ELSE
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (v_usage.user_id, 'weekly', 'relic', v_restore_date);

      INSERT INTO public.relic_recovery_repairs (usage_ledger_id, user_id, applied_to_date, outcome)
      VALUES (v_usage.id, v_usage.user_id, v_restore_date, 'restored');
    END IF;
  END LOOP;
END;
$$;
