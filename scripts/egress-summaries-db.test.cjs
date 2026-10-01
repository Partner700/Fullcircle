const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      GRANT USAGE ON SCHEMA auth TO authenticated, anon;
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text, avatar_url text, visible boolean DEFAULT true);
      CREATE TABLE public.daily_quote_reactions (quote_user_id uuid, quote_record_date date, reactor_user_id uuid, reaction_type text, visible boolean DEFAULT true);
      CREATE TABLE public.daily_quote_comments (quote_user_id uuid, quote_record_date date, visible boolean DEFAULT true);
      INSERT INTO profiles VALUES ('00000000-0000-0000-0000-000000000001','Reader','photo.webp',true);
      INSERT INTO daily_quote_reactions VALUES
        ('00000000-0000-0000-0000-000000000002','2026-09-30','00000000-0000-0000-0000-000000000001','heart',true),
        ('00000000-0000-0000-0000-000000000003','2026-10-01','00000000-0000-0000-0000-000000000001','lightbulb',true),
        ('00000000-0000-0000-0000-000000000002','2026-10-01','00000000-0000-0000-0000-000000000001','heart',true),
        ('00000000-0000-0000-0000-000000000002','2026-09-30','00000000-0000-0000-0000-000000000004','heart',false);
      INSERT INTO daily_quote_comments SELECT '00000000-0000-0000-0000-000000000002','2026-09-30',true FROM generate_series(1,1501);
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE daily_quote_reactions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE daily_quote_comments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY visible_profiles ON profiles FOR SELECT TO authenticated USING (visible);
      CREATE POLICY visible_reactions ON daily_quote_reactions FOR SELECT TO authenticated USING (visible);
      CREATE POLICY visible_comments ON daily_quote_comments FOR SELECT TO authenticated USING (visible);
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261001105617_egress_quote_summaries.sql'), 'utf8'));
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`);
    const quotes = [
      { user_id: '00000000-0000-0000-0000-000000000002', record_date: '2026-09-30' },
      { user_id: '00000000-0000-0000-0000-000000000003', record_date: '2026-10-01' },
    ];
    const result = await db.query('SELECT public.get_quote_reaction_summaries($1::jsonb) AS data', [JSON.stringify([...quotes, quotes[0]])]);
    const data = result.rows[0].data;
    assert.equal(Object.keys(data.quotes).length, 2, 'Exact pairs, not user/date cross product');
    assert.equal(Object.keys(data.actors).length, 1, 'An avatar appears only once across quotes');
    const first = data.quotes['00000000-0000-0000-0000-000000000002:2026-09-30'];
    assert.equal(first.comments.count, 1501, 'Counts are not truncated at the REST row cap');
    assert.equal(first.heart.count, 1, 'RLS-hidden rows do not leak');
    assert.equal(first.heart.reacted, true);
    assert.equal(first.heart.actor_ids.length, 1);
    assert.deepEqual((await db.query("SELECT public.get_quote_reaction_summaries('[]') AS data")).rows[0].data, { quotes: {}, actors: {} });
    await assert.rejects(db.query("SELECT public.get_quote_reaction_summaries('{}')"), /Expected a quote list/);
    await assert.rejects(db.query('SELECT public.get_quote_reaction_summaries($1::jsonb)', [JSON.stringify(Array(501).fill(quotes[0]))]), /Too many quotes/);
    await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(db.query("SELECT public.get_quote_reaction_summaries('[]')"), /Sign in/);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(db.query("SELECT public.get_quote_reaction_summaries('[]')"), /permission denied/);
    console.log('Quote summary SQL: exact pairs, duplicate input, full counts, actor reuse, RLS, authentication and input bounds passed');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
