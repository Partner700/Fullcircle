/* Direct messages should create a notification for the recipient immediately. */

CREATE OR REPLACE FUNCTION public.notify_direct_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
BEGIN
  IF NEW.recipient_id IS NULL OR NEW.sender_id IS NULL OR NEW.recipient_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'Someone')
  INTO v_sender_name
  FROM public.profiles profile
  WHERE profile.id = NEW.sender_id;

  PERFORM public.notify_user(
    NEW.recipient_id,
    NEW.sender_id,
    'direct_message',
    'New message',
    coalesce(v_sender_name, 'Someone') || ' sent you a message.',
    'tent',
    jsonb_build_object('sender_id', NEW.sender_id, 'direct_message_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_direct_message_recipient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_direct_message_recipient() TO service_role;

DROP TRIGGER IF EXISTS trg_notify_direct_message_recipient ON public.direct_messages;
CREATE TRIGGER trg_notify_direct_message_recipient
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_direct_message_recipient();
