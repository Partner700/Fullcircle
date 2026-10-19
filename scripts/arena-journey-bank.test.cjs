const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261019150000_arena_journey_question_bank.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/biblical-journey/index.ts'), 'utf8');
const gameplay = fs.readFileSync(path.join(root, 'src/screens/cadet/JourneyGamePlay.tsx'), 'utf8');
const stagingPath = path.join(root, '../../deploy-all-biblical-journey-volumes.sh');

assert.match(migration, /ADD COLUMN question_set_name text NOT NULL/);
assert.match(migration, /ADD COLUMN retired_at timestamptz/);
assert.match(migration, /FUNCTION public\.append_arena_journey_question_set/);
assert.match(migration, /'instructor-upload', auth\.uid\(\)/);
assert.match(migration, /FUNCTION public\.set_arena_journey_question_retired/);
assert.match(migration, /question\.review_status = 'approved' AND question\.retired_at IS NULL/);
assert.match(migration, /FUNCTION public\.get_arena_journey_bank_page/);
assert.match(migration, /FUNCTION public\.get_arena_journey_active_question_pool/);
assert.match(migration, /PARTITION BY question\.question_stage ORDER BY random\(\)/);
assert.match(migration, /question\.retired_at IS NULL/);
assert.match(edge, /rpc\/get_arena_journey_active_question_pool/);
assert.match(edge, /id=eq\.\$\{id\}&review_status=eq\.approved&select=/);
assert.match(edge, /action === 'EXPIRE'/);
assert.match(gameplay, /aria-label="Board controls"|<JourneyBoard game=/);
assert.match(gameplay, /Correct answer/);
if (fs.existsSync(stagingPath)) {
  const staging = fs.readFileSync(stagingPath, 'utf8');
  assert.doesNotMatch(staging, /-f "\$ACTIVATE_SQL"/);
  assert.match(staging, /remain pending for instructor review|remain pending until the instructor reviews it/);
}
console.log('Journey bank, retirement, timer, and pending-only rollout boundaries passed.');
