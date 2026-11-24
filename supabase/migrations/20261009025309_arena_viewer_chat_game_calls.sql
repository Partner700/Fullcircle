/*
# Arena viewer chat and game calls

Lets current Arena viewers participate in room chat and create stake-backed
Standard Trivia or Ludo Trivia calls. A call always points to a real Arena
room, so existing capacity, stake, expiry, start, and settlement rules remain
authoritative.
*/

CREATE TABLE IF NOT EXISTS public.arena_chat_game_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  target_room_id uuid NOT NULL UNIQUE REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_type text NOT NULL CHECK (game_type IN ('standard', 'ludo')),
  stake_amount integer NOT NULL CHECK (stake_amount >= 10),
  max_players integer NOT NULL CHECK (max_players BETWEEN 2 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arena_chat_game_calls_source_created_idx
  ON public.arena_chat_game_calls(source_room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arena_chat_game_calls_creator_idx
  ON public.arena_chat_game_calls(creator_id, created_at DESC);

ALTER TABLE public.arena_chat_game_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_chat_game_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.arena_chat_game_calls TO authenticated;

DROP POLICY IF EXISTS "arena members read chat game calls" ON public.arena_chat_game_calls;
CREATE POLICY "arena members read chat game calls"
ON public.arena_chat_game_calls FOR SELECT TO authenticated
USING (
  EXISTS (
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

-- A full waiting room can still be entered as a viewer before the host starts.
DROP POLICY IF EXISTS "authenticated users see live arena viewers" ON public.arena_viewers;
CREATE POLICY "authenticated users see live arena viewers"
ON public.arena_viewers FOR SELECT TO authenticated
USING (
  last_seen_at >= now() - interval '2 minutes'
  AND EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = arena_viewers.room_id
      AND room.status IN ('waiting', 'playing', 'completed')
  )
);

DROP POLICY IF EXISTS "users join arena as themselves" ON public.arena_viewers;
CREATE POLICY "users join arena as themselves"
ON public.arena_viewers FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = arena_viewers.room_id
      AND room.status IN ('waiting', 'playing')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    WHERE participant.room_id = arena_viewers.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "users refresh their own arena view" ON public.arena_viewers;
CREATE POLICY "users refresh their own arena view"
ON public.arena_viewers FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = arena_viewers.room_id
      AND room.status IN ('waiting', 'playing')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    WHERE participant.room_id = arena_viewers.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.watch_arena_room(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before watching an Arena match.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = p_room_id
      AND room.status IN ('waiting', 'playing')
  ) THEN
    RAISE EXCEPTION 'This Arena match is not available to watch.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id
      AND participant.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are already playing in this Arena match.';
  END IF;

  DELETE FROM public.arena_viewers viewer
  WHERE viewer.user_id = v_user_id
    AND viewer.room_id <> p_room_id;

  INSERT INTO public.arena_viewers (room_id, user_id)
  VALUES (p_room_id, v_user_id)
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET last_seen_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_arena_viewer(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.arena_viewers viewer
  SET last_seen_at = now()
  FROM public.arena_rooms room
  WHERE viewer.room_id = p_room_id
    AND viewer.user_id = auth.uid()
    AND room.id = viewer.room_id
    AND room.status IN ('waiting', 'playing');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.watch_arena_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_arena_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.watch_arena_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_arena_viewer(uuid) TO authenticated;

-- Viewers can speak, but cannot submit game answers or issue game commands.
DROP POLICY IF EXISTS "arena members write waiting room chat" ON public.arena_room_messages;
DROP POLICY IF EXISTS "arena players and viewers write room chat" ON public.arena_room_messages;
CREATE POLICY "arena players and viewers write room chat"
ON public.arena_room_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND (
    EXISTS (
      SELECT 1
      FROM public.arena_participants participant
      WHERE participant.room_id = arena_room_messages.room_id
        AND participant.user_id = (SELECT auth.uid())
        AND participant.forfeited_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.arena_viewers viewer
      WHERE viewer.room_id = arena_room_messages.room_id
        AND viewer.user_id = (SELECT auth.uid())
        AND viewer.last_seen_at >= now() - interval '2 minutes'
    )
  )
);

GRANT SELECT, INSERT ON public.arena_room_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.create_arena_chat_game_call(
  p_source_room_id uuid,
  p_game_type text,
  p_stake_amount integer,
  p_max_players integer DEFAULT 4
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
  p_max_players := least(
    greatest(coalesce(p_max_players, 4), 2),
    CASE WHEN v_game_type = 'ludo' THEN 4 ELSE 8 END
  );

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

  v_room_name := coalesce(v_display_name, 'Arena player')
    || CASE WHEN v_game_type = 'ludo' THEN '''s Ludo Trivia Call' ELSE '''s Standard Trivia Call' END
    || ' [arena:' || v_game_type || ']';

  v_target_room_id := public.create_arena_room(
    v_user_id,
    v_room_name,
    p_stake_amount,
    p_max_players,
    NULL,
    '{}'::uuid[]
  );

  INSERT INTO public.arena_chat_game_calls (
    source_room_id,
    target_room_id,
    creator_id,
    game_type,
    stake_amount,
    max_players
  ) VALUES (
    p_source_room_id,
    v_target_room_id,
    v_user_id,
    v_game_type,
    p_stake_amount,
    p_max_players
  );

  RETURN v_target_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_arena_chat_game_calls(p_source_room_id uuid)
RETURNS TABLE(
  id uuid,
  source_room_id uuid,
  target_room_id uuid,
  creator_id uuid,
  creator_name text,
  creator_avatar_url text,
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
    coalesce(profile.display_name, 'Arena player')::text,
    profile.avatar_url,
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
  JOIN public.arena_rooms target ON target.id = game_call.target_room_id
  LEFT JOIN public.profiles profile ON profile.id = game_call.creator_id
  LEFT JOIN public.arena_participants participant
    ON participant.room_id = target.id
    AND participant.forfeited_at IS NULL
  WHERE game_call.source_room_id = p_source_room_id
    AND game_call.created_at >= now() - interval '6 hours'
  GROUP BY game_call.id, profile.display_name, profile.avatar_url,
    target.id, target.room_name, target.stake_amount, target.max_players,
    target.status, target.expires_at
  ORDER BY game_call.created_at ASC
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.create_arena_chat_game_call(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_arena_chat_game_calls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_arena_chat_game_call(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_arena_chat_game_calls(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_arena_chat_game_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.arena_chat_game_calls
  SET updated_at = now()
  WHERE target_room_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_arena_chat_game_call_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_room_id := OLD.room_id;
  ELSE
    v_room_id := NEW.room_id;
  END IF;

  UPDATE public.arena_chat_game_calls
  SET updated_at = now()
  WHERE target_room_id = v_room_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_arena_chat_game_call() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_arena_chat_game_call_participants() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_arena_chat_call_after_room_status ON public.arena_rooms;
CREATE TRIGGER touch_arena_chat_call_after_room_status
AFTER UPDATE OF status, expires_at ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.touch_arena_chat_game_call();

DROP TRIGGER IF EXISTS touch_arena_chat_call_after_participant_change ON public.arena_participants;
CREATE TRIGGER touch_arena_chat_call_after_participant_change
AFTER INSERT OR DELETE ON public.arena_participants
FOR EACH ROW EXECUTE FUNCTION public.touch_arena_chat_game_call_participants();

DROP TRIGGER IF EXISTS touch_arena_chat_call_after_participant_forfeit ON public.arena_participants;
CREATE TRIGGER touch_arena_chat_call_after_participant_forfeit
AFTER UPDATE OF forfeited_at ON public.arena_participants
FOR EACH ROW EXECUTE FUNCTION public.touch_arena_chat_game_call_participants();

ALTER TABLE public.arena_chat_game_calls REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'arena_chat_game_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_chat_game_calls;
  END IF;
END $$;
