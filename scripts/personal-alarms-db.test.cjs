// Run with PGLITE_MODULE_PATH pointing to an installed @electric-sql/pglite package.
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
const fn = (text,name) => { const start=text.indexOf('CREATE OR REPLACE FUNCTION '+name+'('); if(start<0)throw Error(name);return text.slice(start,text.indexOf('$$;',start)+3); };
const id = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try {
 await db.exec("\nCREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;\nCREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA extensions; CREATE SCHEMA net;\nCREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;\nCREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;\nGRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;\nCREATE TABLE profiles(id uuid PRIMARY KEY,created_at timestamptz DEFAULT '2020-01-01');\nCREATE TABLE role_assignments(user_id uuid,status text);\nCREATE TABLE daily_records(user_id uuid,record_date date,meditation_submitted boolean);\nCREATE TABLE user_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recipient_id uuid,title text,body text,notification_type text,action_key text,metadata jsonb,read_at timestamptz);\nCREATE TABLE private.push_webhook_config(singleton boolean,secret text);\nINSERT INTO private.push_webhook_config VALUES(true,'fixture-secret');\nCREATE TABLE net.requests(id bigserial PRIMARY KEY);\nCREATE TABLE net._http_response(id bigint PRIMARY KEY,status_code integer,timed_out boolean DEFAULT false,error_msg text);\nCREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE v_id bigint; BEGIN INSERT INTO net.requests DEFAULT VALUES RETURNING id INTO v_id;RETURN v_id;END;$$;\nCREATE FUNCTION public.notify_user(uuid,uuid,text,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO user_notifications(recipient_id,notification_type,title,body,action_key,metadata) VALUES($1,$3,$4,$5,$6,$7) $$;\nCREATE FUNCTION private.daily_meditation_is_submitted(uuid,date) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM daily_records WHERE user_id=$1 AND record_date=$2 AND meditation_submitted) $$;\nCREATE FUNCTION public.normalize_dove_question_answer(text) RETURNS text LANGUAGE sql AS $$ SELECT lower(btrim($1)) $$;\nINSERT INTO profiles(id) VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');\nINSERT INTO role_assignments VALUES('00000000-0000-0000-0000-000000000001','active'),('00000000-0000-0000-0000-000000000002','active');\n");
 const base=read('20260907150000_scripture_alarms_and_reversible_reactions.sql');
 await db.exec(base.slice(base.indexOf('CREATE TABLE'),base.indexOf('CREATE OR REPLACE FUNCTION')));
 await db.exec("ALTER TABLE scripture_alarm_occurrences ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', ADD COLUMN missed_at timestamptz; ALTER TABLE scripture_alarm_occurrences DROP CONSTRAINT scripture_alarm_occurrences_status_check; ALTER TABLE scripture_alarm_occurrences ADD CHECK(status IN ('pending','cleared','missed'));");
 await db.exec("\nCREATE FUNCTION private.assign_scripture_alarm_question(p_alarm_id uuid) RETURNS void LANGUAGE sql AS $$\nUPDATE scripture_alarm_occurrences SET question_source_type='fixture',question_source_id=gen_random_uuid(),\nquestion_payload='{\"question_text\":\"Who built the ark?\",\"question_type\":\"multiple_choice\",\"options\":[\"Noah\",\"Moses\"],\"reference\":\"Genesis 6\"}',\ncorrect_answer='Noah' WHERE id=p_alarm_id $$;\n");
 const tenMinute=read('20260908100000_ten_minute_alarms_and_newcomer_guidance.sql');
 const accurate=read('20260907160000_accurate_loud_alarms_and_streak_reconciliation.sql');
 const eligible=read('20260909202000_restore_reliable_scripture_alarms.sql');
 await db.exec(fn(eligible,'private.user_is_scripture_alarm_eligible'));
 await db.exec(fn(accurate,'private.clear_completed_meditation_alarms'));
 for (const name of ['private.expire_stale_scripture_alarms','private.create_scripture_alarm_for_user','public.dispatch_scripture_alarm','public.ensure_my_due_scripture_alarms','public.submit_scripture_alarm_answer']) await db.exec(fn(tenMinute,name));
 await db.exec(read('20260913103000_personal_scripture_alarms.sql').split('-- Enable Supabase Cron')[0]);
 await db.exec('CREATE TABLE public.push_subscriptions(id uuid PRIMARY KEY);');
 await db.exec(read('20260913110000_alarm_push_retries.sql').split('-- Keep this migration independently')[0]);
 await db.exec('CREATE TRIGGER deliver_user_notification_push AFTER INSERT ON user_notifications FOR EACH ROW EXECUTE FUNCTION private.deliver_user_notification_push();');
 const as=async(user,role='authenticated')=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user?id(user):'']);await db.exec('SET ROLE '+role);};
 const save=async(overrides={})=>{
   const p={id:null,title:'Read and pray',time:'07:00',timezone:'Africa/Douala',days:[1,2,3,4,5,6,7],date:null,enabled:true,...overrides};
   return (await db.query('SELECT * FROM save_personal_alarm($1,$2,$3,$4,$5,$6,$7)',[p.id,p.title,p.time,p.timezone,p.days,p.date,p.enabled])).rows[0];
 };
 await as(1);
 const schedule=await save();
 await assert.rejects(save({timezone:'Not/AZone'}),/timezone/);
 await assert.rejects(save({days:[8]}),/repeat days/);
 await assert.rejects(save({days:[],date:'2020-01-01'}),/future/);
 await assert.rejects(db.query("UPDATE personal_alarms SET user_id=$1",[id(2)]),/permission denied/);
 await as(2);
 assert.equal((await db.query('SELECT * FROM personal_alarms')).rows.length,0);
 await assert.rejects(save({id:schedule.id}),/not found/);
 await assert.rejects(db.query('SELECT delete_personal_alarm($1)',[schedule.id]),/not found/);
 await assert.rejects(db.query('SELECT * FROM scripture_alarm_occurrences'),/permission denied/);
 await as(null,'anon');
 await assert.rejects(db.query('SELECT delete_personal_alarm($1)',[schedule.id]),/permission denied/);
 await db.exec('RESET ROLE');
 await db.query("UPDATE personal_alarms SET timezone='UTC',alarm_time=date_trunc('minute',now() AT TIME ZONE 'UTC')::time,updated_at=now()-interval '1 day' WHERE id=$1",[schedule.id]);
 assert.equal((await db.query('SELECT private.dispatch_personal_alarms() AS n')).rows[0].n,1);
 assert.equal((await db.query('SELECT private.dispatch_personal_alarms() AS n')).rows[0].n,0);
 const alarm=(await db.query('SELECT * FROM scripture_alarm_occurrences')).rows[0];
 assert.equal((await db.query('SELECT count(*)::int AS n FROM net.requests')).rows[0].n,1);
 assert.equal((await db.query('SELECT expires_at-triggered_at=interval \'10 minutes\' AS ok FROM scripture_alarm_occurrences')).rows[0].ok,true);
 await as(1);
 const payload=(await db.query('SELECT get_pending_scripture_alarm() AS p')).rows[0].p;
 assert.equal(payload.alarm_slot,'personal');assert.equal(payload.title,'Read and pray');
 assert.equal('correct_answer' in payload,false);
 await db.exec('RESET ROLE');
 // A retryable HTTP failure must be queued again, but success must stop retrying.
 await db.exec("INSERT INTO net._http_response(id,status_code) SELECT request_id,503 FROM private.alarm_push_outbox; UPDATE private.alarm_push_outbox SET next_attempt_at=now();");
 assert.equal((await db.query('SELECT private.dispatch_alarm_push_queue() AS n')).rows[0].n,1);
 await db.exec("INSERT INTO net._http_response(id,status_code) SELECT request_id,200 FROM private.alarm_push_outbox; UPDATE private.alarm_push_outbox SET next_attempt_at=now();");
 assert.equal((await db.query('SELECT private.dispatch_alarm_push_queue() AS n')).rows[0].n,0);
 assert.equal((await db.query('SELECT finished_at IS NOT NULL AS done FROM private.alarm_push_outbox')).rows[0].done,true);
 // Personal alarms are opt-in and survive meditation completion, unlike the standard midday slot.
 await db.query("INSERT INTO daily_records VALUES($1,(now() AT TIME ZONE 'Africa/Douala')::date,true)",[id(1)]);
 await db.query("SELECT private.clear_completed_meditation_alarms($1,(now() AT TIME ZONE 'Africa/Douala')::date)",[id(1)]);
 assert.equal((await db.query('SELECT status FROM scripture_alarm_occurrences WHERE id=$1',[alarm.id])).rows[0].status,'pending');
 await db.query("SELECT private.create_scripture_alarm_for_user($1,(now() AT TIME ZONE 'Africa/Douala')::date,'midday',now())",[id(1)]);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM scripture_alarm_occurrences WHERE alarm_slot='midday'")).rows[0].n,0);
 await as(2);
 const foreign=(await db.query("SELECT submit_scripture_alarm_answer($1,'Noah') AS p",[alarm.id])).rows[0].p;
 assert.equal(foreign.is_correct,false);
 await as(1);
 const wrong=(await db.query("SELECT submit_scripture_alarm_answer($1,'Moses') AS p",[alarm.id])).rows[0].p;
 assert.equal(wrong.cleared,false);
 assert.equal(wrong.alarm.attempt_count,1);
 assert.equal((await db.query("SELECT submit_scripture_alarm_answer($1,'Noah') AS p",[alarm.id])).rows[0].p.cleared,true);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT alarm_push_is_current($1) AS active',[(await db.query('SELECT id FROM user_notifications')).rows[0].id])).rows[0].active,false);
 // Expired windows do not catch up or ring again.
 await db.exec("DELETE FROM scripture_alarm_occurrences; UPDATE personal_alarms SET alarm_time=date_trunc('minute',(now() AT TIME ZONE 'UTC')-interval '20 minutes')::time;");
 assert.equal((await db.query('SELECT private.dispatch_personal_alarms() AS n')).rows[0].n,0);
 // A one-time schedule disables itself and does not fire twice.
 await db.exec("UPDATE personal_alarms SET enabled=true,repeat_days='{}',once_date=(now() AT TIME ZONE 'UTC')::date,alarm_time=date_trunc('minute',now() AT TIME ZONE 'UTC')::time;");
 assert.equal((await db.query('SELECT private.dispatch_personal_alarms() AS n')).rows[0].n,1);
 assert.equal((await db.query('SELECT enabled FROM personal_alarms')).rows[0].enabled,false);
 assert.equal((await db.query('SELECT private.dispatch_personal_alarms() AS n')).rows[0].n,0);
 await db.exec("UPDATE scripture_alarm_occurrences SET expires_at=now()-interval '1 second';");
 await db.query('SELECT private.expire_stale_scripture_alarms()');
 assert.equal((await db.query('SELECT status FROM scripture_alarm_occurrences')).rows[0].status,'missed');
 // The late-night window is still valid after local midnight.
 await db.exec("DELETE FROM scripture_alarm_occurrences; UPDATE personal_alarms SET enabled=true,repeat_days=ARRAY[1,2,3,4,5,6,7],once_date=NULL,timezone='Africa/Douala',alarm_time='23:58',updated_at='2026-01-01';");
 assert.equal((await db.query("SELECT private.dispatch_personal_alarms(NULL,'2026-09-15 23:02:00+00') AS n")).rows[0].n,1);
 assert.equal((await db.query('SELECT alarm_date::text FROM scripture_alarm_occurrences')).rows[0].alarm_date,'2026-09-15');
 await as(1);
 await db.query('SELECT delete_personal_alarm($1)',[schedule.id]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM personal_alarms')).rows[0].n,0);
 console.log('Personal alarm and push retry database tests passed.');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
