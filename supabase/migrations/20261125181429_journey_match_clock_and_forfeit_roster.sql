-- Keep the roster and scoreboard in the same transaction as the board change.
create or replace function journey_private.record_board_forfeit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.arena_participants p
  set forfeited_at = now(), finished_at = now(), score = 0,
      forfeit_reason = case when coalesce((new.state->'skips'->>p.user_id::text)::integer,0) >= 3
                            then 'three_skips' else 'manual' end
  from jsonb_array_elements(new.state->'game'->'players') as player
  where p.room_id = new.room_id and p.user_id::text = player->>'id'
    and player ? 'forfeitedPoints' and p.forfeited_at is null;
  return new;
end;
$$;
revoke all on function journey_private.record_board_forfeit() from public, anon, authenticated;
create trigger journey_board_forfeit_roster after update of state on public.arena_journey_games
for each row when (new.state->'game'->'players' @? '$[*].forfeitedPoints')
execute function journey_private.record_board_forfeit();

-- Reject moves that arrive at the database after the closing instant, including
-- moves that were valid when the server started evaluating the request.
create or replace function journey_private.guard_match_close()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.state->'game'->>'status'='playing'
    and clock_timestamp() >= (old.state->'game'->>'matchDeadline')::timestamptz
    and (new.state->'game'->>'status' is distinct from 'finished'
         or new.state->'game'->>'closedByClock' is distinct from 'true') then
    raise exception 'The Journey match advanced at the closing deadline.' using errcode='PT409';
  end if;
  return new;
end;
$$;
revoke all on function journey_private.guard_match_close() from public, anon, authenticated;
create trigger journey_match_close_guard before update of state on public.arena_journey_games
for each row when (old.state->'game' ? 'matchDeadline') execute function journey_private.guard_match_close();

-- Wake only overdue timed Journey boards, including rooms with no connected devices.
select cron.schedule('journey-finish-overdue-timed-matches','15 seconds',$job$
 select net.http_post(
   url := 'https://ovusyeqbmtvfcrlflrbf.supabase.co/functions/v1/biblical-journey',
   body := jsonb_build_object('action','GET','roomId',g.room_id),
   timeout_milliseconds := 12000)
 from public.arena_rooms r join public.arena_journey_games g on g.room_id=r.id
 where r.status='playing' and g.state->'game'->>'status'='playing'
   and (g.state->'game'->>'matchDeadline')::timestamptz <= now()
 limit 25;
$job$);