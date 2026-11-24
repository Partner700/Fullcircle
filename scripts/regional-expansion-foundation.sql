-- Regions are independent of tent membership. Selecting a region never moves
-- a person, changes their privileges, or alters any existing camp assignment.
create table private.fc_regions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  city text not null check (char_length(city) between 2 and 100),
  city_key text not null,
  created_at timestamptz not null default now(),
  unique(country_code,city_key)
);
create table private.fc_region_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  region_id uuid not null references private.fc_regions(id),
  joined_at timestamptz not null default now()
);
create index fc_region_members_region_idx on private.fc_region_members(region_id);
alter table private.fc_regions enable row level security;
alter table private.fc_region_members enable row level security;
revoke all on private.fc_regions,private.fc_region_members from public,anon,authenticated;

create function public.get_my_region() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'country_code',r.country_code,'city',r.city)
  from private.fc_region_members m join private.fc_regions r on r.id=m.region_id
  where m.user_id=auth.uid() and auth.uid() is not null;
$$;

create function public.confirm_my_region(p_country text,p_city text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); country text:=upper(trim(p_country)); city_name text:=regexp_replace(trim(p_city),'[[:space:]]+',' ','g'); region uuid;
begin
  if actor is null then raise exception 'Sign in to select your region.'; end if;
  perform 1 from public.profiles where id=actor for update;
  if not found then raise exception 'Complete your profile first.'; end if;
  if not exists(select 1 from public.role_assignments where user_id=actor and status in ('active','approved') and role in ('cadet','sentry','instructor')) then raise exception 'An active resident account is required.'; end if;
  if country is null or country !~ '^[A-Z]{2}$' or char_length(coalesce(city_name,'')) not between 2 and 100 or city_name ~ '[[:cntrl:]]' then raise exception 'Choose a country and enter your city.'; end if;
  if exists(select 1 from private.fc_region_members where user_id=actor) then raise exception 'Your region is already confirmed. Contact your Instructor or support to request a move.'; end if;
  insert into private.fc_regions(country_code,city,city_key) values(country,city_name,lower(city_name)) on conflict(country_code,city_key) do nothing;
  select id into region from private.fc_regions where country_code=country and city_key=lower(city_name);
  insert into private.fc_region_members(user_id,region_id) values(actor,region);
  return public.get_my_region();
end; $$;

-- Regional rankings share only public competitive statistics, not contact,
-- attendance, private meditations, or camp administration information.
create function public.get_regional_challenge_board(p_metric text,p_audience text default 'cadet')
returns table(user_id uuid,display_name text,avatar_url text,score numeric) language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); region uuid;
begin
  if actor is null then raise exception 'Sign in to view regional rankings.'; end if;
  if not exists(select 1 from public.role_assignments where role_assignments.user_id=actor and status in ('active','approved') and role in ('cadet','sentry','instructor')) then raise exception 'An active resident account is required.'; end if;
  if p_metric is null or p_metric not in ('streak','figs','denarii','rhudes','command','rite') or p_audience is null or p_audience not in ('cadet','sentry') then raise exception 'Invalid board.'; end if;
  if p_audience='sentry' and p_metric='denarii' or p_audience='cadet' and p_metric in ('command','rite') then raise exception 'Invalid board for this audience.'; end if;
  select m.region_id into region from private.fc_region_members m where m.user_id=actor;
  if region is null then return; end if;
  return query select p.id,p.display_name,p.avatar_url,coalesce(case p_metric
    when 'streak' then (select s.current_streak::numeric from public.get_authoritative_streak(p.id) s limit 1)
    when 'figs' then public.get_user_lifetime_figs(p.id,null)
    when 'denarii' then (select sum(d.amount)::numeric from public.denarii_ledger_entries d where d.user_id=p.id)
    when 'rhudes' then (select count(*)::numeric from public.arena_rooms a where a.winner_id=p.id and a.status='completed')
    when 'command' then (select count(distinct h.cadet_id)::numeric from private.leadership_memberships h where h.sentry_id=p.id and h.started_on<=timezone('Africa/Douala',now())::date and h.ended_on is null and public.streak_requirement_met(h.cadet_id,timezone('Africa/Douala',now())::date))
    when 'rite' then (select count(*)::numeric from private.rite_developments d where d.sentry_id=p.id)
  end,0) from private.fc_region_members m join public.profiles p on p.id=m.user_id
  where m.region_id=region and exists(select 1 from public.role_assignments a where a.user_id=p.id and a.role=p_audience and a.status in ('active','approved'))
  order by 4 desc,p.id;
end; $$;
revoke execute on function public.get_my_region(),public.confirm_my_region(text,text),public.get_regional_challenge_board(text,text) from public,anon;
grant execute on function public.get_my_region(),public.confirm_my_region(text,text),public.get_regional_challenge_board(text,text) to authenticated;
