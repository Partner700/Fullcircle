/*
  Add a permission-scoped profile CV and retire Dove message deliveries as
  soon as their conversation has been opened.
*/

CREATE OR REPLACE FUNCTION public.get_profile_cv(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_result jsonb;
BEGIN
  IF v_caller IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND v_caller IS DISTINCT FROM v_target
     AND NOT public.is_instructor(v_caller)
     AND NOT EXISTS (
       SELECT 1
       FROM public.tents tent
       JOIN public.tent_members member ON member.tent_id = tent.id
       WHERE tent.sentry_id = v_caller
         AND member.user_id = v_target
     )
  THEN
    RAISE EXCEPTION 'You cannot view this profile.';
  END IF;

  SELECT jsonb_build_object(
    'user_id', profile.id,
    'display_name', profile.display_name,
    'avatar_url', profile.avatar_url,
    'role', coalesce(active_role.role, 'cadet'),
    'tent_id', home_tent.id,
    'tent_name', home_tent.name,
    'tent_house_id', home_tent.tent_house_id,
    'member_since', profile.created_at,
    'total_denarii', stats.total_denarii,
    'current_streak', stats.current_streak,
    'longest_streak', stats.longest_streak,
    'total_figs', stats.total_figs,
    'rhudes', stats.rhudes,
    'marks', stats.marks
  )
  INTO v_result
  FROM public.profiles profile
  CROSS JOIN LATERAL public.get_user_live_stats(profile.id) stats
  LEFT JOIN LATERAL (
    SELECT assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.user_id = profile.id
      AND assignment.status IN ('active', 'approved', 'promoted')
      AND (assignment.end_date IS NULL OR assignment.end_date >= timezone('Africa/Douala', now())::date)
    ORDER BY CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
             assignment.created_at DESC
    LIMIT 1
  ) active_role ON true
  LEFT JOIN LATERAL (
    SELECT tent.id, tent.name, tent.tent_house_id
    FROM public.tents tent
    LEFT JOIN public.tent_members member
      ON member.tent_id = tent.id
     AND member.user_id = profile.id
    WHERE member.user_id IS NOT NULL OR tent.sentry_id = profile.id
    ORDER BY coalesce(member.joined_at, tent.created_at) DESC
    LIMIT 1
  ) home_tent ON true
  WHERE profile.id = v_target;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'This Full Circle profile does not exist.';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_cv(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_cv(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.retire_opened_direct_message_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.read_at IS NULL OR OLD.read_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.user_notifications notification
  SET read_at = NEW.read_at
  WHERE notification.recipient_id = NEW.recipient_id
    AND notification.read_at IS NULL
    AND (
      notification.metadata ->> 'direct_message_id' = NEW.id::text
      OR (
        notification.metadata ->> 'source_table' = 'direct_messages'
        AND notification.metadata ->> 'message_id' = NEW.id::text
      )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retire_opened_direct_message_notification ON public.direct_messages;
CREATE TRIGGER trg_retire_opened_direct_message_notification
AFTER UPDATE OF read_at ON public.direct_messages
FOR EACH ROW
EXECUTE FUNCTION private.retire_opened_direct_message_notification();

CREATE OR REPLACE FUNCTION private.retire_opened_tent_message_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.read_at IS NULL OR OLD.read_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.user_notifications notification
  SET read_at = NEW.read_at
  WHERE notification.recipient_id = NEW.recipient_id
    AND notification.read_at IS NULL
    AND notification.metadata ->> 'message_id' = NEW.id::text
    AND coalesce(notification.metadata ->> 'tent_id', NEW.tent_id::text) = NEW.tent_id::text;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retire_opened_tent_message_notification ON public.tent_messages;
CREATE TRIGGER trg_retire_opened_tent_message_notification
AFTER UPDATE OF read_at ON public.tent_messages
FOR EACH ROW
EXECUTE FUNCTION private.retire_opened_tent_message_notification();

CREATE OR REPLACE FUNCTION public.mark_open_message_notifications_read(
  p_source_table text,
  p_sender_id uuid DEFAULT NULL,
  p_tent_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_source_table NOT IN ('direct_messages', 'tent_messages', 'tent_group_messages') THEN
    RAISE EXCEPTION 'Unsupported message source.';
  END IF;

  UPDATE public.user_notifications notification
  SET read_at = now()
  WHERE notification.recipient_id = v_user_id
    AND notification.read_at IS NULL
    AND CASE p_source_table
      WHEN 'direct_messages' THEN
        p_sender_id IS NOT NULL
        AND coalesce(nullif(notification.metadata ->> 'sender_id', ''), notification.actor_id::text) = p_sender_id::text
        AND (
          notification.notification_type = 'direct_message'
          OR notification.metadata ? 'direct_message_id'
          OR notification.metadata ->> 'source_table' = 'direct_messages'
        )
      WHEN 'tent_messages' THEN
        p_sender_id IS NOT NULL
        AND p_tent_id IS NOT NULL
        AND coalesce(nullif(notification.metadata ->> 'sender_id', ''), notification.actor_id::text) = p_sender_id::text
        AND notification.metadata ->> 'tent_id' = p_tent_id::text
        AND NOT (notification.metadata ? 'group_message_id')
      WHEN 'tent_group_messages' THEN
        p_tent_id IS NOT NULL
        AND notification.metadata ->> 'tent_id' = p_tent_id::text
        AND notification.metadata ? 'group_message_id'
      ELSE false
    END;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_open_message_notifications_read(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_open_message_notifications_read(text, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.retire_opened_direct_message_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.retire_opened_tent_message_notification() FROM PUBLIC, anon, authenticated;

-- Clean up stale Dove deliveries for messages that were opened before this
-- trigger existed.
UPDATE public.user_notifications notification
SET read_at = message.read_at
FROM public.direct_messages message
WHERE message.read_at IS NOT NULL
  AND notification.recipient_id = message.recipient_id
  AND notification.read_at IS NULL
  AND (
    notification.metadata ->> 'direct_message_id' = message.id::text
    OR (
      notification.metadata ->> 'source_table' = 'direct_messages'
      AND notification.metadata ->> 'message_id' = message.id::text
    )
  );

UPDATE public.user_notifications notification
SET read_at = message.read_at
FROM public.tent_messages message
WHERE message.read_at IS NOT NULL
  AND notification.recipient_id = message.recipient_id
  AND notification.read_at IS NULL
  AND notification.metadata ->> 'message_id' = message.id::text
  AND coalesce(notification.metadata ->> 'tent_id', message.tent_id::text) = message.tent_id::text;
