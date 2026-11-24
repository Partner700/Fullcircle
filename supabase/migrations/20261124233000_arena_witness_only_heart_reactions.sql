-- Extra INSERT restriction: active players can chat, but only witnesses can send the Arena heart token.
-- Apply on top of existing room membership and sender identity policy.
create policy "arena hearts are witness-only"
on public.arena_room_messages as restrictive
for insert to authenticated
with check (
  btrim(body) <> '❤️'
  or not exists (
    select 1 from public.arena_participants participant
    where participant.room_id = arena_room_messages.room_id
      and participant.user_id = (select auth.uid())
      and participant.forfeited_at is null
  )
);
