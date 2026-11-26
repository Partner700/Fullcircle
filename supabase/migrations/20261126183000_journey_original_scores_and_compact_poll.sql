CREATE OR REPLACE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN result IS NULL THEN NULL ELSE result
    || jsonb_build_object('players', journey_private.add_journey_scores(p_room_id, result->'players'))
    || CASE WHEN result->>'room_name' ILIKE '%[arena:journey]%'
      THEN jsonb_build_object('game_type', 'journey',
        'finish_reason', case
          when game.state->'game'->>'closedByClock'='true' then 'time limit'
          when exists(select 1 from jsonb_array_elements(game.state->'game'->'players') p where p->>'status'='FINISHED') then 'marathon'
          when r.completion_reason='forfeit' or
               (exists(select 1 from jsonb_array_elements(game.state->'game'->'players') p where p ? 'forfeitedPoints') and
                (select count(*) from jsonb_array_elements(game.state->'game'->'players') p where not p ? 'forfeitedPoints')<=1) then 'forfeiture'
          when game.state->'game'->>'pointsRemaining'='0' then 'pooling' end,
        'original_scores', (select jsonb_object_agg(p->>'id',
          case when p ? 'forfeitedPoints' then (p->>'forfeitedPoints')::integer
               when p->>'id'=game.state->'game'->>'winnerId' then greatest(0,(p->>'score')::integer -
                 (select coalesce(sum((other->>'forfeitedPoints')::integer),0) from jsonb_array_elements(game.state->'game'->'players') other))
               else (p->>'score')::integer end)
          from jsonb_array_elements(game.state->'game'->'players') p where p ? 'score'),
        'forfeited_ids', array(select p.user_id from public.arena_participants p where p.room_id=p_room_id and p.forfeited_at is not null)) ELSE '{}'::jsonb END
    || CASE WHEN result->>'room_name' ILIKE '%[arena:journey]%'
      AND game.state->'game'->>'winnerId' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.arena_match_series_rounds round WHERE round.room_id = p_room_id)
      THEN jsonb_build_object('winner_id', game.state->'game'->>'winnerId')
      ELSE '{}'::jsonb END END
  FROM (SELECT journey_private.get_public_arena_final_scorecard(p_room_id) result) data
  LEFT JOIN public.arena_journey_games game ON game.room_id = p_room_id
  left join public.arena_rooms r on r.id=p_room_id;
$function$
; 

-- One indexed lookup per board poll. Only trusted edge code receives private state.
create or replace function public.read_journey_poll(p_room_id uuid, p_known_version integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'room', jsonb_build_object('id',r.id,'room_name',r.room_name,'status',r.status,
      'play_mode',r.play_mode,'creator_id',r.creator_id,'started_at',r.started_at),
    'snapshot', case when g.room_id is not null and
      (g.version is distinct from p_known_version or (r.status='playing' and (
        (g.state->'game'->>'matchDeadline')::timestamptz <= now() or
        (coalesce((g.state->>'questionDeadline')::timestamptz,
           case when g.state->>'awaitingRoll'='true' then g.updated_at + interval '45 seconds' end) <= now()
         and coalesce((g.state->>'pausedUntil')::timestamptz,now()) <= now()))))
      then jsonb_build_object('version',g.version,'updated_at',g.updated_at,'state',g.state) end)
  from public.arena_rooms r left join public.arena_journey_games g on g.room_id=r.id
  where r.id=p_room_id and r.room_name ilike '%[arena:journey]%';
$$;
revoke all on function public.read_journey_poll(uuid,integer) from public, anon, authenticated;
grant execute on function public.read_journey_poll(uuid,integer) to service_role;
