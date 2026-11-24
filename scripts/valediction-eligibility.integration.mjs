import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
try {
 await db.exec(file('./valediction.fixture.sql'));
 await db.exec(file('../supabase/migrations/20261102212931_valediction_sentry_qualification.sql'));
 await db.exec(`CREATE TABLE streak_refresh_probe(user_id uuid);
 CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
 RETURNS TABLE(current_streak integer) LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.streak_refresh_probe VALUES(p_user_id);
 RETURN QUERY SELECT test_streak FROM public.profiles WHERE id=p_user_id; END$$;`);
 await db.query("SELECT set_config('app.uid',$1,false)",['00000000-0000-4000-8000-000000000001']);
 const callApi=async()=>{
  const mode=(await db.query("SELECT provolatile FROM pg_proc WHERE proname='get_my_valediction_status'")).rows[0].provolatile;
  await db.exec(mode==='v'?'BEGIN READ WRITE':'BEGIN READ ONLY');
  try { const r=await db.query('SELECT get_my_valediction_status() s');await db.exec('COMMIT');return r; }
  catch(e){await db.exec('ROLLBACK');throw e;}
 };
 await assert.rejects(callApi(), /read-only|non-volatile/i);
 await db.exec(file('../supabase/migrations/20261106152527_valediction_eligibility_write_transaction.sql'));
 const status=(await callApi()).rows[0].s;
 assert.equal(status.eligible,true);assert.equal(status.required_streak,100);
 assert.equal((await db.query('SELECT count(*)::int n FROM streak_refresh_probe')).rows[0].n,1);
 assert.equal((await db.query("SELECT provolatile FROM pg_proc WHERE proname='get_my_valediction_status'")).rows[0].provolatile,'v');
 console.log('Valediction eligibility passed: reproduced read-only failure, writable streak refresh, unchanged eligibility thresholds.');
} finally { await db.close(); }
