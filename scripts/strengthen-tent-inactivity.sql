-- Release patch: use the settled streak history instead of counting cron runs.
-- The existing 21:05 Africa/Douala cron invokes this private function daily.
-- No membership is removed by applying this definition alone.
create or replace function private.drop_inactive_tent_cadets()
returns void language plpgsql set search_path = '' as $$
declare
  local_day date := timezone('Africa/Douala', now())::date;
  candidate record;
  live_streak integer;
begin
  -- Do not count the current day until its streak deadline has passed.
  if timezone('Africa/Douala', now())::time < time '21:00' then
    local_day := local_day - 1;
  end if;

  for candidate in
    select m.id, m.user_id, m.joined_at
    from public.tent_members m
    where m.role = 'cadet'
      and timezone('Africa/Douala', m.joined_at)::date <= local_day - 4
    order by m.user_id
  loop
    -- The canonical engine settles missing days and honors active freezers,
    -- reviewed restorations and purchases before checking eligibility.
    select s.current_streak into live_streak
    from public.compute_strict_streak(candidate.user_id) s;

    if live_streak = 0 and (
      select count(*) = 5
        and bool_and(s.settled and s.current_streak = 0
          and not s.protected and s.outcome in ('missed', 'neutral')
          and not public.streak_day_is_protected(candidate.user_id, s.record_date))
      from public.streak_forward_daily_states s
      where s.user_id = candidate.user_id
        and s.record_date between local_day - 4 and local_day
    ) then
      -- Only the exact cadet membership is removed. Preserve account, role,
      -- camp, subscription, currency, history and unrelated memberships.
      delete from public.tent_members m
      where m.id = candidate.id and m.user_id = candidate.user_id
        and m.joined_at = candidate.joined_at and m.role = 'cadet';
    end if;
  end loop;
end;
$$;
revoke execute on function private.drop_inactive_tent_cadets() from public, anon, authenticated;
