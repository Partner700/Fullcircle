/*
# Arena witness playback and orphaned-match cleanup

- Settles rooms whose players have all finished or forfeited instead of leaving
  them in the live witness rail.
- Publishes a tiny, server-validated Standard Trivia playback state so current
  witnesses can see the prompt, selected answer, and verdict without receiving
  the private answer key.
- Keeps instructors read-only: they may witness through the same live channel,
  but this migration does not grant any play or answer permission.
*/

CREATE TABLE IF NOT EXISTS public.arena_live_trivia_states (
  room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  actor_kind text NOT NULL CHECK (actor_kind IN ('player', 'machine')),
  player_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  phase text NOT NULL CHECK (phase IN ('question', 'verdict')),
  selected_answer text,
  is_correct boolean,
  opened_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.arena_live_trivia_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_live_trivia_states FROM PUBLIC, anon;
GRANT SELECT ON public.arena_live_trivia_states TO authenticated;

DROP POLICY IF EXISTS "current arena witnesses read live trivia state" ON public.arena_live_trivia_states;
CREATE POLICY "current arena witnesses read live trivia state"
ON public.arena_live_trivia_states FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.room_id = arena_live_trivia_states.room_id
      AND participant.user_id = (SELECT auth.uid())
      AND room.status = 'playing'
      AND room.completed_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM public.arena_viewers viewer
    JOIN public.arena_rooms room ON room.id = viewer.room_id
    WHERE viewer.room_id = arena_live_trivia_states.room_id
      AND viewer.user_id = (SELECT auth.uid())
      AND viewer.last_seen_at >= now() - interval '2 minutes'
      AND room.status = 'playing'
      AND room.completed_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = (SELECT auth.uid())
      AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  )
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_live_trivia_states;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_arena_trivia_state(
  p_room_id uuid,
  p_question_index integer,
  p_phase text,
  p_actor_kind text DEFAULT 'player'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room public.arena_rooms%ROWTYPE;
  v_expected_index integer;
  v_expected_user uuid;
  v_participant_count integer;
  v_answer text;
  v_correct boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before updating an Arena turn.';
  END IF;
  IF p_phase NOT IN ('question', 'verdict') THEN
    RAISE EXCEPTION 'Unsupported Arena playback phase.';
  END IF;
  IF p_actor_kind NOT IN ('player', 'machine') THEN
    RAISE EXCEPTION 'Unsupported Arena playback actor.';
  END IF;

  SELECT * INTO v_room
  FROM public.arena_rooms room
  WHERE room.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_room.status <> 'playing'
    OR v_room.completed_at IS NOT NULL
    OR v_room.room_name ILIKE '%[arena:ludo]%'
  THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id
      AND participant.user_id = v_user_id
      AND participant.forfeited_at IS NULL
      AND participant.finished_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Only the active Arena player can publish this turn.';
  END IF;

  IF p_actor_kind = 'player' THEN
    IF p_phase = 'question' THEN
      IF v_room.play_mode = 'machine' THEN
        SELECT count(*) * 2 INTO v_expected_index
        FROM public.arena_trivia_responses response
        WHERE response.room_id = p_room_id
          AND response.user_id = v_user_id;
      ELSE
        SELECT count(*) INTO v_expected_index
        FROM public.arena_trivia_responses response
        WHERE response.room_id = p_room_id;
      END IF;

      IF p_question_index <> v_expected_index THEN
        RETURN false;
      END IF;

      IF v_room.play_mode <> 'machine' THEN
        SELECT count(*) INTO v_participant_count
        FROM public.arena_participants participant
        WHERE participant.room_id = p_room_id
          AND participant.forfeited_at IS NULL;

        SELECT participant.user_id INTO v_expected_user
        FROM public.arena_participants participant
        WHERE participant.room_id = p_room_id
          AND participant.forfeited_at IS NULL
        ORDER BY participant.joined_at, participant.user_id
        OFFSET (p_question_index % GREATEST(v_participant_count, 1)) LIMIT 1;

        IF v_expected_user IS DISTINCT FROM v_user_id THEN
          RETURN false;
        END IF;
      END IF;

      INSERT INTO public.arena_live_trivia_states (
        room_id, question_index, actor_kind, player_id, phase,
        selected_answer, is_correct, opened_at, answered_at, updated_at
      ) VALUES (
        p_room_id, p_question_index, 'player', v_user_id, 'question',
        NULL, NULL, now(), NULL, now()
      )
      ON CONFLICT (room_id) DO UPDATE SET
        question_index = EXCLUDED.question_index,
        actor_kind = EXCLUDED.actor_kind,
        player_id = EXCLUDED.player_id,
        phase = EXCLUDED.phase,
        selected_answer = NULL,
        is_correct = NULL,
        opened_at = now(),
        answered_at = NULL,
        updated_at = now();
      RETURN true;
    END IF;

    SELECT response.submitted_answer, response.is_correct
    INTO v_answer, v_correct
    FROM public.arena_trivia_responses response
    WHERE response.room_id = p_room_id
      AND response.user_id = v_user_id
      AND response.question_index = p_question_index;
  ELSE
    IF v_room.play_mode <> 'machine' THEN
      RETURN false;
    END IF;

    SELECT response.submitted_answer, response.is_correct
    INTO v_answer, v_correct
    FROM public.arena_machine_trivia_responses response
    WHERE response.room_id = p_room_id
      AND response.question_index = p_question_index;

    IF p_phase = 'question' THEN
      IF NOT FOUND THEN RETURN false; END IF;
      INSERT INTO public.arena_live_trivia_states (
        room_id, question_index, actor_kind, player_id, phase,
        selected_answer, is_correct, opened_at, answered_at, updated_at
      ) VALUES (
        p_room_id, p_question_index, 'machine', NULL, 'question',
        NULL, NULL, now(), NULL, now()
      )
      ON CONFLICT (room_id) DO UPDATE SET
        question_index = EXCLUDED.question_index,
        actor_kind = EXCLUDED.actor_kind,
        player_id = NULL,
        phase = EXCLUDED.phase,
        selected_answer = NULL,
        is_correct = NULL,
        opened_at = now(),
        answered_at = NULL,
        updated_at = now();
      RETURN true;
    END IF;
  END IF;

  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.arena_live_trivia_states (
    room_id, question_index, actor_kind, player_id, phase,
    selected_answer, is_correct, opened_at, answered_at, updated_at
  ) VALUES (
    p_room_id, p_question_index, p_actor_kind,
    CASE WHEN p_actor_kind = 'player' THEN v_user_id ELSE NULL END,
    'verdict', COALESCE(v_answer, ''), v_correct, now(), now(), now()
  )
  ON CONFLICT (room_id) DO UPDATE SET
    question_index = EXCLUDED.question_index,
    actor_kind = EXCLUDED.actor_kind,
    player_id = EXCLUDED.player_id,
    phase = 'verdict',
    selected_answer = EXCLUDED.selected_answer,
    is_correct = EXCLUDED.is_correct,
    answered_at = now(),
    updated_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_arena_live_trivia_state(p_room_id uuid)
RETURNS TABLE(
  room_id uuid,
  question_index integer,
  actor_kind text,
  player_id uuid,
  actor_name text,
  actor_avatar_url text,
  phase text,
  question jsonb,
  selected_answer text,
  is_correct boolean,
  opened_at timestamptz,
  answered_at timestamptz,
  updated_at timestamptz
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
    OR EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      WHERE assignment.user_id = auth.uid()
        AND assignment.role = 'instructor'
        AND assignment.status IN ('active', 'approved')
    )
  ) THEN
    RAISE EXCEPTION 'Only players and current witnesses can read this Arena turn.';
  END IF;

  RETURN QUERY
  SELECT live.room_id,
    live.question_index,
    live.actor_kind,
    live.player_id,
    CASE WHEN live.actor_kind = 'machine' THEN 'The Scribe' ELSE COALESCE(profile.display_name, 'Arena player') END,
    CASE WHEN live.actor_kind = 'machine' THEN NULL::text ELSE profile.avatar_url END,
    live.phase,
    COALESCE(public.sanitise_arena_questions(room.question_set) -> live.question_index, '{}'::jsonb),
    live.selected_answer,
    live.is_correct,
    live.opened_at,
    live.answered_at,
    live.updated_at
  FROM public.arena_live_trivia_states live
  JOIN public.arena_rooms room ON room.id = live.room_id
  LEFT JOIN public.profiles profile ON profile.id = live.player_id
  WHERE live.room_id = p_room_id
    AND room.status = 'playing'
    AND room.completed_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_arena_trivia_state(uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_arena_live_trivia_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_arena_trivia_state(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_arena_live_trivia_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.repair_orphaned_arena_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room record;
  v_remaining integer;
  v_unfinished integer;
  v_total integer;
  v_has_forfeit boolean;
  v_winner uuid;
  v_winner_name text;
  v_total_stake integer;
  v_repaired integer := 0;
  v_participant record;
BEGIN
  PERFORM public.expire_inactive_arena_participants();

  FOR v_room IN
    SELECT room.*
    FROM public.arena_rooms room
    WHERE room.status = 'playing'
      AND room.started_at IS NOT NULL
      AND room.completed_at IS NULL
    ORDER BY room.started_at
  LOOP
    SELECT
      count(*) FILTER (WHERE participant.forfeited_at IS NULL),
      count(*) FILTER (WHERE participant.forfeited_at IS NULL AND participant.finished_at IS NULL),
      count(*),
      COALESCE(bool_or(participant.forfeited_at IS NOT NULL), false)
    INTO v_remaining, v_unfinished, v_total, v_has_forfeit
    FROM public.arena_participants participant
    WHERE participant.room_id = v_room.id;

    IF v_room.room_name NOT ILIKE '%[arena:ludo]%'
      AND v_has_forfeit
      AND v_remaining <= 1
    THEN
      PERFORM public.settle_standard_arena_forfeit(v_room.id);
      IF EXISTS (
        SELECT 1 FROM public.arena_rooms settled
        WHERE settled.id = v_room.id AND settled.status = 'completed'
      ) THEN
        v_repaired := v_repaired + 1;
      END IF;
      CONTINUE;
    END IF;

    IF (v_has_forfeit AND v_remaining <= 1) OR (v_total > 0 AND v_unfinished = 0) THEN
      SELECT participant.user_id
      INTO v_winner
      FROM public.arena_participants participant
      WHERE participant.room_id = v_room.id
        AND participant.forfeited_at IS NULL
      ORDER BY participant.score DESC, participant.correct_count DESC,
        participant.finished_at NULLS LAST, participant.joined_at
      LIMIT 1;

      -- A stranded machine match is closed conservatively. Its server-owned
      -- game state is the only authority that may declare a human winner.
      IF v_room.play_mode = 'machine' THEN v_winner := NULL; END IF;
      v_total_stake := COALESCE(v_room.stake_amount, 0) * GREATEST(v_total, 1) * 10;

      IF v_winner IS NOT NULL AND v_total_stake > 0 AND NOT EXISTS (
        SELECT 1 FROM public.denarii_ledger_entries entry
        WHERE entry.source_type = 'arena_reward'
          AND entry.source_reference = v_room.id::text
      ) THEN
        INSERT INTO public.denarii_ledger_entries (
          user_id, amount, source_type, source_reference, description
        ) VALUES (
          v_winner, v_total_stake, 'arena_reward', v_room.id::text,
          'Arena tenfold winner reward after forfeiture for ' || v_room.room_name
        );
      END IF;

      UPDATE public.arena_rooms
      SET status = 'completed',
          winner_id = v_winner,
          completed_at = now(),
          completion_reason = CASE WHEN v_has_forfeit THEN 'forfeit' ELSE 'finished' END
      WHERE id = v_room.id
        AND status = 'playing';

      IF FOUND THEN
        v_repaired := v_repaired + 1;
        SELECT profile.display_name INTO v_winner_name
        FROM public.profiles profile
        WHERE profile.id = v_winner;

        FOR v_participant IN
          SELECT participant.user_id
          FROM public.arena_participants participant
          WHERE participant.room_id = v_room.id
        LOOP
          IF NOT EXISTS (
            SELECT 1
            FROM public.user_notifications notification
            WHERE notification.recipient_id = v_participant.user_id
              AND notification.notification_type = 'arena'
              AND notification.action_key = 'arena'
              AND notification.metadata ->> 'room_id' = v_room.id::text
              AND notification.metadata ->> 'repair' = 'orphaned_match'
          ) THEN
            PERFORM public.notify_user(
              v_participant.user_id,
              v_winner,
              'arena',
              CASE WHEN v_participant.user_id = v_winner THEN 'You won the Arena' ELSE 'Arena match ended' END,
              CASE
                WHEN v_winner IS NULL THEN 'The abandoned match "' || v_room.room_name || '" has been closed.'
                WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
                ELSE COALESCE(v_winner_name, 'The remaining player') || ' won "' || v_room.room_name || '".'
              END,
              'arena',
              jsonb_build_object(
                'room_id', v_room.id,
                'status', 'completed',
                'winner_id', v_winner,
                'completion_reason', CASE WHEN v_has_forfeit THEN 'forfeit' ELSE 'finished' END,
                'repair', 'orphaned_match'
              )
            );
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.arena_viewers viewer
  USING public.arena_rooms room
  WHERE room.id = viewer.room_id
    AND (room.status <> 'playing' OR room.completed_at IS NOT NULL);

  RETURN v_repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_orphaned_arena_matches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_orphaned_arena_matches() TO authenticated;

-- Repair any pre-existing matches that were already forfeited or abandoned.
SELECT public.repair_orphaned_arena_matches();

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

  PERFORM public.repair_orphaned_arena_matches();

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

REVOKE ALL ON FUNCTION public.watch_arena_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.watch_arena_room(uuid) TO authenticated;
