-- Update the release catalog, keeping older names accepted for already
-- scheduled releases. Historical award rows are not renamed or deleted.
create or replace function private.award_release_catalog()
returns table(title text,cadence text,targets text[])
language sql immutable set search_path = '' as $$
  values
    ('Rhetoric Award (Orator)','weekly',array['cadet']),
    ('Angel Award (Angelos)','weekly',array['cadet']),
    ('Rumor Award','weekly',array['cadet']),
    ('Scribe Award','weekly',array['cadet']),
    ('The Sprout','weekly',array['cadet']),
    ('Reputation Award','weekly',array['sentry']),
    ('Tutorix','weekly',array['sentry']),
    ('Valley Champion','weekly',array['cadet','sentry']),
    ('Temple','weekly',array['tent']),
    ('The Lord''s Secret','weekly',array['tent']),
    ('Vallum','monthly',array['cadet']),
    ('Messenger Award (Nuncio)','monthly',array['cadet']),
    ('Monthly Scribe','monthly',array['cadet']),
    ('Monthly Valley Champion','monthly',array['cadet']),
    ('Muralis','monthly',array['cadet']),
    ('Century Award (Centurion)','monthly',array['sentry']),
    ('Centurion','monthly',array['sentry']),
    ('Bethel Stone','monthly',array['tent']),
    ('Grand Vallum','annual',array['cadet','sentry']),
    ('Grand Scribe','annual',array['cadet','sentry']),
    ('Grand Valley Champion','annual',array['cadet','sentry']),
    ('Grand Orator','annual',array['cadet','sentry']),
    ('Lumen Domus','annual',array['tent']),
    ('Temple Mount','annual',array['tent']);
$$;
revoke all on function private.award_release_catalog() from public, anon, authenticated;

-- The immediate Give Award action uses this separate RPC; match scheduled
-- release cadence and retain its existing instructor-only authorization.
create or replace function public.award_tent(p_tent_id uuid,p_title text,p_description text default null,p_award_month text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_sentry_id uuid;
  v_today date := timezone('Africa/Douala',now())::date;
  v_cycle text := coalesce(nullif(p_award_month,''),to_char(v_today,'YYYY-MM'));
begin
  if auth.uid() is null or not coalesce(public.is_instructor(auth.uid()),false) then raise exception 'Only instructors can award a tent'; end if;
  if p_title in ('Temple','The Lord''s Secret') and v_cycle !~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_cycle := 'week-'||to_char(v_today-(extract(isodow from v_today)::integer-1),'YYYY-MM-DD');
  end if;
  select sentry_id into v_sentry_id from public.tents where id=p_tent_id;
  if not found then raise exception 'Tent not found'; end if;
  if v_sentry_id is null then raise exception 'Assign a sentry to this tent before giving it an award'; end if;
  insert into public.awards(user_id,title,description,award_type,award_month,award_target_type,award_target_id)
    values(v_sentry_id,p_title,p_description,'tent',v_cycle,'tent',p_tent_id)
    on conflict (award_month,(coalesce(award_target_type,'cadet')),(coalesce(award_target_id,user_id)),title)
    do update set user_id=excluded.user_id,description=excluded.description,award_type='tent';
  return 1;
end;
$$;
revoke execute on function public.award_tent(uuid,text,text,text) from public,anon;
grant execute on function public.award_tent(uuid,text,text,text) to authenticated,service_role;

-- Retain the existing monthly nominees for every unrelated award. Replace
-- only Nuncio and Century with the monthly counterparts of their weekly rules.
create or replace function public.get_monthly_award_nominees_v2(p_month date default null)
returns table(award_title text,target_type text,target_id uuid,display_name text,avatar_url text,metric_value numeric,detail text,rank bigint,is_leader boolean,needs_selection boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month',coalesce(p_month,timezone('Africa/Douala',now())::date))::date;
  v_end date := (v_start+interval '1 month')::date;
  v_start_at timestamptz := v_start::timestamp at time zone 'Africa/Douala';
  v_end_at timestamptz := v_end::timestamp at time zone 'Africa/Douala';
begin
  if auth.uid() is null or not coalesce(public.is_instructor(auth.uid()),false) then raise exception 'Instructor access required.'; end if;
  return query
  with latest_roles as (
    select distinct on (r.user_id) r.user_id,r.role from public.role_assignments r
    where r.status in ('active','approved') and r.end_date is null
    order by r.user_id,r.created_at desc,case r.role when 'instructor' then 0 when 'sentry' then 1 else 2 end
  ), insights as (
    select i.user_id,count(*)::bigint amount from public.scripture_verse_insights i
    where i.created_at>=v_start_at and i.created_at<v_end_at and not i.is_question group by i.user_id
  ), daily as (
    select d.user_id,count(*) filter(where d.meditation_submitted and d.meditation_public)::bigint public_count,
      count(*) filter(where d.attendance_status='present')::bigint attendance_count,
      count(*) filter(where d.meditation_submitted)::bigint meditation_count
    from public.daily_records d where d.record_date>=v_start and d.record_date<v_end group by d.user_id
  ), shares as (
    select s.user_id,count(*)::bigint amount from public.external_share_events s
    where s.created_at>=v_start_at and s.created_at<v_end_at group by s.user_id
  ), totals as (
    select p.id,coalesce(nullif(btrim(p.display_name),''),'Full Circle member') name,p.avatar_url,r.role,
      coalesce(i.amount,0) insights,coalesce(d.public_count,0) public_count,coalesce(s.amount,0) shares,
      coalesce(d.attendance_count,0) attendance_count,coalesce(d.meditation_count,0) meditation_count
    from latest_roles r join public.profiles p on p.id=r.user_id
    left join insights i on i.user_id=p.id left join daily d on d.user_id=p.id left join shares s on s.user_id=p.id
  ), candidates as (
    select 'Messenger Award (Nuncio)'::text title,'cadet'::text target,t.id,t.name,t.avatar_url,
      (t.insights+t.public_count+t.shares)::numeric score,t.insights secondary,t.public_count tertiary,
      format('%s insights published; %s public meditations; %s app link shares',t.insights,t.public_count,t.shares) explanation
    from totals t where t.role='cadet' and t.insights+t.public_count+t.shares>0
    union all
    select 'Century Award (Centurion)','sentry',t.id,t.name,t.avatar_url,
      (t.attendance_count+t.meditation_count)::numeric,0::bigint,0::bigint,
      format('%s leadership actions: %s morning attendances; %s daily meditations',t.attendance_count+t.meditation_count,t.attendance_count,t.meditation_count)
    from totals t where t.role='sentry' and t.attendance_count+t.meditation_count>0
  ), ranked as (
    select c.*,dense_rank() over(partition by c.title order by c.score desc,c.secondary desc,c.tertiary desc) position from candidates c
  )
  select n.award_title,n.target_type,n.target_id,n.display_name,n.avatar_url,n.metric_value,n.detail,n.rank,n.is_leader,n.needs_selection
    from public.get_monthly_award_nominees(v_start) n where n.award_title not in ('Centurion','Century Award (Centurion)','Messenger Award (Nuncio)')
  union all
  select r.title,r.target,r.id,r.name,r.avatar_url,r.score,r.explanation,r.position,r.position=1,false from ranked r
  order by 1,8,4,3;
end;
$$;
revoke execute on function public.get_monthly_award_nominees_v2(date) from public,anon,authenticated;
grant execute on function public.get_monthly_award_nominees_v2(date) to authenticated,service_role;
