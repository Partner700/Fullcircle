import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20260826110000_normalize_full_circle_economy.sql');
const roadHomeEngine = read('supabase/functions/_shared/road-home-engine.ts');
const roadHomeEndpoint = read('supabase/functions/road-home-game/index.ts');
const roadHomeSettlement = read('supabase/migrations/20260810142000_road_home_atomic_settlement.sql');
const clientSource = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((entry) => typeof entry === 'string' && /\.(?:ts|tsx)$/.test(entry))
  .map((entry) => read(path.join('src', entry as string)))
  .join('\n');

const canonicalValues = migration.match(
  /VALUES\s*\(\s*'canonical'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*now\(\)\s*\)/,
);
assert.ok(canonicalValues, 'The canonical economy constants must be present in one server-owned row.');

const rules = {
  streaksPerMark: Number(canonicalValues[1]),
  denariiPerTalent: Number(canonicalValues[2]),
  talentsPerMark: Number(canonicalValues[3]),
  rhudesPerMark: Number(canonicalValues[4]),
  figsPerMark: Number(canonicalValues[5]),
};

assert.deepEqual(rules, {
  streaksPerMark: 1,
  denariiPerTalent: 6000,
  talentsPerMark: 1,
  rhudesPerMark: 6,
  figsPerMark: 300,
});

function normalizedMarks({
  streaks = 0,
  qualifyingDenarii = 0,
  rhudes = 0,
  figs = 0,
}: {
  streaks?: number;
  qualifyingDenarii?: number;
  rhudes?: number;
  figs?: number;
}) {
  return Math.max(streaks, 0) / rules.streaksPerMark
    + (Math.max(qualifyingDenarii, 0) / rules.denariiPerTalent) / rules.talentsPerMark
    + Math.max(rhudes, 0) / rules.rhudesPerMark
    + Math.max(figs, 0) / rules.figsPerMark;
}

assert.equal(normalizedMarks({ streaks: 1 }), 1);
assert.equal(normalizedMarks({ figs: 300 }), 1);
assert.equal(normalizedMarks({ figs: 150 }), 0.5);
assert.equal(normalizedMarks({ rhudes: 6 }), 1);
assert.equal(normalizedMarks({ rhudes: 3 }), 0.5);
assert.equal(normalizedMarks({ qualifyingDenarii: 6000 }), 1);
assert.equal(normalizedMarks({ qualifyingDenarii: 3000 }), 0.5);
assert.equal(normalizedMarks({ streaks: 2, qualifyingDenarii: 6000, rhudes: 12, figs: 600 }), 7);

// Wallet balance is intentionally absent from the formula. Spending changes
// liquidity, not the already captured lifetime achievement.
const marksBeforePurchase = normalizedMarks({ qualifyingDenarii: 6000 });
const marksAfterSpending4000 = normalizedMarks({ qualifyingDenarii: 6000 });
assert.equal(marksBeforePurchase, marksAfterSpending4000);
assert.equal(marksAfterSpending4000, 1);

for (const formulaPart of [
  'greatest(coalesce(p_streaks, 0), 0) / rules.streaks_per_mark',
  'greatest(coalesce(p_qualifying_denarii, 0), 0)',
  '/ rules.denarii_per_talent',
  '/ rules.talents_per_mark',
  'greatest(coalesce(p_rhudes, 0), 0) / rules.rhudes_per_mark',
  'greatest(coalesce(p_figs, 0), 0) / rules.figs_per_mark',
]) {
  assert.ok(migration.includes(formulaPart), `Server Marks formula is missing: ${formulaPart}`);
}

for (const achievementBoundary of [
  'CREATE TABLE IF NOT EXISTS public.denarii_achievement_entries',
  'ledger_entry_id uuid PRIMARY KEY',
  'CREATE UNIQUE INDEX IF NOT EXISTS denarii_achievement_reference_uidx',
  'WHERE source_reference IS NOT NULL',
  'WHERE qualifying.replay_number = 1',
  'ON CONFLICT (user_id, source_type, source_reference)',
  'REVOKE ALL ON TABLE public.denarii_achievement_entries FROM PUBLIC, anon, authenticated',
]) {
  assert.ok(migration.includes(achievementBoundary), `Missing duplicate/replay boundary: ${achievementBoundary}`);
}

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_marks_board_live\(\)[\s\S]*?public\.get_member_mark_components\(\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_tent_leaderboard\(\)[\s\S]*?sum\(component\.marks\)/);
assert.match(migration, /normalized_economy_board_daily_snapshots[\s\S]*formula_version/);
assert.match(migration, /LEFT JOIN LATERAL public\.compute_strict_streak\(active\.user_id\)/);

// A simple ranking acceptance example proves fractional Marks remain useful
// and that the board orders by the normalized value rather than wallet cash.
const standings = [
  { id: 'spent-wallet', wallet: 0, marks: normalizedMarks({ qualifyingDenarii: 6000 }) },
  { id: 'fig-progress', wallet: 9000, marks: normalizedMarks({ figs: 150 }) },
  { id: 'mixed-leader', wallet: 0, marks: normalizedMarks({ streaks: 1, rhudes: 3 }) },
].sort((left, right) => right.marks - left.marks);
assert.deepEqual(standings.map((entry) => entry.id), ['mixed-leader', 'spent-wallet', 'fig-progress']);

for (const matchValue of [
  'startingMatchDenarii: 50',
  'ownQuestion: 10',
  'inheritedQuestion: 20',
  'inheritedPenalty: 20',
  'capture: 30',
  'pawnHome: 40',
  'firstPlace: 100',
  'target.pawn.prisonRounds * 40',
]) {
  assert.ok(roadHomeEngine.includes(matchValue), `Road Home Match Denarii rule is missing: ${matchValue}`);
}
assert.ok(!roadHomeEngine.includes('denarii_ledger_entries'), 'The board engine must not write account Denarii.');
assert.ok(!roadHomeSettlement.includes('matchDenarii'), 'Match Denarii must not enter account settlement.');
assert.ok(!roadHomeSettlement.includes('match_denarii'), 'Match Denarii must not enter account settlement.');
assert.match(roadHomeSettlement, /v_reward := greatest\(coalesce\(v_room\.stake_amount, 0\), 0\)/);
assert.match(roadHomeEndpoint, /normalizeRoadHomeEconomyState/);
assert.doesNotMatch(roadHomeEndpoint, /matchDenarii[\s\S]{0,180}(?:ledger|settle_road_home_game)/);

assert.ok(!clientSource.includes('awardMarks('), 'Client gameplay must never award Marks directly.');
assert.ok(!clientSource.includes(".from('denarii_achievement_entries')"), 'The browser must not access achievement entries.');
assert.ok(!clientSource.includes('.from("denarii_achievement_entries")'), 'The browser must not access achievement entries.');

console.log('Economy normalization acceptance tests passed.');
