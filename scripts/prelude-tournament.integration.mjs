import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const file = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = (name) => file('../supabase/migrations/' + name + '.sql');
try {
  await db.exec(file('./arena-journey-tournaments.fixture.sql'));
  const flexible = migration('20261013170000_flexible_arena_tournament_stages');
  await db.exec(flexible.slice(flexible.indexOf('CREATE OR REPLACE FUNCTION public.create_arena_tournament_room')));
  await db.exec(migration('20261026100000_arena_tournament_inline_choices'));
  const series = migration('20261015151000_arena_scheduled_match_series');
  await db.exec(series.slice(0,series.indexOf('-- The standard trivia function')));
  await db.exec(migration('20261026111736_arena_match_two_to_four_players'));
  await db.exec(migration('20261015150000_arena_scorecard_winner'));
  await db.exec(`ALTER FUNCTION public.get_public_arena_final_scorecard(uuid) SET SCHEMA journey_private;
    CREATE TRIGGER settle AFTER UPDATE ON arena_rooms FOR EACH ROW EXECUTE FUNCTION settle_instructor_arena_match_awards();
    CREATE TRIGGER reservation BEFORE INSERT ON arena_participants FOR EACH ROW EXECUTE FUNCTION enforce_instructor_arena_reservation();`);
  await db.exec(migration('20261027191312_arena_journey_tournaments'));
  await db.exec(migration('20261102065040_arena_optional_game_times'));
  await db.exec('CREATE TRIGGER journey_scores BEFORE UPDATE OF score ON arena_participants FOR EACH ROW EXECUTE FUNCTION journey_private.sync_journey_points();');
  await db.exec(`ALTER TABLE arena_participants ADD COLUMN last_active_at timestamptz,ADD COLUMN forfeit_reason text;
    CREATE TABLE relic_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text);
    CREATE TABLE relic_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,relic_type_id uuid,quantity int);
    CREATE TABLE relic_usage_log(user_id uuid,relic_type_id uuid,effect_applied text);
    CREATE TABLE puzzle_trivia_activity(user_id uuid PRIMARY KEY);
    CREATE TABLE quiz_attempts(id uuid,user_id uuid,submitted_at timestamptz,talents_scored numeric,status text);
    CREATE TABLE question_responses(quiz_attempt_id uuid,question_id uuid,answer text,assisted_by_relic boolean);
    CREATE TABLE generated_questions(id uuid,question_payload jsonb,difficulty_tag text);
    CREATE TABLE game_attempts(user_id uuid,score int,completed_at timestamptz,status text);
    CREATE TABLE story_mode_fig_entries(user_id uuid,figs int,earned_at timestamptz);
    CREATE TABLE account_fig_adjustments(user_id uuid,amount int,effective_at timestamptz);
    CREATE FUNCTION quiz_answer_is_correct(text,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
  await db.exec(migration('20261103152901_puzzle_rewards_and_prelude'));
  await db.exec(migration('20261103192202_prelude_ten_second_stacked_table'));
  await db.exec(migration('20261104060919_prelude_scribe_turns'));
  await db.exec(file('./prelude-tournament.test.sql'));
  console.log('Prelude tournament passed: selectable category, 104-card single round, exactly 1000 reward, bracket advancement and lifetime FIGS.');
  await db.exec(file('./arena-journey-tournaments.test.sql'));
  await db.exec(file('./arena-optional-game-times.test.sql'));
  console.log('Optional game dates passed: partial schedules, later scheduling, deferred finals, date ordering, and instructor permissions.');
  console.log('Journey tournament integration passed: narrative permissions, 2-4 players, rounds, rematches, advancement, witnesses, cumulative scorecards, rewards, legacy and machine behavior.');
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
