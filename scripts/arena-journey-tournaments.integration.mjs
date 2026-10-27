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
  await db.exec('CREATE TRIGGER journey_scores BEFORE UPDATE OF score ON arena_participants FOR EACH ROW EXECUTE FUNCTION journey_private.sync_journey_points();');
  await db.exec(file('./arena-journey-tournaments.test.sql'));
  console.log('Journey tournament integration passed: narrative permissions, 2-4 players, rounds, rematches, advancement, witnesses, cumulative scorecards, rewards, legacy and machine behavior.');
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
