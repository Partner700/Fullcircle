/*
# Live Arena spectators

Adds read-only Arena viewing without turning spectators into participants.
Viewer presence is short-lived, server-stamped, and never affects stakes,
capacity, turns, scores, rewards, or forfeits.
*/

CREATE TABLE IF NOT EXISTS public.arena_viewers (
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS arena_viewers_room_presence_idx
  ON public.arena_viewers(room_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS arena_viewers_user_presence_idx
  ON public.arena_viewers(user_id, last_seen_at DESC);

ALTER TABLE public.arena_viewers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users see live arena viewers" ON public.arena_viewers;
CREATE POLICY "authenticated users see live arena viewers"
ON public.arena_viewers FOR SELECT TO authenticated
USING (
  last_seen_at >= now() - interval '2 minutes'
  AND EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = arena_viewers.room_id
      AND room.status IN ('playing', 'completed')
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
      AND room.status = 'playing'
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
      AND room.status = 'playing'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    WHERE participant.room_id = arena_viewers.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "users leave their own arena view" ON public.arena_viewers;
CREATE POLICY "users leave their own arena view"
ON public.arena_viewers FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.arena_viewers TO authenticated;

CREATE OR REPLACE FUNCTION public.stamp_arena_viewer_presence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.joined_at := now();
  ELSIF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    NEW.joined_at := now();
  ELSE
    NEW.joined_at := OLD.joined_at;
  END IF;
  NEW.last_seen_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_arena_viewer_presence() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_arena_viewer_presence_before_write ON public.arena_viewers;
CREATE TRIGGER stamp_arena_viewer_presence_before_write
BEFORE INSERT OR UPDATE ON public.arena_viewers
FOR EACH ROW EXECUTE FUNCTION public.stamp_arena_viewer_presence();

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
    SELECT 1 FROM public.arena_rooms room
    WHERE room.id = p_room_id AND room.status = 'playing'
  ) THEN
    RAISE EXCEPTION 'This Arena match is not live.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id AND participant.user_id = v_user_id
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
    AND room.status = 'playing';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_arena_room_view(p_room_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  DELETE FROM public.arena_viewers
  WHERE room_id = p_room_id AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.watch_arena_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_arena_viewer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_arena_room_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.watch_arena_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_arena_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_arena_room_view(uuid) TO authenticated;

-- Viewers may read the same sanitised match surfaces as players. They still
-- cannot write chat, submit answers, move pawns, settle games, or earn rewards.
DROP POLICY IF EXISTS "arena members read waiting room chat" ON public.arena_room_messages;
DROP POLICY IF EXISTS "arena players and viewers read room chat" ON public.arena_room_messages;
CREATE POLICY "arena players and viewers read room chat"
ON public.arena_room_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = arena_room_messages.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.arena_viewers viewer
    WHERE viewer.room_id = arena_room_messages.room_id
      AND viewer.user_id = (SELECT auth.uid())
      AND viewer.last_seen_at >= now() - interval '2 minutes'
  )
);

DROP POLICY IF EXISTS "arena players and viewers read trivia responses" ON public.arena_trivia_responses;
CREATE POLICY "arena players and viewers read trivia responses"
ON public.arena_trivia_responses FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = arena_trivia_responses.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.arena_viewers viewer
    WHERE viewer.room_id = arena_trivia_responses.room_id
      AND viewer.user_id = (SELECT auth.uid())
      AND viewer.last_seen_at >= now() - interval '2 minutes'
  )
);

GRANT SELECT ON public.arena_trivia_responses TO authenticated;

DROP POLICY IF EXISTS "arena players read ludo public state" ON public.arena_ludo_public_states;
DROP POLICY IF EXISTS "arena players and viewers read ludo public state" ON public.arena_ludo_public_states;
CREATE POLICY "arena players and viewers read ludo public state"
ON public.arena_ludo_public_states FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = arena_ludo_public_states.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.arena_viewers viewer
    WHERE viewer.room_id = arena_ludo_public_states.room_id
      AND viewer.user_id = (SELECT auth.uid())
      AND viewer.last_seen_at >= now() - interval '2 minutes'
  )
);

DROP POLICY IF EXISTS "arena players read ludo events" ON public.arena_ludo_events;
DROP POLICY IF EXISTS "arena players and viewers read ludo events" ON public.arena_ludo_events;
CREATE POLICY "arena players and viewers read ludo events"
ON public.arena_ludo_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = arena_ludo_events.room_id
      AND participant.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.arena_viewers viewer
    WHERE viewer.room_id = arena_ludo_events.room_id
      AND viewer.user_id = (SELECT auth.uid())
      AND viewer.last_seen_at >= now() - interval '2 minutes'
  )
);

CREATE OR REPLACE FUNCTION public.get_arena_trivia_feed(p_room_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_url text,
  question_index integer,
  submitted_answer text,
  is_correct boolean,
  figs_earned integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.arena_participants participant
      WHERE participant.room_id = p_room_id
        AND participant.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.arena_viewers viewer
      WHERE viewer.room_id = p_room_id
        AND viewer.user_id = auth.uid()
        AND viewer.last_seen_at >= now() - interval '2 minutes'
    )
  ) THEN
    RAISE EXCEPTION 'Only players and current viewers can watch this Arena feed.';
  END IF;

  RETURN QUERY
  SELECT feed.user_id, feed.display_name, feed.avatar_url,
    feed.question_index, feed.submitted_answer, feed.is_correct,
    feed.figs_earned, feed.created_at
  FROM (
    SELECT response.user_id, profile.display_name, profile.avatar_url,
      response.question_index, response.submitted_answer, response.is_correct,
      response.figs_earned, response.created_at
    FROM public.arena_trivia_responses response
    JOIN public.profiles profile ON profile.id = response.user_id
    WHERE response.room_id = p_room_id

    UNION ALL

    SELECT '00000000-0000-0000-0000-000000000000'::uuid, 'The Scribe'::text, NULL::text,
      machine.question_index, machine.submitted_answer, machine.is_correct,
      machine.figs_earned, machine.created_at
    FROM public.arena_machine_trivia_responses machine
    WHERE machine.room_id = p_room_id
  ) feed
  ORDER BY feed.created_at DESC
  LIMIT 160;
END;
$$;

REVOKE ALL ON FUNCTION public.get_arena_trivia_feed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_trivia_feed(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_arena_match_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient record;
  v_player_names text;
  v_player_count integer := 0;
  v_room_name text;
BEGIN
  IF NEW.status <> 'playing' OR OLD.status = 'playing' THEN
    RETURN NEW;
  END IF;

  v_room_name := btrim(regexp_replace(NEW.room_name, '\s*\[[^]]+\]', '', 'g'));
  SELECT string_agg(player_name, ', ' ORDER BY joined_at), count(*)::integer
  INTO v_player_names, v_player_count
  FROM (
    SELECT COALESCE(profile.display_name, 'A player') AS player_name, participant.joined_at
    FROM public.arena_participants participant
    LEFT JOIN public.profiles profile ON profile.id = participant.user_id
    WHERE participant.room_id = NEW.id
      AND participant.forfeited_at IS NULL
    ORDER BY participant.joined_at
    LIMIT 4
  ) players;

  FOR v_recipient IN
    SELECT DISTINCT assignment.user_id
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
      AND NOT EXISTS (
        SELECT 1 FROM public.arena_participants participant
        WHERE participant.room_id = NEW.id
          AND participant.user_id = assignment.user_id
      )
  LOOP
    PERFORM public.notify_user(
      v_recipient.user_id,
      NEW.creator_id,
      'arena_live',
      'Arena game live',
      COALESCE(v_player_names, 'Someone')
        || CASE WHEN v_player_count = 1 THEN ' is playing "' ELSE ' are playing "' END
        || COALESCE(NULLIF(v_room_name, ''), 'an Arena match') || '". Tap to watch.',
      'arena',
      jsonb_build_object('room_id', NEW.id, 'status', 'playing', 'watch', true)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_arena_match_live() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_arena_match_live_after_start ON public.arena_rooms;
CREATE TRIGGER notify_arena_match_live_after_start
AFTER UPDATE OF status ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION public.notify_arena_match_live();

ALTER TABLE public.arena_rooms REPLICA IDENTITY FULL;
ALTER TABLE public.arena_participants REPLICA IDENTITY FULL;
ALTER TABLE public.arena_trivia_responses REPLICA IDENTITY FULL;
ALTER TABLE public.arena_viewers REPLICA IDENTITY FULL;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['arena_rooms', 'arena_participants', 'arena_trivia_responses', 'arena_viewers']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;
