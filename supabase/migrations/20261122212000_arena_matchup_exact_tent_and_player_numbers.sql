-- Preserve the existing signed-in-only Arena roster function. Add exact tent ID
-- and public player numbers to the payload already used by every Arena client.
CREATE OR REPLACE FUNCTION journey_private.get_arena_matchups(p_room_ids uuid[])
 RETURNS TABLE(room_id uuid, players jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to see Arena matches.'; END IF;
 IF coalesce(array_length(p_room_ids,1),0)>50 THEN RAISE EXCEPTION 'Too many rooms requested.'; END IF;
 RETURN QUERY
 WITH active_rooms AS MATERIALIZED (
   SELECT r.id,r.room_name,r.play_mode FROM public.arena_rooms r WHERE r.id=ANY(p_room_ids) AND r.status IN ('waiting','playing') AND r.completed_at IS NULL
 ), roster AS (
   SELECT r.id rid,chosen.id uid,chosen.ordinal position FROM active_rooms r JOIN public.arena_scheduled_matches s ON s.room_id=r.id CROSS JOIN LATERAL unnest(s.player_ids) WITH ORDINALITY chosen(id,ordinal)
   UNION ALL
   SELECT r.id,a.user_id,row_number() OVER(PARTITION BY r.id ORDER BY a.joined_at) FROM active_rooms r JOIN public.arena_participants a ON a.room_id=r.id WHERE NOT EXISTS(SELECT 1 FROM public.arena_scheduled_matches s WHERE s.room_id=r.id)
 ), correct_answers AS (
   SELECT a.room_id rid,a.user_id uid,count(*)::integer points FROM public.arena_trivia_responses a JOIN active_rooms r ON r.id=a.room_id WHERE a.is_correct AND r.room_name NOT ILIKE '%[arena:ludo]%' GROUP BY a.room_id,a.user_id
 ), human_players AS (
   SELECT roster.rid,roster.position,jsonb_build_object('user_id',p.id,'display_name',p.display_name,'avatar_url',p.avatar_url,'player_number',p.player_number,'tent_id',membership.tent_id,'tent_house_id',membership.tent_house_id,
     'correct_count',CASE WHEN r.room_name ILIKE '%[arena:ludo]%' THEN coalesce((SELECT (v->'stats'->>'correct')::integer FROM public.arena_ludo_public_states st CROSS JOIN LATERAL jsonb_array_elements(coalesce(st.public_state->'players','[]'::jsonb)) v WHERE st.room_id=r.id AND v->>'id'=p.id::text LIMIT 1),0)
     ELSE greatest(coalesce(a.correct_count,0),coalesce(c.points,0)) END) AS player
   FROM roster JOIN active_rooms r ON r.id=roster.rid JOIN public.profiles p ON p.id=roster.uid
   LEFT JOIN public.arena_participants a ON a.room_id=roster.rid AND a.user_id=p.id
   LEFT JOIN correct_answers c ON c.rid=roster.rid AND c.uid=p.id
   LEFT JOIN LATERAL (
     SELECT x.tent_house_id,x.tent_id FROM (
       SELECT t.tent_house_id,t.id AS tent_id,t.created_at,0 AS priority FROM public.tents t WHERE t.sentry_id=p.id
       UNION ALL
       SELECT t.tent_house_id,t.id,t.created_at,1 FROM public.tent_members m JOIN public.tents t ON t.id=m.tent_id WHERE m.user_id=p.id
     ) x ORDER BY x.priority,x.created_at DESC LIMIT 1
   ) membership ON true
 ), aggregated AS (SELECT h.rid,jsonb_agg(h.player ORDER BY h.position) AS payload FROM human_players h GROUP BY h.rid)
 SELECT r.id,coalesce(agg.payload,'[]'::jsonb)||CASE WHEN r.play_mode='machine' THEN jsonb_build_array(jsonb_build_object('user_id','00000000-0000-0000-0000-000000000000','display_name','The Scribe','avatar_url',NULL,'player_number',NULL,'tent_id',NULL,'tent_house_id',NULL,
   'correct_count',CASE WHEN r.room_name ILIKE '%[arena:ludo]%' THEN coalesce((SELECT (v->'stats'->>'correct')::integer FROM public.arena_ludo_public_states st CROSS JOIN LATERAL jsonb_array_elements(coalesce(st.public_state->'players','[]'::jsonb)) v WHERE st.room_id=r.id AND v->>'isBot'='true' LIMIT 1),0)
   ELSE (SELECT count(*)::integer FROM public.arena_machine_trivia_responses a WHERE a.room_id=r.id AND a.is_correct) END)) ELSE '[]'::jsonb END
 FROM active_rooms r LEFT JOIN aggregated agg ON agg.rid=r.id;
END; $function$;
