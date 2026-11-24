-- Waiting witnesses belong in the room until it closes. The earlier repair
-- function removed them on every lobby refresh, immediately breaking chat.
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
    AND (room.status NOT IN ('waiting', 'playing')
      OR room.completed_at IS NOT NULL
      OR (room.status = 'playing' AND room.started_at IS NULL));

  RETURN v_repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_orphaned_arena_matches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_orphaned_arena_matches() TO authenticated;

-- One bounded response feeds both the lobby and the room, including players
-- selected for a scheduled match who have not yet joined as participants.
CREATE OR REPLACE FUNCTION public.get_arena_matchups(p_room_ids uuid[])
RETURNS TABLE(room_id uuid, players jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to see Arena matches.'; END IF;
  IF coalesce(array_length(p_room_ids, 1), 0) > 50 THEN RAISE EXCEPTION 'Too many rooms requested.'; END IF;

  FOR v_room IN
    SELECT room.id, room.room_name, room.play_mode
    FROM public.arena_rooms room
    WHERE room.id = ANY(p_room_ids)
      AND room.status IN ('waiting', 'playing')
      AND room.completed_at IS NULL
  LOOP
    room_id := v_room.id;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'user_id', profile.id,
      'display_name', profile.display_name,
      'avatar_url', profile.avatar_url,
      'tent_house_id', membership.tent_house_id,
      'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
        coalesce((SELECT (game_player -> 'stats' ->> 'correct')::integer
          FROM public.arena_ludo_public_states state,
            jsonb_array_elements(coalesce(state.public_state -> 'players', '[]'::jsonb)) game_player
          WHERE state.room_id = v_room.id AND game_player ->> 'id' = profile.id::text
          LIMIT 1), 0)
        ELSE greatest(coalesce(participant.correct_count, 0),
          (SELECT count(*)::integer FROM public.arena_trivia_responses answer
           WHERE answer.room_id = v_room.id AND answer.user_id = profile.id AND answer.is_correct))
        END
    ) ORDER BY roster.position), '[]'::jsonb)
    INTO players
    FROM (
      SELECT chosen.id AS user_id, chosen.ordinal AS position
      FROM public.arena_scheduled_matches schedule,
        unnest(schedule.player_ids) WITH ORDINALITY AS chosen(id, ordinal)
      WHERE schedule.room_id = v_room.id
      UNION ALL
      SELECT participant.user_id, row_number() OVER (ORDER BY participant.joined_at)
      FROM public.arena_participants participant
      WHERE participant.room_id = v_room.id
        AND NOT EXISTS (SELECT 1 FROM public.arena_scheduled_matches schedule WHERE schedule.room_id = v_room.id)
    ) roster
    JOIN public.profiles profile ON profile.id = roster.user_id
    LEFT JOIN public.arena_participants participant
      ON participant.room_id = v_room.id AND participant.user_id = profile.id
    LEFT JOIN LATERAL (
      SELECT tent.tent_house_id
      FROM public.tents tent
      WHERE tent.sentry_id = profile.id OR EXISTS (
        SELECT 1 FROM public.tent_members member WHERE member.tent_id = tent.id AND member.user_id = profile.id
      )
      ORDER BY CASE WHEN tent.sentry_id = profile.id THEN 0 ELSE 1 END, tent.created_at DESC
      LIMIT 1
    ) membership ON true;

    IF v_room.play_mode = 'machine' THEN
      players := players || jsonb_build_array(jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'display_name', 'The Scribe', 'avatar_url', NULL, 'tent_house_id', NULL,
        'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
          coalesce((SELECT (game_player -> 'stats' ->> 'correct')::integer
            FROM public.arena_ludo_public_states state,
              jsonb_array_elements(coalesce(state.public_state -> 'players', '[]'::jsonb)) game_player
            WHERE state.room_id = v_room.id AND game_player ->> 'isBot' = 'true'
            LIMIT 1), 0)
          ELSE (SELECT count(*)::integer FROM public.arena_machine_trivia_responses answer
                WHERE answer.room_id = v_room.id AND answer.is_correct)
          END
      ));
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_arena_matchups(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arena_matchups(uuid[]) TO authenticated;
