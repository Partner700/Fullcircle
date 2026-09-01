const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901100000_story_mode_noah_ark_construction.sql');
const api = read('src/screens/cadet/story-mode/api.ts');
const clientSource = fs.readdirSync(path.join(root, 'src/screens/cadet/story-mode'))
  .filter((entry) => /\.(?:ts|tsx)$/.test(entry))
  .map((entry) => read(path.join('src/screens/cadet/story-mode', entry)))
  .join('\n');

assert.match(migration, /VALUES \('beginnings', 'noah', 'beginnings', 'generations'\)/);
assert.match(migration, /JOIN public\.story_mode_chapter_completions completion[\s\S]*prerequisite_chapter_slug/);
assert.match(migration, /Complete the previous Story Mode chapter first/);
assert.match(migration, /WHERE slug = p_level_slug AND is_published = true/);
assert.match(migration, /Complete the previous Story Mode level first/);
assert.match(migration, /\('the-flood', 'beginnings', 'noah', 'The Flood', 11, 'the-ark-stands', false\)/);

for (const table of [
  'story_mode_chapter_unlocks',
  'story_mode_world_builds',
  'story_mode_world_build_stages',
  'story_mode_level_build_context',
  'story_mode_user_build_progress',
  'story_mode_attempt_build_progress',
]) {
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*story_mode_attempt_build_progress[\s\S]*FROM PUBLIC, anon, authenticated/);

const start = migration.match(/CREATE OR REPLACE FUNCTION public\.start_story_mode_level[\s\S]*?\n\$\$;/)?.[0] || '';
assert.match(start, /ORDER BY md5\(v_attempt\.id::text \|\| ':' \|\| question\.id\)/);
assert.match(start, /PARTITION BY pool\.level_slug, pool\.pool_id/);
assert.match(start, /within_pool_order <= questions_per_attempt/);
assert.match(start, /The saved Story Mode construction state is invalid for this level/);

const submit = migration.match(/CREATE OR REPLACE FUNCTION public\.submit_story_mode_answer\([\s\S]*?\n\$\$;/)?.[0] || '';
assert.ok(submit);
const signature = submit.slice(0, submit.indexOf('RETURNS jsonb'));
for (const forbiddenParameter of ['correct', 'figs', 'denarii', 'stage', 'build', 'ark', 'complete', 'deadline']) {
  assert.doesNotMatch(signature, new RegExp(`p_${forbiddenParameter}`, 'i'));
}
assert.match(submit, /v_timed_out := coalesce\(p_timed_out, false\)[\s\S]*now\(\) > v_attempt\.question_started_at/);
assert.match(submit, /v_correct := NOT v_timed_out[\s\S]*v_question\.correct_answer/);
assert.match(submit, /v_attempt\.active_question_id IS DISTINCT FROM p_question_id/);
assert.match(submit, /IF v_correct AND NOT v_attempt\.is_replay THEN/);
assert.match(submit, /ON CONFLICT \(user_id, question_id\) DO NOTHING/);
assert.match(submit, /v_build_stage\.stage_order <> v_attempt_build\.stage_order \+ 1/);
assert.match(submit, /IF NOT v_attempt\.is_replay THEN[\s\S]*UPDATE public\.story_mode_user_build_progress/);
assert.match(submit, /Every mandatory construction milestone must be settled before level completion/);
assert.match(submit, /'denarii_earned', 0/);
assert.doesNotMatch(migration, /story_mode_marks|INSERT INTO public\.[a-z_]*marks|award_[a-z_]*mark/);

const submitApi = api.match(/export async function submitStoryAnswer[\s\S]*?^}/m)?.[0] || '';
assert.match(submitApi, /attemptId: string/);
assert.match(submitApi, /questionId: string/);
assert.match(submitApi, /selectedAnswer: string \| null/);
assert.match(submitApi, /timedOut: boolean/);
assert.match(submitApi, /submissionId: string/);
assert.doesNotMatch(submitApi, /correct:|figs:|denarii:|buildStage|arkStage|arkComplete|levelComplete/);

for (const table of ['story_mode_user_build_progress', 'story_mode_attempt_build_progress']) {
  const directWrite = new RegExp(`\\.from\\(['"]${table}['"]\\)[\\s\\S]{0,240}?\\.(?:insert|update|upsert|delete)\\(`);
  assert.doesNotMatch(clientSource, directWrite);
}
assert.doesNotMatch(clientSource, /correctAnswer|correct_answer|answerKey/);

for (const externalSystem of [
  'game_attempts', 'arena_rooms', 'arena_participants', 'denarii_ledger_entries',
  'daily_game_runs', 'quiz_attempts', 'relic_inventory',
]) {
  assert.doesNotMatch(migration, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${externalSystem}`));
}
assert.equal((migration.match(/\$\$/g) || []).length % 2, 0, 'Phase 3D SQL delimiters are unbalanced.');

console.log('Story Mode Noah unlock, answer privacy, construction authority, rewards, and system-isolation checks passed.');
