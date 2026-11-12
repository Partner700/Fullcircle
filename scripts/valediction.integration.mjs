import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const file = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor = (n) => db.query("SELECT set_config('app.uid',$1,false)",[uid(n)]);
const rejected = async (fn, pattern) => { await assert.rejects(fn, pattern); };
try {
 await db.exec(file('./valediction.fixture.sql'));
 await db.exec(file('../supabase/migrations/20261102212931_valediction_sentry_qualification.sql'));
 await actor(1);
 let result=(await db.query('SELECT process_automatic_sentry_promotion($1) state',[uid(1)])).rows[0].state;
 assert.equal(result.eligible,true); assert.equal(result.promoted,false);
 assert.equal((await db.query("SELECT count(*)::int n FROM role_assignments WHERE user_id=$1 AND role='sentry'",[uid(1)])).rows[0].n,0);
 await rejected(()=>db.query("INSERT INTO role_assignments VALUES($1,'sentry','active',null,current_date)",[uid(1)]),/Valediction/);
 const session=(await db.query("INSERT INTO quiz_sessions(id,quiz_type,title) VALUES(gen_random_uuid(),'valediction','Admission') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO generated_questions(quiz_session_id,question_payload) SELECT $1,jsonb_build_object('correct_answer','yes') FROM generate_series(1,100)",[session]);
 await db.query('UPDATE profiles SET test_streak=99 WHERE id=$1',[uid(2)]); await actor(2);
 await rejected(()=>db.query('INSERT INTO quiz_attempts(user_id,quiz_session_id) VALUES($1,$2)',[uid(2),session]),/100 verified/);
 await db.query('UPDATE game_attempts SET score=10000 WHERE user_id=$1',[uid(3)]); await actor(3);
 await rejected(()=>db.query('INSERT INTO quiz_attempts(user_id,quiz_session_id) VALUES($1,$2)',[uid(3),session]),/10,000/);
 for (const [user,correct,assisted,passed] of [[1,90,false,true],[4,89,false,false],[5,100,true,false]]) {
  await actor(user);
  const attempt=(await db.query('INSERT INTO quiz_attempts(user_id,quiz_session_id) VALUES($1,$2) RETURNING id',[uid(user),session])).rows[0].id;
  await db.query("INSERT INTO question_responses(question_id,quiz_attempt_id,answer,assisted_by_relic) SELECT id,$1,to_jsonb('yes'::text),$2 FROM generated_questions WHERE quiz_session_id=$3 LIMIT $4",[attempt,assisted,session,correct]);
  await rejected(()=>db.query("INSERT INTO relic_usage_log(user_id,quiz_attempt_id,effect_applied) VALUES($1,$2,'perfect_quiz')",[uid(user),attempt]),/Relics cannot/);
  await rejected(()=>db.query('SELECT submit_quiz_attempt_secure($1,\'submitted\',true)',[attempt]),/Relics cannot/);
  await db.query("SELECT submit_quiz_attempt_secure($1,'submitted',false)",[attempt]);
  const row=(await db.query('SELECT * FROM valediction_results WHERE attempt_id=$1',[attempt])).rows[0];
  assert.equal(row.passed,passed); assert.equal(row.question_count,100); assert.equal(row.correct_count,assisted?0:correct);
  const roles=(await db.query("SELECT count(*)::int n FROM role_assignments WHERE user_id=$1 AND role='sentry' AND status='active'",[uid(user)])).rows[0].n;
  assert.equal(roles,passed?1:0);
  await db.query("SELECT submit_quiz_attempt_secure($1,'submitted',false)",[attempt]);
  assert.equal((await db.query('SELECT count(*)::int n FROM valediction_results WHERE attempt_id=$1',[attempt])).rows[0].n,1);
  await rejected(()=>db.query("UPDATE quiz_attempts SET status='in_progress' WHERE id=$1",[attempt]),/attempt has ended/);
 }
 assert.equal((await db.query('SELECT count(*)::int n FROM daily_records')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM denarii_ledger_entries')).rows[0].n,0);
 await actor(8); await db.query('SELECT process_automatic_sentry_promotion($1)',[uid(8)]);
 assert.equal((await db.query("SELECT count(*)::int n FROM streak_freezers WHERE user_id=$1",[uid(8)])).rows[0].n,3);
 console.log('Valediction integration passed: thresholds, no automatic/manual bypass, exact 90%, 89% failure, relic exclusion, idempotency, existing benefits, and Saturday record preservation.');
} catch (error) { console.error(error.message, error.where || ''); process.exitCode=1; } finally { await db.close(); }
