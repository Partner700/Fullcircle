-- Journey points cannot drop below zero, including scores saved before this release.
CREATE OR REPLACE FUNCTION journey_private.sync_journey_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_player jsonb;
BEGIN
  IF TG_TABLE_NAME = 'arena_participants' THEN
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.room_id AND player->>'id' = NEW.user_id::text;
    IF v_player ? 'score' THEN NEW.score := greatest(0, (v_player->>'score')::integer); END IF;
  ELSE
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.id AND player->>'id' = '00000000-0000-0000-0000-000000000000';
    IF v_player ? 'score' THEN NEW.machine_score := greatest(0, (v_player->>'score')::integer); END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION journey_private.add_journey_scores(p_room_id uuid, p_players jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(player || CASE WHEN saved.value ? 'score'
    THEN jsonb_build_object('score', greatest(0, (saved.value->>'score')::integer),
      'correct_count', (saved.value->>'correctAnswers')::integer)
    ELSE '{}'::jsonb END ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(p_players) WITH ORDINALITY entry(player, ordinal)
  LEFT JOIN public.arena_journey_games game ON game.room_id = p_room_id
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(game.state->'game'->'players')
    WHERE value->>'id' = player->>'user_id') saved ON true;
$$;

-- Machine victories have no room.winner_id; the Journey result retains the winner.
CREATE OR REPLACE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN result IS NULL THEN NULL ELSE result
    || jsonb_build_object('players', journey_private.add_journey_scores(p_room_id, result->'players'))
    || CASE WHEN result->>'room_name' ILIKE '%[arena:journey]%'
      AND game.state->'game'->>'winnerId' IS NOT NULL
      THEN jsonb_build_object('winner_id', game.state->'game'->>'winnerId')
      ELSE '{}'::jsonb END END
  FROM (SELECT journey_private.get_public_arena_final_scorecard(p_room_id) result) data
  LEFT JOIN public.arena_journey_games game ON game.room_id = p_room_id;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_final_scorecard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_final_scorecard(uuid) TO anon, authenticated;

-- A set is scoped to one character. Live games keep their question pool intact.
CREATE FUNCTION public.delete_arena_journey_question_set(p_slug text, p_set_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted integer; v_bank jsonb;
BEGIN
  PERFORM journey_private.require_instructor();
  IF p_slug IS NULL OR p_set_name IS NULL OR length(btrim(p_set_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Choose a Journey character and question set.';
  END IF;
  PERFORM 1 FROM public.arena_journey_characters WHERE slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journey character not found.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_journey_questions
    WHERE character_slug = p_slug AND question_set_name = p_set_name) THEN
    RAISE EXCEPTION 'This question set is no longer available. Refresh the question bank.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arena_journey_games game
    JOIN public.arena_rooms room ON room.id = game.room_id
    WHERE game.character_slug = p_slug AND room.status IN ('waiting', 'playing')
      AND room.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A match is using this character. Delete the set after the match ends.';
  END IF;

  -- Completed rooms may still retain a pointer to their last question.
  UPDATE public.arena_journey_games game SET current_question_id = NULL
  WHERE game.character_slug = p_slug AND game.current_question_id IN (
    SELECT id FROM public.arena_journey_questions
    WHERE character_slug = p_slug AND question_set_name = p_set_name
  );
  DELETE FROM public.arena_journey_questions
  WHERE character_slug = p_slug AND question_set_name = p_set_name;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_bank := journey_private.refresh_bank(p_slug, false);
  RETURN v_bank || jsonb_build_object('deleted', v_deleted);
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'A match is using these questions. Try again after it ends.';
END;
$$;
REVOKE ALL ON FUNCTION public.delete_arena_journey_question_set(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_arena_journey_question_set(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
