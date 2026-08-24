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
const offlinePage = read('public/offline.html');
const supabaseConfig = read('supabase/config.toml');
const campayWebhook = read('supabase/functions/campay-webhook/index.ts');
const campayCheckout = read('supabase/functions/create-checkout-session/index.ts');
const campaySubscriptions = read('supabase/migrations/20260824110000_campay_subscriptions.sql');
const campayDemoSubscription = read('supabase/migrations/20260824113000_campay_demo_subscription_price.sql');
const subscriptionScreen = read('src/components/SubscriptionScreen.tsx');
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
const directMessageNotifications = read('supabase/migrations/20260818123000_direct_message_notifications.sql');
const pushDelivery = read('supabase/functions/send-push-notification/index.ts');
const scriptureNavigation = read('src/lib/scriptureNavigation.ts');
const appShell = read('src/components/AppShell.tsx');
const freezerLifecycle = read('supabase/migrations/20260818113000_freezer_lifecycle_and_rare_rewards.sql');
const quoteReactions = read('src/components/QuoteReactions.tsx');
const quoteQueries = read('src/lib/queries.ts');
const tentGroupChat = read('supabase/migrations/20260819100000_tent_group_chat.sql');
const quoteCommentReplies = read('supabase/migrations/20260819103000_quote_comment_replies.sql');
const scriptureInsightReactions = read('supabase/migrations/20260821160000_scripture_insight_reactions.sql');
const doveComponent = read('src/components/Dove.tsx');
const boardRow = read('src/components/BoardRow.tsx');
const cadetLeaderboard = read('src/screens/cadet/CadetLeaderboard.tsx');
const boardMovements = read('supabase/migrations/20260821210000_authoritative_board_movements.sql');
const statFirstBoardMovements = read('supabase/migrations/20260822100000_stat_first_board_movements.sql');
const saturdayQuizReminders = read('supabase/migrations/20260822110000_saturday_quiz_reminders.sql');
const weeklyQuizRelease = read('supabase/migrations/20260822120000_weekly_quiz_4pm_release.sql');
const externalQuestionMetadata = read('supabase/migrations/20260822130000_external_question_import_metadata.sql');
const quizLifecycle = read('supabase/migrations/20260822140000_quiz_lifecycle_startup_and_streak_repairs.sql');
const authoritativeStreakLifecycle = read('supabase/migrations/20260823100000_authoritative_streak_lifecycle.sql');
const verifiedStreakRollForward = read('supabase/migrations/20260823110000_roll_verified_streaks_forward.sql');
const persistentBoardMovements = read('supabase/migrations/20260823120000_persist_board_movements_all_day.sql');
const fcxExperienceRegistration = read('supabase/migrations/20260824100000_fcx_experience_registration.sql');
const instructorApp = read('src/screens/instructor/InstructorApp.tsx');
const cadetQuiz = read('src/screens/cadet/CadetQuiz.tsx');
const authContext = read('src/context/AuthContext.tsx');
const quoteAuthorStats = read('src/components/QuoteAuthorStats.tsx');

for (const required of [
  'CREATE TABLE IF NOT EXISTS public.fcx_events',
  'CREATE TABLE IF NOT EXISTS public.fcx_registrations',
  'capacity integer NOT NULL DEFAULT 30',
  'FOR UPDATE',
  'Only the instructor can add FCX registrations',
  'REVOKE INSERT, UPDATE, DELETE ON public.fcx_registrations FROM anon, authenticated',
]) {
  assert.ok(fcxExperienceRegistration.includes(required), `Missing FCX registration boundary: ${required}`);
}

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
  'relic_usage_log', 'arena_rooms', 'arena_participants', 'scripture_insight_reactions',
  'fcx_events', 'fcx_registrations',
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
assert.ok(serviceWorker.includes('self.clients.claim()'), 'The repaired worker must replace legacy phone controllers immediately.');
assert.ok(!installHandler.includes('cache.addAll'), 'Optional shell assets must not make service-worker installation all-or-nothing.');
assert.match(serviceWorker, /CACHE_VERSION = 'full-circle-v82'/);
assert.match(serviceWorker, /RECOVERY_MARKER = '82'/);
assert.match(serviceWorker, /client\.navigate\(target\.href\)/);
assert.match(serviceWorker, /FULL_CIRCLE_RECOVERY_READY/);
assert.ok(!serviceWorker.includes('networkFirstNavigation'), 'Online page navigation must not be replaced by an offline timeout.');
assert.ok(!serviceWorker.includes('controller.abort()'), 'The worker must not abort a slow phone navigation.');
assert.ok(!serviceWorker.includes("addEventListener('fetch'"), 'The notification worker must never intercept phone application requests.');
assert.ok(!offlinePage.includes('.unregister('), 'The fallback must not unregister the worker that is rescuing the phone.');
assert.match(offlinePage, /RECOVERY_VERSION = '82'/);
assert.ok(!offlinePage.includes('waitForCurrentController'), 'A delayed service-worker handoff must not trap an online phone.');
assert.match(offlinePage, /fetch\('\/index\.html\?fc-connectivity='/);
assert.match(offlinePage, /window\.location\.replace\('\/index\.html\?fc-recovered='/);
assert.match(saturdayQuizReminders, /extract\(isodow[\s\S]*= 6/);
assert.match(saturdayQuizReminders, /'weekly_quiz_reminder'[\s\S]*time '09:15'/);
assert.match(saturdayQuizReminders, /'15 8 \* \* 6'/);
assert.match(weeklyQuizRelease, /time '16:00'/);
assert.match(weeklyQuizRelease, /CREATE TABLE IF NOT EXISTS public\.weekly_quiz_result_releases/);
assert.match(weeklyQuizRelease, /REVOKE ALL ON TABLE public\.weekly_quiz_result_releases FROM PUBLIC, anon, authenticated/);
assert.match(weeklyQuizRelease, /CREATE OR REPLACE FUNCTION public\.release_due_weekly_quiz_results/);
assert.match(weeklyQuizRelease, /v_session\.quiz_type = 'saturday'[\s\S]*weekly_quiz_result_releases/);
assert.match(weeklyQuizRelease, /'\*\/5 15 \* \* 6'/);
assert.match(externalQuestionMetadata, /ADD COLUMN IF NOT EXISTS accepted_answers jsonb/);
assert.match(externalQuestionMetadata, /ADD COLUMN IF NOT EXISTS scripture_reference text/);
assert.match(externalQuestionMetadata, /public\.is_instructor\(auth\.uid\(\)\)/);
assert.match(externalQuestionMetadata, /jsonb_array_elements_text\(coalesce\(v_question\.accepted_answers/);
assert.match(externalQuestionMetadata, /REVOKE ALL ON FUNCTION public\.daily_game_answer_is_correct/);
assert.match(quizLifecycle, /CREATE OR REPLACE FUNCTION public\.get_my_app_bootstrap/);
assert.match(quizLifecycle, /CREATE OR REPLACE FUNCTION public\.launch_quiz_session/);
assert.match(quizLifecycle, /CREATE OR REPLACE FUNCTION public\.delete_quiz_session_cascade/);
assert.match(quizLifecycle, /v_session\.status = 'scheduled'/);
assert.match(quizLifecycle, /greatest\(25,[\s\S]*Vedette/);
assert.match(quizLifecycle, /Courage Webnjoh/);
assert.match(authoritativeStreakLifecycle, /CREATE OR REPLACE FUNCTION public\.streak_day_is_restored/);
assert.match(authoritativeStreakLifecycle, /CREATE OR REPLACE FUNCTION public\.streak_day_is_purchased/);
assert.match(authoritativeStreakLifecycle, /CREATE OR REPLACE FUNCTION public\.streak_day_is_protected/);
assert.match(authoritativeStreakLifecycle, /marked\.attendance_marked_by = p_user_id/);
assert.match(authoritativeStreakLifecycle, /p_record_date < date '2026-08-10'[\s\S]*historical\.streak_valid IS TRUE/);
assert.match(authoritativeStreakLifecycle, /v_credited := v_requirement_met OR v_restored OR v_purchased/);
assert.match(authoritativeStreakLifecycle, /CREATE OR REPLACE FUNCTION public\.use_simons_coin/);
assert.match(authoritativeStreakLifecycle, /Today is already earned\. Simon''s Coin was not used/);
assert.match(authoritativeStreakLifecycle, /Simon''s Coin added one streak day for today/);
assert.match(authoritativeStreakLifecycle, /ELSIF v_protected THEN[\s\S]*A freezer holds the number exactly where it was/);
assert.match(authoritativeStreakLifecycle, /A genuine miss resets the current chain[\s\S]*v_current := 0/);
assert.match(authoritativeStreakLifecycle, /THEN 27[\s\S]*THEN 26/);
assert.match(authoritativeStreakLifecycle, /Restored verified Courage Webnjoh 26-day streak/);
assert.match(authoritativeStreakLifecycle, /SELECT public\.refresh_all_streak_snapshots\(\)/);
assert.match(authoritativeStreakLifecycle, /full-circle-streak-snapshots/);
assert.match(verifiedStreakRollForward, /date '2026-08-22'/);
assert.match(verifiedStreakRollForward, /THEN 27[\s\S]*THEN 26/);
assert.match(verifiedStreakRollForward, /replay later evidence/);
assert.match(verifiedStreakRollForward, /refresh_user_streak_snapshot\(baseline\.user_id\)/);
assert.ok(
  !verifiedStreakRollForward.includes('verified_streak - CASE'),
  'Verified close-of-day totals must not subtract a later completed day.',
);
assert.match(quoteQueries, /current_streak: visibleStreak/);
assert.ok(!quoteQueries.includes('streak.current_streak === 0'), 'A canonical zero must not trigger a local streak reconstruction.');
assert.match(quoteQueries, /if \(!liveStats\) throw error/);
assert.ok(!quoteAuthorStats.includes('Math.max(feedStreak'), 'Quote streaks must use the canonical public value exactly.');
assert.match(authContext, /get_my_app_bootstrap/);
assert.match(cadetQuiz, /Update Answer/);
assert.ok(!cadetQuiz.includes('if (showFeedback) return;'), 'Saved quiz answers must remain editable until final submission.');
assert.match(cadetQuiz, /session\.status === 'scheduled'/);
assert.ok(!instructorApp.includes('Countdown (minutes)'), 'Quiz countdown must be derived from the programmed start time.');
assert.ok(!instructorApp.includes('Wait Time (min before quiz opens)'), 'Quiz builder must not expose a manual countdown setting.');
assert.match(instructorApp, /deleteQuizSession/);
assert.match(instructorApp, /destination="quiz"/);
assert.match(instructorApp, /destination="game"/);
assert.match(read('scripts/preserve-release-assets.cjs'), /path\.join\(dist, 'assets'\)/);
assert.match(doveComponent, /stableDoveArtwork = '\/icons\/fullcircle-dove-clean\.png'/);
assert.match(doveComponent, /fallbackLoaded/);
assert.match(boardRow, /<span>\{value\}<\/span>[\s\S]*?<ArrowUp/);
assert.match(cadetLeaderboard, /baseline_value/);
assert.match(cadetLeaderboard, /snapshot_date: today/);
assert.match(persistentBoardMovements, /ADD COLUMN IF NOT EXISTS day_movement/);
assert.match(persistentBoardMovements, /ELSE snapshot\.day_movement/);
assert.match(persistentBoardMovements, /day_record = snapshot\.day_record OR live\.is_new_record/);
assert.match(persistentBoardMovements, /timezone\('Africa\/Douala', now\(\)\)::date/);
assert.match(cadetLeaderboard, /get_competitive_board_movements/);
assert.match(cadetLeaderboard, /rowsFromBoardPayload/);
assert.match(boardMovements, /CREATE TABLE IF NOT EXISTS public\.challenge_board_daily_snapshots/);
assert.match(boardMovements, /row_data jsonb/);
assert.match(boardMovements, /WHEN row\.current_value > COALESCE\(prior\.current_value, saved\.opening_value\) THEN 1/);
assert.match(boardMovements, /WHEN row\.current_rank > COALESCE\(prior\.current_rank, saved\.opening_rank, row\.current_rank\) THEN -1/);
assert.match(boardMovements, /REVOKE ALL ON TABLE public\.challenge_board_daily_snapshots FROM PUBLIC, anon, authenticated/);
assert.match(statFirstBoardMovements, /WHEN ranked\.current_value > ranked\.previous_value THEN 1/);
assert.match(statFirstBoardMovements, /WHEN ranked\.current_value < ranked\.previous_value THEN -1/);
assert.match(statFirstBoardMovements, /WHEN ranked\.current_position < ranked\.previous_position THEN 1/);
assert.match(statFirstBoardMovements, /WHEN ranked\.current_position > ranked\.previous_position THEN -1/);
assert.match(statFirstBoardMovements, /entry\.created_at < v_midnight/);
assert.match(statFirstBoardMovements, /attempt\.completed_at < v_midnight/);
assert.match(instructorApp, /Rumor is the weekly Vallum/);
assert.match(instructorApp, /fetchMarksBoard\(\)/);
assert.match(scriptureInsightReactions, /reaction_type IN \('heart', 'lightbulb'\)/);
assert.match(scriptureInsightReactions, /v_user_id uuid := auth\.uid\(\)/);
assert.match(scriptureInsightReactions, /REVOKE ALL ON TABLE public\.scripture_insight_reactions FROM PUBLIC, anon, authenticated/);
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
assert.match(directMessageNotifications, /CREATE OR REPLACE FUNCTION public\.notify_direct_message_recipient/);
assert.match(directMessageNotifications, /AFTER INSERT ON public\.direct_messages/);
assert.match(directMessageNotifications, /'direct_message'/);
assert.match(quoteQueries, /\.from\('daily_quote_comments'\)/);
assert.match(quoteReactions, /previewLimit = 2/);
assert.match(quoteReactions, /previewComments = comments\.slice\(0, Math\.max\(0, previewLimit\)\)/);
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
assert.match(campayWebhook, /payment\.purchase_kind === "subscription"/);
assert.match(campayCheckout, /fetchSubscriptionProduct/);
assert.match(campayCheckout, /campayEnvironment === "DEV" \? "demo" : "live"/);
assert.match(campayCheckout, /quote_only === true/);
assert.match(campayCheckout, /displayedAmountXaf[\s\S]*?!== amountXaf/);
assert.match(campayDemoSubscription, /demo_amount_xaf integer NOT NULL DEFAULT 25/);
for (const required of [
  'subscription_payment_deliveries',
  'finalize_subscription_payment',
  "purchase_kind <> 'subscription'",
  'REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon, authenticated',
  'ON CONFLICT (payment_id) DO NOTHING',
]) {
  assert.ok(campaySubscriptions.includes(required), `Missing subscription payment boundary: ${required}`);
}
assert.match(subscriptionScreen, /MTN MoMo/);
assert.match(subscriptionScreen, /Orange Money/);
assert.doesNotMatch(subscriptionScreen, /checkout is not connected yet/);
assert.match(sentryApp, /DashboardHeroSlideshow/);
assert.match(sentryApp, /kind: 'custom'/);

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
  '20260819100000_tent_group_chat.sql',
  '20260819103000_quote_comment_replies.sql',
  '20260822110000_saturday_quiz_reminders.sql',
  '20260822120000_weekly_quiz_4pm_release.sql',
  '20260822130000_external_question_import_metadata.sql',
  '20260822140000_quiz_lifecycle_startup_and_streak_repairs.sql',
  '20260823120000_persist_board_movements_all_day.sql',
  '20260824100000_fcx_experience_registration.sql',
  '20260824110000_campay_subscriptions.sql',
  '20260824113000_campay_demo_subscription_price.sql',
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

for (const required of [
  'CREATE TABLE IF NOT EXISTS public.tent_group_messages',
  'CREATE POLICY tent_group_messages_select_members',
  'CREATE POLICY tent_group_messages_insert_members',
  'notify_tent_group_message_insert',
]) {
  assert.ok(tentGroupChat.includes(required), `Missing tent group chat boundary: ${required}`);
}

for (const required of [
  'parent_comment_id',
  'mentioned_user_ids',
  'Quote reply',
  'DROP FUNCTION IF EXISTS public.get_daily_quote_comments(uuid, date)',
]) {
  assert.ok(quoteCommentReplies.includes(required), `Missing quote reply boundary: ${required}`);
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
