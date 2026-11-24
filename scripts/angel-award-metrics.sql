-- Angel (weekly): one point per published insight, public meditation and
-- successful app-link share. Preserve historical awards and Nuncio's formula.
alter table public.external_share_events drop constraint if exists external_share_events_share_kind_check;
alter table public.external_share_events add constraint external_share_events_share_kind_check
  check (share_kind in ('reading','quiz','game','meditation','arena','birthday'));

create or replace function public.record_external_share(p_share_kind text,p_reference_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if p_share_kind is null or p_share_kind not in ('reading','quiz','game','meditation','arena','birthday') then
    raise exception 'Unsupported share type.';
  end if;
  if nullif(btrim(coalesce(p_reference_key,'')), '') is null then raise exception 'A share reference is required.'; end if;
  insert into public.external_share_events(user_id,share_kind,reference_key)
  values (v_user_id,p_share_kind,left(btrim(p_reference_key),200)) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.record_external_share(text,text) from public, anon;
grant execute on function public.record_external_share(text,text) to authenticated;

create or replace function public.get_weekly_angel_award_metrics(p_week_start date default null)
returns table(user_id uuid,display_name text,insights_published bigint,public_meditations bigint,external_shares bigint,angel_score bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start date := coalesce(p_week_start, timezone('Africa/Douala',statement_timestamp())::date
    - (extract(isodow from timezone('Africa/Douala',statement_timestamp()))::integer - 1));
  v_start_at timestamptz := v_start::timestamp at time zone 'Africa/Douala';
  v_end_at timestamptz := (v_start + 7)::timestamp at time zone 'Africa/Douala';
begin
  if auth.uid() is null or not coalesce(public.is_instructor(auth.uid()),false) then
    raise exception 'Only instructors can view award metrics.';
  end if;
  return query
  with insights as (
    select i.user_id,count(*)::bigint as amount from public.scripture_verse_insights i
    where i.created_at >= v_start_at and i.created_at < v_end_at and not i.is_question group by i.user_id
  ), meditations as (
    select d.user_id,count(*)::bigint as amount from public.daily_records d
    where d.record_date >= v_start and d.record_date < v_start+7
      and d.meditation_submitted and d.meditation_public group by d.user_id
  ), shares as (
    select s.user_id,count(*)::bigint as amount from public.external_share_events s
    where s.created_at >= v_start_at and s.created_at < v_end_at group by s.user_id
  ), totals as (
    select p.id,p.display_name as name,coalesce(i.amount,0)::bigint as insights,
      coalesce(m.amount,0)::bigint as meditations,coalesce(s.amount,0)::bigint as shares
    from public.profiles p left join insights i on i.user_id=p.id
    left join meditations m on m.user_id=p.id left join shares s on s.user_id=p.id
  )
  select t.id,t.name,t.insights,t.meditations,t.shares,(t.insights+t.meditations+t.shares)::bigint
    from totals t where t.insights+t.meditations+t.shares > 0
    order by t.insights+t.meditations+t.shares desc,t.insights desc,t.meditations desc,t.shares desc,t.name,t.id;
end;
$$;
revoke execute on function public.get_weekly_angel_award_metrics(date) from public, anon, authenticated;
grant execute on function public.get_weekly_angel_award_metrics(date) to authenticated, service_role;
