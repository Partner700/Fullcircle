alter table public.scripture_verse_insights
  alter column narrative_id drop not null,
  add column bible_book text,
  add column bible_chapter integer,
  add column is_question boolean not null default false,
  add constraint scripture_insight_location check (
    (narrative_id is not null and bible_book is null and bible_chapter is null)
    or (narrative_id is null and bible_book is not null and bible_chapter is not null
        and bible_book ~ '^[1-3]?[a-z]+(-[a-z]+)*$' and bible_chapter between 1 and 150)
  );

do $migration$
declare
  original_constraint name;
begin
  select conname into strict original_constraint from pg_constraint
    where conrelid = 'public.scripture_verse_insights'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (narrative_id, user_id, verse_reference)';
  execute format('alter table public.scripture_verse_insights drop constraint %I', original_constraint);
end;
$migration$;

create unique index scripture_daily_insight_unique on public.scripture_verse_insights
  (narrative_id, user_id, verse_reference) where not is_question;
create index scripture_bible_chapter_insights on public.scripture_verse_insights
  (bible_book, bible_chapter, created_at) where narrative_id is null;

-- Keep the existing verse-insight upsert and allow multiple question threads on the same verse.
do $migration$
declare
  definition text := pg_get_functiondef('public.save_scripture_verse_insight_secure(uuid,text,text,uuid[])'::regprocedure);
begin
  if strpos(definition, 'ON CONFLICT (narrative_id, user_id, verse_reference) DO UPDATE') = 0 then
    raise exception 'Unexpected existing scripture insight conflict target';
  end if;
  definition := replace(definition, 'AND insight.verse_reference = btrim(p_verse_reference)',
    'AND insight.verse_reference = btrim(p_verse_reference) AND NOT insight.is_question');
  execute replace(definition, 'ON CONFLICT (narrative_id, user_id, verse_reference) DO UPDATE',
    'ON CONFLICT (narrative_id, user_id, verse_reference) WHERE NOT is_question DO UPDATE');
end;
$migration$;

create policy scripture_regular_insight_insert on public.scripture_verse_insights
  as restrictive for insert to authenticated with check (not is_question);
create policy scripture_regular_insight_update on public.scripture_verse_insights
  as restrictive for update to authenticated using (not is_question) with check (not is_question);

create table private.scripture_question_deliveries (
  question_id uuid not null references public.scripture_verse_insights(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (question_id, recipient_id)
);
alter table private.scripture_question_deliveries enable row level security;
revoke all on private.scripture_question_deliveries from public, anon, authenticated;
create index scripture_question_pending_recipient on private.scripture_question_deliveries
  (recipient_id, delivered_at, question_id) where resolved_at is null;

create function private.scripture_question_camp(p_user_id uuid)
returns bigint language sql stable set search_path = '' as $$
  select coalesce(
    (select i.camp_id from camp_management.instructors i where i.user_id = p_user_id),
    (select t.camp_id from public.tent_members m join public.tents t on t.id = m.tent_id
     where m.user_id = p_user_id order by m.joined_at desc limit 1),
    (select t.camp_id from public.tents t where t.sentry_id = p_user_id order by t.id limit 1),
    1
  );
$$;
revoke all on function private.scripture_question_camp(uuid) from public, anon, authenticated;

create function public.post_scripture_question(
  p_id uuid, p_narrative_id uuid, p_book text, p_chapter integer, p_reference text,
  p_body text, p_people uuid[], p_scope text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  inserted_id uuid;
begin
  if actor is null or not public.has_current_subscription_access(actor) then
    raise exception 'An active subscription is required to ask a scripture question.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('people', 'camp', 'community')
     or char_length(trim(coalesce(p_body, ''))) not between 1 and 1200
     or char_length(trim(coalesce(p_reference, ''))) not between 1 and 120 then
    raise exception 'Choose who to tag and enter a question.';
  end if;
  insert into public.scripture_verse_insights
    (id, narrative_id, bible_book, bible_chapter, verse_reference, user_id, body, is_question, mentioned_user_ids)
  values (p_id, p_narrative_id, p_book, p_chapter, trim(p_reference), actor, trim(p_body), true,
    coalesce(p_people, '{}'::uuid[]))
  on conflict (id) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    if exists (select 1 from public.scripture_verse_insights where id = p_id and user_id = actor and is_question) then
      return p_id;
    end if;
    raise exception 'This question could not be saved.';
  end if;

  insert into private.scripture_question_deliveries (question_id, recipient_id)
  select inserted_id, c.user_id
  from public.get_camp_mention_candidates() c
  where c.user_id <> actor and (
    c.user_id = any(coalesce(p_people, '{}'::uuid[]))
    or p_scope = 'community'
    or (p_scope = 'camp' and private.scripture_question_camp(c.user_id) = private.scripture_question_camp(actor))
  )
  on conflict do nothing;
  if not found then raise exception 'Tag at least one other active member.'; end if;
  return inserted_id;
end;
$$;

create function public.get_pending_scripture_question()
returns table(id uuid, verse_reference text, body text, author text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.verse_reference, i.body, coalesce(nullif(p.display_name, ''), 'Full Circle member')
  from private.scripture_question_deliveries d
  join public.scripture_verse_insights i on i.id = d.question_id
  join public.profiles p on p.id = i.user_id
  where d.recipient_id = auth.uid() and d.resolved_at is null
  order by d.delivered_at, d.question_id limit 1;
$$;

create function public.resolve_scripture_question(p_question_id uuid, p_decision text, p_answer text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  delivery private.scripture_question_deliveries%rowtype;
begin
  if actor is null or p_decision is null or p_decision not in ('answer', 'ignore') then
    raise exception 'Choose Answer or Ignore.' using errcode = '42501';
  end if;
  select * into delivery from private.scripture_question_deliveries
    where question_id = p_question_id and recipient_id = actor for update;
  if not found then raise exception 'This question was not sent to you.' using errcode = '42501'; end if;
  if delivery.resolved_at is not null then return; end if;
  if p_decision = 'answer' then
    if char_length(trim(coalesce(p_answer, ''))) not between 1 and 1200 then
      raise exception 'Enter an answer of up to 1200 characters.';
    end if;
    insert into public.scripture_insight_comments (insight_id, user_id, body)
    values (p_question_id, actor, trim(p_answer));
  end if;
  update private.scripture_question_deliveries set resolved_at = now()
    where question_id = p_question_id and recipient_id = actor;
end;
$$;

revoke execute on function public.post_scripture_question(uuid,uuid,text,integer,text,text,uuid[],text),
  public.get_pending_scripture_question(), public.resolve_scripture_question(uuid,text,text)
  from public, anon;
grant execute on function public.post_scripture_question(uuid,uuid,text,integer,text,text,uuid[],text),
  public.get_pending_scripture_question(), public.resolve_scripture_question(uuid,text,text) to authenticated;
