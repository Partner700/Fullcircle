create or replace function journey_private.set_human_match_clock() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare n integer; prior integer; started timestamptz; deadline timestamptz;
begin
 if TG_OP='UPDATE' then
   if not (old.state->'game' ? 'clockHumanCount') then return new; end if;
   prior := (old.state->'game'->>'clockHumanCount')::integer;
   deadline := (old.state->'game'->>'matchDeadline')::timestamptz;
 else
   prior := 0;
   select started_at into strict started from public.arena_rooms where id=new.room_id;
   deadline := started;
 end if;
 select count(distinct p->>'id') into n from jsonb_array_elements(new.state->'game'->'players') p where p->>'id' <> '00000000-0000-0000-0000-000000000000';
 n := greatest(prior, least(4,greatest(1,n)));
 new.state := jsonb_set(new.state,'{game,clockHumanCount}',to_jsonb(n));
 new.state := jsonb_set(new.state,'{game,matchDeadline}',to_jsonb(deadline + (n-prior)*interval '15 minutes'));
 return new;
end;
$$;
revoke all on function journey_private.set_human_match_clock() from public;
drop trigger if exists journey_human_match_clock on public.arena_journey_games;
create trigger journey_human_match_clock before insert or update of state on public.arena_journey_games for each row execute function journey_private.set_human_match_clock();