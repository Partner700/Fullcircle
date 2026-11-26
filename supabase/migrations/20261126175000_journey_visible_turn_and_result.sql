-- Record delivery only when the active player's visible board confirms this version near timeout.
alter table public.arena_participants add column journey_seen_version integer;

create function public.confirm_visible_journey_turn(p_room_id uuid, p_version integer)
returns void language sql security definer set search_path='' as $$
  update public.arena_participants p set journey_seen_version=p_version
  from public.arena_journey_games g
  where p.user_id=auth.uid() and p.room_id=p_room_id and p.forfeited_at is null
    and g.room_id=p.room_id and g.version=p_version and g.state->'game'->>'status'='playing'
    and g.state->>'currentQuestionPlayerId'=p.user_id::text
    and (g.state->>'questionDeadline')::timestamptz between now() and now()+interval '10 seconds'
    and p.journey_seen_version is distinct from p_version;
$$;
revoke all on function public.confirm_visible_journey_turn(uuid,integer) from public,anon;
grant execute on function public.confirm_visible_journey_turn(uuid,integer) to authenticated;

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

