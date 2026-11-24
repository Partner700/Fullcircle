import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
const actor = (n) => query("SELECT set_config('app.uid',$1,false)",[uid(n)]);
try {
 await db.exec(file('./valediction.fixture.sql'));
 await db.exec(file('../supabase/migrations/20261102212931_valediction_sentry_qualification.sql'));
 await db.exec(`CREATE SCHEMA scripture_games;
  CREATE OR REPLACE FUNCTION is_instructor(p_user_id uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${uid(7)}'::uuid$$;
  ALTER TABLE generated_questions ADD COLUMN question_index integer,ADD COLUMN mechanic_type text,
   ADD COLUMN recycled_from_game boolean,ADD COLUMN source_narrative_date date;
  CREATE TABLE custom_questions(id uuid DEFAULT gen_random_uuid(),quiz_session_id uuid,question_type text,question_text text,
   options jsonb,correct_answer text,accepted_answers jsonb,explanation text,scripture_reference text,passage text,difficulty_tag text,is_approved boolean);
  CREATE TABLE arena_journey_questions(id uuid DEFAULT gen_random_uuid(),question_type text,question_text text,options jsonb,
   correct_answer text,accepted_answers jsonb,explanation text,source_reference text,difficulty_tag text,review_status text,retired_at timestamptz);
  CREATE TABLE story_mode_questions(id text,question_type text,prompt text,options jsonb,correct_answer text,explanation text,scripture_reference text,difficulty text);
  CREATE TABLE dove_questions(id uuid DEFAULT gen_random_uuid(),question_type text,question_text text,options text[],correct_answer text,accepted_answers text[],explanation text,status text);
  CREATE TABLE arena_question_decks(room_id uuid,questions jsonb);
  CREATE TABLE scripture_games.number_facts(id integer,number integer,meaning text,reference text);
  CREATE TABLE scripture_games.puzzle_catalog(difficulty text,level integer,payload jsonb);`);
 const source=(await query("INSERT INTO quiz_sessions(id,quiz_type,title,status) VALUES(gen_random_uuid(),'saturday','Source','closed') RETURNING id"))[0].id;
 const payload = (source,n) => ({type:'multiple_choice',question:`Which answer is correct for ${source} number ${n}?`,options:['Correct','Wrong','Other','None'],correct_answer:'Correct',reference:'Genesis 1:1',explanation:'A test source.'});
 for(let n=1;n<=12;n++) {
  const p=payload('quiz',n);
  await query('INSERT INTO generated_questions(quiz_session_id,question_index,question_payload) VALUES($1,$2,$3)',[source,n,JSON.stringify(p)]);
  await query("INSERT INTO custom_questions(question_type,question_text,options,correct_answer,is_approved) VALUES('multiple_choice',$1,$2,'Correct',true)",[payload('daily',n).question,JSON.stringify(p.options)]);
  await query("INSERT INTO arena_journey_questions(question_type,question_text,options,correct_answer,review_status) VALUES('multiple_choice',$1,$2,'Correct','approved')",[payload('journey',n).question,JSON.stringify(p.options)]);
  await query("INSERT INTO story_mode_questions(id,question_type,prompt,options,correct_answer) VALUES($1,'multiple_choice',$2,$3,'Correct')",[String(n),payload('story',n).question,JSON.stringify(p.options)]);
  await query("INSERT INTO dove_questions(question_type,question_text,options,correct_answer,status) VALUES('multiple_choice',$1,$2,'Correct','active')",[payload('dove',n).question,p.options]);
  await query('INSERT INTO arena_question_decks VALUES(gen_random_uuid(),$1)',[JSON.stringify([payload('arena',n)])]);
  await query('INSERT INTO scripture_games.number_facts VALUES($1,$1,$2,$3)',[n,`Prelude fact ${n}`,'Genesis 1:1']);
  await query("INSERT INTO scripture_games.puzzle_catalog VALUES('easy',$1,$2)",[n,JSON.stringify({board:{words:[{word:'WORD'+n,clue:'Puzzle clue '+n,category:'person',reference:'Genesis 1:1'}]}})]);
 }
 await query("INSERT INTO custom_questions(question_type,question_text,options,correct_answer,is_approved) VALUES('multiple_choice',$1,$2,'Correct',true)",[payload('quiz',1).question,JSON.stringify(['Correct','Wrong'])]);
 await query("INSERT INTO custom_questions(question_type,question_text,options,correct_answer,is_approved) VALUES('multiple_choice','Unapproved question must be absent','[\"Correct\",\"Wrong\"]','Correct',false)");
 await db.exec(file('../supabase/migrations/20261106152601_valediction_question_drafts.sql'));
 await actor(7);
 const session=(await query("INSERT INTO quiz_sessions(id,quiz_type,title,status) VALUES(gen_random_uuid(),'valediction','Draft','scheduled') RETURNING id"))[0].id;
 const draft=(await query('SELECT generate_valediction_draft($1,50) s',[session]))[0].s;
 assert.equal(draft.question_count,50);assert.equal(Object.keys(draft.sources).length,8);
 assert.ok(Math.max(...Object.values(draft.sources))-Math.min(...Object.values(draft.sources))<=1);
 const prompts=(await query("SELECT question_payload->>'question' q FROM generated_questions WHERE quiz_session_id=$1",[session])).map(r=>r.q);
 await assert.rejects(query('SELECT generate_valediction_draft($1,100)',[session]),/suitable unique/i);
 assert.equal((await query('SELECT count(*)::integer n FROM generated_questions WHERE quiz_session_id=$1',[session]))[0].n,50,'A failed regeneration preserves the existing draft');
 assert.equal(new Set(prompts).size,50);assert.ok(!prompts.some(q=>q.includes('Unapproved')));
 await assert.rejects(query("UPDATE quiz_sessions SET status='live' WHERE id=$1",[session]),/instructor must validate/i);
 await actor(1);
 await assert.rejects(query('INSERT INTO quiz_attempts(user_id,quiz_session_id) VALUES($1,$2)',[uid(1),session]),/validated and released/i);
 await assert.rejects(query('SELECT generate_valediction_draft($1,50)',[session]),/instructor/i);
 await assert.rejects(query('SELECT validate_valediction_draft($1)',[session]),/instructor/i);
 assert.equal((await query("SELECT get_current_quiz_session_for_type('valediction') s"))[0].s,null);
 await actor(7);
 assert.equal((await query('SELECT validate_valediction_draft($1) s',[session]))[0].s.validated,true);
 await query("UPDATE generated_questions SET question_payload=question_payload||'{\"explanation\":\"Reviewed correction\"}' WHERE id=(SELECT id FROM generated_questions WHERE quiz_session_id=$1 LIMIT 1)",[session]);
 assert.equal((await query('SELECT get_valediction_draft_review($1) s',[session]))[0].s.validated,false);
 await assert.rejects(query("UPDATE quiz_sessions SET status='countdown' WHERE id=$1",[session]),/validate/i);
 const first=(await query('SELECT id,question_payload FROM generated_questions WHERE quiz_session_id=$1 LIMIT 1',[session]))[0];
 await query("UPDATE generated_questions SET question_payload=question_payload||'{\"correct_answer\":\"Missing option\"}' WHERE id=$1",[first.id]);
 await assert.rejects(query('SELECT validate_valediction_draft($1)',[session]),/incomplete or unsupported/i);
 await query('UPDATE generated_questions SET question_payload=$2 WHERE id=$1',[first.id,JSON.stringify(first.question_payload)]);
 await query('SELECT validate_valediction_draft($1)',[session]);
 await query("UPDATE quiz_sessions SET status='countdown' WHERE id=$1",[session]);
 await assert.rejects(query('SELECT generate_valediction_draft($1,50)',[session]),/unpublished/i);
 await assert.rejects(query("UPDATE generated_questions SET question_payload=question_payload WHERE quiz_session_id=$1",[session]),/before launch/i);
 await actor(1);assert.equal((await query("SELECT (get_current_quiz_session_for_type('valediction')).id id"))[0].id,session);
 await db.exec('SET ROLE anon');await assert.rejects(query('SELECT generate_valediction_draft($1,50)',[session]),/permission denied/i);
 await db.exec('RESET ROLE');
 console.log('Valediction drafts passed: all eight sources, balanced unique questions, unapproved filtering, instructor-only generation/validation, hidden drafts, mandatory validation, edit invalidation and locked live questions.');
} catch(error) { console.error(error.stack || error.message,error.where || ''); process.exitCode=1; } finally { await db.close(); }
