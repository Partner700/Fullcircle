const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = require('node:path').resolve(__dirname, '..');
const read = (path) => fs.readFileSync(`${root}/${path}`, 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

(async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
    CREATE TABLE profiles(id uuid PRIMARY KEY, display_name text, avatar_url text, whatsapp_number text, created_at timestamptz DEFAULT now());
    CREATE TABLE tents(id uuid PRIMARY KEY, sentry_id uuid, name text, tent_house_id text, created_at timestamptz DEFAULT now());
    CREATE TABLE tent_members(tent_id uuid, user_id uuid, role text, joined_at timestamptz DEFAULT now());
    CREATE TABLE role_assignments(user_id uuid, role text, status text, end_date date, created_at timestamptz DEFAULT now());
    CREATE TABLE challenge_submissions(user_id uuid, status text);
    INSERT INTO challenge_submissions VALUES ('00000000-0000-0000-0000-000000000001','approved'),('00000000-0000-0000-0000-000000000001','pending'),('00000000-0000-0000-0000-000000000001','rejected'),('00000000-0000-0000-0000-000000000002','approved');
    CREATE FUNCTION get_user_live_stats(uuid) RETURNS TABLE(total_denarii numeric, current_streak int, longest_streak int, total_figs int, rhudes int, marks numeric)
    LANGUAGE sql AS $$ SELECT 500::numeric, 28, 28, 60, 5, 10::numeric $$;
    INSERT INTO profiles(id,display_name,whatsapp_number) VALUES
      ('${id(1)}','Cadet One','+237600000001'),('${id(2)}','Cadet Two','+237600000002'),
      ('${id(3)}','Sentry One','+237600000003'),('${id(4)}','Sentry Two','+237600000004'),
      ('${id(5)}','Instructor','+237600000005'),('${id(6)}','Tentless Cadet',NULL),
      ('${id(7)}','No Phone Cadet',NULL);
    INSERT INTO tents(id,sentry_id,name,tent_house_id) VALUES
      ('${id(101)}','${id(3)}','First Tent','spades'),('${id(102)}','${id(4)}','Second Tent','hearts');
    INSERT INTO tent_members(tent_id,user_id,role) VALUES
      ('${id(101)}','${id(1)}','cadet'),('${id(102)}','${id(2)}','cadet'),
      ('${id(101)}','${id(3)}','sentry'),('${id(102)}','${id(4)}','sentry'),
      ('${id(101)}','${id(7)}','cadet');
    INSERT INTO role_assignments(user_id,role,status) VALUES
      ('${id(1)}','cadet','active'),('${id(2)}','cadet','active'),
      ('${id(3)}','sentry','active'),('${id(4)}','sentry','approved'),
      ('${id(5)}','instructor','active'),('${id(6)}','cadet','active');
  `);
  const helpers = read('supabase/migrations/20260710050523_002_full_circle_functions_policies.sql');
  for (const name of ['is_instructor', 'is_sentry_of_tent']) {
    const sql = helpers.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`))[0];
    await db.exec(sql);
  }
  await db.exec(read('supabase/migrations/20260910100000_profiles_and_opened_message_delivery.sql').split('CREATE OR REPLACE FUNCTION private.retire')[0]);
  const migration = read('supabase/migrations/20260912140000_sentry_cadet_contacts.sql');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(read('supabase/migrations/20260913100000_profile_challenge_totals.sql'));
  await db.exec(`
    CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    CREATE TABLE storage.objects(bucket_id text, name text);
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT INSERT, SELECT ON storage.objects TO authenticated;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
  `);
  const avatarPolicies = read('supabase/migrations/20260720210923_20260720170000_major_game_store_relics_overhaul.sql.sql');
  await db.exec(avatarPolicies.match(/CREATE POLICY "avatar_upload_own"[\s\S]*?;/)[0]);
  await db.exec(read('supabase/migrations/20260726124500_instructor_panel_image_storage_policies.sql'));
  const as = async (user, role = 'authenticated') => {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [user ? id(user) : '']);
    await db.exec(`SET ROLE ${role}`);
  };
  const contacts = (tent) => db.query(`SELECT * FROM get_sentry_cadet_contacts($1)`, [id(tent)]);
  await as(3);
  assert.deepEqual((await contacts(101)).rows, [
    { user_id: id(1), whatsapp_number: '+237600000001' },
    { user_id: id(7), whatsapp_number: null },
  ]);
  await assert.rejects(contacts(102), /Only the tent sentry/);
  await assert.rejects(db.query('SELECT whatsapp_number FROM profiles'), /permission denied/);
  await as(1);
  await db.query('INSERT INTO storage.objects VALUES($1,$2)', ['avatars', `${id(1)}/challenge-evidence/photo.jpg`]);
  await assert.rejects(db.query('INSERT INTO storage.objects VALUES($1,$2)', ['avatars', `challenge-evidence/${id(1)}/photo.jpg`]), /row-level security/);
  await assert.rejects(db.query('INSERT INTO storage.objects VALUES($1,$2)', ['avatars', `${id(2)}/challenge-evidence/photo.jpg`]), /row-level security/);
  await assert.rejects(contacts(101), /Only the tent sentry/);
  assert.equal((await db.query('SELECT get_profile_cv(NULL) AS profile')).rows[0].profile.user_id, id(1));
  assert.equal((await db.query('SELECT get_profile_cv(NULL) AS profile')).rows[0].profile.completed_challenges, 1);
  await assert.rejects(db.query('SELECT get_profile_cv($1)', [id(2)]), /cannot view/);
  await as(6);
  assert.equal((await db.query('SELECT get_profile_cv(NULL) AS profile')).rows[0].profile.user_id, id(6));
  await as(3);
  assert.equal((await db.query('SELECT get_profile_cv($1) AS profile', [id(1)])).rows[0].profile.current_streak, 28);
  await as(5);
  await db.query('INSERT INTO storage.objects VALUES($1,$2)', ['avatars', `panel-images/${id(5)}/profile.jpg`]);
  assert.equal((await contacts(102)).rows.length, 1);
  await as(null);
  await assert.rejects(contacts(101), /Authentication required/);
  await as(null, 'anon');
  await assert.rejects(contacts(101), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(`UPDATE role_assignments SET status='expired' WHERE user_id='${id(3)}'`);
  await as(3);
  await assert.rejects(contacts(101), /Only the tent sentry/);
  await db.exec('RESET ROLE');
  await db.exec(`UPDATE role_assignments SET status='active' WHERE user_id='${id(3)}'; DELETE FROM tent_members WHERE user_id='${id(1)}'`);
  await as(3);
  assert.deepEqual((await contacts(101)).rows.map((r) => r.user_id), [id(7)]);
  await db.close();
  console.log('PASS: own/tentless profile, sentry and instructor access, cross-tent/cadet/anon/inactive denial, removed membership, limited fields and repeatable migration.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
