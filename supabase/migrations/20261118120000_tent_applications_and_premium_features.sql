CREATE OR REPLACE FUNCTION public.enforce_resident_tent_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  first_join boolean;
  eligible boolean;
BEGIN
  -- Existing assignments may be moved by the instructor without restarting their trial.
  IF TG_TABLE_NAME='tent_members' AND to_jsonb(NEW)->>'role'<>'cadet' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='tent_members' AND EXISTS (
    SELECT 1 FROM private.resident_tent_trials WHERE user_id=NEW.user_id
  ) AND public.has_current_subscription_access(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT longest_streak>=5 INTO eligible FROM public.compute_strict_streak(NEW.user_id);
  IF NOT coalesce(eligible,false) THEN RAISE EXCEPTION 'Reach a 5-day streak to unlock Tent access.'; END IF;
  IF TG_TABLE_NAME='tent_join_requests' THEN
    IF EXISTS (SELECT 1 FROM private.resident_tent_trials WHERE user_id=NEW.user_id)
       AND NOT public.has_current_subscription_access(NEW.user_id) THEN
      RAISE EXCEPTION 'Renew your subscription to join a tent.';
    END IF;
    RETURN NEW;
  END IF;
  INSERT INTO private.resident_tent_trials(user_id) VALUES(NEW.user_id)
  ON CONFLICT DO NOTHING RETURNING true INTO first_join;
  IF coalesce(first_join,false) AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions WHERE user_id=NEW.user_id AND status IN ('active','grace')
      AND public.has_current_subscription_access(NEW.user_id)
  ) THEN
    INSERT INTO public.subscriptions(user_id,status,trial_started_at,trial_ends_at)
    VALUES(NEW.user_id,'trial',now(),now()+interval '1 month')
    ON CONFLICT (user_id) DO UPDATE SET status='trial',trial_started_at=excluded.trial_started_at,
      trial_ends_at=excluded.trial_ends_at,current_period_end=NULL,updated_at=now();
  END IF;
  IF NOT public.has_current_subscription_access(NEW.user_id) THEN
    RAISE EXCEPTION 'An active subscription or first-month trial is required to join a tent.';
  END IF;
  RETURN NEW;
END;
$$;

drop index public.tent_join_requests_one_pending;
create unique index tent_join_requests_one_pending_per_tent
  on public.tent_join_requests(user_id, tent_id) where status = 'pending';

create or replace function public.enforce_self_service_first_tent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'cadet' and not exists (
    select 1 from private.resident_tent_trials where user_id = new.user_id
  ) and not exists (
    select 1 from public.tent_join_requests r
    where r.user_id = new.user_id and r.tent_id = new.tent_id and r.status = 'pending'
  ) then
    raise exception 'The resident must request this tent first.';
  end if;
  return new;
end;
$$;

create or replace function public.request_to_join_tent(p_tent_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  request_id uuid;
  chosen_tent public.tents%rowtype;
begin
  if caller is null or camp_management.is_admin() then raise exception 'Sign in as a resident to request a tent.'; end if;
  perform 1 from public.profiles where id = caller for update;
  if not found then raise exception 'Complete your profile before requesting a tent.'; end if;
  if exists (select 1 from public.tent_members where user_id = caller) then
    raise exception 'You already belong to a tent.';
  end if;
  if not exists (select 1 from public.role_assignments
                where user_id = caller and role = 'cadet' and status in ('active', 'approved')) then
    raise exception 'Only residents can request a tent.';
  end if;
  select * into chosen_tent from public.tents where id = p_tent_id and camp_id = 1;
  if not found then raise exception 'Tent not found.'; end if;
  select id into request_id from public.tent_join_requests
    where user_id = caller and tent_id = p_tent_id and status = 'pending';
  if found then return request_id; end if;
  insert into public.tent_join_requests(tent_id, user_id)
    values (p_tent_id, caller) returning id into request_id;
  if chosen_tent.sentry_id is not null then
    perform public.notify_user(chosen_tent.sentry_id, caller, 'tent_join_request',
      'New tent application', 'A cadet requested to join ' || chosen_tent.name || '.',
      'cadets', jsonb_build_object('tent_id', p_tent_id, 'request_id', request_id));
  end if;
  return request_id;
end;
$$;

revoke execute on function public.join_eligible_tent(uuid) from authenticated;

drop function public.get_tent_join_options();
create function public.get_tent_join_options()
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
    and coalesce((select s.longest_streak >= 5 from public.compute_strict_streak(auth.uid()) s), false)
  order by t.name, t.id;
$$;

create or replace function public.review_tent_join_request(p_request_id uuid, p_approve boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  application public.tent_join_requests%rowtype;
  chosen_tent public.tents%rowtype;
begin
  select * into application from public.tent_join_requests where id = p_request_id;
  if not found then raise exception 'Pending request not found.'; end if;
  perform 1 from public.profiles where id = application.user_id for update;
  select * into application from public.tent_join_requests
    where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'Pending request not found.'; end if;
  select * into chosen_tent from public.tents where id = application.tent_id for update;
  if auth.uid() is null or not (
    chosen_tent.sentry_id is not distinct from auth.uid()
    or exists (select 1 from public.tent_members where tent_id = application.tent_id
               and user_id = auth.uid() and role = 'sentry')
  ) then raise exception 'Only this tent''s sentry can review the request.'; end if;
  if p_approve then
    if public.tent_cadet_count(application.tent_id) >= public.tent_cadet_limit(application.tent_id) then
      raise exception 'This tent is full. The request is still pending.';
    end if;
    if exists (select 1 from public.tent_members where user_id = application.user_id) then
      raise exception 'This resident already belongs to a tent.';
    end if;
    insert into public.tent_members(tent_id, user_id, role)
      values (application.tent_id, application.user_id, 'cadet');
    update public.tent_join_requests set status = 'cancelled', reviewed_at = now()
      where user_id = application.user_id and status = 'pending' and id <> p_request_id;
  end if;
  update public.tent_join_requests set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_at = now(), reviewed_by = auth.uid() where id = p_request_id;
  perform public.notify_user(application.user_id, auth.uid(), 'tent_join_request',
    case when p_approve then 'Tent application accepted' else 'Tent application declined' end,
    case when p_approve then 'You joined ' || chosen_tent.name || '.'
         else chosen_tent.name || ' declined your application.' end,
    'tent', jsonb_build_object('tent_id', application.tent_id, 'request_id', p_request_id));
  return true;
end;
$$;

revoke execute on function public.get_tent_join_options() from public, anon;
grant execute on function public.get_tent_join_options(), public.request_to_join_tent(uuid),
  public.review_tent_join_request(uuid, boolean) to authenticated;

create table private.tent_zero_streak (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  joined_at timestamptz not null,
  first_zero_day date not null,
  last_zero_day date not null
);

create function private.drop_inactive_tent_cadets()
returns void language plpgsql set search_path = '' as $$
declare
  local_day date := timezone('Africa/Douala', now())::date;
begin
  delete from private.tent_zero_streak z where not exists (
    select 1 from public.tent_members m where m.user_id = z.user_id and m.role = 'cadet' and m.joined_at = z.joined_at
  );
  with streaks as materialized (
    select m.user_id, m.joined_at, s.current_streak
    from public.tent_members m cross join lateral public.compute_strict_streak(m.user_id) s
    where m.role = 'cadet'
  ), reset as (
    delete from private.tent_zero_streak z using streaks s
    where s.user_id = z.user_id and s.current_streak > 0
  )
  insert into private.tent_zero_streak as z(user_id, joined_at, first_zero_day, last_zero_day)
  select user_id, joined_at, local_day, local_day from streaks where current_streak = 0
  on conflict (user_id) do update set last_zero_day = excluded.last_zero_day,
    joined_at = excluded.joined_at,
    first_zero_day = case when z.joined_at = excluded.joined_at and z.last_zero_day >= local_day - 1
      then z.first_zero_day else local_day end;
  delete from public.tent_members m using private.tent_zero_streak z
    where m.user_id = z.user_id and m.joined_at = z.joined_at and m.role = 'cadet'
      and z.last_zero_day = local_day and z.first_zero_day <= local_day - 4;
end;
$$;
revoke execute on function private.drop_inactive_tent_cadets() from public, anon, authenticated;
select cron.schedule('full-circle-drop-inactive-tent-cadets', '5 20 * * *',
  'select private.drop_inactive_tent_cadets()');

-- Preserve the ordinary table policies and add the subscription requirement.
create policy premium_reader_insights on public.scripture_verse_insights as restrictive for all to authenticated
  using (public.has_current_subscription_access(auth.uid()))
  with check (public.has_current_subscription_access(auth.uid()));
create policy premium_insight_comments on public.scripture_insight_comments as restrictive for all to authenticated
  using (public.has_current_subscription_access(auth.uid()))
  with check (public.has_current_subscription_access(auth.uid()));
create policy premium_insight_reactions on public.scripture_insight_reactions as restrictive for all to authenticated
  using (public.has_current_subscription_access(auth.uid()))
  with check (public.has_current_subscription_access(auth.uid()));

create function public.can_access_quiz_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.quiz_sessions where id = p_session_id and quiz_type in ('fortune', 'valediction')
  ) or public.has_current_subscription_access(auth.uid());
$$;
revoke execute on function public.can_access_quiz_session(uuid) from public, anon;
grant execute on function public.can_access_quiz_session(uuid) to authenticated;

create policy premium_quiz_sessions on public.quiz_sessions as restrictive for select to authenticated
  using (public.can_access_quiz_session(id));
create policy premium_quiz_questions on public.generated_questions as restrictive for select to authenticated
  using (public.can_access_quiz_session(quiz_session_id));
create policy premium_quiz_attempts on public.quiz_attempts as restrictive for select to authenticated
  using (public.can_access_quiz_session(quiz_session_id));

-- These SECURITY DEFINER entry points also need checks because they bypass RLS.
do $migration$
declare
  change record;
  definition text;
  signature text;
begin
  for change in select * from (values
    ('get_current_quiz_session_for_type(text)',
      'AND auth.uid() IS NOT NULL',
      'AND auth.uid() IS NOT NULL AND (p_quiz_type = ''saturday'' OR public.has_current_subscription_access(auth.uid()))'),
    ('get_quiz_questions_for_play(uuid)',
      '  v_is_participant := EXISTS',
      '  IF NOT public.can_access_quiz_session(p_quiz_session_id) THEN RAISE EXCEPTION ''Subscribe to play this quiz.'' USING ERRCODE = ''42501''; END IF;' || chr(10) || '  v_is_participant := EXISTS'),
    ('get_shared_quiz(uuid)',
      'WHERE session.id = p_quiz_session_id',
      'WHERE session.id = p_quiz_session_id AND public.can_access_quiz_session(p_quiz_session_id)'),
    ('get_my_quiz_attempt(uuid)',
      'BEGIN', 'BEGIN IF NOT public.can_access_quiz_session(p_quiz_session_id) THEN RETURN NULL; END IF;'),
    ('get_my_quiz_runtime_state(uuid)',
      'BEGIN', 'BEGIN IF NOT public.can_access_quiz_session(p_quiz_session_id) THEN RAISE EXCEPTION ''Subscribe to play this quiz.'' USING ERRCODE = ''42501''; END IF;'),
    ('get_scripture_insight_reaction_summaries(uuid[])',
      'FROM actor_rows actor', 'FROM actor_rows actor WHERE public.has_current_subscription_access(auth.uid())'),
    ('save_shared_quiz_answer(uuid,text,uuid,jsonb)',
      'BEGIN',
      'BEGIN IF NOT public.can_access_quiz_session(p_quiz_session_id) THEN RAISE EXCEPTION ''Subscribe to play this quiz.'' USING ERRCODE = ''42501''; END IF;'),
    ('complete_shared_quiz(uuid,text)',
      'BEGIN',
      'BEGIN IF NOT public.can_access_quiz_session(p_quiz_session_id) THEN RAISE EXCEPTION ''Subscribe to play this quiz.'' USING ERRCODE = ''42501''; END IF;'),
    ('public_reading_insight_threads(uuid[],text)',
      'SELECT coalesce((',
      'SELECT CASE WHEN NOT public.has_current_subscription_access(auth.uid()) THEN ''[]''::jsonb ELSE coalesce((')
  ) as updates(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(('public.' || change.signature)::regprocedure);
    if strpos(definition, change.old_text) = 0 then
      raise exception 'Could not add subscription guard to %', change.signature;
    end if;
    if change.old_text = 'BEGIN' then
      definition := regexp_replace(definition, '\mBEGIN\M', change.new_text);
    else
      definition := replace(definition, change.old_text, change.new_text);
    end if;
    if change.signature = 'public_reading_insight_threads(uuid[],text)' then
      definition := replace(definition, '), ''[]''::jsonb);', '), ''[]''::jsonb) END;');
    end if;
    execute definition;
  end loop;

  foreach signature in array array[
    'get_my_valediction_status()',
    'save_scripture_verse_insight_secure(uuid,text,text,uuid[])',
    'add_scripture_insight_comment_secure(uuid,text,uuid[],uuid)',
    'edit_scripture_verse_insight(uuid,text)',
    'edit_scripture_insight_comment(uuid,text)',
    'toggle_scripture_insight_reaction(uuid,text)',
    'add_public_scripture_insight(uuid,text,text,text)',
    'toggle_public_scripture_insight_reaction(uuid,text,text)'
  ]
  loop
    definition := pg_get_functiondef(('public.' || signature)::regprocedure);
    execute regexp_replace(definition, '\mBEGIN\M',
      'BEGIN IF NOT public.has_current_subscription_access(auth.uid()) THEN RAISE EXCEPTION ''This feature requires a subscription.'' USING ERRCODE = ''42501''; END IF;');
  end loop;
end;
$migration$;
