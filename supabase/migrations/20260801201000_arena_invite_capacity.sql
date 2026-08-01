-- A host is already one of the room players. Invitations cannot exceed the remaining seats.
CREATE OR REPLACE FUNCTION public.invite_arena_players(
  p_room_id uuid,
  p_inviter_id uuid,
  p_invitee_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_invitee uuid;
  v_invitees uuid[];
  v_invited_count integer := 0;
  v_inviter_name text;
  v_available_slots integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_inviter_id THEN RAISE EXCEPTION 'You can only send arena invites as yourself.'; END IF;
  PERFORM public.expire_stale_arena_rooms();
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'waiting' THEN RAISE EXCEPTION 'Room is not accepting invites.'; END IF;
  IF v_room.creator_id <> p_inviter_id THEN RAISE EXCEPTION 'Only the host can invite players to this room.'; END IF;
  SELECT greatest(0, v_room.max_players - count(*)) INTO v_available_slots FROM public.arena_participants WHERE room_id = p_room_id;
  SELECT coalesce(array_agg(candidate.invitee), '{}'::uuid[]) INTO v_invitees
  FROM (
    SELECT DISTINCT invitee
    FROM unnest(coalesce(p_invitee_ids, '{}'::uuid[])) AS invitee
    WHERE invitee IS NOT NULL AND invitee <> p_inviter_id
      AND NOT EXISTS (SELECT 1 FROM public.arena_participants participant WHERE participant.room_id = p_room_id AND participant.user_id = invitee)
    LIMIT v_available_slots
  ) candidate;
  SELECT display_name INTO v_inviter_name FROM public.profiles WHERE id = p_inviter_id;
  FOREACH v_invitee IN ARRAY v_invitees LOOP
    INSERT INTO public.arena_room_invites (room_id, inviter_id, invitee_id, status)
    VALUES (p_room_id, p_inviter_id, v_invitee, 'pending')
    ON CONFLICT (room_id, invitee_id) DO UPDATE
      SET inviter_id = EXCLUDED.inviter_id, status = 'pending', created_at = now(), responded_at = NULL;
    UPDATE public.arena_rooms
      SET tagged_user_ids = (SELECT coalesce(array_agg(DISTINCT user_id), '{}'::uuid[]) FROM unnest(coalesce(tagged_user_ids, '{}'::uuid[]) || ARRAY[v_invitee]) AS user_id)
      WHERE id = p_room_id;
    PERFORM public.notify_user(v_invitee, p_inviter_id, 'arena_invite', 'Arena invite', coalesce(v_inviter_name, 'A cadet') || ' invited you to "' || v_room.room_name || '".', 'arena', jsonb_build_object('room_id', p_room_id, 'inviter_id', p_inviter_id, 'stake_amount', v_room.stake_amount));
    v_invited_count := v_invited_count + 1;
  END LOOP;
  RETURN v_invited_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_arena_players(uuid, uuid, uuid[]) TO authenticated;
