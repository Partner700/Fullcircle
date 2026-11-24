-- Former members may submit new applications regardless of their current
-- streak or subscription. Admission still requires a valid subscription or
-- the one-time first-membership trial. First-time qualification is unchanged.
create or replace function public.enforce_resident_tent_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  first_join boolean;
  eligible boolean;
  previously_joined boolean;
begin
  if TG_TABLE_NAME = 'tent_members' and to_jsonb(NEW)->>'role' <> 'cadet' then return NEW; end if;
  select exists(select 1 from private.resident_tent_trials where user_id = NEW.user_id) into previously_joined;
  if not previously_joined then
    select longest_streak >= 5 into eligible from public.compute_strict_streak(NEW.user_id);
    if not coalesce(eligible, false) then raise exception 'Reach a 5-day streak to unlock Tent access.'; end if;
  end if;
  if TG_TABLE_NAME = 'tent_join_requests' then return NEW; end if;
  insert into private.resident_tent_trials(user_id) values (NEW.user_id)
    on conflict do nothing returning true into first_join;
  if coalesce(first_join, false) and not exists (
    select 1 from public.subscriptions where user_id = NEW.user_id and status in ('active','grace')
      and public.has_current_subscription_access(NEW.user_id)
  ) then
    insert into public.subscriptions(user_id,status,trial_started_at,trial_ends_at)
      values (NEW.user_id,'trial',now(),now()+interval '1 month')
      on conflict (user_id) do update set status='trial',trial_started_at=excluded.trial_started_at,
        trial_ends_at=excluded.trial_ends_at,current_period_end=null,updated_at=now();
  end if;
  if not public.has_current_subscription_access(NEW.user_id) then
    raise exception 'An active subscription or first-month trial is required to join a tent.';
  end if;
  return NEW;
end;
$$;
revoke execute on function public.enforce_resident_tent_eligibility() from public, anon, authenticated;

create or replace function public.get_tent_join_options()
returns table(id uuid, name text, profile_image_url text, cadet_count bigint, cadet_limit integer, requested boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.profile_image_url, public.tent_cadet_count(t.id)::bigint,
    public.tent_cadet_limit(t.id)::integer, exists (
      select 1 from public.tent_join_requests r
      where r.user_id = auth.uid() and r.tent_id = t.id and r.status = 'pending'
    )
  from public.tents t
  where auth.uid() is not null and t.camp_id = 1
    and not camp_management.is_admin()
    and exists (select 1 from public.role_assignments r
      where r.user_id = auth.uid() and r.role = 'cadet' and r.status in ('active', 'approved'))
    and not exists (select 1 from public.tent_members m where m.user_id = auth.uid())
    and (exists (select 1 from private.resident_tent_trials where user_id = auth.uid())
      or coalesce((select s.longest_streak >= 5 from public.compute_strict_streak(auth.uid()) s), false))
  order by t.name, t.id;
$$;
revoke execute on function public.get_tent_join_options() from public, anon;
grant execute on function public.get_tent_join_options() to authenticated;
