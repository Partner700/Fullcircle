create or replace function public.get_public_arena_successor(p_room_id uuid)
returns uuid language plpgsql stable security definer set search_path to '' as $$
declare v_current uuid := p_room_id; v_next uuid; v_steps integer := 0;
begin
 loop
  select room.restarted_as_room_id into v_next
  from public.arena_rooms room
  where room.id = v_current and room.status='completed'
    and room.restarted_as_room_id is not null
    and room.completion_reason in ('round','draw','forfeit');
  if v_next is null or v_steps >= 32 then exit; end if;
  v_current := v_next;
  v_steps := v_steps + 1;
 end loop;
 return case when v_current=p_room_id then null else v_current end;
end $$;
