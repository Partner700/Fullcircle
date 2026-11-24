-- Preserve the original result and its room reference when an instructor
-- cancels a decided inter-tent fixture. This is private audit data only.
create table if not exists private.intertent_cancelled_replays (
  old_room_id uuid primary key references public.arena_rooms(id),
  fixture_id uuid not null references private.intertent_fixtures(id),
  canceled_at timestamptz not null default now(),
  previous_result jsonb not null,
  previous_winner_id uuid,
  previous_completed_at timestamptz,
  new_room_id uuid references public.arena_rooms(id),
  reason text not null
);
