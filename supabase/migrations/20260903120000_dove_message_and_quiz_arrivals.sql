/* Deliver a single durable notification whenever a Weekly Quiz is released.
   Direct and tent-message notifications already carry enough metadata for the
   client Dove to open the exact conversation. */

CREATE OR REPLACE FUNCTION public.deliver_quiz_release_notifications(p_quiz_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_recipient record;
  v_delivered integer := 0;
BEGIN
  SELECT * INTO v_session
  FROM public.quiz_sessions session
  WHERE session.id = p_quiz_session_id;

  IF NOT FOUND OR v_session.status NOT IN ('countdown', 'live') THEN
    RETURN 0;
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT assignment.user_id
    FROM public.role_assignments assignment
    JOIN public.profiles profile ON profile.id = assignment.user_id
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
      AND (assignment.end_date IS NULL OR assignment.end_date >= timezone('Africa/Douala', now())::date)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_notifications notification
      WHERE notification.recipient_id = v_recipient.user_id
        AND notification.notification_type = 'quiz_release'
        AND notification.metadata ->> 'quiz_session_id' = v_session.id::text
    ) THEN
      PERFORM public.notify_user(
        v_recipient.user_id,
        NULL,
        'quiz_release',
        'Weekly Quiz released',
        coalesce(nullif(btrim(v_session.title), ''), 'The Weekly Quiz') || ' is ready. Open it with the Dove.',
        'quiz',
        jsonb_build_object(
          'quiz_session_id', v_session.id,
          'status', v_session.status,
          'live_opens_at', v_session.live_opens_at,
          'live_closes_at', v_session.live_closes_at
        )
      );
      v_delivered := v_delivered + 1;
    END IF;
  END LOOP;

  RETURN v_delivered;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_released_quiz_with_dove()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.deliver_quiz_release_notifications(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_released_quiz_with_dove ON public.quiz_sessions;
CREATE TRIGGER trg_notify_released_quiz_with_dove
AFTER UPDATE OF status ON public.quiz_sessions
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  AND NEW.status IN ('countdown', 'live')
)
EXECUTE FUNCTION public.notify_released_quiz_with_dove();

REVOKE ALL ON FUNCTION public.deliver_quiz_release_notifications(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_released_quiz_with_dove() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_quiz_release_notifications(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_released_quiz_with_dove() TO service_role;

-- A deployment made during a live quiz still delivers that release once.
SELECT public.deliver_quiz_release_notifications(session.id)
FROM public.quiz_sessions session
WHERE session.status IN ('countdown', 'live')
  AND session.live_closes_at > now()
ORDER BY session.live_opens_at DESC
LIMIT 1;
