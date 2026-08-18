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
const toolbarStats = read('supabase/migrations/20260814172000_authoritative_toolbar_stats.sql');
const cadetDashboard = read('src/screens/cadet/CadetDashboard.tsx');
const sentryApp = read('src/screens/sentry/SentryApp.tsx');
const arenaGenerator = read('supabase/functions/generate-arena-questions/index.ts');
const frenchUi = read('src/lib/frenchUi.ts');
const relicRecovery = read('supabase/migrations/20260817120000_relic_recovery_and_denarii_only.sql');
const sentryStreakRecovery = read('supabase/migrations/20260817121000_preserve_sentry_duty_and_relic_recovery.sql');
const authoritativeRestitution = read('supabase/migrations/20260817122000_make_streak_restitutions_authoritative.sql');
const materializedRestitution = read('supabase/migrations/20260817123000_neutral_sunday_and_materialized_restitution.sql');
const verifiedStreakBaseline = read('supabase/migrations/20260817124000_preserve_verified_streak_baselines.sql');
const scriptureDeepLinks = read('supabase/migrations/20260817183000_scripture_notification_deep_links.sql');
const messageMentions = read('supabase/migrations/20260817190000_notify_mentions_in_messages.sql');
const pushDelivery = read('supabase/functions/send-push-notification/index.ts');
const scriptureNavigation = read('src/lib/scriptureNavigation.ts');
const appShell = read('src/components/AppShell.tsx');
const freezerLifecycle = read('supabase/migrations/20260818113000_freezer_lifecycle_and_rare_rewards.sql');

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
assert.ok(installHandler.includes('skipWaiting'), 'Service worker must activate the repaired release for the next launch.');
assert.ok(!serviceWorker.includes('clients.claim()'), 'Service worker must not replace the controller of an open session.');
assert.match(serviceWorker, /CACHE_VERSION = 'full-circle-v52'/);
assert.ok(!cadetDashboard.includes('setHeroIndex(0)'), 'Cadet background refresh must not reset the slideshow.');
assert.ok(!sentryApp.includes('setQuoteIndex(0)'), 'Sentry background refresh must not reset the slideshow.');
assert.match(frenchUi, /const lastAppliedText = new WeakMap<Text, string>\(\)/);
assert.match(frenchUi, /current !== lastApplied/);
assert.match(relicRecovery, /denarii_cost = 60000/);
assert.match(relicRecovery, /money_price_usd = NULL/);
assert.match(relicRecovery, /restore_thiefs_request_history\(v_use\.user_id, v_cutoff\)/);
assert.match(relicRecovery, /CREATE OR REPLACE FUNCTION public\.get_authoritative_streak/);
assert.match(sentryStreakRecovery, /marked\.attendance_marked_by = p_user_id/);
assert.ok(!sentryStreakRecovery.includes('JOIN public.tent_members cadet_member'), 'Historical sentry duty must not depend on current tent membership.');
assert.match(authoritativeRestitution, /historical\.streak_valid IS TRUE/);
assert.match(authoritativeRestitution, /restitution\.source = 'thiefs_request'/);
assert.match(authoritativeRestitution, /LIKE ANY \(ARRAY\['%thiefsrequest%', '%thievesrequest%'\]\)/);
assert.match(authoritativeRestitution, /v_complete := public\.streak_requirement_met\(p_user_id, v_check\)/);
assert.ok(!authoritativeRestitution.includes('JOIN public.tent_members cadet_member'), 'Restitution must preserve historical sentry duty after tent changes.');
assert.match(materializedRestitution, /ON CONFLICT \(user_id, record_date\) DO UPDATE/);
assert.match(materializedRestitution, /SET streak_valid = true/);
assert.match(materializedRestitution, /WHEN extract\(dow FROM v_check\) = 0 THEN v_complete/);
assert.match(materializedRestitution, /restoration\.source IN \('relic', 'redemption', 'thiefs_request'\)/);
assert.match(verifiedStreakBaseline, /coalesce\(snapshot\.current_streak, 0\) > 0/);
assert.match(verifiedStreakBaseline, /v_current := greatest\(v_current, v_baseline_current\)/);
assert.match(verifiedStreakBaseline, /v_longest := greatest\(v_longest, v_baseline_longest, v_current\)/);
assert.ok(!read('src/components/PanelImageBackdrop.tsx').includes('panel-image-mode-veil absolute inset-0'), 'Panel images must not stack a second full-card mode veil.');
assert.match(scriptureDeepLinks, /'verse_reference', v_verse_reference/);
assert.match(scriptureDeepLinks, /'narrative_id', v_narrative_id/);
assert.match(pushDelivery, /destinationParams\.set\("fc-verse"/);
assert.match(scriptureNavigation, /scrollIntoView|SCRIPTURE_TARGET_KEY/);
assert.match(appShell, /app-safe-header fixed left-0 right-0 top-0/);
assert.match(appShell, /style=\{\{ height: headerHeight \}\}/);
for (const messageTable of [
  'tent_messages',
  'direct_messages',
  'arena_room_messages',
  'quiz_waiting_messages',
  'daily_quote_comments',
  'daily_verse_comments',
]) {
  assert.match(messageMentions, new RegExp(`AFTER INSERT ON public\\.${messageTable}`));
}
assert.match(messageMentions, /'message_mention'/);
assert.match(messageMentions, /PERFORM public\.notify_user/);
assert.match(toolbarStats, /CREATE OR REPLACE FUNCTION public\.get_my_toolbar_stats\(\)/);
assert.match(read('supabase/migrations/20260816090000_versioned_toolbar_stats.sql'), /CREATE OR REPLACE FUNCTION public\.get_my_toolbar_stats_v2\(\)/);
assert.match(toolbarStats, /SECURITY DEFINER/);
assert.match(toolbarStats, /public\.get_user_denarii_total\(caller\.user_id\)/);
assert.match(toolbarStats, /public\.compute_strict_streak\(caller\.user_id\)/);
assert.ok(!toolbarStats.includes('get_marks_board_live'), 'Toolbar counters must not depend on a board RPC.');

for (const category of ['characters', 'books', 'themes']) {
  const bank = arenaGenerator.match(new RegExp(`${category}: \\[([\\s\\S]*?)\\]`))?.[1] || '';
  assert.equal((bank.match(/"[^"]+"/g) || []).length, 10, `${category} must expose ten Arena banks.`);
}
assert.match(arenaGenerator, /gameType === 'ludo' \? 120 : 19/);
assert.match(arenaGenerator, /isNearDuplicate\(candidate\.question/);

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
assert.doesNotMatch(campayWebhook, /ageMs >= 35_000/);
assert.match(campayWebhook, /Keep an unconfirmed transaction pending/);

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
  '20260818100000_active_answer_figs_and_payment_delivery.sql',
  '20260818113000_freezer_lifecycle_and_rare_rewards.sql',
]) {
  const migration = read(`supabase/migrations/${migrationName}`);
  assert.equal((migration.match(/\$\$/g) || []).length % 2, 0, `Unbalanced SQL function delimiter in ${migrationName}`);
}

for (const required of [
  "v_cost integer := 6000",
  "v_cost integer := 18000",
  "freezer.freezer_type = 'daily'",
  "freezer.freezer_type = 'weekly'",
  "v_deadline + interval '24 hours'",
  'pg_advisory_xact_lock',
  "p_context_type = 'arena'",
  "WHEN v_roll < v_threshold_thief THEN 'thieves-request'",
  'get_my_streak_protection_state',
]) {
  assert.ok(freezerLifecycle.includes(required), `Missing freezer/reward boundary: ${required}`);
}

const activeAnswerIntegrity = read('supabase/migrations/20260818100000_active_answer_figs_and_payment_delivery.sql');
for (const required of [
  'assisted_by_relic',
  'relic_payment_deliveries',
  'v_figs := 0',
  "v_score := 0",
  "payment.relic_slug = 'masters-reward'",
]) {
  assert.ok(activeAnswerIntegrity.includes(required), `Missing active-answer/payment boundary: ${required}`);
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
