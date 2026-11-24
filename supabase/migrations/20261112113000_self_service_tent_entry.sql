-- Residents choose their own tent once the existing 10-day streak gate is met.
create function public.get_tent_join_options()
returns table(id uuid, name text, profile_image_url text, cadet_count bigint, cadet_limit integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.profile_image_url, public.tent_cadet_count(t.id)::bigint,
    public.tent_cadet_limit(t.id)::integer
  from public.tents t
  where auth.uid() is not null
    and not camp_management.is_admin()
    and exists (
      select 1 from public.role_assignments r
      where r.user_id = auth.uid() and r.role = 'cadet' and r.status in ('active', 'approved')
    )
    and not exists (select 1 from public.tent_members m where m.user_id = auth.uid())
    and coalesce((select s.longest_streak >= 10 from public.compute_strict_streak(auth.uid()) s), false)
  order by t.name, t.id;
$$;

create function public.join_eligible_tent(p_tent_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  current_tent uuid;
begin
  if caller is null then raise exception 'Sign in to join a tent.' using errcode = '42501'; end if;
  if camp_management.is_admin() then raise exception 'Admin accounts do not join tents.' using errcode = '42501'; end if;
  -- Keep simultaneous requests by one resident from claiming two places.
  perform 1 from public.profiles where id = caller for update;
  if not found then raise exception 'Complete your profile before joining a tent.'; end if;
  select m.tent_id into current_tent from public.tent_members m where m.user_id = caller;
  if found then
    if current_tent = p_tent_id then return current_tent; end if;
    raise exception 'You already belong to a tent.';
  end if;
  if not exists (
    select 1 from public.role_assignments r
    where r.user_id = caller and r.role = 'cadet' and r.status in ('active', 'approved')
  ) then raise exception 'Only residents can join a tent.'; end if;

  if not coalesce((select s.longest_streak >= 10 from public.compute_strict_streak(caller) s), false) then
    raise exception 'Reach a 10-day streak to unlock Tent access.';
  end if;
  perform 1 from public.tents where id = p_tent_id for update;
  if not found then raise exception 'Tent not found.'; end if;
  if public.tent_cadet_count(p_tent_id) >= public.tent_cadet_limit(p_tent_id) then
    raise exception 'That tent is full. Choose another tent.';
  end if;

  -- Existing membership triggers enforce streak eligibility, capacity and the
  -- first-month trial in the same transaction as the seat reservation.
  insert into public.tent_members (tent_id, user_id, role) values (p_tent_id, caller, 'cadet');
  return p_tent_id;
end;
$$;

create function public.enforce_self_service_first_tent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'cadet' and auth.uid() is distinct from new.user_id
    and not exists (select 1 from private.resident_tent_trials where user_id = new.user_id) then
    raise exception 'New residents choose their own tent once they reach a 10-day streak.';
  end if;
  return new;
end;
$$;
create trigger first_tent_requires_resident_choice
before insert on public.tent_members for each row execute function public.enforce_self_service_first_tent();

update public.tent_join_requests set status = 'cancelled', reviewed_at = now() where status = 'pending';
revoke insert, update on public.tent_join_requests from anon, authenticated;
revoke execute on function public.request_to_join_tent(uuid), public.review_tent_join_request(uuid, boolean),
  public.set_tent_join_direction(uuid, uuid), public.set_default_tent_join_direction(uuid)
  from public, anon, authenticated;
revoke execute on function public.enforce_self_service_first_tent() from public, anon, authenticated;
revoke execute on function public.get_tent_join_options(), public.join_eligible_tent(uuid) from public, anon;
grant execute on function public.get_tent_join_options(), public.join_eligible_tent(uuid) to authenticated;
