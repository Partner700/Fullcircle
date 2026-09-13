// Run with PGLITE_MODULE_PATH pointing to an installed @electric-sql/pglite package.
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260913120000_closed_app_alerts_and_audio_calls.sql'),
  'utf8',
);
const id = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE ROLE anon;
      CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE SCHEMA private;
      CREATE SCHEMA extensions;
      CREATE SCHEMA net;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;

      CREATE TABLE public.profiles(
        id uuid PRIMARY KEY,
        display_name text NOT NULL,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.role_assignments(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.profiles(id),
        role text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.tents(
        id uuid PRIMARY KEY,
        sentry_id uuid REFERENCES public.profiles(id)
      );
      CREATE TABLE public.tent_members(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tent_id uuid NOT NULL REFERENCES public.tents(id),
        user_id uuid NOT NULL REFERENCES public.profiles(id),
        UNIQUE(tent_id, user_id)
      );
      CREATE TABLE public.user_notifications(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_id uuid NOT NULL REFERENCES public.profiles(id),
        actor_id uuid REFERENCES public.profiles(id),
        notification_type text NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        action_key text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
      CREATE TABLE private.push_webhook_config(singleton boolean PRIMARY KEY, secret text NOT NULL);
      INSERT INTO private.push_webhook_config VALUES (true, 'fixture-secret');
      CREATE TABLE net.requests(id bigserial PRIMARY KEY, body jsonb);
      CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
      RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE v_id bigint;
      BEGIN INSERT INTO net.requests(body) VALUES(body) RETURNING id INTO v_id; RETURN v_id; END;
      $$;

      CREATE FUNCTION public.is_instructor(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT EXISTS(SELECT 1 FROM public.role_assignments WHERE user_id=p_user_id AND role='instructor' AND status IN ('active','approved'))
      $$;
      CREATE FUNCTION public.get_user_active_role(p_user_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT role FROM public.role_assignments WHERE user_id=p_user_id AND status IN ('active','approved') ORDER BY created_at DESC LIMIT 1
      $$;
      CREATE FUNCTION public.get_user_tent_id(p_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT tent_id FROM public.tent_members WHERE user_id=p_user_id LIMIT 1
      $$;
      CREATE FUNCTION public.notify_user(uuid,uuid,text,text,text,text,jsonb) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE v_id uuid;
      BEGIN
        INSERT INTO public.user_notifications(recipient_id,actor_id,notification_type,title,body,action_key,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id INTO v_id;
        RETURN v_id;
      END;
      $$;
      CREATE FUNCTION private.dispatch_due_scripture_alarms() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE FUNCTION private.dispatch_personal_alarms(uuid DEFAULT NULL,timestamptz DEFAULT now()) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE FUNCTION private.dispatch_alarm_push_queue() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE FUNCTION private.expire_stale_scripture_alarms(uuid DEFAULT NULL) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
    `);

    await db.exec(migration.split('-- Reinstall all background alert work')[0]);
    await db.query(`INSERT INTO public.profiles(id,display_name) VALUES
      ($1,'Instructor'),($2,'Cadet'),($3,'Sentry'),($4,'Outsider')`, [id(1), id(2), id(3), id(4)]);
    await db.query(`INSERT INTO public.role_assignments(user_id,role,status,created_at) VALUES
      ($1,'instructor','active','2026-01-01'),($2,'cadet','active','2026-01-02'),
      ($3,'sentry','active','2026-01-03'),($4,'cadet','active','2026-01-04')`, [id(1), id(2), id(3), id(4)]);
    await db.query('INSERT INTO public.tents(id,sentry_id) VALUES($1,$2),($3,NULL)', [id(101), id(3), id(102)]);
    await db.query('INSERT INTO public.tent_members(tent_id,user_id) VALUES($1,$2),($3,$4)', [id(101), id(2), id(102), id(4)]);

    const as = async (user, role = 'authenticated') => {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : '']);
      await db.exec(`SET ROLE ${role}`);
    };

    await as(1);
    const globalCall = (await db.query("SELECT public.start_audio_call('all',NULL) AS call")).rows[0].call;
    assert.equal(globalCall.scope, 'all');
    assert.equal(globalCall.recipient_status, 'joined');
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.audio_call_recipients WHERE call_id=$1', [globalCall.id])).rows[0].n, 4);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.user_notifications WHERE notification_type='audio_call'", [])).rows[0].n, 3);
    assert.equal((await db.query('SELECT public.start_audio_call(\'all\',NULL) AS call')).rows[0].call.id, globalCall.id);

    await as(2);
    await assert.rejects(db.query("SELECT public.start_audio_call('all',NULL)"), /Only the instructor/);
    const tentCall = (await db.query('SELECT public.start_audio_call(\'tent\',$1) AS call', [id(101)])).rows[0].call;
    assert.equal(tentCall.tent_id, id(101));
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.audio_call_recipients WHERE call_id=$1', [tentCall.id])).rows[0].n, 2);
    await assert.rejects(db.query('INSERT INTO public.audio_call_rooms(scope,host_id,title,provider_room_name,expires_at) VALUES(\'all\',$1,\'Bad\',\'bad\',now()+interval \'1 hour\')', [id(2)]), /permission denied/);

    await as(4);
    await assert.rejects(db.query('SELECT public.start_audio_call(\'tent\',$1)', [id(101)]), /only ring your own tent/i);
    await assert.rejects(db.query('SELECT public.answer_audio_call($1,\'join\')', [tentCall.id]), /not invited/i);

    await as(3);
    const joinedTentCall = (await db.query('SELECT public.start_audio_call(\'tent\',$1) AS call', [id(101)])).rows[0].call;
    assert.equal(joinedTentCall.id, tentCall.id);
    assert.equal(joinedTentCall.recipient_status, 'joined');

    await as(1);
    await db.query('SELECT public.end_audio_call($1)', [globalCall.id]);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT public.audio_call_push_is_current(notification_id) AS current FROM public.audio_call_recipients WHERE call_id=$1 AND user_id=$2', [globalCall.id, id(2)])).rows[0].current, false);
    assert.equal((await db.query("SELECT private.ensure_morning_audio_call('2026-09-14 05:00:00+00') AS n")).rows[0].n, 1);
    assert.equal((await db.query("SELECT private.ensure_morning_audio_call('2026-09-14 05:01:00+00') AS n")).rows[0].n, 0);
    assert.equal((await db.query("SELECT private.ensure_morning_audio_call('2026-09-19 05:00:00+00') AS n")).rows[0].n, 0);
    const morning = (await db.query("SELECT id FROM public.audio_call_rooms WHERE automatic AND call_date='2026-09-14'")).rows[0];
    assert.ok(morning?.id);
    assert.equal((await db.query('SELECT status FROM public.audio_call_recipients WHERE call_id=$1 AND user_id=$2', [morning.id, id(1)])).rows[0].status, 'ringing');
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.user_notifications WHERE metadata->>'call_id'=$1", [morning.id])).rows[0].n, 4);

    await db.query("UPDATE public.audio_call_rooms SET starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [morning.id]);
    assert.equal((await db.query('SELECT private.expire_audio_calls() AS n')).rows[0].n, 1);
    assert.equal((await db.query('SELECT status FROM public.audio_call_rooms WHERE id=$1', [morning.id])).rows[0].status, 'expired');
    console.log('Audio-call authorization, morning schedule, and lifecycle tests passed.');
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
