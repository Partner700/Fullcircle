CREATE OR REPLACE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room public.arena_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id AND status = 'completed';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_room.id, 'room_name', v_room.room_name,
    'winner_id', v_room.winner_id,
    'game_type', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END,
    'completed_at', v_room.completed_at,
    'players', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'display_name', profile.display_name, 'avatar_url', profile.avatar_url,
        'tent_id', membership.id, 'tent_house_id', membership.tent_house_id, 'tent_name', membership.name,
        'correct_count', CASE WHEN v_room.room_name ILIKE '%[arena:ludo]%' THEN
          greatest(p.correct_count, coalesce((SELECT (player -> 'stats' ->> 'correct')::integer
            FROM public.arena_ludo_public_states state,
              jsonb_array_elements(state.public_state -> 'players') player
            WHERE state.room_id = p_room_id AND player ->> 'id' = p.user_id::text LIMIT 1), 0))
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
