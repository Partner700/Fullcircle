/*
  One deterministic source for the signed-in user's persistent toolbar. This
  deliberately avoids leaderboard functions so a board refresh cannot blank
  a user's Denarii or streak.
*/

create or replace function public.get_my_toolbar_stats_v4()
returns table (
  user_id uuid,
  total_denarii bigint,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  return query
  with strict as (
    select * from public.compute_strict_streak(v_user_id) limit 1
  ),
  latest_snapshot as (
    select snapshot.current_streak, snapshot.longest_streak
    from public.streakboard_snapshots snapshot
    where snapshot.user_id = v_user_id
    order by snapshot.snapshot_date desc, snapshot.created_at desc
    limit 1
  ),
  wallet as (
    select coalesce(sum(entry.amount), 0)::bigint as total_denarii
    from public.denarii_ledger_entries entry
    where entry.user_id = v_user_id
  )
  select
    v_user_id,
    wallet.total_denarii,
    case
      when coalesce(strict.current_streak, 0) = 0
        and coalesce(strict.consecutive_inactive, 0) = 0
      then greatest(coalesce(strict.current_streak, 0), coalesce(latest_snapshot.current_streak, 0))
      else coalesce(strict.current_streak, 0)
    end::integer,
    greatest(coalesce(strict.longest_streak, 0), coalesce(latest_snapshot.longest_streak, 0))::integer,
    coalesce(strict.consecutive_inactive, 0)::integer,
    coalesce(strict.cumulative_inactive, 0)::integer
  from wallet
  left join strict on true
  left join latest_snapshot on true
  limit 1;
end;
$$;

revoke all on function public.get_my_toolbar_stats_v4() from public, anon;
grant execute on function public.get_my_toolbar_stats_v4() to authenticated, service_role;
