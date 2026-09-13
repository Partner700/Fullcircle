-- Retry alarm push requests on the server, without depending on an open browser.
CREATE TABLE private.alarm_push_outbox (
  notification_id uuid PRIMARY KEY REFERENCES public.user_notifications(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  request_id bigint,
  requested_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_error text
);
REVOKE ALL ON private.alarm_push_outbox FROM PUBLIC, anon, authenticated;

CREATE TABLE public.alarm_push_receipts (
  notification_id uuid NOT NULL REFERENCES public.user_notifications(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,subscription_id)
);
ALTER TABLE public.alarm_push_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alarm_push_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.alarm_push_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.alarm_push_is_current(p_notification_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_notifications notification
    JOIN public.scripture_alarm_occurrences alarm ON alarm.id::text=notification.metadata->>'alarm_id'
      AND alarm.user_id=notification.recipient_id
    WHERE notification.id=p_notification_id AND notification.notification_type='scripture_alarm'
      AND alarm.status='pending' AND alarm.triggered_at<=now() AND alarm.expires_at>now()
      AND (alarm.personal_alarm_id IS NOT NULL OR (
        private.user_is_scripture_alarm_eligible(alarm.user_id,alarm.alarm_date)
        AND (alarm.alarm_slot='morning' OR NOT private.daily_meditation_is_submitted(alarm.user_id,alarm.alarm_date))
      ))
  );
$$;
REVOKE ALL ON FUNCTION public.alarm_push_is_current(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alarm_push_is_current(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.dispatch_alarm_push_queue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, extensions AS $$
DECLARE
  v_job private.alarm_push_outbox;
  v_response record;
  v_secret text;
  v_request bigint;
  v_count integer := 0;
BEGIN
  SELECT secret INTO v_secret FROM private.push_webhook_config WHERE singleton;
  FOR v_job IN SELECT * FROM private.alarm_push_outbox
    WHERE finished_at IS NULL AND next_attempt_at<=now()
    ORDER BY next_attempt_at LIMIT 250 FOR UPDATE SKIP LOCKED
  LOOP
    IF v_job.expires_at<=now() OR NOT public.alarm_push_is_current(v_job.notification_id) THEN
      UPDATE private.alarm_push_outbox SET finished_at=now(),last_error='Expired or no longer due' WHERE notification_id=v_job.notification_id;
      CONTINUE;
    END IF;
    IF v_job.request_id IS NOT NULL THEN
      SELECT status_code,timed_out,error_msg INTO v_response FROM net._http_response WHERE id=v_job.request_id;
      IF FOUND THEN
        IF v_response.status_code BETWEEN 200 AND 299 AND NOT coalesce(v_response.timed_out,false) THEN
          UPDATE private.alarm_push_outbox SET finished_at=now(),last_error=NULL WHERE notification_id=v_job.notification_id;
          CONTINUE;
        END IF;
      ELSIF v_job.requested_at > now()-interval '90 seconds' THEN CONTINUE;
      END IF;
    END IF;
    IF v_job.attempts>=6 THEN
      UPDATE private.alarm_push_outbox SET finished_at=now(),last_error='Push retry limit reached' WHERE notification_id=v_job.notification_id;
      CONTINUE;
    END IF;
    BEGIN
      v_request := net.http_post(
        url:='https://kckzqsafzemeijxfohuy.supabase.co/functions/v1/send-push-notification',
        headers:=jsonb_build_object('Content-Type','application/json','x-full-circle-push-secret',v_secret),
        body:=jsonb_build_object('notification_id',v_job.notification_id), timeout_milliseconds:=10000
      );
      UPDATE private.alarm_push_outbox SET request_id=v_request,requested_at=now(),attempts=attempts+1,
        next_attempt_at=now()+interval '30 seconds',last_error=NULL WHERE notification_id=v_job.notification_id;
      v_count:=v_count+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.alarm_push_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '30 seconds',
        last_error='Push request could not be queued' WHERE notification_id=v_job.notification_id;
    END;
  END LOOP;
  DELETE FROM private.alarm_push_outbox WHERE finished_at<now()-interval '7 days';
  DELETE FROM public.alarm_push_receipts WHERE delivered_at<now()-interval '7 days';
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.dispatch_alarm_push_queue() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.deliver_user_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public, extensions AS $$
DECLARE v_secret text; v_expires timestamptz;
BEGIN
  IF NEW.notification_type='scripture_alarm' THEN
    SELECT expires_at INTO v_expires FROM public.scripture_alarm_occurrences WHERE id::text=NEW.metadata->>'alarm_id' AND user_id=NEW.recipient_id;
    IF v_expires IS NOT NULL THEN
      INSERT INTO private.alarm_push_outbox(notification_id,expires_at) VALUES(NEW.id,v_expires) ON CONFLICT DO NOTHING;
      PERFORM private.dispatch_alarm_push_queue();
    END IF;
    RETURN NEW;
  END IF;
  SELECT secret INTO v_secret FROM private.push_webhook_config WHERE singleton;
  PERFORM net.http_post(
    url:='https://kckzqsafzemeijxfohuy.supabase.co/functions/v1/send-push-notification',
    headers:=jsonb_build_object('Content-Type','application/json','x-full-circle-push-secret',v_secret),
    body:=jsonb_build_object('notification_id',NEW.id), timeout_milliseconds:=5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push delivery queue failed for notification %: %',NEW.id,SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.deliver_user_notification_push() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'Enable Supabase Cron (pg_cron) before installing alarm push delivery.';
  END IF;
  PERFORM cron.schedule('full-circle-alarm-push-retry','* * * * *','SELECT private.dispatch_alarm_push_queue();');
  PERFORM cron.schedule('full-circle-scripture-alarm-watchdog','* * * * *','SELECT private.dispatch_due_scripture_alarms();');
  PERFORM cron.schedule('full-circle-scripture-alarm-expiry','* * * * *','SELECT private.expire_stale_scripture_alarms();');
END;
$$;
