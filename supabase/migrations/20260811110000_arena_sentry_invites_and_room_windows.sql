-- Arena waiting-room windows and broader invite support.
-- Empty player rooms expire after 15 minutes. Once another player joins, the
-- host has 10 minutes to launch before the room expires and stakes are refunded.

CREATE OR REPLACE FUNCTION public.expire_stale_arena_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room record;
  v_participant record;
  v_refund integer;
  v_expired_count integer := 0;
BEGIN
  FOR v_room IN
    SELECT
      r.*,
      (SELECT count(*) FROM public.arena_participants ap WHERE ap.room_id = r.id) AS participant_count
    FROM public.arena_rooms r
    WHERE r.status = 'waiting'
      AND COALESCE(r.expires_at, r.created_at + interval '15 minutes') <= now()
  LOOP
    UPDATE public.arena_rooms
    SET status = 'expired',
        closed_at = now(),
        completed_at = now()
    WHERE id = v_room.id AND status = 'waiting';

    IF FOUND THEN
      v_expired_count := v_expired_count + 1;

      UPDATE public.arena_room_invites
      SET status = 'expired', responded_at = now()
      WHERE room_id = v_room.id AND status = 'pending';

      FOR v_participant IN
        SELECT user_id FROM public.arena_participants WHERE room_id = v_room.id
      LOOP
        v_refund := COALESCE(v_room.stake_amount, 0)
          + CASE WHEN v_participant.user_id = v_room.creator_id THEN COALESCE(v_room.game_call_fee, 0) ELSE 0 END;

        IF v_refund > 0 AND NOT EXISTS (
          SELECT 1 FROM public.denarii_ledger_entries
          WHERE user_id = v_participant.user_id
            AND source_type = 'arena_reward'
            AND source_reference = v_room.id::text
            AND description LIKE 'Arena room expired refund%'
        ) THEN
          INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
          VALUES (v_participant.user_id, v_refund, 'arena_reward', v_room.id::text, 'Arena room expired refund for ' || v_room.room_name);
        END IF;

        PERFORM public.notify_user(
          v_participant.user_id,
          NULL,
          'arena',
          'Arena room expired',
          '"' || v_room.room_name || '" closed automatically before the host launched the game.',
          'arena',
          jsonb_build_object('room_id', v_room.id, 'status', 'expired')
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_arena_room(
  p_creator_id uuid,
  p_room_name text,
  p_stake_amount integer,
  p_max_players integer DEFAULT 4,
  p_narrative_date text DEFAULT NULL,
  p_tagged_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_balance bigint;
  v_game_fee integer := 10;
  v_invitee uuid;
  v_invitees uuid[];
  v_creator_name text;
  v_room_name text := COALESCE(NULLIF(btrim(p_room_name), ''), 'Arena Room');
  v_expires_at timestamptz := now() + interval '15 minutes';
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_creator_id THEN
    RAISE EXCEPTION 'You can only create arena rooms for yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  IF p_stake_amount < 10 THEN
    RAISE EXCEPTION 'Arena stake must be at least 10 denarii.';
  END IF;

  p_max_players := LEAST(GREATEST(COALESCE(p_max_players, 4), 2), 8);

  SELECT public.get_user_denarii_total(p_creator_id) INTO v_balance;
  IF v_balance < (p_stake_amount + v_game_fee) THEN
    RAISE EXCEPTION 'Insufficient denarii. You need % (stake + 10 game fee) but have %.',
      (p_stake_amount + v_game_fee), v_balance;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT invitee), '{}'::uuid[]) INTO v_invitees
  FROM unnest(COALESCE(p_tagged_user_ids, '{}'::uuid[])) AS invitee
  WHERE invitee IS NOT NULL AND invitee <> p_creator_id;

  INSERT INTO public.arena_rooms (
    creator_id,
    room_name,
    stake_amount,
    max_players,
    narrative_date,
    tagged_user_ids,
    game_call_fee,
    status,
    expires_at
  )
  VALUES (
    p_creator_id,
    v_room_name,
    p_stake_amount,
    p_max_players,
    p_narrative_date,
    v_invitees,
    v_game_fee,
    'waiting',
    v_expires_at
  )
  RETURNING id INTO v_id;

  INSERT INTO public.arena_participants (room_id, user_id, stake_paid)
  VALUES (v_id, p_creator_id, true)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_creator_id, -p_stake_amount, 'arena_stake', v_id::text, 'Arena stake for room ' || v_room_name);

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_creator_id, -v_game_fee, 'arena_fee', v_id::text, 'Arena game call fee for room ' || v_room_name);

  SELECT display_name INTO v_creator_name FROM public.profiles WHERE id = p_creator_id;

  PERFORM public.notify_user(
    p_creator_id,
    NULL,
    'arena',
    'Arena room created',
    '"' || v_room_name || '" is open for 15 minutes. Once another player joins, launch within 10 minutes.',
    'arena',
    jsonb_build_object('room_id', v_id, 'status', 'waiting', 'expires_at', v_expires_at)
  );

  FOREACH v_invitee IN ARRAY v_invitees
  LOOP
    INSERT INTO public.arena_room_invites (room_id, inviter_id, invitee_id, status)
    VALUES (v_id, p_creator_id, v_invitee, 'pending')
    ON CONFLICT (room_id, invitee_id) DO UPDATE
      SET inviter_id = EXCLUDED.inviter_id,
          status = 'pending',
          created_at = now(),
          responded_at = NULL;

    PERFORM public.notify_user(
      v_invitee,
      p_creator_id,
      'arena_invite',
      'Arena invite',
      COALESCE(v_creator_name, 'A player') || ' invited you to "' || v_room_name || '".',
      'arena',
      jsonb_build_object('room_id', v_id, 'inviter_id', p_creator_id, 'stake_amount', p_stake_amount)
    );
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_arena_room(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_balance bigint;
  v_count integer;
  v_joiner_name text;
  v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only join arena rooms as yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  SELECT * INTO v_room
  FROM public.arena_rooms
  WHERE id = p_room_id AND status = 'waiting'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found or not accepting players.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    UPDATE public.arena_room_invites
    SET status = 'accepted', responded_at = now()
    WHERE room_id = p_room_id AND invitee_id = p_user_id AND status = 'pending';
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
  IF v_count >= v_room.max_players THEN
    RAISE EXCEPTION 'Room is full.';
  END IF;

  SELECT public.get_user_denarii_total(p_user_id) INTO v_balance;
  IF v_balance < v_room.stake_amount THEN
    RAISE EXCEPTION 'Insufficient denarii for stake. You need % but have %.', v_room.stake_amount, v_balance;
  END IF;

  INSERT INTO public.arena_participants (room_id, user_id, stake_paid)
  VALUES (p_room_id, p_user_id, true);

  IF v_count = 1 THEN
    UPDATE public.arena_rooms
    SET expires_at = now() + interval '10 minutes'
    WHERE id = p_room_id AND status = 'waiting';
  END IF;

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_user_id, -v_room.stake_amount, 'arena_stake', p_room_id::text, 'Arena stake for room ' || v_room.room_name);

  UPDATE public.arena_room_invites
  SET status = 'accepted', responded_at = now()
  WHERE room_id = p_room_id AND invitee_id = p_user_id AND status = 'pending';

  SELECT display_name INTO v_joiner_name FROM public.profiles WHERE id = p_user_id;

  FOR v_participant IN
    SELECT user_id FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id <> p_user_id
  LOOP
    PERFORM public.notify_user(
      v_participant.user_id,
      p_user_id,
      'arena',
      'Arena player joined',
      COALESCE(v_joiner_name, 'A player') || ' joined "' || v_room.room_name || '". Launch within 10 minutes.',
      'arena',
      jsonb_build_object('room_id', p_room_id, 'joined_user_id', p_user_id)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_machine_arena_room(
  p_creator_id uuid,
  p_room_name text DEFAULT 'Bible Trail vs Machine',
  p_narrative_date text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_balance bigint;
  v_name text := COALESCE(NULLIF(btrim(p_room_name), ''), 'Bible Trail vs Machine');
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_creator_id THEN
    RAISE EXCEPTION 'You can only create a machine match for yourself.';
  END IF;

  PERFORM public.expire_stale_arena_rooms();

  SELECT public.get_user_denarii_total(p_creator_id) INTO v_balance;
  IF v_balance < 50 THEN
    RAISE EXCEPTION 'A machine match costs 50 denarii.';
  END IF;

  INSERT INTO public.arena_rooms (creator_id, room_name, stake_amount, max_players, narrative_date, status, expires_at, play_mode, machine_score)
  VALUES (p_creator_id, v_name, 50, 1, p_narrative_date, 'waiting', now() + interval '15 minutes', 'machine', 7 + floor(random() * 10)::integer)
  RETURNING id INTO v_id;

  INSERT INTO public.arena_participants (room_id, user_id, stake_paid)
  VALUES (v_id, p_creator_id, true);

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_creator_id, -50, 'arena_stake', v_id::text, 'Machine arena stake for ' || v_name);

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_arena_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_arena_room(uuid, text, integer, integer, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_arena_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_machine_arena_room(uuid, text, text) TO authenticated;
