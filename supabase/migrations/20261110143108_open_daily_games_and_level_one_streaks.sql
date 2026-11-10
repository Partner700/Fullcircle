-- Level 1 takes effect on the current Douala day. Earlier streak history keeps its attendance rule.
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
          p_record_date >= date '2026-11-10'
          AND EXISTS (
            SELECT 1
            FROM public.game_attempts attempt
            WHERE attempt.user_id = p_user_id
              AND attempt.narrative_date = p_record_date
              AND attempt.level = 1
              AND attempt.status = 'passed'
              AND attempt.completed_at >= (p_record_date::timestamp AT TIME ZONE 'Africa/Douala')
              AND attempt.completed_at < ((p_record_date + time '21:00') AT TIME ZONE 'Africa/Douala')
          )
        )
        OR (
          (
            p_record_date < (SELECT starts_on FROM private.resident_streak_rollout WHERE singleton)
            OR EXISTS (
              SELECT 1 FROM public.tent_members membership
              WHERE membership.user_id = p_user_id
                AND timezone('Africa/Douala', membership.joined_at)::date <= p_record_date
            )
            OR EXISTS (
              SELECT 1 FROM public.subscription_payment_deliveries period
              WHERE period.user_id = p_user_id
                AND timezone('Africa/Douala', period.period_start)::date <= p_record_date
                AND period.period_end > (p_record_date::timestamp AT TIME ZONE 'Africa/Douala')
            )
            OR EXISTS (
              SELECT 1 FROM public.subscriptions subscription
              WHERE subscription.user_id = p_user_id
                AND subscription.status IN ('active', 'grace', 'expired')
                AND timezone('Africa/Douala', subscription.created_at)::date <= p_record_date
                AND (
                  subscription.current_period_end > (p_record_date::timestamp AT TIME ZONE 'Africa/Douala')
                  OR (subscription.current_period_end IS NULL AND subscription.status IN ('active', 'grace'))
                )
                AND NOT EXISTS (
                  SELECT 1 FROM public.subscription_payment_deliveries period
                  WHERE period.user_id = p_user_id
                )
            )
          )
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
$function$;

-- A completed game can be the second half of the streak, after meditation.
CREATE FUNCTION private.refresh_streak_after_level_one_pass()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.narrative_date = timezone('Africa/Douala', now())::date
    AND NEW.narrative_date >= date '2026-11-10'
    AND extract(dow FROM NEW.narrative_date) BETWEEN 1 AND 5
    AND NEW.completed_at < ((NEW.narrative_date + time '21:00') AT TIME ZONE 'Africa/Douala')
  THEN
    PERFORM public.synchronize_daily_record_streak_valid(NEW.user_id, NEW.narrative_date);
    PERFORM public.refresh_user_streak_snapshot(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_streak_after_level_one_pass() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER refresh_streak_after_level_one_pass
AFTER INSERT ON public.game_attempts
FOR EACH ROW WHEN (NEW.level = 1 AND NEW.status = 'passed')
EXECUTE FUNCTION private.refresh_streak_after_level_one_pass();

-- Pick up Level 1 passes from earlier on deployment day.
DO $$
DECLARE resident record;
BEGIN
  FOR resident IN
    SELECT DISTINCT attempt.user_id, attempt.narrative_date
    FROM public.game_attempts attempt
    WHERE attempt.narrative_date = timezone('Africa/Douala', now())::date
      AND attempt.level = 1 AND attempt.status = 'passed'
      AND public.streak_requirement_met(attempt.user_id, attempt.narrative_date)
  LOOP
    PERFORM public.synchronize_daily_record_streak_valid(resident.user_id, resident.narrative_date);
    PERFORM public.refresh_user_streak_snapshot(resident.user_id);
  END LOOP;
END;
$$;
