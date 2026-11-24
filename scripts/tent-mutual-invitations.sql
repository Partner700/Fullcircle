-- Invitations are private until the resident explicitly accepts them.
create table if not exists private.tent_invitations (
  id uuid primary key default gen_random_uuid(),
  tent_id uuid not null references public.tents(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists tent_invitations_pending_unique on private.tent_invitations(tent_id, recipient_id) where status = 'pending';
alter table private.tent_invitations enable row level security;
revoke all on private.tent_invitations from public, anon, authenticated;

create or replace function public.sentry_assign_cadet_to_tent(p_tent_id uuid, p_cadet_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.tents%rowtype; invitation uuid; actor uuid := auth.uid();
begin
  perform 1 from public.profiles where id = p_cadet_id for update;
  if not found then raise exception 'Resident not found.'; end if;
  select * into t from public.tents where id = p_tent_id and camp_id = 1 for update;
  if not found or actor is null or not (t.sentry_id is not distinct from actor or exists (
    select 1 from public.tent_members m where m.tent_id = p_tent_id and m.user_id = actor and m.role = 'sentry'
  )) then raise exception 'Only this tent''s sentry can invite residents.'; end if;
  if not exists (select 1 from public.role_assignments where user_id = p_cadet_id and role = 'cadet' and status in ('active','approved'))
    or exists (select 1 from public.tent_members where user_id = p_cadet_id) then
    raise exception 'Invite an active resident who does not yet belong to a tent.';
  end if;
  update private.tent_invitations set status='cancelled',responded_at=now() where tent_id=p_tent_id and recipient_id=p_cadet_id and status='pending' and invited_by<>actor;
  select id into invitation from private.tent_invitations where tent_id = p_tent_id and recipient_id = p_cadet_id and status = 'pending';
  if not found then
    insert into private.tent_invitations(tent_id,recipient_id,invited_by) values(p_tent_id,p_cadet_id,actor) returning id into invitation;
    perform public.notify_user(p_cadet_id,actor,'tent_join_request','Tent invitation',t.name || ' invited you to join. Accept once you reach a five-day streak.','tent',jsonb_build_object('tent_id',p_tent_id,'invitation_id',invitation));
  end if;
  return jsonb_build_object('success',true,'invited',true,'invitation_id',invitation,'user_id',p_cadet_id,'tent_id',t.id,'tent_name',t.name,'tent_house_id',t.tent_house_id,'role','cadet');
end; $$;

-- A full tent can still send invitations, just as it can receive applications.
create or replace function public.get_sentry_addable_cadets(p_sentry_id uuid)
returns table(user_id uuid,display_name text,avatar_url text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.display_name,p.avatar_url from public.profiles p
  where auth.uid()=p_sentry_id and exists(select 1 from public.tents t where t.camp_id=1 and (t.sentry_id=p_sentry_id or exists(select 1 from public.tent_members m where m.tent_id=t.id and m.user_id=p_sentry_id and m.role='sentry')))
  and exists(select 1 from public.role_assignments a where a.user_id=p.id and a.role='cadet' and a.status in ('active','approved'))
  and not exists(select 1 from public.tent_members m where m.user_id=p.id)
  order by p.display_name,p.id;
$$;

create or replace function public.get_my_tent_invitations()
returns table(invitation_id uuid,tent_name text,sentry_name text,longest_streak integer,has_space boolean,can_accept boolean)
language plpgsql security definer set search_path = '' as $$
declare streak integer; actor uuid := auth.uid();
begin
  if actor is null or exists(select 1 from public.tent_members where user_id=actor) then return; end if;
  if not exists(select 1 from private.tent_invitations where recipient_id=actor and status='pending') then return; end if;
  select s.longest_streak into streak from public.compute_strict_streak(actor) s;
  return query select i.id,t.name,p.display_name,coalesce(streak,0),public.tent_cadet_count(t.id)<public.tent_cadet_limit(t.id),
    coalesce(streak,0)>=5 and public.tent_cadet_count(t.id)<public.tent_cadet_limit(t.id)
  from private.tent_invitations i join public.tents t on t.id=i.tent_id join public.profiles p on p.id=i.invited_by
  where i.recipient_id=actor and i.status='pending' and t.camp_id=1
    and (t.sentry_id=i.invited_by or exists(select 1 from public.tent_members m where m.tent_id=t.id and m.user_id=i.invited_by and m.role='sentry'))
  order by i.created_at desc;
end; $$;

create or replace function public.get_sent_tent_invitations(p_tent_id uuid)
returns table(recipient_id uuid,display_name text)
language sql stable security definer set search_path = '' as $$
  select i.recipient_id,p.display_name from private.tent_invitations i join public.profiles p on p.id=i.recipient_id
  join public.tents t on t.id=i.tent_id where i.tent_id=p_tent_id and i.status='pending'
  and auth.uid() is not null and i.invited_by=auth.uid() and (t.sentry_id=auth.uid() or exists(select 1 from public.tent_members m where m.tent_id=t.id and m.user_id=auth.uid() and m.role='sentry'));
$$;

create or replace function public.enforce_self_service_first_tent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role='cadet' and not exists(select 1 from private.resident_tent_trials where user_id=new.user_id)
    and not exists(select 1 from public.tent_join_requests r where r.user_id=new.user_id and r.tent_id=new.tent_id and r.status='pending')
    and not exists(select 1 from private.tent_invitations i where i.recipient_id=new.user_id and i.tent_id=new.tent_id and i.status='accepted' and i.responded_at=transaction_timestamp() and auth.uid()=new.user_id)
    then raise exception 'The resident must request this tent or accept an invitation first.'; end if;
  return new;
end; $$;

create or replace function public.respond_to_tent_invitation(p_invitation_id uuid,p_accept boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); i private.tent_invitations%rowtype; t public.tents%rowtype; eligible boolean;
begin
  if actor is null then raise exception 'Sign in to respond to an invitation.'; end if;
  perform 1 from public.profiles where id=actor for update;
  select * into i from private.tent_invitations where id=p_invitation_id and recipient_id=actor and status='pending' for update;
  if not found then raise exception 'Pending invitation not found.'; end if;
  if p_accept is null then raise exception 'Choose whether to accept or decline.'; end if;
  if not p_accept then
    update private.tent_invitations set status='declined',responded_at=now() where id=i.id;
    return true;
  end if;
  select * into t from public.tents where id=i.tent_id and camp_id=1 for update;
  if not found or not (t.sentry_id is not distinct from i.invited_by or exists(select 1 from public.tent_members m where m.tent_id=i.tent_id and m.user_id=i.invited_by and m.role='sentry')) then raise exception 'This invitation is no longer valid.'; end if;
  if not exists(select 1 from public.role_assignments where user_id=actor and role='cadet' and status in ('active','approved')) or exists(select 1 from public.tent_members where user_id=actor) then raise exception 'Only unassigned active residents can accept invitations.'; end if;
  select longest_streak>=5 into eligible from public.compute_strict_streak(actor);
  if not coalesce(eligible,false) then raise exception 'Reach a 5-day streak before accepting this invitation.'; end if;
  if public.tent_cadet_count(t.id)>=public.tent_cadet_limit(t.id) then raise exception 'This tent is full. Your invitation remains pending.'; end if;
  update private.tent_invitations set status='accepted',responded_at=now() where id=i.id;
  insert into public.tent_members(tent_id,user_id,role) values(t.id,actor,'cadet');
  update public.tent_join_requests set status='cancelled',reviewed_at=now() where user_id=actor and status='pending';
  perform public.notify_user(i.invited_by,actor,'tent_join_request','Tent invitation accepted','A resident accepted your invitation to ' || t.name || '.','cadets',jsonb_build_object('tent_id',t.id,'invitation_id',i.id));
  return true;
end; $$;

create or replace function private.close_pending_tent_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.tent_invitations set status='cancelled',responded_at=now() where recipient_id=new.user_id and status='pending';
  return new;
end; $$;
drop trigger if exists close_pending_tent_invitations on public.tent_members;
create trigger close_pending_tent_invitations after insert on public.tent_members for each row execute function private.close_pending_tent_invitations();
revoke execute on function public.sentry_assign_cadet_to_tent(uuid,uuid),public.get_my_tent_invitations(),public.get_sent_tent_invitations(uuid),public.respond_to_tent_invitation(uuid,boolean) from public,anon;
grant execute on function public.sentry_assign_cadet_to_tent(uuid,uuid),public.get_my_tent_invitations(),public.get_sent_tent_invitations(uuid),public.respond_to_tent_invitation(uuid,boolean) to authenticated;
