/*
# Arena live witness integrity

Prevents completed Arena rooms from retaining or accepting witnesses. Waiting
rooms remain witnessable so a full room or direct challenge can still be seen
before play begins. The room row is locked while witness access is granted so
completion and admission cannot race each other.
*/

DELETE FROM public.arena_viewers viewer
USING public.arena_rooms room
WHERE room.id = viewer.room_id
  AND (
    room.status NOT IN ('waiting', 'playing')
    OR room.completed_at IS NOT NULL
    OR (room.status = 'playing' AND room.started_at IS NULL)
  );

DROP POLICY IF EXISTS "authenticated users see live arena viewers" ON public.arena_viewers;
CREATE POLICY "authenticated users see live arena viewers"
ON public.arena_viewers FOR SELECT TO authenticated
USING (
  last_seen_at >= now() - interval '2 minutes'
  AND EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = arena_viewers.room_id
      AND room.status IN ('waiting', 'playing')
      AND room.completed_at IS NULL
      AND (room.status = 'waiting' OR room.started_at IS NOT NULL)
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
      AND room.completed_at IS NULL
      AND (room.status = 'waiting' OR room.started_at IS NOT NULL)
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
      AND room.completed_at IS NULL
      AND (room.status = 'waiting' OR room.started_at IS NOT NULL)
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
  v_started_at timestamptz;
  v_completed_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before witnessing an Arena match.';
  END IF;

  SELECT room.status, room.started_at, room.completed_at
  INTO v_status, v_started_at, v_completed_at
  FROM public.arena_rooms room
  WHERE room.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_status NOT IN ('waiting', 'playing')
    OR v_completed_at IS NOT NULL
    OR (v_status = 'playing' AND v_started_at IS NULL)
  THEN
    RAISE EXCEPTION 'This Arena match has ended and cannot be witnessed.';
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
    AND room.status IN ('waiting', 'playing')
    AND room.completed_at IS NULL
    AND (room.status = 'waiting' OR room.started_at IS NOT NULL);

  IF FOUND THEN
    RETURN true;
  END IF;

  DELETE FROM public.arena_viewers viewer
  WHERE viewer.room_id = p_room_id
    AND viewer.user_id = auth.uid();
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.watch_arena_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_arena_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.watch_arena_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_arena_viewer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_finished_arena_witnesses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('waiting', 'playing')
    OR NEW.completed_at IS NOT NULL
    OR (NEW.status = 'playing' AND NEW.started_at IS NULL)
  THEN
    DELETE FROM public.arena_viewers viewer
    WHERE viewer.room_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_finished_arena_witnesses() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_finished_arena_witnesses_after_update ON public.arena_rooms;
CREATE CONSTRAINT TRIGGER clear_finished_arena_witnesses_after_update
AFTER UPDATE ON public.arena_rooms
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.clear_finished_arena_witnesses();

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
        SELECT 1
        FROM public.arena_participants participant
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
        || COALESCE(NULLIF(v_room_name, ''), 'an Arena match') || '". Tap to witness.',
      'arena',
      jsonb_build_object('room_id', NEW.id, 'status', 'playing', 'watch', true, 'witness', true)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_arena_match_live() FROM PUBLIC, anon, authenticated;

-- Keep legacy function names and metadata compatible while presenting the new
-- Witness language in every Arena notification users can read.
CREATE OR REPLACE FUNCTION public.normalize_arena_witness_notification_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.notification_type, '')) LIKE 'arena%' THEN
    NEW.body := replace(NEW.body, 'Arena viewers', 'Arena witnesses');
    NEW.body := replace(NEW.body, 'Arena viewer', 'Arena witness');
    NEW.body := replace(NEW.body, 'current viewers', 'current witnesses');
    NEW.body := replace(NEW.body, 'current viewer', 'current witness');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_arena_witness_notification_language() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS normalize_arena_witness_notification_language_before_write
ON public.user_notifications;
CREATE TRIGGER normalize_arena_witness_notification_language_before_write
BEFORE INSERT OR UPDATE OF notification_type, body ON public.user_notifications
FOR EACH ROW EXECUTE FUNCTION public.normalize_arena_witness_notification_language();

UPDATE public.user_notifications
SET body = replace(
  replace(
    replace(
      replace(body, 'Arena viewers', 'Arena witnesses'),
      'Arena viewer', 'Arena witness'
    ),
    'current viewers', 'current witnesses'
  ),
  'current viewer', 'current witness'
)
WHERE read_at IS NULL
  AND lower(notification_type) LIKE 'arena%'
  AND body ~ '(Arena viewer|current viewer)';
