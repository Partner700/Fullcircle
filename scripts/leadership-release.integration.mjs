import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const file=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=n=>db.query("select set_config('app.uid',$1,false)",[id(n)]);
await db.exec(file('./valediction.fixture.sql'));
await db.exec(file('../supabase/migrations/20261102212931_valediction_sentry_qualification.sql'));
await db.exec(`create schema private; alter table profiles add column display_name text default 'Resident'; create table tents(id uuid primary key,sentry_id uuid,camp_id bigint); create table tent_members(user_id uuid,tent_id uuid,role text,joined_at timestamptz default now()); create function streak_requirement_met(uuid,date) returns boolean language sql as $$select exists(select 1 from public.daily_records where user_id=$1 and record_date=$2 and streak_valid)$$; insert into tents values('${id(20)}','${id(8)}',1); insert into tent_members(user_id,tent_id,role) values('${id(1)}','${id(20)}','cadet'),('${id(2)}','${id(20)}','cadet');`);
await db.exec(file('./leadership-release.sql'));
const query=(sql,args=[])=>db.query(sql,args);
const status=async()=> (await query('select get_my_valediction_status() as s')).rows[0].s;
await actor(1);await query('update game_attempts set score=5000 where user_id=$1',[id(1)]);assert.equal((await status()).eligible,true);
await actor(2);await query('update game_attempts set score=4999 where user_id=$1',[id(2)]);assert.equal((await status()).eligible,false);
await actor(8);await query('update profiles set test_streak=200 where id=$1',[id(8)]);await query('update game_attempts set score=10000 where user_id=$1',[id(8)]);assert.equal((await status()).passing_percent,95);assert.equal((await status()).eligible,true);
const session=(await query("insert into quiz_sessions(id,quiz_type,title) values(gen_random_uuid(),'valediction','Leadership') returning id")).rows[0].id;
await query("insert into generated_questions(quiz_session_id,question_payload) select $1,jsonb_build_object('correct_answer','yes') from generate_series(1,100)",[session]);
for(const [user,correct,passed,target] of [[1,80,true,'sentry'],[3,79,false,'sentry'],[8,95,true,'instructor']]){
 await actor(user); const a=(await query('insert into quiz_attempts(user_id,quiz_session_id) values($1,$2) returning id',[id(user),session])).rows[0].id;
 await query("insert into question_responses(question_id,quiz_attempt_id,answer) select id,$1,to_jsonb('yes'::text) from generated_questions where quiz_session_id=$2 limit $3",[a,session,correct]);
 await query("select submit_quiz_attempt_secure($1,'submitted',false)",[a]); const row=(await query('select * from valediction_results where attempt_id=$1',[a])).rows[0];assert.equal(row.passed,passed);assert.equal(row.target_role,target);
}
await actor(8);await query("insert into daily_records(user_id,record_date,streak_valid) values($1,timezone('Africa/Douala',now())::date,true)",[id(2)]);
const board=(await query("select * from get_sentry_leadership_board('day')")).rows[0];assert.equal(Number(board.command_score),1);assert.equal(Number(board.rite_count),1);
assert.equal((await query("select count(*) as n from role_assignments where user_id=$1 and role='instructor'",[id(8)])).rows[0].n,0);
await db.close();console.log('Leadership release: inclusive thresholds, role-specific grading, Command activity and Rite attribution passed.');
