import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20260902130000_treasures_and_mines.sql');
const mineHardening = read('supabase/migrations/20260903101000_hidden_challenge_timer_and_mine_relics.sql');
const mineVerseTags = read('supabase/migrations/20260903143000_forty_second_mines_and_scripture_tags.sql');
const expiry = read('supabase/migrations/20260906113000_hidden_challenge_expiry.sql');
const api = read('src/lib/hiddenChallenges.ts');
const market = read('src/components/HiddenItemsMarket.tsx');
const overlay = read('src/components/HiddenChallengeOverlay.tsx');
const app = read('src/App.tsx');
const messenger = read('src/components/TentMessenger.tsx');
const reading = read('src/screens/cadet/CadetNarrative.tsx');
const gamesHub = read('src/screens/cadet/DailyGamesHub.tsx');
const trivia = read('src/screens/cadet/CadetGame.tsx');

for (const table of [
  'hidden_item_tokens',
  'hidden_challenges',
  'hidden_challenge_claims',
  'hidden_challenge_attempts',
]) {
  assert.ok(migration.includes(`CREATE TABLE public.${table}`), `Missing ${table}.`);
  assert.ok(migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `Missing RLS for ${table}.`);
  assert.ok(
    migration.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`),
    `Direct access to ${table} must remain closed.`,
  );
}

for (const boundary of [
  'v_cost integer := 50',
  'v_target_count NOT BETWEEN 1 AND 3',
  'p_reward_denarii::bigint * v_target_count::bigint',
  'p_reward_relic_quantity * v_target_count',
  'p_reward_freezer_quantity * v_target_count',
  "SET status = 'used', used_at = now()",
  'FOR UPDATE SKIP LOCKED',
  'pg_advisory_xact_lock',
  'least(v_balance, v_challenge.mine_penalty_denarii)',
  "placement = 'app_open'",
  'current_target_id = v_next_target',
  "'sender_hidden', true",
  'ORDER BY pool.age_priority, random()',
  'public.has_current_subscription_access',
]) {
  assert.ok(migration.includes(boundary), `Missing hidden-item authority boundary: ${boundary}`);
}

assert.match(migration, /CREATE UNIQUE INDEX hidden_challenge_settlement_ledger_uidx/);
assert.match(migration, /UNIQUE \(claim_id, transfer_number\)/);
assert.match(migration, /p_item_type = 'treasure' AND p_placement NOT IN \('direct_message', 'verse'\)/);
assert.match(migration, /claim\.placement IN \('todays_reading', 'daily_trivia', 'daily_games'\)/);
assert.match(migration, /claim\.status IN \('pending', 'opened'\)/);

const openPayload = migration.match(
  /RETURN jsonb_build_object\(\s*'claim_id', v_claim\.id,[\s\S]*?'participant_count', v_participant_count\s*\);/,
)?.[0] || '';
assert.ok(openPayload, 'The sanitized hidden-question payload is missing.');
assert.doesNotMatch(openPayload, /'correct_answer'/, 'The answer must not reach the browser before settlement.');

for (const rpc of [
  'purchase_hidden_item_token',
  'get_my_hidden_item_inventory',
  'create_hidden_challenge',
  'get_pending_hidden_challenge_claim',
  'get_my_pending_hidden_verse_markers',
  'open_hidden_challenge',
  'submit_hidden_challenge_answer',
  'forfeit_hidden_challenge',
  'get_hidden_challenge_result',
  'get_hidden_challenge_participants',
  'get_my_hidden_challenge_relics',
  'use_hidden_challenge_relic',
]) {
  assert.ok(api.includes(`supabase.rpc('${rpc}'`), `Client API is missing ${rpc}.`);
}

for (const forbiddenWrite of [
  ".from('denarii_ledger_entries')",
  ".from('relic_inventory')",
  ".from('streak_freezers')",
  ".from('hidden_challenge_claims')",
]) {
  assert.ok(!api.includes(forbiddenWrite), `Hidden-item client must not directly write ${forbiddenWrite}.`);
}

assert.match(market, /50 Ð each/);
assert.match(market, /targets\.length >= 3/);
assert.match(market, /Empty boxes are allowed/);
assert.match(market, /Question difficulty/);
assert.match(market, /Unopened items return after 48 hours/);
assert.match(market, /role="radiogroup" aria-label="Hiding place"/);
assert.match(market, /setPlacement\(option\.value as HiddenChallengePlacement\)/);
assert.match(overlay, /Leaving this panel forfeits your attempt/);
assert.match(overlay, /ParticipantStack/);
assert.match(overlay, /document\.visibilityState === 'hidden'/);
assert.match(overlay, /retryAbandonedForfeit/);
assert.match(overlay, /seconds \/ HIDDEN_CHALLENGE_SECONDS/);
assert.match(overlay, /function ChallengeCountdown/);
assert.match(overlay, /pathLength="100"/);
assert.match(overlay, /text-sage/);
assert.match(overlay, /text-gold/);
assert.match(overlay, /text-orange-500/);
assert.match(overlay, /text-coral/);
assert.match(overlay, /Do not leave this page/);
assert.match(overlay, /HIDDEN_CHALLENGE_SECONDS = 40/);
assert.match(overlay, /You stepped on a Mine/);
assert.doesNotMatch(overlay, /You found a Mine/);
assert.match(overlay, /deployHiddenChallengeRelic/);
assert.match(app, /<HiddenChallengeOverlay \/>/);
assert.match(messenger, /revealHiddenChallenge\(\{ claimIds: hiddenClaimIds \}\)/);
assert.match(overlay, /for \(const claimId of detail\.claimIds\)/);
assert.doesNotMatch(messenger, /Open hidden question/);
assert.match(reading, /placement: 'todays_reading'/);
assert.match(reading, /placement: 'verse'/);
assert.match(reading, /Tagged for you/);
assert.match(reading, /fetchPendingHiddenVerseMarkers/);
assert.match(reading, /openHiddenVerseChallenge\(targetSourceNarrativeId, reference\)/);
assert.match(gamesHub, /placement: 'daily_games'/);
assert.match(trivia, /placement: 'daily_trivia'/);

const mineCharge = (balance: number, penalty: number) => Math.min(Math.max(balance, 0), penalty);
assert.equal(mineCharge(500, 100), 100);
assert.equal(mineCharge(25, 100), 25);
assert.equal(mineCharge(0, 100), 0);

const escrow = (perRecipient: number, recipients: number) => perRecipient * recipients;
assert.equal(escrow(300, 1), 300);
assert.equal(escrow(300, 3), 900);

for (const boundary of [
  "'shield-of-faith'",
  "denarii_cost,",
  "'single_mine'",
  "interval '15 seconds'",
  'protection_relic_slug',
  "'mine_blocked', true",
  'settle_hidden_challenge_failure_unprotected',
  'CREATE OR REPLACE FUNCTION public.get_my_hidden_challenge_relics',
  'CREATE OR REPLACE FUNCTION public.use_hidden_challenge_relic',
  "p_relic_slug IN ('skip', 'witch-ball-endor', 'sword-goliath')",
  "p_relic_slug = 'freeze-timer'",
  "p_relic_slug = 'eliminate'",
  "p_relic_slug = 'talking-donkey'",
  "p_relic_slug = 'reveal-reference'",
]) {
  assert.ok(mineHardening.includes(boundary), `Missing Mine/timer hardening boundary: ${boundary}`);
}
assert.match(mineHardening, /'shield-of-faith'[\s\S]*?100,/);
assert.match(mineHardening, /REVOKE ALL ON FUNCTION public\.settle_hidden_challenge_failure_unprotected/);
assert.match(mineHardening, /GRANT EXECUTE ON FUNCTION public\.use_hidden_challenge_relic[\s\S]*TO authenticated/);

for (const boundary of [
  "interval '40 seconds'",
  'get_my_pending_hidden_verse_markers',
  'notify_scripture_mine_as_verse_tag',
  "'scripture_insight_mention'",
  "'hidden_challenge_claim_id', NEW.id",
  "NEW.placement = 'verse'",
]) {
  assert.ok(mineVerseTags.includes(boundary), `Missing 40-second/Scripture Mine boundary: ${boundary}`);
}
assert.match(mineVerseTags, /claim\.current_target_id = auth\.uid\(\)/);
assert.match(mineVerseTags, /challenge\.item_type = 'mine'/);
assert.match(mineVerseTags, /GRANT EXECUTE ON FUNCTION public\.get_my_pending_hidden_verse_markers\(uuid\[\]\)[\s\S]*TO authenticated, service_role/);

for (const boundary of [
  "created_at + interval '48 hours'",
  'CREATE TABLE IF NOT EXISTS public.hidden_challenge_expirations',
  'CREATE OR REPLACE FUNCTION public.expire_hidden_challenges',
  "claim.status IN ('pending', 'opened')",
  'v_challenge.reward_denarii::bigint * v_unresolved_count::bigint',
  'v_challenge.reward_relic_quantity * v_unresolved_count',
  'v_challenge.reward_freezer_quantity * v_unresolved_count',
  "VALUES (v_challenge.creator_id, v_challenge.item_type, 'available'",
  "v_challenge.id::text || ':expiry'",
  "'full-circle-hidden-challenge-expiry'",
  "'*/5 * * * *'",
]) {
  assert.ok(expiry.includes(boundary), `Missing 48-hour expiry boundary: ${boundary}`);
}
assert.match(expiry, /ON CONFLICT \(challenge_id\) DO NOTHING/);
assert.match(expiry, /PERFORM public\.expire_hidden_challenges\(v_user_id\)/);
assert.match(expiry, /ALTER FUNCTION public\.open_hidden_challenge\(uuid, uuid\)[\s\S]*RENAME TO open_hidden_challenge_before_expiry/);
assert.match(expiry, /REVOKE ALL ON TABLE public\.hidden_challenge_expirations FROM PUBLIC, anon, authenticated/);

console.log('Treasure and Mine authority checks passed.');
