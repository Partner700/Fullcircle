create index if not exists user_notifications_unread_type_time_idx on public.user_notifications(recipient_id,notification_type,created_at desc) where read_at is null;

CREATE OR REPLACE FUNCTION public.get_public_arena_chat(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.arena_rooms WHERE id = p_room_id
    AND status IN ('waiting', 'playing') AND completed_at IS NULL
    AND (status <> 'waiting' OR coalesce(expires_at, created_at + interval '15 minutes') > now())
    AND (status <> 'playing' OR (started_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.arena_participants participant
      WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL
        AND participant.finished_at IS NULL
        AND coalesce(participant.last_active_at, participant.joined_at, arena_rooms.started_at) > now() - interval '3 minutes'
    )))) THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(message ORDER BY created_at)
    FROM (
      SELECT jsonb_build_object('id', member.id, 'room_id', member.room_id,
        'sender_id', member.sender_id, 'body', member.body, 'created_at', member.created_at,
        'sender', jsonb_build_object('id', profile.id, 'display_name', profile.display_name,
          'avatar_url', profile.avatar_url)) AS message, member.created_at
      FROM public.arena_room_messages member JOIN public.profiles profile ON profile.id = member.sender_id
      WHERE member.room_id = p_room_id
      UNION ALL
      SELECT jsonb_build_object('id', guest.id, 'room_id', guest.room_id,
        'sender_id', NULL, 'body', guest.body, 'created_at', guest.created_at,
        'sender', jsonb_build_object('id', NULL, 'display_name', 'Guest witness', 'avatar_url', NULL)), guest.created_at
      FROM public.arena_guest_messages guest WHERE guest.room_id = p_room_id
      ORDER BY created_at DESC LIMIT 80
    ) recent), '[]'::jsonb);
END;
$function$
;
