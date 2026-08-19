-- Tent-wide group chat with member-scoped access and notifications.

CREATE TABLE IF NOT EXISTS public.tent_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tent_id uuid NOT NULL REFERENCES public.tents(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tent_group_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tent_group_messages_tent_created
  ON public.tent_group_messages(tent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tent_group_messages_sender
  ON public.tent_group_messages(sender_id);

DROP POLICY IF EXISTS tent_group_messages_select_members ON public.tent_group_messages;
CREATE POLICY tent_group_messages_select_members
  ON public.tent_group_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tent_members member
      WHERE member.tent_id = tent_group_messages.tent_id
        AND member.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.role_assignments role
      WHERE role.user_id = auth.uid()
        AND role.role = 'instructor'
        AND role.status IN ('active', 'approved')
        AND (role.end_date IS NULL OR role.end_date >= timezone('Africa/Douala', now())::date)
    )
  );

DROP POLICY IF EXISTS tent_group_messages_insert_members ON public.tent_group_messages;
CREATE POLICY tent_group_messages_insert_members
  ON public.tent_group_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1
        FROM public.tent_members member
        WHERE member.tent_id = tent_group_messages.tent_id
          AND member.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.role_assignments role
        WHERE role.user_id = auth.uid()
          AND role.role = 'instructor'
          AND role.status IN ('active', 'approved')
          AND (role.end_date IS NULL OR role.end_date >= timezone('Africa/Douala', now())::date)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.notify_tent_group_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient uuid;
  sender_name text;
  tent_name text;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO tent_name FROM public.tents WHERE id = NEW.tent_id;

  FOR recipient IN
    SELECT DISTINCT member.user_id
    FROM public.tent_members member
    WHERE member.tent_id = NEW.tent_id
      AND member.user_id IS DISTINCT FROM NEW.sender_id
  LOOP
    PERFORM public.notify_user(
      recipient,
      NEW.sender_id,
      'message',
      COALESCE(tent_name, 'Tent chat'),
      COALESCE(sender_name, 'A tent member') || ' sent a message in the tent chat.',
      'tent',
      jsonb_build_object(
        'tent_id', NEW.tent_id,
        'group_message_id', NEW.id,
        'message_preview', left(NEW.body, 120)
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_tent_group_message_insert ON public.tent_group_messages;
CREATE TRIGGER trg_notify_tent_group_message_insert
  AFTER INSERT ON public.tent_group_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tent_group_message_insert();

GRANT SELECT, INSERT ON public.tent_group_messages TO authenticated;
