create table if not exists public.scripture_verse_insights (
  id uuid primary key default gen_random_uuid(),
  narrative_id uuid not null references public.daily_narratives(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  verse_reference text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (narrative_id, user_id, verse_reference)
);

alter table public.scripture_verse_insights enable row level security;

drop policy if exists "Everyone can read scripture insights" on public.scripture_verse_insights;
create policy "Everyone can read scripture insights"
on public.scripture_verse_insights
for select
to authenticated
using (true);

drop policy if exists "Users manage their scripture insights" on public.scripture_verse_insights;
create policy "Users manage their scripture insights"
on public.scripture_verse_insights
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists scripture_verse_insights_narrative_reference_idx
on public.scripture_verse_insights(narrative_id, verse_reference, created_at desc);
