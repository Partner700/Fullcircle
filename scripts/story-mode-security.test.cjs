const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260831110000_story_mode_abel_vertical_slice.sql');
const brothersMigration = read('supabase/migrations/20260831160000_complete_brothers_chapter.sql');
const api = read('src/screens/cadet/story-mode/api.ts');

for (const table of [
  'story_mode_levels',
  'story_mode_questions',
  'story_mode_checkpoints',
  'story_mode_progress',
  'story_mode_attempts',
  'story_mode_answer_events',
  'story_mode_fig_entries',
  'story_mode_level_completions',
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*story_mode_level_completions[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(migration, /public\.has_current_subscription_access\(v_user_id\)/);
assert.match(migration, /assignment\.role IN \('cadet', 'sentry'\)/);
assert.match(migration, /assignment\.status IN \('active', 'approved'\)/);

const questionPayload = migration.match(/CREATE OR REPLACE FUNCTION public\.story_mode_question_payload[\s\S]*?\$\$;/)?.[0] || '';
assert.ok(questionPayload, 'Public Story question payload function is missing.');
assert.doesNotMatch(questionPayload, /correct_answer/);
assert.match(migration, /correct_answer text NOT NULL/);

const submitApi = api.match(/export async function submitStoryAnswer[\s\S]*?^}/m)?.[0] || '';
assert.ok(submitApi, 'Story answer API wrapper is missing.');
assert.match(submitApi, /attemptId: string/);
assert.match(submitApi, /questionId: string/);
assert.match(submitApi, /selectedAnswer: string \| null/);
assert.match(submitApi, /timedOut: boolean/);
assert.match(submitApi, /submissionId: string/);
assert.doesNotMatch(submitApi, /correct:\s*(?:true|boolean)/);
assert.doesNotMatch(submitApi, /figs:\s*number/);
assert.doesNotMatch(submitApi, /denarii:\s*number/);
assert.doesNotMatch(submitApi, /levelCompleted|level_complete:/);

assert.match(migration, /v_correct := NOT v_timed_out[\s\S]*v_question\.correct_answer/);
assert.match(migration, /now\(\) > v_attempt\.question_started_at \+ make_interval\(secs => v_question\.timer_seconds\)/);
assert.match(migration, /active_question_id text REFERENCES public\.story_mode_questions/);
assert.match(migration, /v_attempt\.active_question_id IS DISTINCT FROM p_question_id/);
assert.match(migration, /UNIQUE[\s\S]*submission_id|submission_id uuid NOT NULL UNIQUE/);
assert.ok((migration.match(/event\.submission_id = p_submission_id/g) || []).length >= 2, 'Duplicate submissions must be checked before and after the attempt lock.');
assert.match(migration, /FOR UPDATE;[\s\S]*Re-check the idempotency key/);

assert.match(migration, /figs integer NOT NULL CHECK \(figs IN \(1, 3, 5\)\)/);
assert.match(migration, /WHEN 'hard' THEN 5[\s\S]*WHEN 'moderate' THEN 3[\s\S]*ELSE 1/);
assert.match(migration, /IF v_correct AND NOT v_attempt\.is_replay THEN/);
assert.match(migration, /PRIMARY KEY \(user_id, question_id\)/);
assert.match(migration, /ON CONFLICT \(user_id, question_id\) DO NOTHING/);
assert.match(migration, /'denarii_earned', 0/);
assert.match(migration, /story_mode_fig_entries story/);
assert.doesNotMatch(migration, /story_mode_marks|INSERT INTO public\.[a-z_]*marks|award_[a-z_]*mark/);

assert.match(migration, /WHERE slug = p_level_slug AND is_published = true/);
assert.match(migration, /Complete the previous Story Mode level first/);
assert.match(migration, /This Story Mode question is not unlocked yet/);
assert.match(migration, /Reach the Story Mode question checkpoint first/);
assert.match(migration, /JOIN LATERAL \([\s\S]*candidate\.checkpoint_order/);
assert.match(migration, /checkpoint\.checkpoint_order DESC/);
assert.match(migration, /v_retry_checkpoint := v_attempt\.checkpoint_id/);
assert.match(migration, /Story Mode checkpoints cannot be moved backward/);
assert.match(migration, /Story Mode checkpoints must be reached in order/);
assert.match(migration, /Level completion must be settled by the Story Mode answer service/);
assert.match(migration, /Resume Story Mode before saving a checkpoint/);
assert.match(migration, /question_started_at = CASE[\s\S]*now\(\) - paused_at/);
assert.match(migration, /FROM public\.profiles profile[\s\S]*FOR UPDATE/);
const startFunction = migration.match(/CREATE OR REPLACE FUNCTION public\.start_story_mode_level[\s\S]*?\$\$;/)?.[0] || '';
assert.doesNotMatch(startFunction, /abel-field|abel-offering/, 'Generic level startup must derive its checkpoints from content data.');

for (const externalSystem of ['game_attempts', 'arena_rooms', 'arena_participants', 'denarii_ledger_entries']) {
  assert.doesNotMatch(migration, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${externalSystem}`), `Story Mode must not mutate ${externalSystem}.`);
}
assert.equal((migration.match(/\$\$/g) || []).length % 2, 0, 'Story migration SQL delimiters are unbalanced.');

for (const table of [
  'story_mode_question_pools',
  'story_mode_attempt_questions',
  'story_mode_canonical_events',
  'story_mode_event_settlements',
  'story_mode_chapter_completions',
]) {
  assert.match(brothersMigration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(brothersMigration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(brothersMigration, /REVOKE ALL ON TABLE[\s\S]*story_mode_chapter_completions[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(brothersMigration, /CREATE OR REPLACE FUNCTION public\.settle_story_mode_canonical_event/);
assert.match(brothersMigration, /REVOKE ALL ON FUNCTION public\.settle_story_mode_canonical_event\(uuid, text, uuid\) FROM PUBLIC, anon/);
assert.match(brothersMigration, /GRANT EXECUTE ON FUNCTION public\.settle_story_mode_canonical_event\(uuid, text, uuid\) TO authenticated, service_role/);

const phase3bPayload = brothersMigration.match(/CREATE OR REPLACE FUNCTION public\.story_mode_question_payload[\s\S]*?\$\$;/)?.[0] || '';
assert.ok(phase3bPayload);
assert.doesNotMatch(phase3bPayload, /correct_answer|explanation|correct_action_id|wrong_action_id/);
assert.match(phase3bPayload, /'scene_id', question\.scene_id/);
assert.match(phase3bPayload, /'is_read_follow_up', question\.is_read_follow_up/);

assert.match(brothersMigration, /story_mode_attempt_questions[\s\S]*answered_correct boolean/);
assert.match(brothersMigration, /ORDER BY md5\(v_attempt\.id::text \|\| ':' \|\| question\.id\)/);
assert.match(brothersMigration, /This Story Mode question is not unlocked yet/);
assert.match(brothersMigration, /Only the next server-selected Story Mode checkpoint can be saved/);
assert.match(brothersMigration, /Terminal Story Mode checkpoints must be settled by the server/);
assert.match(brothersMigration, /Complete the server-selected questions before the canonical transition/);
assert.match(brothersMigration, /The canonical transition cannot be skipped or reached out of order/);
assert.match(brothersMigration, /IF v_correct AND NOT v_attempt\.is_replay THEN/);
assert.match(brothersMigration, /ON CONFLICT \(user_id, question_id\) DO NOTHING/);
assert.match(brothersMigration, /WHERE user_id = v_user_id AND NOT v_attempt\.is_replay/);
assert.match(brothersMigration, /'denarii_earned', 0/);
assert.doesNotMatch(brothersMigration, /story_mode_marks|INSERT INTO public\.[a-z_]*marks|award_[a-z_]*mark/);

const canonicalApi = api.match(/export async function settleStoryCanonicalEvent[\s\S]*?^}/m)?.[0] || '';
assert.ok(canonicalApi);
assert.match(canonicalApi, /attemptId: string/);
assert.match(canonicalApi, /eventId: string/);
assert.match(canonicalApi, /submissionId: string/);
assert.doesNotMatch(canonicalApi, /survived|outcome|correct|figs|denarii|chapterComplete|levelComplete/);

for (const externalSystem of ['game_attempts', 'arena_rooms', 'arena_participants', 'denarii_ledger_entries']) {
  assert.doesNotMatch(brothersMigration, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${externalSystem}`));
}
assert.equal((brothersMigration.match(/\$\$/g) || []).length % 2, 0, 'Phase 3B SQL delimiters are unbalanced.');

console.log('Story Mode server-authority and economy-isolation checks passed.');
