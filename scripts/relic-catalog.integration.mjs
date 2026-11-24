import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const q=async(s,args=[])=>(await db.query(s,args)).rows;
const a='00000000-0000-4000-8000-000000000001';
const use=async(slug)=>(await q('select public.use_relic($1,$2) value',[a,slug]))[0].value;
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA scripture_games;CREATE ROLE service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('app.uid',true),'')::uuid$$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,created_at timestamptz);
 CREATE TABLE relic_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,name text,effect_type text,description text,denarii_cost int,money_price_xaf int,money_price_usd numeric);
 CREATE TABLE relic_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,relic_type_id uuid,quantity int,UNIQUE(user_id,relic_type_id));
 CREATE TABLE relic_usage_log(user_id uuid,relic_type_id uuid,effect_applied text);
 CREATE TABLE streak_achievement_days(user_id uuid,achievement_date date,source_kind text,PRIMARY KEY(user_id,achievement_date));
 CREATE TABLE streak_achievement_baselines(user_id uuid,effective_date date,minimum_qualifying_days int,source_reference text);
 CREATE TABLE streak_manual_adjustments(user_id uuid PRIMARY KEY,effective_date date,current_streak int,longest_streak int,reason text,created_at timestamptz);
 CREATE TABLE earned_fixture(user_id uuid,day date);
 CREATE TABLE streak_fixture(user_id uuid,current_streak int,longest_streak int);
 CREATE FUNCTION compute_strict_streak(uuid) RETURNS TABLE(current_streak int,longest_streak int) LANGUAGE sql AS $$SELECT current_streak,longest_streak FROM public.streak_fixture WHERE user_id=$1$$;
 CREATE FUNCTION streak_requirement_met(uuid,date) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.earned_fixture WHERE user_id=$1 AND day=$2)$$;
 CREATE FUNCTION refresh_user_streak_snapshot(uuid) RETURNS void LANGUAGE sql AS $$UPDATE public.streak_fixture f SET current_streak=m.current_streak,longest_streak=m.longest_streak FROM public.streak_manual_adjustments m WHERE m.user_id=f.user_id AND f.user_id=$1$$;
 INSERT INTO profiles VALUES('${a}',((timezone('Africa/Douala',now())::date-99)::timestamp AT TIME ZONE 'Africa/Douala'));
 INSERT INTO streak_fixture VALUES('${a}',2,5);
 INSERT INTO relic_types(slug,name,denarii_cost,money_price_xaf) VALUES('eliminate','Eliminate',80,25),('hint','Hint',80,25),('talking-donkey','Donkey',500,25),('simons-coin','Simon',1000,NULL),('thieves-request','The Thief''s Request',60000,NULL),('redemption-coin','Redemption Coin',60000,NULL),('sword-goliath','Sword of Goliath',3000,25),('freeze-timer','Freeze Timer',50,25),('hezekiahs-sundial','Sundial',1000,NULL);
 INSERT INTO relic_inventory(user_id,relic_type_id,quantity) SELECT '${a}',id,3 FROM relic_types;
 INSERT INTO streak_achievement_days SELECT '${a}',timezone('Africa/Douala',now())::date-days_ago,'earned' FROM (VALUES(1),(2),(4),(5),(7),(8),(10),(12)) day_offsets(days_ago);
 INSERT INTO earned_fixture VALUES('${a}',timezone('Africa/Douala',now())::date-1);
 `);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261105205812_relic_catalog_and_restoration_rules.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261105210609_thief_recovery_current_day_credit.sql',import.meta.url),'utf8'));
 await q("select set_config('app.uid',$1,false)",[a]);
 assert.equal((await q('select count(*)::int n from relic_types where not is_active'))[0].n,4);
 for(const slug of ['hint','eliminate','talking-donkey','simons-coin']){
  await assert.rejects(q('update relic_inventory set quantity=quantity-1 where relic_type_id=(select id from relic_types where slug=$1)',[slug]),/removed from the catalogue/);
  await assert.rejects(q('update relic_inventory set quantity=quantity+1 where relic_type_id=(select id from relic_types where slug=$1)',[slug]),/removed from the catalogue/);
 }
 const prices=Object.fromEntries((await q('select slug,denarii_cost from relic_types where is_active')).map(r=>[r.slug,r.denarii_cost]));
 assert.equal(prices['thieves-request'],100000);assert.equal(prices['redemption-coin'],300000);assert.equal(prices['sword-goliath'],6000);assert.equal(prices['freeze-timer'],600);assert.equal(prices['hezekiahs-sundial'],1000);
 let result=await use('thieves-request');assert.equal(result.current_streak,8,'Restore all unique earned days across broken streaks, not just the longest run');assert.equal(result.restored_days,6);assert.equal(result.denarii_awarded,0);
 result=await use('thieves-request');assert.equal(result.success,false);assert.equal((await q("select quantity from relic_inventory i join relic_types t on t.id=i.relic_type_id where t.slug='thieves-request'"))[0].quantity,2);

 await q("insert into earned_fixture values($1,timezone('Africa/Douala',now())::date)",[a]);
 await q("insert into streak_achievement_days values($1,timezone('Africa/Douala',now())::date,'earned')",[a]);
 assert.equal((await q('select current_streak from streak_fixture where user_id=$1',[a]))[0].current_streak,9,'A real day earned after recovery still increments once');
 await q("insert into streak_achievement_days values($1,timezone('Africa/Douala',now())::date,'earned') on conflict do nothing",[a]);
 assert.equal((await q('select current_streak from streak_fixture where user_id=$1',[a]))[0].current_streak,9);
 result=await use('redemption-coin');assert.equal(result.current_streak,100,'Restore every possible account day including unearned days');
 result=await use('redemption-coin');assert.equal(result.success,false);
 await q("select set_config('app.uid',$1,false)",['']);await assert.rejects(use('thieves-request'),/own relics/);
 console.log('Relic catalogue passed: four retired relics blocked, prices exact, earned-only Thief restoration, 100-day Redemption, no duplicates, no extra consumption, authenticated ownership.');
}catch(error){console.error(error.message,error.where||'');process.exitCode=1;}finally{await db.close();}
