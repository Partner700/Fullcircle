const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
const id = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
    CREATE TABLE profiles(id uuid PRIMARY KEY,display_name text,avatar_url text,created_at timestamptz DEFAULT now(),birth_day integer,birth_month integer);
    CREATE TABLE role_assignments(user_id uuid,role text,status text,end_date date);
    CREATE TABLE scheduled_announcements(id uuid,announcement_type text,is_active boolean,publish_at timestamptz,expires_at timestamptz,audience text,metadata jsonb);
    CREATE TABLE user_notifications(recipient_id uuid,sender_id uuid,type text,title text,body text,action text,metadata jsonb);
    CREATE FUNCTION notify_user(uuid,uuid,text,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO user_notifications VALUES($1,$2,$3,$4,$5,$6,$7) $$;
    INSERT INTO profiles(id,display_name,birth_day,birth_month) VALUES
      ('${id(1)}','Celebrant',extract(day FROM timezone('Africa/Douala',now())),extract(month FROM timezone('Africa/Douala',now()))),
      ('${id(2)}','Cadet',NULL,NULL),('${id(3)}','Sentry',NULL,NULL);
    INSERT INTO role_assignments VALUES ('${id(2)}','cadet','active',NULL),('${id(3)}','sentry','active',NULL);
    INSERT INTO scheduled_announcements VALUES ('${id(10)}','birthday',true,now(),NULL,'sentries','{}');
  `);
  await db.exec(read('20260812154500_birthday_slide_avatar_metadata.sql'));
  await db.exec(read('20260913113000_birthday_wishes_and_reactions.sql'));
  const date=(await db.query("SELECT timezone('Africa/Douala',now())::date::text AS d")).rows[0].d;
  const as=async(user,role='authenticated')=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user?id(user):'']);await db.exec('SET ROLE '+role);};
  const view=(target=1,day=date)=>db.query('SELECT get_birthday_conversation($1,$2) AS data',[id(target),day]);
  const react=state=>db.query("SELECT set_birthday_reaction($1,$2,'amen',$3)",[id(1),date,state]);
  const wish=(body,wishId=null,parent=null)=>db.query('SELECT save_birthday_wish($1,$2,$3,$4,$5) AS id',[id(1),date,body,wishId,parent]);
  await as(null,'anon');
  await assert.rejects(view(),/permission denied/);
  await as(2);
  assert.deepEqual((await view()).rows[0].data,{reactions:{},comments:[]});
  await assert.rejects(view(10),/not available/);
  await assert.rejects(view(99),/not available/);
  await assert.rejects(view(1,'2001-01-01'),/not available/);
  await react(true); await react(true);
  let data=(await view()).rows[0].data;
  assert.equal(data.reactions.amen.count,1);assert.equal(data.reactions.amen.reacted,true);
  assert.equal(data.reactions.amen.actors[0].user_id,id(2));
  await react(false);assert.deepEqual((await view()).rows[0].data.reactions,{});
  await assert.rejects(wish(' '),/1 to 500/);await assert.rejects(wish('a'.repeat(501)),/1 to 500/);
  const first=(await wish('Happy birthday!')).rows[0].id;
  await wish('A blessed birthday!',first);
  data=(await view()).rows[0].data;
  assert.equal(data.comments[0].body,'A blessed birthday!');assert.ok(data.comments[0].edited_at);
  assert.equal(data.comments[0].commenter_user_id,id(2));assert.ok(data.comments[0].created_at);
  await as(3);
  await view(10);
  await assert.rejects(wish('Not mine',first),/Only the author/);
  await assert.rejects(db.query('UPDATE birthday_wishes SET body=$1',['changed']),/permission denied/);
  const reply=(await wish('Amen!',null,first)).rows[0].id;
  await assert.rejects(wish('Nested',null,reply),/Choose a wish/);
  await assert.rejects(db.query('SELECT save_birthday_wish($1,$2,$3,NULL,$4)',[id(10),date,'Wrong celebration',first]),/Choose a wish/);
  await as(1);
  data=(await view()).rows[0].data;assert.equal(data.comments.length,2);assert.equal(data.comments[1].parent_comment_id,first);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM user_notifications WHERE recipient_id=$1',[id(1)])).rows[0].n,2,'Edits do not send duplicate wishes');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM birthday_wishes')).rows[0].n,2);
  console.log('Birthday reactions, unlike, wishes, replies, editing, dates, privacy, and notifications passed.');
 } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
