import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const [instructor, first, second] = [1, 2, 3].map(n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function public.is_instructor(uuid) returns boolean language sql as $$select $1='${instructor}'::uuid$$;
create table profiles(id uuid primary key,display_name text);
create table scripture_verse_insights(user_id uuid,created_at timestamptz,is_question boolean default false);
create table daily_records(user_id uuid, record_date date, meditation_submitted boolean, meditation_public boolean);
create table external_share_events(id uuid default gen_random_uuid() primary key,user_id uuid,share_kind text not null check(share_kind in ('reading','quiz','game','meditation')),reference_key text,created_at timestamptz default now());
insert into profiles values ('${first}','First'),('${second}','Second');
insert into scripture_verse_insights values
('${first}','2026-11-15 23:00+00',false),('${first}','2026-11-18 09:00+00',false),
('${first}','2026-11-18 09:00+00',true),('${first}','2026-11-15 22:59+00',false),('${first}','2026-11-22 23:00+00',false),
('${second}','2026-11-19 08:00+00',false);
insert into daily_records values ('${first}','2026-11-16',true,true),('${first}','2026-11-17',true,false),('${first}','2026-11-18',false,true),('${second}','2026-11-20',true,true);`);
await db.exec(readFileSync(new URL('./angel-award-metrics.sql', import.meta.url),'utf8'));
const query = async (sql,params=[]) => (await db.query(sql,params)).rows;
const actor = u => query("select set_config('test.uid',$1,false)",[u]);
await actor(first);
for(const kind of ['reading','quiz','game','meditation','arena','birthday']) await query('select public.record_external_share($1,$2)',[kind,'reference']);
await query("update external_share_events set created_at='2026-11-20 12:00+00' where user_id=$1",[first]);
await assert.rejects(query('select public.record_external_share($1,$2)',['invalid','ref']),/Unsupported share/);
await assert.rejects(query("select * from public.get_weekly_angel_award_metrics('2026-11-16')"),/Only instructors/);
await actor(instructor);
const results = await query("select * from public.get_weekly_angel_award_metrics('2026-11-16')");
assert.equal(results[0].user_id,first);
assert.equal(Number(results[0].insights_published),2);
assert.equal(Number(results[0].public_meditations),1);
assert.equal(Number(results[0].external_shares),6);
assert.equal(Number(results[0].angel_score),9);
assert.equal(Number(results[1].angel_score),2);
assert.equal((await query("select has_function_privilege('anon','public.get_weekly_angel_award_metrics(date)','execute') allowed"))[0].allowed,false);
await db.close();
console.log('Angel Award: published insights only, public meditations, six share types, Cameroon weekly boundaries and instructor access passed.');
