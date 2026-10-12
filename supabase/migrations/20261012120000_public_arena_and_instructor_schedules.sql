-- Public Arena witnessing and instructor-reserved matches. No private deck or
-- ledger data is returned by the anonymous endpoints.
CREATE TABLE IF NOT EXISTS public.arena_scheduled_matches (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  scheduled_by uuid NOT NULL REFERENCES public.profiles(id),
  starts_at timestamptz NOT NULL,
  player_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (array_length(player_ids, 1) BETWEEN 2 AND 8)
);
CREATE INDEX IF NOT EXISTS arena_scheduled_matches_starts_idx ON public.arena_scheduled_matches(starts_at);
ALTER TABLE public.arena_scheduled_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_scheduled_matches FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "members see upcoming arena schedules" ON public.arena_scheduled_matches;
CREATE POLICY "members see upcoming arena schedules" ON public.arena_scheduled_matches
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.arena_rooms room WHERE room.id = arena_scheduled_matches.room_id
    AND room.status IN ('waiting', 'playing') AND room.completed_at IS NULL
));
GRANT SELECT ON public.arena_scheduled_matches TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_instructor_arena_match(
  p_room_name text, p_game_type text, p_player_ids uuid[], p_starts_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  v_room_id uuid;
  v_player_id uuid;
  v_name text;
  v_capacity integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = auth.uid() AND role = 'instructor' AND status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'Only the instructor can schedule Arena matches.'; END IF;
  IF p_game_type NOT IN ('standard', 'ludo') THEN RAISE EXCEPTION 'Choose an Arena game.'; END IF;
  IF p_starts_at < now() + interval '1 minute' OR p_starts_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a time between one minute and 90 days from now.';
  END IF;
  SELECT array_agg(id ORDER BY ordinal) INTO v_ids
  FROM (SELECT DISTINCT ON (id) id, ordinal FROM unnest(p_player_ids) WITH ORDINALITY AS chosen(id, ordinal)
        WHERE id IS NOT NULL ORDER BY id, ordinal) distinct_ids;
  IF p_game_type = 'ludo' THEN v_capacity := 4; ELSE v_capacity := 8; END IF;
  IF coalesce(array_length(v_ids, 1), 0) < 2
     OR array_length(v_ids, 1) > v_capacity THEN
    RAISE EXCEPTION 'Choose 2 to % distinct players.', v_capacity;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) chosen(id) WHERE NOT (
      EXISTS (SELECT 1 FROM public.role_assignments assignment
        WHERE assignment.user_id = chosen.id AND assignment.role IN ('cadet', 'sentry')
          AND assignment.status IN ('active', 'approved'))
      OR EXISTS (SELECT 1 FROM public.tents tent WHERE tent.sentry_id = chosen.id)
      OR EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = chosen.id
        AND member.role IN ('cadet', 'sentry'))
    )
  ) THEN
    RAISE EXCEPTION 'Every selected player must be an active cadet or sentry.';
  END IF;
  v_name := left(coalesce(nullif(btrim(p_room_name), ''), 'Instructor Match'), 72)
    || CASE WHEN p_game_type = 'ludo' THEN ' [arena:ludo]' ELSE ' [arena:standard]' END;
  INSERT INTO public.arena_rooms (
    creator_id, room_name, stake_amount, max_players, status,
    tagged_user_ids, game_call_fee, expires_at
  ) VALUES (
    v_ids[1], v_name, 0, array_length(v_ids, 1), 'waiting',
    v_ids, 0, p_starts_at + interval '2 hours'
  ) RETURNING id INTO v_room_id;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (v_room_id, auth.uid(), p_starts_at, v_ids);
  FOREACH v_player_id IN ARRAY v_ids LOOP
    PERFORM public.notify_user(v_player_id, auth.uid(), 'arena', 'Instructor Arena match',
      'You were chosen for ' || v_name || '. Open the Arena waiting room before the match begins.',
      'arena', jsonb_build_object('room_id', v_room_id, 'starts_at', p_starts_at));
  END LOOP;
  RETURN v_room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_instructor_arena_match(text, text, uuid[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_instructor_arena_match(text, text, uuid[], timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_instructor_arena_match(p_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_match public.arena_scheduled_matches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to join this match.'; END IF;
  SELECT * INTO v_match FROM public.arena_scheduled_matches WHERE room_id = p_room_id;
  IF NOT FOUND OR auth.uid() <> ALL(v_match.player_ids) THEN
    RAISE EXCEPTION 'This match is reserved for its selected players.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_rooms WHERE id = p_room_id AND status = 'waiting' AND expires_at > now()) THEN
    RAISE EXCEPTION 'This waiting room has closed.';
  END IF;
  INSERT INTO public.arena_participants(room_id, user_id, stake_paid)
  VALUES (p_room_id, auth.uid(), true) ON CONFLICT (room_id, user_id) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.join_instructor_arena_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_instructor_arena_match(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_scheduled_arena_match(p_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_match public.arena_scheduled_matches%ROWTYPE; v_room public.arena_rooms%ROWTYPE; v_player uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to start this match.'; END IF;
  SELECT * INTO v_match FROM public.arena_scheduled_matches WHERE room_id = p_room_id;
  IF NOT FOUND OR auth.uid() <> ALL(v_match.player_ids) THEN
    RAISE EXCEPTION 'Only selected players can start this match.';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status = 'playing' THEN RETURN true; END IF;
  IF v_room.status <> 'waiting' OR now() > v_room.expires_at THEN
    RAISE EXCEPTION 'This scheduled match is no longer open.';
  END IF;
  IF now() < v_match.starts_at THEN RAISE EXCEPTION 'The countdown is still running.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Enter the match as a player first.';
  END IF;
  IF (SELECT count(*) FROM public.arena_participants WHERE room_id = p_room_id AND forfeited_at IS NULL) < 2 THEN
    RAISE EXCEPTION 'At least two selected players must enter before the match starts.';
  END IF;
  UPDATE public.arena_rooms SET status = 'playing', started_at = now(), expires_at = NULL WHERE id = p_room_id;
  FOR v_player IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    PERFORM public.notify_user(v_player, auth.uid(), 'arena', 'Arena game started',
      'The scheduled Arena match is live.', 'arena', jsonb_build_object('room_id', p_room_id, 'status', 'playing'));
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.start_scheduled_arena_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_scheduled_arena_match(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_instructor_arena_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_match public.arena_scheduled_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_match FROM public.arena_scheduled_matches WHERE room_id = NEW.room_id;
  IF FOUND AND NEW.user_id <> ALL(v_match.player_ids) THEN
    RAISE EXCEPTION 'This match is reserved for its selected players.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_instructor_arena_reservation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_instructor_arena_reservation_before_join ON public.arena_participants;
CREATE TRIGGER enforce_instructor_arena_reservation_before_join
BEFORE INSERT OR UPDATE OF user_id, room_id ON public.arena_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_arena_reservation();

CREATE OR REPLACE FUNCTION public.enforce_instructor_arena_start()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_starts_at timestamptz;
BEGIN
  SELECT starts_at INTO v_starts_at FROM public.arena_scheduled_matches WHERE room_id = NEW.id;
  IF v_starts_at IS NOT NULL THEN
    IF NEW.status = 'waiting' THEN
      NEW.expires_at := greatest(coalesce(NEW.expires_at, v_starts_at + interval '2 hours'), v_starts_at + interval '2 hours');
    ELSIF NEW.status = 'playing' AND OLD.status <> 'playing' THEN
      IF now() < v_starts_at THEN RAISE EXCEPTION 'The scheduled match has not begun yet.'; END IF;
      IF (SELECT count(*) FROM public.arena_participants WHERE room_id = NEW.id AND forfeited_at IS NULL) < 2 THEN
        RAISE EXCEPTION 'At least two selected players must enter before the match starts.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_instructor_arena_start() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_instructor_arena_start_before_update ON public.arena_rooms;
CREATE TRIGGER enforce_instructor_arena_start_before_update
BEFORE UPDATE ON public.arena_rooms FOR EACH ROW
EXECUTE FUNCTION public.enforce_instructor_arena_start();

CREATE OR REPLACE FUNCTION public.cancel_instructor_arena_match(p_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_scheduled_matches
    WHERE room_id = p_room_id AND scheduled_by = auth.uid()
  ) THEN RAISE EXCEPTION 'Only the scheduling instructor can cancel this match.'; END IF;
  UPDATE public.arena_rooms SET status = 'cancelled', completed_at = now(), closed_at = now()
  WHERE id = p_room_id AND status = 'waiting';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_instructor_arena_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_instructor_arena_match(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.arena_guest_witnesses (
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  guest_key_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, guest_key_hash)
);
CREATE INDEX IF NOT EXISTS arena_guest_witnesses_presence_idx ON public.arena_guest_witnesses(room_id, last_seen_at);
ALTER TABLE public.arena_guest_witnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_guest_witnesses FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.arena_guest_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  guest_key_hash text NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arena_guest_messages_room_idx ON public.arena_guest_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arena_guest_messages_rate_idx ON public.arena_guest_messages(room_id, guest_key_hash, created_at DESC);
ALTER TABLE public.arena_guest_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_guest_messages FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.watch_public_arena_room(p_room_id uuid, p_guest_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'A guest session is required.';
  END IF;
  IF public.get_public_arena_room(p_room_id) IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.arena_guest_witnesses(room_id, guest_key_hash, last_seen_at)
  VALUES (p_room_id, md5(p_guest_key), now())
  ON CONFLICT (room_id, guest_key_hash) DO UPDATE SET last_seen_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.watch_public_arena_room(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watch_public_arena_room(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_room(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room public.arena_rooms%ROWTYPE; v_schedule public.arena_scheduled_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id
    AND status IN ('waiting', 'playing') AND completed_at IS NULL
    AND (status <> 'waiting' OR coalesce(expires_at, created_at + interval '15 minutes') > now())
    AND (status <> 'playing' OR (started_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.arena_participants participant
      WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL
        AND participant.finished_at IS NULL
        AND coalesce(participant.last_active_at, participant.joined_at, started_at) > now() - interval '3 minutes'
    )));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_schedule FROM public.arena_scheduled_matches WHERE room_id = p_room_id;
  RETURN jsonb_build_object(
    'id', v_room.id, 'room_name', v_room.room_name, 'status', v_room.status,
    'game_type', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END,
    'play_mode', v_room.play_mode, 'max_players', v_room.max_players,
    'started_at', v_room.started_at, 'created_at', v_room.created_at,
    'starts_at', v_schedule.starts_at, 'scheduled', v_schedule.room_id IS NOT NULL,
    'participants', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', p.user_id, 'display_name', profile.display_name,
        'avatar_url', profile.avatar_url, 'score', p.score, 'joined_at', p.joined_at)
        ORDER BY p.joined_at)
      FROM public.arena_participants p JOIN public.profiles profile ON profile.id = p.user_id
      WHERE p.room_id = p_room_id AND p.forfeited_at IS NULL
    ), '[]'::jsonb),
    'selected_players', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', profile.id, 'display_name', profile.display_name,
        'avatar_url', profile.avatar_url) ORDER BY chosen.ordinal)
      FROM unnest(v_schedule.player_ids) WITH ORDINALITY AS chosen(id, ordinal)
      JOIN public.profiles profile ON profile.id = chosen.id
    ), '[]'::jsonb),
    'witness_count',
      (SELECT count(*) FROM public.arena_viewers WHERE room_id = p_room_id AND last_seen_at > now() - interval '2 minutes')
      + (SELECT count(*) FROM public.arena_guest_witnesses WHERE room_id = p_room_id AND last_seen_at > now() - interval '2 minutes')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_room(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room public.arena_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id AND status = 'completed';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_room.id, 'room_name', v_room.room_name,
    'game_type', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END,
    'completed_at', v_room.completed_at,
    'players', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'display_name', profile.display_name, 'avatar_url', profile.avatar_url,
        'tent_id', membership.id, 'tent_house_id', membership.tent_house_id, 'tent_name', membership.name,
        'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
          coalesce((SELECT (player -> 'stats' ->> 'correct')::integer
            FROM public.arena_ludo_public_states state,
              jsonb_array_elements(state.public_state -> 'players') player
            WHERE state.room_id = p_room_id AND player ->> 'id' = p.user_id::text LIMIT 1), p.correct_count)
          ELSE greatest(p.correct_count, (SELECT count(*)::integer FROM public.arena_trivia_responses answer
            WHERE answer.room_id = p_room_id AND answer.user_id = p.user_id AND answer.is_correct)) END
      ) ORDER BY p.joined_at)
      FROM public.arena_participants p JOIN public.profiles profile ON profile.id = p.user_id
      LEFT JOIN LATERAL (
        SELECT tent.id, tent.name, tent.tent_house_id FROM public.tents tent
        WHERE tent.sentry_id = p.user_id OR EXISTS (
          SELECT 1 FROM public.tent_members member WHERE member.tent_id = tent.id AND member.user_id = p.user_id)
        ORDER BY CASE WHEN tent.sentry_id = p.user_id THEN 0 ELSE 1 END, tent.created_at DESC LIMIT 1
      ) membership ON true
      WHERE p.room_id = p_room_id
    ), '[]'::jsonb) || CASE WHEN v_room.play_mode = 'machine' THEN jsonb_build_array(
      jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000',
        'display_name', 'The Scribe', 'avatar_url', NULL, 'tent_id', NULL, 'tent_house_id', NULL, 'tent_name', NULL,
        'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
          coalesce((SELECT (player -> 'stats' ->> 'correct')::integer
            FROM public.arena_ludo_public_states state,
              jsonb_array_elements(state.public_state -> 'players') player
            WHERE state.room_id = p_room_id AND player ->> 'isBot' = 'true' LIMIT 1), 0)
        ELSE (SELECT count(*) FROM public.arena_machine_trivia_responses answer
          WHERE answer.room_id = p_room_id AND answer.is_correct) END)
    ) ELSE '[]'::jsonb END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_final_scorecard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_final_scorecard(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_arena_guest_witness_counts(p_room_ids uuid[])
RETURNS TABLE(room_id uuid, guest_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to see the Arena lobby.'; END IF;
  IF coalesce(array_length(p_room_ids, 1), 0) > 50 THEN RAISE EXCEPTION 'Too many rooms requested.'; END IF;
  RETURN QUERY
  SELECT guest.room_id, count(*)
  FROM public.arena_guest_witnesses guest
  JOIN public.arena_rooms room ON room.id = guest.room_id
  WHERE guest.room_id = ANY(p_room_ids)
    AND guest.last_seen_at > now() - interval '2 minutes'
    AND room.status IN ('waiting', 'playing') AND room.completed_at IS NULL
  GROUP BY guest.room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_arena_guest_witness_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_guest_witness_counts(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_chat(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_public_arena_room(p_room_id) IS NULL THEN RETURN '[]'::jsonb; END IF;
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
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_chat(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_public_arena_comment(p_room_id uuid, p_guest_key text, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash text; v_id uuid;
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'A guest session is required.';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Write a message of at most 500 characters.';
  END IF;
  IF public.get_public_arena_room(p_room_id) IS NULL THEN
    RAISE EXCEPTION 'This Arena room is no longer live.';
  END IF;
  v_hash := md5(p_guest_key);
  IF EXISTS (SELECT 1 FROM public.arena_guest_messages
             WHERE room_id = p_room_id AND guest_key_hash = v_hash
               AND created_at > now() - interval '8 seconds') THEN
    RAISE EXCEPTION 'Wait a moment before commenting again.';
  END IF;
  IF (SELECT count(*) FROM public.arena_guest_messages
      WHERE room_id = p_room_id AND guest_key_hash = v_hash
        AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'The guest message limit has been reached for now.';
  END IF;
  INSERT INTO public.arena_guest_messages(room_id, guest_key_hash, body)
  VALUES (p_room_id, v_hash, btrim(p_body)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_public_arena_comment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_public_arena_comment(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_trivia_feed(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_public_arena_room(p_room_id) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_rooms WHERE id = p_room_id AND status = 'playing'
  ) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC) FROM (
    SELECT jsonb_build_object('user_id', response.user_id, 'display_name', profile.display_name,
      'avatar_url', profile.avatar_url, 'question_index', response.question_index,
      'submitted_answer', response.submitted_answer, 'is_correct', response.is_correct,
      'figs_earned', response.figs_earned, 'created_at', response.created_at) AS item,
      response.created_at
    FROM public.arena_trivia_responses response
    JOIN public.profiles profile ON profile.id = response.user_id WHERE response.room_id = p_room_id
    UNION ALL
    SELECT jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000'::uuid,
      'display_name', 'The Scribe', 'avatar_url', NULL, 'question_index', machine.question_index,
      'submitted_answer', machine.submitted_answer, 'is_correct', machine.is_correct,
      'figs_earned', machine.figs_earned, 'created_at', machine.created_at), machine.created_at
    FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id
    ORDER BY created_at DESC LIMIT 80
  ) recent), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_trivia_feed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_trivia_feed(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_live_state(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object('room_id', live.room_id, 'question_index', live.question_index,
      'actor_kind', live.actor_kind, 'player_id', live.player_id,
      'actor_name', CASE WHEN live.actor_kind = 'machine' THEN 'The Scribe'
        ELSE coalesce(profile.display_name, 'Arena player') END,
      'actor_avatar_url', CASE WHEN live.actor_kind = 'machine' THEN NULL ELSE profile.avatar_url END,
      'phase', live.phase, 'question', coalesce(public.sanitise_arena_questions(room.question_set) -> live.question_index, '{}'::jsonb),
      'selected_answer', live.selected_answer, 'is_correct', live.is_correct,
      'opened_at', live.opened_at, 'answered_at', live.answered_at, 'updated_at', live.updated_at)
    FROM public.arena_live_trivia_states live
    JOIN public.arena_rooms room ON room.id = live.room_id
    LEFT JOIN public.profiles profile ON profile.id = live.player_id
    WHERE live.room_id = p_room_id AND room.status = 'playing' AND room.completed_at IS NULL
      AND public.get_public_arena_room(p_room_id) IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_live_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_live_state(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_arena_ludo_state(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_public_arena_room(p_room_id) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_rooms WHERE id = p_room_id
      AND status = 'playing' AND room_name ILIKE '%[arena:ludo]%'
  ) THEN RETURN NULL; END IF;
  RETURN (SELECT jsonb_build_object('version', version, 'public_state', public_state)
          FROM public.arena_ludo_public_states WHERE room_id = p_room_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_ludo_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_ludo_state(uuid) TO anon, authenticated;
