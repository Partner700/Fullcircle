-- Public Arena witnesses see the same player numbers and exact tent groups
-- as signed-in players, without additional API requests.
CREATE OR REPLACE FUNCTION journey_private.get_public_arena_journey_matchup(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN public.get_public_arena_room(p_room_id) IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.arena_rooms room
      WHERE room.id = p_room_id AND room.room_name ILIKE '%[arena:journey]%')
    THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', profile.id, 'display_name', profile.display_name,
        'avatar_url', profile.avatar_url, 'player_number', profile.player_number, 'tent_id', membership.tent_id, 'tent_house_id', membership.tent_house_id,
        'correct_count', coalesce(participant.correct_count, 0)
      ) ORDER BY participant.joined_at)
      FROM public.arena_participants participant
      JOIN public.profiles profile ON profile.id = participant.user_id
      LEFT JOIN LATERAL (
        SELECT tent.tent_house_id,tent.id AS tent_id FROM public.tents tent
        WHERE tent.sentry_id = profile.id OR EXISTS (
          SELECT 1 FROM public.tent_members member
          WHERE member.tent_id = tent.id AND member.user_id = profile.id
        ) ORDER BY CASE WHEN tent.sentry_id = profile.id THEN 0 ELSE 1 END,
          tent.created_at DESC LIMIT 1
      ) membership ON true
      WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL
    ), '[]'::jsonb) || CASE WHEN room.play_mode = 'machine' THEN jsonb_build_array(
      jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000',
        'display_name', 'The Scribe', 'avatar_url', NULL, 'player_number', NULL, 'tent_id', NULL, 'tent_house_id', NULL,
        'correct_count', greatest(coalesce(room.machine_score, 0), 0))
    ) ELSE '[]'::jsonb END END
  FROM public.arena_rooms room WHERE room.id = p_room_id;
$function$;
