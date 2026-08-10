const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const closure = read('supabase/migrations/20260810144000_final_rpc_security_closure.sql');
const release = read('supabase/migrations/20260810143000_release_integrity_followup.sql');
const streakIntegrity = read('supabase/migrations/20260810145000_deterministic_streak_calculator.sql');
const serviceWorker = read('public/sw.js');
const supabaseConfig = read('supabase/config.toml');
const campayWebhook = read('supabase/functions/campay-webhook/index.ts');
const calendarUtilities = read('src/lib/utils.ts');

for (const required of [
  "v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id",
  "v_reactor_id IS NULL OR v_reactor_id IS DISTINCT FROM p_reactor_user_id",
  "v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id",
  "REVOKE ALL ON FUNCTION public.complete_daily_game_level",
  "REVOKE ALL ON FUNCTION public.use_relic",
]) {
  assert.ok(closure.includes(required), `Missing RPC boundary: ${required}`);
}

for (const table of [
  'denarii_ledger_entries',
  'game_attempts',
  'quiz_attempts',
  'daily_records',
  'role_assignments',
  'relic_inventory',
  'mobile_money_payments',
  'question_responses',
  'daily_game_runs',
  'daily_game_responses',
  'arena_question_decks',
  'arena_trivia_responses',
  'arena_machine_trivia_responses',
]) {
  assert.ok(
    release.includes(`REVOKE INSERT, UPDATE, DELETE ON public.${table} FROM anon, authenticated;`),
    `Authoritative table is not sealed: ${table}`,
  );
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(item);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [item] : [];
  });
}

const sealedTables = [
  'denarii_ledger_entries', 'game_attempts', 'quiz_attempts', 'daily_records',
  'role_assignments', 'relic_inventory', 'mobile_money_payments', 'question_responses',
  'daily_game_runs', 'daily_game_responses', 'daily_game_question_aids',
  'arena_question_decks', 'arena_trivia_responses', 'arena_machine_trivia_responses',
  'relic_usage_log', 'arena_rooms', 'arena_participants',
];

for (const file of sourceFiles(path.join(root, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const table of sealedTables) {
    const directWrite = new RegExp(
      `\\.from\\(['\"]${table}['\"]\\)[\\s\\S]{0,240}?\\.(?:insert|update|upsert|delete)\\(`,
    );
    assert.ok(!directWrite.test(source), `Direct write to ${table} in ${path.relative(root, file)}`);
  }
}

const installHandler = serviceWorker.match(/addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
assert.ok(!installHandler.includes('skipWaiting'), 'Service worker must not force an update during install.');
assert.match(serviceWorker, /CACHE_VERSION = 'full-circle-v20'/);

for (const required of [
  "v_user_id IS NULL OR v_user_id IS DISTINCT FROM p_user_id",
  "v_local_now::time >= time '21:00'",
  'find_latest_recoverable_streak_gap',
  "protection.source IN ('relic', 'redemption')",
  "v_relic.effect_type NOT IN",
  "No unrepaired streak-breaking day was found",
  'relic_recovery_repairs',
]) {
  assert.ok(streakIntegrity.includes(required), `Missing deterministic streak boundary: ${required}`);
}

assert.match(supabaseConfig, /\[functions\.campay-webhook\][\s\S]*?verify_jwt = false/);
assert.match(supabaseConfig, /\[functions\.send-push-notification\][\s\S]*?verify_jwt = false/);
assert.match(campayWebhook, /requestedPayment\.user_id !== authenticatedUserId/);
assert.match(campayWebhook, /ageMs >= 35_000/);

for (const required of [
  "APP_TIME_ZONE = 'Africa/Douala'",
  'getAppDateTimeMs',
  'getDateDaysAgoISO',
]) {
  assert.ok(
    read('src/lib/constants.ts').includes(required) || calendarUtilities.includes(required),
    `Missing authoritative app-calendar behavior: ${required}`,
  );
}

const appShellBlock = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
const appShellPaths = [...appShellBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
for (const assetPath of appShellPaths) {
  if (assetPath === '/' || assetPath === '/index.html') continue;
  assert.ok(fs.existsSync(path.join(root, 'public', assetPath)), `Missing service-worker shell asset: ${assetPath}`);
}

const manifest = JSON.parse(read('public/manifest.webmanifest'));
for (const asset of [...(manifest.icons || []), ...(manifest.screenshots || [])]) {
  const assetPath = String(asset.src || '').split('?')[0].replace(/^\//, '');
  assert.ok(assetPath && fs.existsSync(path.join(root, 'public', assetPath)), `Missing manifest asset: ${asset.src}`);
}

for (const migrationName of [
  '20260810130000_identity_streak_security_hardening.sql',
  '20260810131000_server_authoritative_quizzes.sql',
  '20260810132000_economy_and_relic_integrity.sql',
  '20260810133000_atomic_campay_confirmation.sql',
  '20260810134000_private_authoritative_arena_questions.sql',
  '20260810135000_arena_and_balance_integrity.sql',
  '20260810140000_server_authoritative_daily_games.sql',
  '20260810141000_profile_contact_privacy.sql',
  '20260810142000_road_home_atomic_settlement.sql',
  '20260810143000_release_integrity_followup.sql',
  '20260810144000_final_rpc_security_closure.sql',
  '20260810145000_deterministic_streak_calculator.sql',
]) {
  const migration = read(`supabase/migrations/${migrationName}`);
  assert.equal((migration.match(/\$\$/g) || []).length % 2, 0, `Unbalanced SQL function delimiter in ${migrationName}`);
}

for (const file of sourceFiles(path.join(root, 'supabase/functions'))) {
  if (!file.endsWith('.ts')) continue;
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: file,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], `Edge Function syntax error in ${path.relative(root, file)}`);
}

console.log('Security and release-boundary checks passed.');
