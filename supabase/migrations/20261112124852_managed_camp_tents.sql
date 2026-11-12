alter table public.tents drop constraint tents_a0_during_camp_rollout;
create index tents_camp_id_idx on public.tents(camp_id);

-- Old Camp A0 Instructor RPCs can bypass RLS. Apply the boundary to their
-- writes as well, including the legacy delete and move operations.
create function camp_management.guard_legacy_tent_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_camp bigint;
  new_camp bigint;
begin
  if public.is_instructor(auth.uid()) then
    if tg_table_name = 'tents' then
      if tg_op <> 'INSERT' then old_camp := old.camp_id; end if;
      if tg_op <> 'DELETE' then new_camp := new.camp_id; end if;
    else
      if tg_op <> 'INSERT' then select camp_id into old_camp from public.tents where id = old.tent_id; end if;
      if tg_op <> 'DELETE' then select camp_id into new_camp from public.tents where id = new.tent_id; end if;
    end if;
    if coalesce(old_camp, 1) <> 1 or coalesce(new_camp, 1) <> 1 then
      raise exception 'Camp A0 Instructor access cannot change another camp''s tents.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_legacy_tent_writes before insert or update or delete on public.tents
for each row execute function camp_management.guard_legacy_tent_writes();
create trigger guard_legacy_tent_membership_writes before insert or update or delete on public.tent_members
for each row execute function camp_management.guard_legacy_tent_writes();

create function camp_management.require_instructor_camp(p_lock boolean)
returns bigint language plpgsql set search_path = '' as $$
declare assigned bigint;
begin
  if auth.uid() is null or camp_management.is_admin() or public.is_instructor(auth.uid()) then
    raise exception 'A camp Instructor assignment is required.' using errcode = '42501';
  end if;
  if p_lock then
    select camp_id into assigned from camp_management.instructors where user_id = auth.uid() for share;
  else
    select camp_id into assigned from camp_management.instructors where user_id = auth.uid();
  end if;
  if assigned is null then
    raise exception 'A camp Instructor assignment is required.' using errcode = '42501';
  end if;
  return assigned;
end;
$$;

create function public.get_instructor_camp_tents()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  assigned bigint := camp_management.require_instructor_camp(false);
  today date := timezone('Africa/Douala', now())::date;
begin
  return jsonb_build_object(
    'date', today,
    'weekday', extract(isodow from today) <= 5,
    'tents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'houseId', t.tent_house_id, 'sentryName', s.display_name,
        'cadets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.display_name,
            'status', coalesce(nullif(d.attendance_status, ''), 'unmarked')
          ) order by p.display_name, p.id)
          from public.tent_members m join public.profiles p on p.id = m.user_id
          left join public.daily_records d on d.user_id = m.user_id and d.record_date = today
          where m.tent_id = t.id and m.role = 'cadet'
        ), '[]'::jsonb)
      ) order by t.name, t.id)
      from public.tents t left join public.profiles s on s.id = t.sentry_id
      where t.camp_id = assigned
    ), '[]'::jsonb)
  );
end;
$$;

create function public.save_instructor_camp_tent(p_name text, p_house_id text, p_tent_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  assigned bigint := camp_management.require_instructor_camp(true);
  saved_id uuid;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then
    raise exception 'Enter a tent name between 1 and 100 characters.';
  end if;
  if not exists (select 1 from public.tent_houses where id = p_house_id) then
    raise exception 'Select a valid tent house.';
  end if;
  if p_tent_id is null then
    insert into public.tents (camp_id, name, tent_house_id)
    values (assigned, trim(p_name), p_house_id) returning id into saved_id;
  else
    update public.tents set name = trim(p_name), tent_house_id = p_house_id
    where id = p_tent_id and camp_id = assigned returning id into saved_id;
    if not found then raise exception 'That tent is outside your assigned camp.' using errcode = '42501'; end if;
  end if;
  return saved_id;
end;
$$;

create function public.set_instructor_camp_tent_sentry(p_tent_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  assigned bigint := camp_management.require_instructor_camp(true);
  target uuid;
  current_sentry uuid;
begin
  select t.sentry_id into current_sentry from public.tents t
  where t.id = p_tent_id and t.camp_id = assigned for update;
  if not found then raise exception 'That tent is outside your assigned camp.' using errcode = '42501'; end if;

  select u.id into target from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null
    and exists (select 1 from public.role_assignments r where r.user_id = u.id
      and r.role = 'sentry' and r.status in ('active', 'approved'))
    and not exists (select 1 from camp_management.instructors i where i.user_id = u.id)
    and not exists (select 1 from camp_management.admin a where a.user_id = u.id)
  for update of p;
  if target is null then raise exception 'Enter the email of a confirmed account with an active Sentry role.'; end if;

  if exists (select 1 from public.tents where sentry_id = target and id <> p_tent_id)
    or exists (select 1 from public.tent_members where user_id = target and (tent_id <> p_tent_id or role <> 'sentry')) then
    raise exception 'That Sentry already belongs to a tent. Choose an available Sentry.';
  end if;

  if current_sentry is not null and current_sentry <> target then
    delete from public.tent_members where tent_id = p_tent_id and user_id = current_sentry and role = 'sentry';
  end if;
  update public.tents set sentry_id = target where id = p_tent_id;
  if not exists (select 1 from public.tent_members where tent_id = p_tent_id and user_id = target and role = 'sentry') then
    insert into public.tent_members (tent_id, user_id, role) values (p_tent_id, target, 'sentry');
  end if;
end;
$$;

revoke execute on function public.get_instructor_camp_tents(),
  public.save_instructor_camp_tent(text, text, uuid), public.set_instructor_camp_tent_sentry(uuid, text)
  from public, anon;
grant execute on function public.get_instructor_camp_tents(),
  public.save_instructor_camp_tent(text, text, uuid), public.set_instructor_camp_tent_sentry(uuid, text)
  to authenticated;
