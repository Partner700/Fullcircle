/*
# Direct Arena challenges from viewers

Lets a current Arena viewer challenge one active player in the match they are
watching. The resulting room is always one-to-one, reserves its second seat for
the named player, and continues to use the existing Arena stake and settlement
engine.
*/

ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS direct_challenge_user_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direct_challenge_source_room_id uuid
  REFERENCES public.arena_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direct_challenge_status text
  CHECK (direct_challenge_status IS NULL OR direct_challenge_status IN ('pending', 'accepted', 'declined', 'scheduled')),
  ADD COLUMN IF NOT EXISTS restarted_as_room_id uuid
  REFERENCES public.arena_rooms(id) ON DELETE SET NULL;

ALTER TABLE public.arena_chat_game_calls
  ADD COLUMN IF NOT EXISTS challenged_user_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS response_status text NOT NULL DEFAULT 'pending'
  CHECK (response_status IN ('pending', 'accepted', 'declined', 'scheduled')),
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

CREATE INDEX IF NOT EXISTS arena_rooms_direct_challenge_idx
  ON public.arena_rooms(direct_challenge_user_id)
  WHERE direct_challenge_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS arena_chat_game_calls_challenged_idx
  ON public.arena_chat_game_calls(challenged_user_id, created_at DESC)
  WHERE challenged_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS arena_one_unresolved_direct_challenge_idx
  ON public.arena_chat_game_calls(source_room_id, challenged_user_id)
  WHERE challenged_user_id IS NOT NULL
    AND response_status IN ('pending', 'scheduled');

DROP POLICY IF EXISTS "arena members read chat game calls" ON public.arena_chat_game_calls;
CREATE POLICY "arena members read chat game calls"
ON public.arena_chat_game_calls FOR SELECT TO authenticated
USING (
  creator_id = (SELECT auth.uid())
  OR challenged_user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    WHERE participant.room_id = arena_chat_game_calls.source_room_id
      AND participant.user_id = (SELECT auth.uid())
      AND participant.forfeited_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM public.arena_viewers viewer
    WHERE viewer.room_id = arena_chat_game_calls.source_room_id
      AND viewer.user_id = (SELECT auth.uid())
      AND viewer.last_seen_at >= now() - interval '2 minutes'
  )
);

CREATE OR REPLACE FUNCTION public.enforce_arena_direct_challenge_seat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id uuid;
  v_challenged_user_id uuid;
  v_challenge_status text;
BEGIN
  SELECT room.creator_id, room.direct_challenge_user_id, room.direct_challenge_status
  INTO v_creator_id, v_challenged_user_id, v_challenge_status
  FROM public.arena_rooms room
  WHERE room.id = NEW.room_id;

  IF v_challenged_user_id IS NOT NULL THEN
    IF NEW.user_id NOT IN (v_creator_id, v_challenged_user_id) THEN
      RAISE EXCEPTION 'This Arena seat is reserved for the challenged player.';
    END IF;
    IF NEW.user_id = v_challenged_user_id AND v_challenge_status <> 'accepted' THEN
      RAISE EXCEPTION 'Respond to this Arena challenge before taking its reserved seat.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_arena_direct_challenge_seat()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_arena_direct_challenge_seat ON public.arena_participants;
CREATE TRIGGER enforce_arena_direct_challenge_seat
BEFORE INSERT ON public.arena_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_arena_direct_challenge_seat();

DROP FUNCTION IF EXISTS public.create_arena_chat_game_call(uuid, text, integer, integer);
CREATE FUNCTION public.create_arena_chat_game_call(
  p_source_room_id uuid,
  p_game_type text,
  p_stake_amount integer,
  p_max_players integer DEFAULT 4,
  p_challenged_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_game_type text := lower(btrim(coalesce(p_game_type, '')));
  v_target_room_id uuid;
  v_display_name text;
  v_challenged_name text;
  v_room_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before calling an Arena game.';
  END IF;
  IF v_game_type NOT IN ('standard', 'ludo') THEN
    RAISE EXCEPTION 'Choose Standard Trivia or Ludo Trivia.';
  END IF;
  IF coalesce(p_stake_amount, 0) < 10 THEN
    RAISE EXCEPTION 'Arena stake must be at least 10 denarii.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    JOIN public.arena_viewers viewer ON viewer.room_id = room.id
    WHERE room.id = p_source_room_id
      AND room.status = 'playing'
      AND viewer.user_id = v_user_id
      AND viewer.last_seen_at >= now() - interval '2 minutes'
  ) THEN
    RAISE EXCEPTION 'Only a current viewer can call a game from this live chat.';
  END IF;

  IF p_challenged_user_id IS NOT NULL THEN
    IF p_challenged_user_id = v_user_id THEN
      RAISE EXCEPTION 'Choose another player to challenge.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.arena_rooms room
      JOIN public.arena_participants participant ON participant.room_id = room.id
      WHERE room.id = p_source_room_id
        AND room.status = 'playing'
        AND participant.user_id = p_challenged_user_id
        AND participant.forfeited_at IS NULL
    ) THEN
      RAISE EXCEPTION 'That player is no longer active in this match.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.arena_chat_game_calls game_call
      JOIN public.arena_rooms target ON target.id = game_call.target_room_id
      WHERE game_call.source_room_id = p_source_room_id
        AND game_call.challenged_user_id = p_challenged_user_id
        AND game_call.response_status IN ('pending', 'scheduled')
        AND target.status = 'waiting'
    ) THEN
      RAISE EXCEPTION 'That player already has an Arena challenge to answer.';
    END IF;
    p_max_players := 2;
  ELSE
    p_max_players := least(
      greatest(coalesce(p_max_players, 4), 2),
      CASE WHEN v_game_type = 'ludo' THEN 4 ELSE 8 END
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arena_chat_game_calls game_call
    JOIN public.arena_rooms target ON target.id = game_call.target_room_id
    WHERE game_call.source_room_id = p_source_room_id
      AND game_call.creator_id = v_user_id
      AND target.status IN ('waiting', 'playing')
  ) THEN
    RAISE EXCEPTION 'You already have an active game call in this chat.';
  END IF;

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'Arena player')
  INTO v_display_name
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  IF p_challenged_user_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(profile.display_name), ''), 'Arena player')
    INTO v_challenged_name
    FROM public.profiles profile
    WHERE profile.id = p_challenged_user_id;
  END IF;

  v_room_name := coalesce(v_display_name, 'Arena player')
    || CASE
      WHEN p_challenged_user_id IS NOT NULL THEN
        ' vs ' || coalesce(v_challenged_name, 'Arena player') || ' Challenge'
      WHEN v_game_type = 'ludo' THEN '''s Ludo Trivia Call'
      ELSE '''s Standard Trivia Call'
    END
    || ' [arena:' || v_game_type || ']';

  v_target_room_id := public.create_arena_room(
    v_user_id,
    v_room_name,
    p_stake_amount,
    p_max_players,
    NULL,
    '{}'::uuid[]
  );

  IF p_challenged_user_id IS NOT NULL THEN
    UPDATE public.arena_rooms
    SET direct_challenge_user_id = p_challenged_user_id,
        direct_challenge_source_room_id = p_source_room_id,
        direct_challenge_status = 'pending',
        tagged_user_ids = ARRAY[p_challenged_user_id]
    WHERE id = v_target_room_id;

    INSERT INTO public.arena_room_invites (room_id, inviter_id, invitee_id, status)
    VALUES (v_target_room_id, v_user_id, p_challenged_user_id, 'pending')
    ON CONFLICT (room_id, invitee_id) DO UPDATE
      SET inviter_id = EXCLUDED.inviter_id,
          status = 'pending',
          created_at = now(),
          responded_at = NULL;
  END IF;

  INSERT INTO public.arena_chat_game_calls (
    source_room_id,
    target_room_id,
    creator_id,
    challenged_user_id,
    game_type,
    stake_amount,
    max_players
  ) VALUES (
    p_source_room_id,
    v_target_room_id,
    v_user_id,
    p_challenged_user_id,
    v_game_type,
    p_stake_amount,
    p_max_players
  );

  IF p_challenged_user_id IS NOT NULL THEN
    PERFORM public.notify_user(
      p_challenged_user_id,
      v_user_id,
      'arena_invite',
      'Arena challenge',
      coalesce(v_display_name, 'An Arena viewer') || ' challenged you to '
        || CASE WHEN v_game_type = 'ludo' THEN 'Ludo Trivia' ELSE 'Standard Trivia' END
        || ' for ' || p_stake_amount || ' denarii.',
      'arena',
      jsonb_build_object(
        'room_id', v_target_room_id,
        'source_room_id', p_source_room_id,
        'inviter_id', v_user_id,
        'challenged_user_id', p_challenged_user_id,
        'game_type', v_game_type,
        'stake_amount', p_stake_amount,
        'direct_challenge', true
      )
    );
  END IF;

  RETURN v_target_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_arena_chat_challenge(
  p_target_room_id uuid,
  p_response text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_response text := lower(btrim(coalesce(p_response, '')));
  v_game_call public.arena_chat_game_calls%ROWTYPE;
  v_target_room public.arena_rooms%ROWTYPE;
  v_source_room public.arena_rooms%ROWTYPE;
  v_user_name text;
  v_viewer record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before responding to an Arena challenge.';
  END IF;
  IF v_response NOT IN ('accept', 'decline', 'schedule') THEN
    RAISE EXCEPTION 'Choose Accept, Decline, or Schedule next.';
  END IF;

  SELECT game_call.*
  INTO v_game_call
  FROM public.arena_chat_game_calls game_call
  WHERE game_call.target_room_id = p_target_room_id
    AND game_call.challenged_user_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That Arena challenge is no longer available.';
  END IF;
  IF v_game_call.challenged_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the challenged player can answer this Arena challenge.';
  END IF;
  IF v_game_call.response_status NOT IN ('pending', 'scheduled') THEN
    RAISE EXCEPTION 'That Arena challenge has already been answered.';
  END IF;

  SELECT * INTO v_target_room
  FROM public.arena_rooms room
  WHERE room.id = v_game_call.target_room_id
  FOR UPDATE;
  SELECT * INTO v_source_room
  FROM public.arena_rooms room
  WHERE room.id = v_game_call.source_room_id
  FOR UPDATE;

  IF v_target_room.status <> 'waiting' THEN
    RAISE EXCEPTION 'That Arena challenge is no longer waiting for players.';
  END IF;

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'The challenged player')
  INTO v_user_name
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  IF v_response = 'decline' THEN
    UPDATE public.arena_chat_game_calls
    SET response_status = 'declined', responded_at = now(), updated_at = now()
    WHERE id = v_game_call.id;
    UPDATE public.arena_rooms
    SET direct_challenge_status = 'declined',
        status = 'cancelled',
        completed_at = now(),
        closed_at = now(),
        closed_by = v_user_id
    WHERE id = v_target_room.id;
    UPDATE public.arena_room_invites
    SET status = 'declined', responded_at = now()
    WHERE room_id = v_target_room.id AND invitee_id = v_user_id;

    IF v_target_room.stake_amount > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = v_target_room.creator_id
        AND entry.source_type = 'arena_reward'
        AND entry.source_reference = v_target_room.id::text
        AND entry.description LIKE 'Arena challenge declined refund%'
    ) THEN
      INSERT INTO public.denarii_ledger_entries (
        user_id, amount, source_type, source_reference, description
      ) VALUES (
        v_target_room.creator_id,
        v_target_room.stake_amount,
        'arena_reward',
        v_target_room.id::text,
        'Arena challenge declined refund for ' || v_target_room.room_name
      );
    END IF;

    PERFORM public.notify_user(
      v_target_room.creator_id,
      v_user_id,
      'arena_invite',
      'Arena challenge declined',
      coalesce(v_user_name, 'The challenged player') || ' declined your Arena challenge.',
      'arena',
      jsonb_build_object('room_id', v_target_room.id, 'status', 'declined', 'direct_challenge', true)
    );
    RETURN v_target_room.id;
  END IF;

  IF v_response = 'schedule' THEN
    UPDATE public.arena_chat_game_calls
    SET response_status = 'scheduled', responded_at = now(), updated_at = now()
    WHERE id = v_game_call.id;
    UPDATE public.arena_rooms
    SET direct_challenge_status = 'scheduled',
        expires_at = greatest(coalesce(expires_at, now()), now() + interval '24 hours')
    WHERE id = v_target_room.id;
    PERFORM public.notify_user(
      v_target_room.creator_id,
      v_user_id,
      'arena_invite',
      'Arena challenge scheduled',
      coalesce(v_user_name, 'The challenged player') || ' scheduled your challenge as their next Arena match.',
      'arena',
      jsonb_build_object('room_id', v_target_room.id, 'status', 'scheduled', 'direct_challenge', true)
    );
    RETURN v_target_room.id;
  END IF;

  IF v_game_call.response_status = 'pending'
    AND (v_source_room.status <> 'playing' OR v_source_room.play_mode <> 'machine')
  THEN
    RAISE EXCEPTION 'Accept is available only while playing against the machine. Schedule next or decline this challenge.';
  END IF;
  IF v_game_call.response_status = 'scheduled' AND v_source_room.status = 'playing' THEN
    RAISE EXCEPTION 'Finish the current Arena match before starting this scheduled challenge.';
  END IF;

  UPDATE public.arena_chat_game_calls
  SET response_status = 'accepted', responded_at = now(), updated_at = now()
  WHERE id = v_game_call.id;
  UPDATE public.arena_rooms
  SET direct_challenge_status = 'accepted'
  WHERE id = v_target_room.id;

  IF v_source_room.status = 'playing' THEN
    UPDATE public.arena_participants
    SET forfeited_at = now(),
        forfeit_reason = 'accepted_challenge',
        finished_at = coalesce(finished_at, now())
    WHERE room_id = v_source_room.id
      AND user_id = v_user_id
      AND forfeited_at IS NULL;
    UPDATE public.arena_rooms
    SET status = 'completed',
        winner_id = NULL,
        completed_at = now(),
        completion_reason = 'forfeit',
        restarted_as_room_id = v_target_room.id
    WHERE id = v_source_room.id;
  ELSE
    UPDATE public.arena_rooms
    SET restarted_as_room_id = v_target_room.id
    WHERE id = v_source_room.id;
  END IF;

  PERFORM public.join_arena_room(v_target_room.id, v_user_id);

  FOR v_viewer IN
    SELECT viewer.user_id, viewer.joined_at
    FROM public.arena_viewers viewer
    WHERE viewer.room_id = v_source_room.id
      AND viewer.last_seen_at >= now() - interval '2 minutes'
      AND viewer.user_id NOT IN (v_target_room.creator_id, v_user_id)
  LOOP
    INSERT INTO public.arena_viewers (room_id, user_id, joined_at, last_seen_at)
    VALUES (v_target_room.id, v_viewer.user_id, v_viewer.joined_at, now())
    ON CONFLICT (room_id, user_id) DO UPDATE SET last_seen_at = now();
  END LOOP;
  DELETE FROM public.arena_viewers
  WHERE room_id = v_source_room.id;

  UPDATE public.arena_rooms
  SET status = 'playing', started_at = now(), expires_at = NULL
  WHERE id = v_target_room.id AND status = 'waiting';
  UPDATE public.arena_room_invites
  SET status = 'accepted', responded_at = now()
  WHERE room_id = v_target_room.id AND invitee_id = v_user_id;

  PERFORM public.notify_user(
    v_target_room.creator_id,
    v_user_id,
    'arena',
    'Arena challenge accepted',
    coalesce(v_user_name, 'The challenged player') || ' accepted. The challenge match is starting now.',
    'arena',
    jsonb_build_object('room_id', v_target_room.id, 'status', 'playing', 'direct_challenge', true)
  );
  PERFORM public.notify_user(
    v_user_id,
    v_target_room.creator_id,
    'arena',
    'Arena challenge started',
    'Your challenge match is starting now.',
    'arena',
    jsonb_build_object('room_id', v_target_room.id, 'status', 'playing', 'direct_challenge', true)
  );

  RETURN v_target_room.id;
END;
$$;

DROP FUNCTION IF EXISTS public.get_arena_chat_game_calls(uuid);
CREATE FUNCTION public.get_arena_chat_game_calls(p_source_room_id uuid)
RETURNS TABLE(
  id uuid,
  source_room_id uuid,
  target_room_id uuid,
  creator_id uuid,
  creator_name text,
  creator_avatar_url text,
  challenged_user_id uuid,
  challenged_user_name text,
  challenged_user_avatar_url text,
  challenge_status text,
  source_play_mode text,
  game_type text,
  room_name text,
  stake_amount integer,
  max_players integer,
  participant_count integer,
  participant_ids uuid[],
  room_status text,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.arena_chat_game_calls game_call
      WHERE game_call.source_room_id = p_source_room_id
        AND auth.uid() IN (game_call.creator_id, game_call.challenged_user_id)
    )
    OR
    EXISTS (
      SELECT 1
      FROM public.arena_participants participant
      WHERE participant.room_id = p_source_room_id
        AND participant.user_id = auth.uid()
        AND participant.forfeited_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.arena_viewers viewer
      WHERE viewer.room_id = p_source_room_id
        AND viewer.user_id = auth.uid()
        AND viewer.last_seen_at >= now() - interval '2 minutes'
    )
  ) THEN
    RAISE EXCEPTION 'Only players and current viewers can read this Arena chat.';
  END IF;

  RETURN QUERY
  SELECT
    game_call.id,
    game_call.source_room_id,
    game_call.target_room_id,
    game_call.creator_id,
    coalesce(creator.display_name, 'Arena player')::text,
    creator.avatar_url,
    game_call.challenged_user_id,
    challenged.display_name,
    challenged.avatar_url,
    game_call.response_status,
    source.play_mode,
    game_call.game_type,
    target.room_name,
    target.stake_amount,
    target.max_players,
    count(participant.user_id)::integer,
    coalesce(
      array_agg(participant.user_id ORDER BY participant.joined_at)
        FILTER (WHERE participant.user_id IS NOT NULL),
      '{}'::uuid[]
    ),
    target.status,
    target.expires_at,
    game_call.created_at,
    game_call.updated_at
  FROM public.arena_chat_game_calls game_call
  JOIN public.arena_rooms source ON source.id = game_call.source_room_id
  JOIN public.arena_rooms target ON target.id = game_call.target_room_id
  LEFT JOIN public.profiles creator ON creator.id = game_call.creator_id
  LEFT JOIN public.profiles challenged ON challenged.id = game_call.challenged_user_id
  LEFT JOIN public.arena_participants participant
    ON participant.room_id = target.id
    AND participant.forfeited_at IS NULL
  WHERE game_call.source_room_id = p_source_room_id
    AND game_call.created_at >= now() - interval '6 hours'
  GROUP BY game_call.id, creator.display_name, creator.avatar_url,
    challenged.display_name, challenged.avatar_url,
    source.id, source.play_mode,
    target.id, target.room_name, target.stake_amount, target.max_players,
    target.status, target.expires_at
  ORDER BY game_call.created_at ASC
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_arena_challenge_response_before_answer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.arena_chat_game_calls game_call
    JOIN public.arena_rooms target ON target.id = game_call.target_room_id
    WHERE game_call.source_room_id = NEW.room_id
      AND game_call.challenged_user_id = NEW.user_id
      AND game_call.response_status = 'pending'
      AND target.status = 'waiting'
  ) THEN
    RAISE EXCEPTION 'Respond to the Arena challenge before playing your next move.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_arena_challenge_response_before_answer()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS require_arena_challenge_response_before_answer
  ON public.arena_trivia_responses;
CREATE TRIGGER require_arena_challenge_response_before_answer
BEFORE INSERT ON public.arena_trivia_responses
FOR EACH ROW EXECUTE FUNCTION public.require_arena_challenge_response_before_answer();

CREATE OR REPLACE FUNCTION public.notify_scheduled_arena_challenge_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call record;
BEGIN
  IF OLD.status = 'playing' AND NEW.status <> 'playing' THEN
    FOR v_call IN
      SELECT game_call.target_room_id,
        game_call.creator_id,
        game_call.challenged_user_id
      FROM public.arena_chat_game_calls game_call
      JOIN public.arena_rooms target ON target.id = game_call.target_room_id
      WHERE game_call.source_room_id = NEW.id
        AND game_call.response_status = 'scheduled'
        AND target.status = 'waiting'
    LOOP
      UPDATE public.arena_rooms
      SET expires_at = greatest(coalesce(expires_at, now()), now() + interval '1 hour')
      WHERE id = v_call.target_room_id;
      PERFORM public.notify_user(
        v_call.challenged_user_id,
        v_call.creator_id,
        'arena_invite',
        'Scheduled Arena challenge ready',
        'Your current match has ended. Your scheduled Arena challenge is ready to start.',
        'arena',
        jsonb_build_object('room_id', v_call.target_room_id, 'status', 'scheduled', 'direct_challenge', true)
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_scheduled_arena_challenge_ready()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_scheduled_arena_challenge_ready ON public.arena_rooms;
CREATE TRIGGER notify_scheduled_arena_challenge_ready
AFTER UPDATE OF status ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.notify_scheduled_arena_challenge_ready();

REVOKE ALL ON FUNCTION public.create_arena_chat_game_call(uuid, text, integer, integer, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_arena_chat_challenge(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_arena_chat_game_calls(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_arena_chat_game_call(uuid, text, integer, integer, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_arena_chat_challenge(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_arena_chat_game_calls(uuid)
  TO authenticated;
