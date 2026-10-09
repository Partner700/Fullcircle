/*
# Reliable Arena witness delivery

- Keeps an admitted witness authorized for the lifetime of a live match even
  when a phone throttles the heartbeat timer.
- Publishes every human answer verdict from the authoritative response row,
  so witness playback does not depend on a best-effort browser request.
- Retains read-only access and never exposes the private Arena answer deck.
*/

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
      AND room.status = 'playing'
      AND room.completed_at IS NULL
  )
  OR (
    EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = (SELECT auth.uid())
        AND assignment.role = 'instructor'
        AND assignment.status IN ('active', 'approved')
    )
    AND EXISTS (
      SELECT 1
      FROM public.arena_rooms room
      WHERE room.id = arena_live_trivia_states.room_id
        AND room.status = 'playing'
        AND room.completed_at IS NULL
    )
  )
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_live_trivia_states;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_arena_player_verdict_for_witnesses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opened_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.arena_rooms room
    WHERE room.id = NEW.room_id
      AND room.status = 'playing'
      AND room.completed_at IS NULL
      AND room.room_name NOT ILIKE '%[arena:ludo]%'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT live.opened_at
  INTO v_opened_at
  FROM public.arena_live_trivia_states live
  WHERE live.room_id = NEW.room_id
    AND live.question_index = NEW.question_index
    AND live.actor_kind = 'player'
    AND live.player_id = NEW.user_id;

  INSERT INTO public.arena_live_trivia_states (
    room_id,
    question_index,
    actor_kind,
    player_id,
    phase,
    selected_answer,
    is_correct,
    opened_at,
    answered_at,
    updated_at
  ) VALUES (
    NEW.room_id,
    NEW.question_index,
    'player',
    NEW.user_id,
    'verdict',
    COALESCE(NEW.submitted_answer, ''),
    NEW.is_correct,
    COALESCE(v_opened_at, NEW.created_at, now()),
    COALESCE(NEW.created_at, now()),
    now()
  )
  ON CONFLICT (room_id) DO UPDATE SET
    question_index = EXCLUDED.question_index,
    actor_kind = EXCLUDED.actor_kind,
    player_id = EXCLUDED.player_id,
    phase = 'verdict',
    selected_answer = EXCLUDED.selected_answer,
    is_correct = EXCLUDED.is_correct,
    opened_at = EXCLUDED.opened_at,
    answered_at = EXCLUDED.answered_at,
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_arena_player_verdict_for_witnesses() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_arena_player_verdict_for_witnesses_after_write
ON public.arena_trivia_responses;
CREATE TRIGGER sync_arena_player_verdict_for_witnesses_after_write
AFTER INSERT OR UPDATE OF submitted_answer, is_correct
ON public.arena_trivia_responses
FOR EACH ROW
EXECUTE FUNCTION public.sync_arena_player_verdict_for_witnesses();

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
      SELECT 1
      FROM public.arena_participants participant
      JOIN public.arena_rooms room ON room.id = participant.room_id
      WHERE participant.room_id = p_room_id
        AND participant.user_id = auth.uid()
        AND room.status = 'playing'
        AND room.completed_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.arena_viewers viewer
      JOIN public.arena_rooms room ON room.id = viewer.room_id
      WHERE viewer.room_id = p_room_id
        AND viewer.user_id = auth.uid()
        AND room.status = 'playing'
        AND room.completed_at IS NULL
    )
    OR (
      EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = auth.uid()
          AND assignment.role = 'instructor'
          AND assignment.status IN ('active', 'approved')
      )
      AND EXISTS (
        SELECT 1
        FROM public.arena_rooms room
        WHERE room.id = p_room_id
          AND room.status = 'playing'
          AND room.completed_at IS NULL
      )
    )
  ) THEN
    RAISE EXCEPTION 'Only players and admitted witnesses can read this Arena turn.';
  END IF;

  RETURN QUERY
  SELECT live.room_id,
    live.question_index,
    live.actor_kind,
    live.player_id,
    CASE
      WHEN live.actor_kind = 'machine' THEN 'The Scribe'
      ELSE COALESCE(profile.display_name, 'Arena player')
    END,
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

REVOKE ALL ON FUNCTION public.get_arena_live_trivia_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_live_trivia_state(uuid) TO authenticated;
