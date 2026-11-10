-- Begin at the next Douala calendar day so today's existing streak is preserved.
CREATE TABLE private.resident_streak_rollout (
  singleton boolean PRIMARY KEY CHECK (singleton),
  starts_on date NOT NULL
);
INSERT INTO private.resident_streak_rollout VALUES (true, timezone('Africa/Douala',now())::date + 1);
REVOKE ALL ON TABLE private.resident_streak_rollout FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.streak_requirement_met(p_user_id uuid, p_record_date date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_record_date < date '2026-08-10' AND EXISTS (
    SELECT 1
    FROM public.daily_records historical
    WHERE historical.user_id = p_user_id
      AND historical.record_date = p_record_date
      AND historical.streak_valid IS TRUE
  ) THEN
    RETURN true;
  END IF;

  IF extract(dow FROM p_record_date) = 0 THEN
    RETURN p_record_date >= date '2026-08-02' AND EXISTS (
      SELECT 1
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
        AND record.record_date = p_record_date
        AND record.sunday_reading_opened_at IS NOT NULL
        AND (record.sunday_reading_opened_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
    );
  END IF;

  IF extract(dow FROM p_record_date) = 6 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.quiz_attempts attempt
      JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
      WHERE attempt.user_id = p_user_id
        AND session.session_date = p_record_date
        AND session.quiz_type = 'saturday'
        AND attempt.status IN ('submitted', 'timed_out')
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.daily_records record
    WHERE record.user_id = p_user_id
      AND record.record_date = p_record_date
      AND coalesce(record.meditation_submitted, false)
      AND (
        (
          record.meditation_submitted_at IS NOT NULL
          AND scripture_games.meditation_submission_is_timely(record.user_id,record.record_date,record.meditation_submitted_at)
        )
        OR (
          p_record_date < date '2026-08-10'
          AND record.meditation_submitted_at IS NULL
        )
      )
      AND (
        /* The authorized sentry/instructor status is the attendance fact.
           The entry timestamp remains available for punctuality reporting. */
        (
          p_record_date >= (SELECT starts_on FROM private.resident_streak_rollout WHERE singleton)
          AND (SELECT count(DISTINCT run.level)
               FROM public.daily_game_runs run
               WHERE run.user_id=p_user_id AND run.narrative_date=p_record_date
                 AND run.level BETWEEN 1 AND 7 AND run.status='completed'
                 AND run.completed_at < ((p_record_date + time '21:00') AT TIME ZONE 'Africa/Douala'))=7
        )
        OR (
          (p_record_date < (SELECT starts_on FROM private.resident_streak_rollout WHERE singleton)
           OR EXISTS (SELECT 1 FROM public.tent_members membership
                      WHERE membership.user_id=p_user_id
                        AND timezone('Africa/Douala',membership.joined_at)::date <= p_record_date))
          AND (
            coalesce(record.attendance_status, 'unmarked') = 'present'
            OR EXISTS (
              /* Sentry duty is still earned only by actually recording at least
                 one cadet before noon. This branch is intentionally unchanged. */
              SELECT 1
              FROM public.daily_records marked
              WHERE marked.record_date = p_record_date
                AND marked.attendance_marked_by = p_user_id
                AND marked.attendance_marked_at IS NOT NULL
                AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
            )
          )
        )
      )
  );
END;
$function$
;
-- These core streak actions stay available even after premium access expires.
DROP TRIGGER IF EXISTS enforce_subscription_daily_records ON public.daily_records;
DROP TRIGGER IF EXISTS enforce_subscription_daily_game_runs ON public.daily_game_runs;
DROP TRIGGER IF EXISTS enforce_subscription_game_attempts ON public.game_attempts;

CREATE OR REPLACE FUNCTION public.enforce_owned_subscription_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  owner_id uuid := nullif(coalesce(to_jsonb(NEW)->>'user_id',to_jsonb(NEW)->>'sender_id'),'')::uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role()='service_role' OR owner_id IS DISTINCT FROM auth.uid()
     OR public.has_current_subscription_access(owner_id) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='quiz_attempts' AND EXISTS (
    SELECT 1 FROM public.quiz_sessions WHERE id=(to_jsonb(NEW)->>'quiz_session_id')::uuid AND quiz_type='saturday'
  ) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='denarii_ledger_entries' AND (
    to_jsonb(NEW)->>'source_type' IN ('game_level','game_blitz')
    OR (to_jsonb(NEW)->>'source_type'='quiz_reward' AND EXISTS (
      SELECT 1 FROM public.quiz_attempts a JOIN public.quiz_sessions s ON s.id=a.quiz_session_id
      WHERE a.id::text=to_jsonb(NEW)->>'source_reference' AND a.user_id=owner_id AND s.quiz_type='saturday'
    ))
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sunday_reading_open(
  p_user_id uuid, p_record_date date DEFAULT timezone('Africa/Douala', now())::date
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE local_now timestamp := timezone('Africa/Douala',clock_timestamp());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only record your own reading activity.';
  END IF;
  IF p_record_date IS DISTINCT FROM local_now::date OR extract(dow FROM p_record_date)<>0
    OR local_now::time>=time '21:00' OR NOT EXISTS (
      SELECT 1 FROM public.daily_narratives WHERE narrative_date=p_record_date
    ) THEN RETURN false; END IF;
  INSERT INTO public.daily_records(user_id,record_date,day_type,attendance_status,meditation_submitted,streak_valid,sunday_reading_opened_at)
    VALUES(p_user_id,p_record_date,'sunday','unmarked',false,true,clock_timestamp())
  ON CONFLICT (user_id,record_date) DO UPDATE
    SET sunday_reading_opened_at=coalesce(daily_records.sunday_reading_opened_at,excluded.sunday_reading_opened_at),
        streak_valid=true;
  RETURN true;
END;
$$;

CREATE TABLE private.resident_tent_trials (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.resident_tent_trials FROM PUBLIC, anon, authenticated;
INSERT INTO private.resident_tent_trials(user_id,started_at)
SELECT user_id,min(joined_at) FROM public.tent_members GROUP BY user_id
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.enforce_resident_tent_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  first_join boolean;
  eligible boolean;
BEGIN
  -- Existing assignments may be moved by the instructor without restarting their trial.
  IF TG_TABLE_NAME='tent_members' AND to_jsonb(NEW)->>'role'<>'cadet' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='tent_members' AND EXISTS (
    SELECT 1 FROM private.resident_tent_trials WHERE user_id=NEW.user_id
  ) AND public.has_current_subscription_access(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT longest_streak>=10 INTO eligible FROM public.compute_strict_streak(NEW.user_id);
  IF NOT coalesce(eligible,false) THEN RAISE EXCEPTION 'Reach a 10-day streak to unlock Tent access.'; END IF;
  IF TG_TABLE_NAME='tent_join_requests' THEN
    IF EXISTS (SELECT 1 FROM private.resident_tent_trials WHERE user_id=NEW.user_id)
       AND NOT public.has_current_subscription_access(NEW.user_id) THEN
      RAISE EXCEPTION 'Renew your subscription to join a tent.';
    END IF;
    RETURN NEW;
  END IF;
  INSERT INTO private.resident_tent_trials(user_id) VALUES(NEW.user_id)
  ON CONFLICT DO NOTHING RETURNING true INTO first_join;
  IF coalesce(first_join,false) AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions WHERE user_id=NEW.user_id AND status IN ('active','grace')
      AND public.has_current_subscription_access(NEW.user_id)
  ) THEN
    INSERT INTO public.subscriptions(user_id,status,trial_started_at,trial_ends_at)
    VALUES(NEW.user_id,'trial',now(),now()+interval '1 month')
    ON CONFLICT (user_id) DO UPDATE SET status='trial',trial_started_at=excluded.trial_started_at,
      trial_ends_at=excluded.trial_ends_at,current_period_end=NULL,updated_at=now();
  END IF;
  IF NOT public.has_current_subscription_access(NEW.user_id) THEN
    RAISE EXCEPTION 'An active subscription or first-month trial is required to join a tent.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_resident_tent_eligibility() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER resident_tent_eligibility_before_request BEFORE INSERT ON public.tent_join_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_resident_tent_eligibility();
CREATE TRIGGER resident_tent_eligibility_before_membership BEFORE INSERT ON public.tent_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_resident_tent_eligibility();
