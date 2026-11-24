create schema camp_management;
revoke all on schema camp_management from public, anon, authenticated;

create table camp_management.admin (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict
);
create table camp_management.camps (
  id bigint generated always as identity primary key,
  series text not null check (series ~ '^[A-Z]$'),
  ordinal integer not null check (ordinal >= 0),
  code text generated always as (series || case when ordinal = 0 then '0'
    when ordinal < 1000 then lpad(ordinal::text, 3, '0') else ordinal::text end) stored,
  unique (series, ordinal)
);
create table camp_management.instructors (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  camp_id bigint not null references camp_management.camps(id)
);
create table camp_management.assignment_history (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  instructor_id uuid not null,
  previous_camp bigint,
  next_camp bigint,
  changed_at timestamptz not null default now()
);
alter table camp_management.admin enable row level security;
alter table camp_management.camps enable row level security;
alter table camp_management.instructors enable row level security;
alter table camp_management.assignment_history enable row level security;

insert into camp_management.camps (series, ordinal) values ('A', 0);
insert into camp_management.instructors
select distinct r.user_id, c.id
from public.role_assignments r cross join camp_management.camps c
where r.role = 'instructor' and r.status in ('active', 'approved') and c.code = 'A0';

-- A0 remains the home of legacy tent operations until camp-scoped tent tools ship.
alter table public.tents add column camp_id bigint not null default 1 references camp_management.camps(id);
alter table public.tents add constraint tents_a0_during_camp_rollout check (camp_id = 1);

create function camp_management.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from camp_management.admin where user_id = auth.uid());
$$;

create function public.get_camp_workspace()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare assigned_code text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if camp_management.is_admin() then
    return jsonb_build_object('role', 'admin', 'camps', (
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', c.code, 'instructors', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name,
            'legacy', public.is_instructor(p.id)) order by p.display_name, p.id)
          from camp_management.instructors i join public.profiles p on p.id = i.user_id
          where i.camp_id = c.id
        ), '[]'::jsonb)
      ) order by c.series, c.ordinal) from camp_management.camps c
    ));
  end if;

  select c.code into assigned_code from camp_management.instructors i
  join camp_management.camps c on c.id = i.camp_id where i.user_id = auth.uid();
  if found and not public.is_instructor(auth.uid()) then
    return jsonb_build_object('role', 'instructor', 'campCode', assigned_code);
  end if;
  return jsonb_build_object('role', 'none');
end;
$$;

create function public.create_managed_camp(p_series text)
returns void language plpgsql security definer set search_path = '' as $$
declare camp_series text := upper(trim(p_series));
begin
  if not camp_management.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if camp_series is null or camp_series !~ '^[A-Z]$' then raise exception 'Choose a series from A to Z'; end if;
  lock table camp_management.camps in exclusive mode;
  insert into camp_management.camps (series, ordinal)
  select camp_series, coalesce(max(ordinal) + 1, 0) from camp_management.camps where series = camp_series;
end;
$$;

create function public.set_managed_camp_instructor(p_camp_id bigint, p_email text default null, p_remove_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare target uuid;
  previous_camp bigint;
begin
  if not camp_management.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if (p_email is null) = (p_remove_id is null) then raise exception 'Select one instructor action'; end if;
  if not exists (select 1 from camp_management.camps where id = p_camp_id) then raise exception 'Camp does not exist'; end if;
  if p_email is null then
    target := p_remove_id;
  else
    select u.id into target from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null;
    if target is null then raise exception 'No confirmed Full Circle account matches that email'; end if;
  end if;
  if target = auth.uid() then raise exception 'Admin is separate from Instructor assignments'; end if;
  perform 1 from public.profiles where id = target for update;
  select camp_id into previous_camp from camp_management.instructors where user_id = target;
  if public.is_instructor(target) and (p_remove_id is not null or p_camp_id <> 1) then
    raise exception 'Legacy Camp A0 Instructor permissions must be migrated before moving this account';
  end if;
  if p_remove_id is not null then
    delete from camp_management.instructors where user_id = target and camp_id = p_camp_id;
    if not found then return; end if;
  else
    if previous_camp = p_camp_id then return; end if;
    insert into camp_management.instructors values (target, p_camp_id)
    on conflict (user_id) do update set camp_id = excluded.camp_id;
  end if;
  insert into camp_management.assignment_history (admin_id, instructor_id, previous_camp, next_camp)
  values (auth.uid(), target, previous_camp, case when p_remove_id is null then p_camp_id end);
end;
$$;

revoke execute on function public.get_camp_workspace(), public.create_managed_camp(text),
  public.set_managed_camp_instructor(bigint, text, uuid) from public, anon;
grant execute on function public.get_camp_workspace(), public.create_managed_camp(text),
  public.set_managed_camp_instructor(bigint, text, uuid) to authenticated;
