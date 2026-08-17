create table if not exists public.scripture_insight_comments (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid not null references public.scripture_verse_insights(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_user_id uuid references public.profiles(id) on delete set null,
  parent_comment_id uuid references public.scripture_insight_comments(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1200),
  created_at timestamptz not null default now()
);

alter table public.scripture_insight_comments enable row level security;

drop policy if exists "Authenticated users read insight comments" on public.scripture_insight_comments;
create policy "Authenticated users read insight comments"
on public.scripture_insight_comments for select to authenticated using (true);

drop policy if exists "Users create their insight comments" on public.scripture_insight_comments;
create policy "Users create their insight comments"
on public.scripture_insight_comments for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users manage their insight comments" on public.scripture_insight_comments;
create policy "Users manage their insight comments"
on public.scripture_insight_comments for delete to authenticated
using (auth.uid() = user_id);

create index if not exists scripture_insight_comments_insight_created_idx
on public.scripture_insight_comments(insight_id, created_at);

create or replace function public.notify_scripture_insight_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insight_author uuid;
  v_actor_name text;
  v_recipient uuid;
begin
  select insight.user_id into v_insight_author
  from public.scripture_verse_insights insight
  where insight.id = new.insight_id;

  select coalesce(nullif(btrim(profile.display_name), ''), 'A reader') into v_actor_name
  from public.profiles profile where profile.id = new.user_id;

  for v_recipient in
    select distinct recipient_id
    from (values (v_insight_author), (new.mentioned_user_id)) recipients(recipient_id)
    where recipient_id is not null and recipient_id <> new.user_id
  loop
    insert into public.user_notifications (
      recipient_id, actor_id, notification_type, title, body, action_key, metadata
    ) values (
      v_recipient,
      new.user_id,
      'scripture_insight_reply',
      'New reply to a scripture insight',
      v_actor_name || ' replied to an insight in Today''s Reading.',
      'narrative',
      jsonb_build_object('insight_id', new.insight_id, 'comment_id', new.id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_scripture_insight_reply_trigger on public.scripture_insight_comments;
create trigger notify_scripture_insight_reply_trigger
after insert on public.scripture_insight_comments
for each row execute function public.notify_scripture_insight_reply();

grant select, insert, delete on public.scripture_insight_comments to authenticated;
