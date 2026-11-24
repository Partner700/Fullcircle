import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const policy = readFileSync(new URL('../supabase/migrations/20261106121709_own_profile_photo_storage_access.sql', import.meta.url), 'utf8');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('app.uid',true),'')::uuid$$;
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb DEFAULT '{}',PRIMARY KEY(bucket_id,name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage,auth TO authenticated,anon;
    GRANT SELECT,INSERT,UPDATE ON storage.objects TO authenticated,anon;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,avatar_url text);
    INSERT INTO public.profiles VALUES('${a}',NULL),('${b}',NULL);`);
  await db.exec(policy);
  const source = readFileSync(new URL('../supabase/migrations/20260919130000_weekend_quotes_quiz_extensions_and_response_board.sql', import.meta.url), 'utf8');
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.save_own_avatar');
  const end = source.indexOf('GRANT EXECUTE ON FUNCTION public.save_own_avatar',start);
  await db.exec(source.slice(start,end) + 'GRANT EXECUTE ON FUNCTION public.save_own_avatar(text) TO authenticated;');
  await db.exec('SET ROLE authenticated');
  await query("SELECT set_config('app.uid',$1,false)",[a]);
  const path = `${a}/avatar-100.webp`;
  const upload = (bucket,name) => query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2) ON CONFLICT(bucket_id,name) DO UPDATE SET metadata=excluded.metadata RETURNING name',[bucket,name]);
  assert.equal((await upload('avatars',path))[0].name,path);
  assert.equal((await upload('avatars',path))[0].name,path,'An upload retry can upsert its own photo');
  for (let i=101;i<105;i++) await upload('avatars',`${a}/avatar-${i}.jpg`);
  assert.equal((await query('SELECT count(*)::int n FROM storage.objects'))[0].n,5,'Multiple photo changes have no cooldown');
  for (const [bucket,name] of [['avatars',`${b}/avatar-100.webp`],['other',path],['avatars',`${a}/fcx/event/guest-100.jpg`],['avatars',`${a}/avatar-100.html`],['avatars',`${a}/nested/avatar-100.webp`]]) {
    await assert.rejects(upload(bucket,name),/row-level security/);
  }
  const url = `https://test.supabase.co/storage/v1/object/public/avatars/${path}?v=100`;
  assert.equal((await query('SELECT public.save_own_avatar($1) url',[url]))[0].url,url);
  const next = url.replace('100','104');
  assert.equal((await query('SELECT public.save_own_avatar($1) url',[next]))[0].url,next,'Saving a replacement is unrestricted');
  await assert.rejects(query('SELECT public.save_own_avatar($1)',[url.replace(a,b)]),/only use a photo/);
  await query("SELECT set_config('app.uid',$1,false)",[b]);
  assert.equal((await query('UPDATE storage.objects SET metadata=\'{"changed":true}\' WHERE name=$1 RETURNING name',[path])).length,0,'Other users cannot overwrite a photo');
  assert.equal((await query('SELECT count(*)::int n FROM storage.objects'))[0].n,0,'Other users cannot list private storage metadata');
  await db.exec('RESET ROLE; SET ROLE anon');
  await query("SELECT set_config('app.uid','',false)");
  await assert.rejects(upload('avatars',path),/row-level security/);
  await assert.rejects(query('SELECT public.save_own_avatar($1)',[url]),/permission denied/);
  await db.exec('RESET ROLE');
  assert.equal((await query('SELECT avatar_url FROM profiles WHERE id=$1',[a]))[0].avatar_url,next);
  console.log('Profile photo storage passed: own insert/upsert, repeated replacement, profile saving, cross-user and anonymous denial, scoped image paths.');
} finally { await db.close(); }
