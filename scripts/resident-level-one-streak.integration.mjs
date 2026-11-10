import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261110143419_open_daily_games_and_level_one_streaks.sql', import.meta.url), 'utf8')
  .replaceAll('now()', "timestamptz '2026-11-11 18:00:00+00'");
const residents = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
const weekday = '2026-11-11';

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA private;
    CREATE SCHEMA scripture_games;
    CREATE TABLE private.resident_streak_rollout(singleton boolean, starts_on date);
    INSERT INTO private.resident_streak_rollout VALUES (true, '2026-11-11');
    CREATE TABLE daily_records(user_id uuid, record_date date, meditation_submitted boolean,
      meditation_submitted_at timestamptz, attendance_status text, attendance_marked_by uuid,
      attendance_marked_at timestamptz, sunday_reading_opened_at timestamptz, streak_valid boolean);
    CREATE TABLE game_attempts(user_id uuid, narrative_date date, level int, status text, completed_at timestamptz);
    CREATE TABLE quiz_sessions(id int, session_date date, quiz_type text);
    CREATE TABLE quiz_attempts(user_id uuid, quiz_session_id int, status text);
    CREATE TABLE tent_members(user_id uuid, joined_at timestamptz);
    CREATE TABLE subscriptions(user_id uuid, status text, created_at timestamptz, current_period_end timestamptz);
    CREATE TABLE subscription_payment_deliveries(user_id uuid, period_start timestamptz, period_end timestamptz);
    CREATE FUNCTION scripture_games.meditation_submission_is_timely(uuid, date, timestamptz)
      RETURNS boolean LANGUAGE sql AS $$ SELECT ($3 AT TIME ZONE 'Africa/Douala')::time < time '21:00' $$;
    CREATE TABLE streak_refresh_probe(user_id uuid);
    CREATE FUNCTION public.refresh_user_streak_snapshot(uuid)
      RETURNS void LANGUAGE sql AS $$ INSERT INTO public.streak_refresh_probe VALUES ($1) $$;
    CREATE FUNCTION public.synchronize_daily_record_streak_valid(uuid, date)
      RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        UPDATE public.daily_records SET streak_valid = public.streak_requirement_met($1, $2)
        WHERE user_id = $1 AND record_date = $2;
      END $$;
  `);
  await db.exec(migration);
  const med = (resident, day = weekday, attendance = 'unmarked', time = '18:00:00+00') => db.query(
    "INSERT INTO daily_records VALUES ($1,$2,true,($2::date::text || ' ' || $4)::timestamptz,$3,null,null,null,false)",
    [resident, day, attendance, time],
  );
  const attempt = (resident, level, status, time = '18:05:00+00', day = weekday) => db.query(
    "INSERT INTO game_attempts VALUES ($1,$2,$3,$4,($2::date::text || ' ' || $5)::timestamptz)",
    [resident, day, level, status, time],
  );
  const meets = async (resident, day = weekday) => (await db.query(
    'SELECT public.streak_requirement_met($1,$2) AS met', [resident, day],
  )).rows[0].met;

  const [free, tent, subscribed, failed, late, outside, gameFirst] = residents;
  await med(free);
  assert.equal(await meets(free), false, 'meditation alone does not count');
  await attempt(free, 1, 'passed');
  assert.equal(await meets(free), true, 'a non-subscriber earns the streak with Level 1');
  const badge = await db.query('SELECT streak_valid FROM daily_records WHERE user_id = $1', [free]);
  assert.equal(badge.rows[0].streak_valid, true, 'the game trigger refreshes the stored day');
  assert.equal((await db.query('SELECT user_id FROM streak_refresh_probe')).rows[0].user_id, free);

  await attempt(gameFirst, 1, 'passed');
  assert.equal(await meets(gameFirst), false, 'Level 1 alone does not count');
  await med(gameFirst);
  assert.equal(await meets(gameFirst), true, 'meditation can come second');

  await med(tent, weekday, 'present');
  await db.query("INSERT INTO tent_members VALUES ($1,'2026-11-10 00:00Z')", [tent]);
  assert.equal(await meets(tent), true, 'tent attendance substitutes for Level 1');

  await med(subscribed, weekday, 'present');
  await db.query("INSERT INTO subscription_payment_deliveries VALUES ($1,'2026-11-10 00:00Z','2026-12-10 00:00Z')", [subscribed]);
  assert.equal(await meets(subscribed), true, 'documented subscribers can use attendance without a tent');

  await med(outside, weekday, 'present');
  assert.equal(await meets(outside), false, 'attendance without eligibility does not substitute');
  await attempt(outside, 1, 'passed');
  assert.equal(await meets(outside), true);
  await med(failed);
  await attempt(failed, 1, 'failed');
  await attempt(failed, 2, 'passed');
  assert.equal(await meets(failed), false, 'failed Level 1 and other levels do not substitute');

  await med(late);
  await attempt(late, 1, 'passed', '20:00:00+00');
  assert.equal(await meets(late), false, 'the 9 p.m. Douala cutoff applies');
  await med(late, '2026-11-09', 'present');
  assert.equal(await meets(late, '2026-11-09'), true, 'earlier attendance credit is preserved');

  await db.exec("INSERT INTO quiz_sessions VALUES (1,'2026-11-14','saturday')");
  await db.query("INSERT INTO quiz_attempts VALUES ($1,1,'submitted')", [free]);
  assert.equal(await meets(free, '2026-11-14'), true);
  await db.query("INSERT INTO daily_records (user_id,record_date,sunday_reading_opened_at) VALUES ($1,'2026-11-15','2026-11-15 12:00Z')", [free]);
  assert.equal(await meets(free, '2026-11-15'), true);
  console.log('Resident streak checks passed for Level 1, attendance, the Douala cutoff, and weekends.');
} finally {
  await db.close();
}
