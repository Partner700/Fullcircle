-- Existing results keep their original passing threshold; new admissions store their own.
alter table public.valediction_results add column if not exists target_role text not null default 'sentry';
alter table public.valediction_results add column if not exists passing_percent integer not null default 90;
alter table public.valediction_results drop constraint valediction_results_admitted_figs_check;
alter table public.valediction_results drop constraint valediction_results_check;
alter table public.valediction_results add constraint leadership_admission_check check ((target_role='sentry' and admitted_figs>=5000 and passing_percent in (80,90)) or (target_role='instructor' and admitted_streak>=200 and admitted_figs>=10000 and passing_percent=95));
alter table public.valediction_results add constraint leadership_pass_check check (not passed or (graded_at is not null and question_count>0 and correct_count*100>=question_count*passing_percent));

create or replace function public.get_my_valediction_status() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s integer; f numeric; sentry boolean; cadet boolean; instructor boolean; required_streak integer; required_figs integer;
begin
  if auth.uid() is null then raise exception 'Sign in to view Valediction eligibility.'; end if;
  select coalesce(current_streak,0) into s from public.compute_strict_streak(auth.uid()) limit 1;
  select coalesce((select sum(score) from public.game_attempts where user_id=auth.uid()),0)+coalesce((select sum(talents_scored) from public.quiz_attempts where user_id=auth.uid()),0)+coalesce((select sum(score) from public.arena_participants where user_id=auth.uid()),0) into f;
  select exists(select 1 from public.role_assignments where user_id=auth.uid() and role='sentry' and status in ('active','approved')), exists(select 1 from public.role_assignments where user_id=auth.uid() and role='cadet' and status in ('active','approved')), exists(select 1 from public.role_assignments where user_id=auth.uid() and role='instructor' and status in ('active','approved')) into sentry,cadet,instructor;
  required_streak := case when sentry then 200 else 100 end; required_figs := case when sentry then 10000 else 5000 end;
  return jsonb_build_object('eligible',not instructor and (sentry or cadet) and coalesce(s,0)>=required_streak and f>=required_figs,'streak',coalesce(s,0),'figs',f,'required_streak',required_streak,'required_figs',required_figs,'is_sentry',sentry,'target_role',case when sentry then 'instructor' else 'sentry' end,'passing_percent',case when sentry then 95 else 80 end);
end; $$;

create or replace function public.enforce_valediction_admission() returns trigger language plpgsql security definer set search_path='' as $$
declare v_type text; v_status jsonb;
begin
  select quiz_type into v_type from public.quiz_sessions where id=new.quiz_session_id;
  if v_type<>'valediction' then return new; end if;
  if auth.uid() is distinct from new.user_id or new.status<>'in_progress' then raise exception 'Start your Valediction quiz from your own account.'; end if;
  v_status:=public.get_my_valediction_status();
  if not (v_status->>'eligible')::boolean then raise exception 'You have not met the Valediction qualification requirements.'; end if;
  insert into public.valediction_results(attempt_id,user_id,admitted_streak,admitted_figs,target_role,passing_percent) values(new.id,new.user_id,(v_status->>'streak')::integer,(v_status->>'figs')::numeric,v_status->>'target_role',(v_status->>'passing_percent')::integer);
  return new;
end; $$;

create or replace function public.grade_valediction_attempt() returns trigger language plpgsql security definer set search_path='' as $$
declare v_total integer; v_correct integer; admission public.valediction_results%rowtype;
begin
  if new.status not in ('submitted','timed_out') or old.status in ('submitted','timed_out','forfeited') then return new; end if;
  if not exists(select 1 from public.quiz_sessions where id=new.quiz_session_id and quiz_type='valediction') then return new; end if;
  select * into admission from public.valediction_results where attempt_id=new.id and user_id=new.user_id;
  if not found then raise exception 'Valediction admission was not verified.'; end if;
  select count(*)::integer,count(*) filter(where public.quiz_answer_is_correct(response.answer,question.question_payload) and not coalesce(response.assisted_by_relic,false))::integer into v_total,v_correct from public.generated_questions question left join public.question_responses response on response.question_id=question.id and response.quiz_attempt_id=new.id where question.quiz_session_id=new.quiz_session_id;
  if v_total=0 then raise exception 'Valediction has no questions.'; end if;
  update public.valediction_results set correct_count=v_correct,question_count=v_total,passed=(v_correct::numeric*100>=v_total::numeric*admission.passing_percent),graded_at=now() where attempt_id=new.id;
  if admission.target_role='sentry' and v_correct::numeric*100>=v_total::numeric*admission.passing_percent then perform public.process_automatic_sentry_promotion(new.user_id); end if;
  -- Instructor exam qualification is recorded; camp allocation is a separate release.
  return new;
end; $$;

-- Preserve existing promotion grants and rewards, changing only the threshold and exam type.
do $$ declare definition text; begin
  select pg_get_functiondef('public.process_automatic_sentry_promotion(uuid)'::regprocedure) into definition;
  definition:=replace(replace(replace(replace(definition,'v_figs > 10000','v_figs >= 5000'),'10001','5000'),'at least 90%','at least 80%'),'AND passed AND graded_at IS NOT NULL','AND target_role = ''sentry'' AND passed AND graded_at IS NOT NULL');
  execute definition;
end $$;
create or replace function public.require_valediction_for_sentry() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role='sentry' and new.status in ('active','approved') then
    if tg_op='UPDATE' and old.user_id=new.user_id and old.role='sentry' and old.status in ('active','approved') then return new; end if;
    if not exists(select 1 from public.valediction_results where user_id=new.user_id and target_role='sentry' and passed and graded_at is not null) then raise exception 'Pass the Valediction quiz with at least 80%% before becoming a Sentry.'; end if;
  end if; return new;
end; $$;

-- Track verified leadership relationships prospectively. Backfill current membership only;
-- never infer previous mentors from a person's current tent.
create table if not exists private.leadership_memberships (id bigint generated always as identity primary key,cadet_id uuid not null,sentry_id uuid not null,tent_id uuid not null,camp_id bigint not null,started_on date not null,ended_on date);
create unique index if not exists leadership_one_open_membership on private.leadership_memberships(cadet_id) where ended_on is null;
create table if not exists private.rite_developments(cadet_id uuid primary key,sentry_id uuid not null,tent_id uuid not null,camp_id bigint not null,promoted_on date not null);
alter table private.leadership_memberships enable row level security;
alter table private.rite_developments enable row level security;
revoke all on private.leadership_memberships,private.rite_developments from public,anon,authenticated;
insert into private.leadership_memberships(cadet_id,sentry_id,tent_id,camp_id,started_on)
select m.user_id,t.sentry_id,t.id,t.camp_id,greatest(timezone('Africa/Douala',m.joined_at)::date,coalesce((select min(r.start_date) from public.role_assignments r where r.user_id=t.sentry_id and r.role='sentry' and r.status in ('active','approved')),timezone('Africa/Douala',m.joined_at)::date)) from public.tent_members m join public.tents t on t.id=m.tent_id where m.role='cadet' and t.sentry_id is not null and m.user_id<>t.sentry_id on conflict do nothing;

create or replace function private.refresh_leadership_membership(p_cadet uuid) returns void language plpgsql security definer set search_path='' as $$
declare today date:=timezone('Africa/Douala',now())::date; target record;
begin
  select t.sentry_id,t.id,t.camp_id into target from public.tent_members m join public.tents t on t.id=m.tent_id where m.user_id=p_cadet and m.role='cadet' and t.sentry_id is not null and t.sentry_id<>p_cadet;
  if found then
    update private.leadership_memberships set ended_on=today where cadet_id=p_cadet and ended_on is null and (sentry_id,tent_id,camp_id) is distinct from (target.sentry_id,target.id,target.camp_id);
    insert into private.leadership_memberships(cadet_id,sentry_id,tent_id,camp_id,started_on) values(p_cadet,target.sentry_id,target.id,target.camp_id,today) on conflict do nothing;
  else update private.leadership_memberships set ended_on=today where cadet_id=p_cadet and ended_on is null; end if;
end; $$;
create or replace function private.track_leadership_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'INSERT' then perform private.refresh_leadership_membership(old.user_id); end if;
  if tg_op<>'DELETE' then perform private.refresh_leadership_membership(new.user_id); end if;
  return null;
end; $$;
create trigger track_leadership_membership after insert or update or delete on public.tent_members for each row execute function private.track_leadership_membership();
create or replace function private.track_leadership_tent() returns trigger language plpgsql security definer set search_path='' as $$
declare member_id uuid;
begin
  for member_id in select user_id from public.tent_members where tent_id=new.id and role='cadet' loop perform private.refresh_leadership_membership(member_id); end loop;
  return null;
end; $$;
create trigger track_leadership_tent after update of sentry_id,camp_id on public.tents for each row execute function private.track_leadership_tent();
create or replace function private.record_rite_development() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role='sentry' and new.status in ('active','approved') then
    if tg_op='UPDATE' and old.role='sentry' and old.status in ('active','approved') then return new; end if;
    insert into private.rite_developments(cadet_id,sentry_id,tent_id,camp_id,promoted_on)
    select new.user_id,h.sentry_id,h.tent_id,h.camp_id,timezone('Africa/Douala',now())::date from private.leadership_memberships h where h.cadet_id=new.user_id and h.sentry_id<>new.user_id order by h.started_on desc,h.id desc limit 1 on conflict do nothing;
    update private.leadership_memberships set ended_on=timezone('Africa/Douala',now())::date where cadet_id=new.user_id and ended_on is null;
  end if; return new;
end; $$;
create trigger record_rite_development after insert or update on public.role_assignments for each row execute function private.record_rite_development();

create or replace function public.get_sentry_leadership_board(p_period text default 'day') returns table(user_id uuid,display_name text,command_score numeric,rite_count bigint) language plpgsql stable security definer set search_path='' as $$
declare today date:=timezone('Africa/Douala',now())::date; first_day date; viewer_camp bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to view leadership boards.'; end if;
  select t.camp_id into viewer_camp from public.tents t where t.sentry_id=auth.uid() or exists(select 1 from public.tent_members m where m.tent_id=t.id and m.user_id=auth.uid()) limit 1;
  if viewer_camp is null and public.is_instructor(auth.uid()) then viewer_camp:=1; end if;
  if viewer_camp is null then return; end if;
  first_day:=case p_period when 'day' then today when 'week' then today-((extract(dow from today)::integer+1)%7) when 'month' then date_trunc('month',today)::date when 'year' then date_trunc('year',today)::date else null end;
  if first_day is null then raise exception 'Invalid leadership period.'; end if;
  return query with leaders as (select distinct t.sentry_id as sid from public.tents t where t.camp_id=viewer_camp and t.sentry_id is not null), activity as (select h.sentry_id,count(distinct (h.cadet_id,d.day))::numeric/(today-first_day+1) as score from private.leadership_memberships h cross join lateral generate_series(greatest(h.started_on,first_day),least(coalesce(h.ended_on-1,today),today),'1 day'::interval) d(day) where h.camp_id=viewer_camp and public.streak_requirement_met(h.cadet_id,d.day::date) group by h.sentry_id), rites as (select r.sentry_id,count(*) as total from private.rite_developments r group by r.sentry_id)
  select p.id,p.display_name,round(coalesce(a.score,0),2),coalesce(r.total,0) from leaders l join public.profiles p on p.id=l.sid left join activity a on a.sentry_id=l.sid left join rites r on r.sentry_id=l.sid order by coalesce(a.score,0) desc,p.id;
end; $$;
revoke execute on function public.get_sentry_leadership_board(text) from public,anon;
grant execute on function public.get_sentry_leadership_board(text) to authenticated;
revoke execute on function private.refresh_leadership_membership(uuid),private.track_leadership_membership(),private.track_leadership_tent(),private.record_rite_development() from public,anon,authenticated;
