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
const serviceWorkerRegistration = read('src/registerServiceWorker.ts');
const staleBundleRecovery = read('src/lib/staleBundleRecovery.ts');
const releaseCache = read('src/lib/releaseCache.ts');
const appIndex = read('index.html');
const hostingerHeaders = read('public/.htaccess');
const packageManifest = read('package.json');
const viteConfig = read('vite.config.ts');
const rootApp = read('src/App.tsx');
const cadetApp = read('src/screens/cadet/CadetApp.tsx');
const pagesWorkflow = read('.github/workflows/deploy-pages.yml');
const supabaseConfig = read('supabase/config.toml');
const campayWebhook = read('supabase/functions/campay-webhook/index.ts');
const campayCheckout = read('supabase/functions/create-checkout-session/index.ts');
const campaySubscriptions = read('supabase/migrations/20260824110000_campay_subscriptions.sql');
const campayDemoSubscription = read('supabase/migrations/20260824113000_campay_demo_subscription_price.sql');
const subscriptionAccess = read('supabase/migrations/20260824120000_enforce_subscription_feature_access.sql');
const subscriptionScreen = read('src/components/SubscriptionScreen.tsx');
const subscriptionAccessContext = read('src/context/SubscriptionAccessContext.tsx');
const tentMessenger = read('src/components/TentMessenger.tsx');
const cadetNarrative = read('src/screens/cadet/CadetNarrative.tsx');
const cadetSettings = read('src/screens/cadet/CadetSettings.tsx');
const calendarUtilities = read('src/lib/utils.ts');
const toolbarStats = read('supabase/migrations/20260814172000_authoritative_toolbar_stats.sql');
const cadetDashboard = read('src/screens/cadet/CadetDashboard.tsx');
const sentryApp = read('src/screens/sentry/SentryApp.tsx');
const arenaGenerator = read('supabase/functions/generate-arena-questions/index.ts');
const cadetArena = read('src/screens/cadet/CadetArena.tsx');
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
const vallumAvatarBadge = read('src/components/VallumAvatarBadge.tsx');
const freezerLifecycle = read('supabase/migrations/20260818113000_freezer_lifecycle_and_rare_rewards.sql');
const quoteReactions = read('src/components/QuoteReactions.tsx');
const awardReactions = read('src/components/AwardReactions.tsx');
const quoteQueries = read('src/lib/queries.ts');
const tentGroupChat = read('supabase/migrations/20260819100000_tent_group_chat.sql');
const quoteCommentReplies = read('supabase/migrations/20260819103000_quote_comment_replies.sql');
const scriptureInsightReactions = read('supabase/migrations/20260821160000_scripture_insight_reactions.sql');
const doveComponent = read('src/components/Dove.tsx');
const boardRow = read('src/components/BoardRow.tsx');
const cadetLeaderboard = read('src/screens/cadet/CadetLeaderboard.tsx');
const boardMovementResolver = read('src/lib/boardMovement.ts');
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
const fcxGuestPhotos = read('supabase/migrations/20260825120000_fcx_guest_photos.sql');
const fcxExperience = read('src/components/FcxExperience.tsx');
const profilePhotoEditor = read('src/components/ProfilePhotoEditor.tsx');
const atomicStreakSnapshots = read('supabase/migrations/20260824130000_courage_28_and_atomic_streak_snapshots.sql');
const accountBootstrapAndLiveActivity = read('supabase/migrations/20260825100000_account_bootstrap_and_live_activity.sql');
const accountAccessBootstrapRepair = read('supabase/migrations/20260826100000_account_access_bootstrap_repair.sql');
const repairedBoardMovements = read('supabase/migrations/20260825110000_repair_board_movement_visibility.sql');
const normalizedEconomy = read('supabase/migrations/20260826110000_normalize_full_circle_economy.sql');
const cumulativeStreakEconomy = read('supabase/migrations/20260826120000_cumulative_streak_achievement_marks.sql');
const correctedStreakAchievement = read('supabase/migrations/20260826123000_close_streak_achievement_loophole.sql');
const attendanceCorrection = read('supabase/migrations/20260827100000_preserve_attendance_corrections.sql');
const spadesStreakRestoration = read('supabase/migrations/20260827103000_restore_spades_streaks.sql');
const spadesStreakAdvancement = read('supabase/migrations/20260827104000_advance_restored_spades_streaks.sql');
const quizRespondersAndMonthlyWatch = read('supabase/migrations/20260829100000_quiz_responders_and_monthly_vallum_watch.sql');
const instructorApp = read('src/screens/instructor/InstructorApp.tsx');
const cadetQuiz = read('src/screens/cadet/CadetQuiz.tsx');
const quizResponders = read('src/components/QuizResponders.tsx');
const weeklyQuizRankings = read('src/components/WeeklyQuizRankings.tsx');
const authContext = read('src/context/AuthContext.tsx');
const authScreen = read('src/screens/AuthScreen.tsx');
const quoteAuthorStats = read('src/components/QuoteAuthorStats.tsx');
const pwaInstallPrompt = read('src/components/PWAInstallPrompt.tsx');
const sundayPublicReading = read('supabase/migrations/20260830120000_sunday_readings_public_conversations.sql');
const sundayBiblicalOrder = read('supabase/migrations/20260830123000_sunday_biblical_order_and_streak_ranking.sql');
const publicShareScreen = read('src/screens/PublicShareScreen.tsx');
const publicQuizResultClaim = read('src/components/PublicQuizResultClaim.tsx');
const panelImageTypes = read('src/lib/types.ts');
const panelImages = read('src/lib/panelImages.ts');
const panelImageBackdrop = read('src/components/PanelImageBackdrop.tsx');
const foundersGiftRestoration = read('supabase/migrations/20260830130000_first_fcx_founders_streak_gift.sql');
const foundersGiftPopup = read('src/components/FoundersGiftPopup.tsx');
const messagingContext = read('src/context/MessagingContext.tsx');
const readingDrafts = read('src/lib/readingDrafts.ts');
const batchedStreakHydration = read('supabase/migrations/20260831100000_batched_streak_hydration.sql');
const phStreakContinuity = read('supabase/migrations/20260902090000_preserve_ph_verified_streak_continuity.sql');
const doveQuestions = read('supabase/migrations/20260902100000_dove_questions.sql');
const resilientQuizAttempts = read('supabase/migrations/20260902110000_resilient_quiz_attempts.sql');
const doveQuestionApi = read('src/lib/doveQuestions.ts');
const doveQuestionManager = read('src/components/DoveQuestionManager.tsx');
const doveQuestionOverlay = read('src/components/DoveQuestionOverlay.tsx');
const appErrorBoundary = read('src/components/AppErrorBoundary.tsx');
const noahArkConstruction = read('supabase/migrations/20260901100000_story_mode_noah_ark_construction.sql');
const noahFloodBook = read('supabase/migrations/20260901150000_story_mode_flood_book_completion.sql');
const paymentAndPublicShareRecovery = read('supabase/migrations/20260903100000_payment_and_public_share_recovery.sql');
const hiddenChallengeHardening = read('supabase/migrations/20260903101000_hidden_challenge_timer_and_mine_relics.sql');
const quizDoveArrivals = read('supabase/migrations/20260903120000_dove_message_and_quiz_arrivals.sql');
const mineVerseTags = read('supabase/migrations/20260903143000_forty_second_mines_and_scripture_tags.sql');
const resultsReleaseRankingsAndWeeklyAwards = read('supabase/migrations/20260905110000_results_release_rankings_and_weekly_awards.sql');
const hiddenItemsMarket = read('src/components/HiddenItemsMarket.tsx');
const hiddenChallengeOverlay = read('src/components/HiddenChallengeOverlay.tsx');
const doveNotificationArrival = read('src/components/DoveNotificationArrival.tsx');
const notificationArrival = read('src/lib/notificationArrival.ts');
const appNavigation = read('src/lib/appNavigation.ts');

for (const required of [
  'CREATE TABLE IF NOT EXISTS public.story_mode_world_builds',
  'CREATE TABLE IF NOT EXISTS public.story_mode_world_build_stages',
  'CREATE TABLE IF NOT EXISTS public.story_mode_user_build_progress',
  'CREATE TABLE IF NOT EXISTS public.story_mode_attempt_build_progress',
  'ALTER TABLE public.story_mode_attempt_build_progress ENABLE ROW LEVEL SECURITY',
  'FROM PUBLIC, anon, authenticated',
  'Story Mode construction stages cannot be skipped or duplicated',
  'Every mandatory construction milestone must be settled before level completion',
  "'denarii_earned', 0",
]) {
  assert.ok(noahArkConstruction.includes(required), `Missing Noah/Ark authority boundary: ${required}`);
}
assert.doesNotMatch(noahArkConstruction, /story_mode_marks|INSERT INTO public\.[a-z_]*marks/);
for (const externalSystem of ['game_attempts', 'arena_rooms', 'denarii_ledger_entries', 'daily_game_runs']) {
  assert.doesNotMatch(noahArkConstruction, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${externalSystem}`));
}

for (const required of [
  'CREATE TABLE IF NOT EXISTS public.story_mode_environment_sequences',
  'CREATE TABLE IF NOT EXISTS public.story_mode_environment_stages',
  'CREATE TABLE IF NOT EXISTS public.story_mode_attempt_environment_progress',
  'CREATE TABLE IF NOT EXISTS public.story_mode_book_completions',
  'ALTER TABLE public.story_mode_attempt_environment_progress ENABLE ROW LEVEL SECURITY',
  'FROM PUBLIC, anon, authenticated',
  'Story Mode environment stages cannot be skipped or duplicated',
  'Every mandatory Story Mode environment milestone must be settled before level completion',
  'Book I cannot complete before the covenant and rainbow sequence',
  'get_my_story_mode_environment_state',
  'get_my_story_mode_book_completion',
]) {
  assert.ok(noahFloodBook.includes(required), `Missing Flood/Book I authority boundary: ${required}`);
}
assert.doesNotMatch(noahFloodBook, /story_mode_marks|INSERT INTO public\.[a-z_]*marks/);
for (const externalSystem of ['game_attempts', 'arena_rooms', 'denarii_ledger_entries', 'daily_game_runs']) {
  assert.doesNotMatch(noahFloodBook, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${externalSystem}`));
}

for (const required of [
  'CREATE OR REPLACE FUNCTION public.ensure_sunday_highlight_reading',
  "'Sunday Scripture Highlights'",
  "'auto_sunday_highlights', true",
  "'5 23 * * 6'",
  'CREATE OR REPLACE FUNCTION public.get_previous_muralis',
  'CREATE OR REPLACE FUNCTION public.get_shared_daily_reading_v2',
  'CREATE TABLE IF NOT EXISTS public.public_scripture_insight_reactions',
  'REVOKE ALL ON TABLE public.public_scripture_insight_reactions FROM PUBLIC, anon, authenticated',
  'CREATE OR REPLACE FUNCTION public.toggle_public_scripture_insight_reaction',
]) {
  assert.ok(sundayPublicReading.includes(required), `Missing Sunday/public-reading boundary: ${required}`);
}
assert.match(quoteQueries, /ensure_sunday_highlight_reading/);
assert.match(sundayPublicReading, /item\.ordinality::text \|\| '\. ' \|\| \(item\.value->>'text'\)/);
assert.match(fcxExperience, /fetchPreviousMuralis/);
assert.match(publicShareScreen, /function SharedReadingView/);
assert.match(publicShareScreen, /toggleSharedInsightReaction/);
assert.match(publicShareScreen, /insight\.comments\.map/);
assert.match(publicShareScreen, /Join Full Circle to share an insight, comment, or reply/);

for (const required of [
  'CREATE OR REPLACE FUNCTION public.bible_reference_sort_key',
  'ORDER BY public.bible_reference_sort_key(reference)',
  'LIMIT 10',
  "'source_narrative_id', item.value->>'narrative_id'",
  "scripture_reference = 'Sunday Scripture Highlights'",
  "reflection_prompts = '[]'::jsonb",
  'ORDER BY\n    coalesce(nullif(item.value->>\'engagement_score\'',
]) {
  assert.ok(sundayBiblicalOrder.includes(required), `Missing Sunday biblical-order boundary: ${required}`);
}
assert.match(cadetNarrative, /isSundayRest \? 'Verse of the Week' : 'Verse of the Day'/);
assert.match(cadetNarrative, /sourceNarrativeId: verse\.source_narrative_id \|\| passage\.source_narrative_id/);
assert.match(cadetNarrative, /item\.narrative_id === sourceNarrativeId/);
assert.match(cadetNarrative, /closedSundayInsights/);
assert.match(cadetNarrative, /setClosedSundayInsights\(\(current\) => current\.filter/);
assert.doesNotMatch(cadetNarrative, /const userExpanded = isSundayRest \|\|/);
assert.doesNotMatch(cadetNarrative, /fetchWeeklyVerseHighlights|setArchiveDate\(highlight\.narrative_date/);
assert.match(publicShareScreen, /isSundayReading \? 'Verse of the Week' : 'Verse of the Day'/);
assert.match(quoteReactions, /size="xs"/);
assert.match(awardReactions, /size="xs"/);
assert.match(tentMessenger, /size === 'xs' \? 'h-4 w-4 text-\[7px\]'/);
assert.match(cadetNarrative, /<MessageAvatar[\s\S]*?profile=\{messageProfile\(item\.user_id/);
assert.match(cadetNarrative, /profile=\{messageProfile\(comment\.user_id/);
assert.match(cadetNarrative, /profile=\{messageProfile\(actor\.user_id/);
assert.match(cadetNarrative, /const participants = insightParticipants\(userInsights\)/);
assert.match(cadetNarrative, /!userExpanded && participants\.length > 0/);
assert.match(cadetNarrative, /reader insight participant/);
assert.match(publicShareScreen, /relative inline-flex h-4 w-4[\s\S]*?overflow-hidden rounded-full/);
assert.match(instructorApp, /panel_image_honors', label: 'Monthly Honors'/);
assert.match(cadetDashboard, /'welcome', 'fcx', 'honors', 'verse'/);
assert.match(sentryApp, /'welcome', 'fcx', 'honors', 'verse'/);
assert.match(cadetSettings, /fetchUserLiveStats\(profile\.id\)/);
assert.match(cadetSettings, /label: 'Figs', value: stats\.figs\.toLocaleString\(\)/);
assert.match(cadetSettings, /label: 'Rhudes', value: stats\.rhudes\.toLocaleString\(\)/);
assert.match(quoteQueries, /\.sort\(\(left, right\) => \(/);
assert.match(quoteQueries, /Number\(right\.current_streak\)[\s\S]*Number\(left\.current_streak\)/);
assert.match(quoteQueries, /\.map\(\(row, index\) => \(\{ \.\.\.row, rank: index \+ 1 \}\)\)/);

for (const required of [
  'CREATE OR REPLACE FUNCTION public.get_quiz_responders',
  "attempt.status IN ('submitted', 'timed_out')",
  'FROM public.question_responses response',
  'REVOKE ALL ON FUNCTION public.get_quiz_responders(uuid) FROM PUBLIC, anon',
  'CREATE OR REPLACE FUNCTION public.get_monthly_vallum_watch',
  "assignment.role = 'instructor'",
  'punctual_actions',
  'insights_written',
  'comments_written',
  'reactions_given',
]) {
  assert.ok(quizRespondersAndMonthlyWatch.includes(required), `Missing quiz/monthly-watch boundary: ${required}`);
}
assert.doesNotMatch(quizRespondersAndMonthlyWatch, /RETURNS TABLE[\s\S]{0,500}(question_payload|correct_answer|response\.answer|talents_scored|score)/i);
assert.match(quizResponders, /fetchQuizResponders/);
assert.match(quizResponders, /Already answered/);
assert.match(quizResponders, /table: 'quiz_attempts'/);
assert.match(cadetDashboard, /announcement_type === 'weekly_quiz_reminder'[\s\S]*<QuizResponders/);
assert.match(cadetQuiz, /const responderPanel = <QuizResponders sessionId=\{session\.id\}/);
assert.match(instructorApp, /title: 'Bethel Stone', description: 'Overall Best Tent of the Month'/);
assert.match(instructorApp, /title: 'Temple Mount', description: 'Overall Best Tent of the Year'/);
assert.match(instructorApp, /Monthly Award Watches/);
assert.match(instructorApp, /Vallum watches Marks together with punctual attendance and meditation, scripture insights, comments, and reactions/);

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
assert.match(fcxExperience, /const FCX_START_HOUR = 12/);
assert.match(fcxExperience, /getAppDateTimeMs\(countdownDate, FCX_START_HOUR\)/);
assert.match(fcxExperience, /fullcircle-dove-clean\.png/);
assert.match(fcxExperience, /fullcircle-dove-clean\.png[\s\S]*\{displayTitle\}[\s\S]*text-\[#ffd400\][\s\S]*\(FCX\)/);
assert.doesNotMatch(fcxExperience, /<h2[^>]*>\{visibleExperience\.title\}<\/h2>/);
assert.match(fcxExperience, /min-w-8 whitespace-nowrap text-center text-base font-black tabular-nums/);
assert.match(profilePhotoEditor, /createPortal\(dialog, document\.body\)/);
assert.match(profilePhotoEditor, /type="range"[\s\S]*aria-label="Profile photo zoom"/);
assert.match(profilePhotoEditor, /context\.drawImage\(/);
assert.match(profilePhotoEditor, /await uploadAvatar\(profile\.id, file\)/);
assert.match(profilePhotoEditor, /fetch\(profile\.avatar_url, \{ cache: 'no-store' \}\)/);
assert.match(profilePhotoEditor, /Crop and adjust current profile photo/);
assert.match(fcxExperience, /uploadFcxGuestAvatar/);
assert.match(fcxExperience, /Crop participant photo/);
for (const required of [
  'ADD COLUMN IF NOT EXISTS guest_avatar_url text',
  "'avatar_url', COALESCE(profile.avatar_url, entry.guest_avatar_url)",
  'p_guest_avatar_url text DEFAULT NULL',
  'Only the instructor can add FCX registrations',
]) {
  assert.ok(fcxGuestPhotos.includes(required), `Missing FCX guest-photo boundary: ${required}`);
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
  'denarii_achievement_entries', 'full_circle_economy_rules',
  'streak_achievement_days', 'streak_achievement_baselines',
  'public_scripture_insight_reactions',
  'story_mode_user_build_progress', 'story_mode_attempt_build_progress',
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
assert.match(serviceWorker, /CACHE_VERSION = 'full-circle-v108'/);
assert.match(serviceWorker, /RECOVERY_MARKER = '108'/);
assert.match(serviceWorker, /client\.navigate\(target\.href\)/);
assert.match(serviceWorker, /FULL_CIRCLE_RECOVERY_READY/);
assert.ok(!serviceWorker.includes('networkFirstNavigation'), 'Online page navigation must not be replaced by an offline timeout.');
assert.ok(!serviceWorker.includes('controller.abort()'), 'The worker must not abort a slow phone navigation.');
assert.ok(!serviceWorker.includes("addEventListener('fetch'"), 'The notification worker must never intercept phone application requests.');
assert.ok(!offlinePage.includes('.unregister('), 'The fallback must not unregister the worker that is rescuing the phone.');
assert.match(offlinePage, /RECOVERY_VERSION = '106'/);
assert.ok(!offlinePage.includes('waitForCurrentController'), 'A delayed service-worker handoff must not trap an online phone.');
assert.match(offlinePage, /fetch\(new URL\('index\.html\?fc-connectivity=/);
assert.match(offlinePage, /window\.location\.replace\(new URL\('index\.html\?fc-recovered=/);
assert.match(serviceWorkerRegistration, /register\(`\$\{import\.meta\.env\.BASE_URL\}sw\.js\?v=106`/);
assert.match(staleBundleRecovery, /set\('fc-release', '106'\)/);
assert.match(staleBundleRecovery, /lastRecoveryInMemory/);
assert.match(releaseCache, /2026-09-05-v108/);
assert.match(releaseCache, /mobile privacy mode blocks storage/);
assert.match(appIndex, /%BASE_URL%manifest\.webmanifest\?v=106/);
assert.match(appIndex, /register\('%BASE_URL%sw\.js\?v=106'/);
assert.match(appIndex, /__fullCircleBootWatchdog/);
assert.match(appIndex, /__repairFullCircleBoot/);
assert.match(appIndex, /navigator\.serviceWorker\.getRegistrations/);
assert.match(appIndex, /registration\.unregister\(\)/);
assert.match(appIndex, /searchParams\.set\(marker, release\)/);
assert.match(read('public/manifest.webmanifest'), /"start_url": "\.\/\?fc-launch=106"/);
assert.match(viteConfig, /target: 'es2017'/);
assert.match(appIndex, /Array\.prototype\.flatMap/);
assert.match(appIndex, /Object\.fromEntries/);
assert.match(appIndex, /String\.prototype\.matchAll/);
assert.match(appIndex, /Promise\.allSettled/);
assert.match(authContext, /function storeRoleHint/);
assert.ok(!pwaInstallPrompt.includes('DISMISSAL_WINDOW_MS'), 'Install access must not disappear for days after dismissal.');
assert.match(pwaInstallPrompt, /Install Full Circle on this device/);
assert.match(pwaInstallPrompt, /Install app[\s\S]*Add to Home Screen/);
assert.match(pwaInstallPrompt, /if \(!isStandalone\(\)\) showSoon\(\)/);
assert.match(appIndex, /rel="canonical" href="https:\/\/fullcircle\.partnertai\.com\/"/);
assert.match(appIndex, /hostname\.toLowerCase\(\) === 'www\.fullcircle\.partnertai\.com'/);
assert.match(appIndex, /canonicalUrl\.hostname = 'fullcircle\.partnertai\.com'/);
assert.match(hostingerHeaders, /\^www\\\.fullcircle\\\.partnertai\\\.com\$/);
assert.match(hostingerHeaders, /https:\/\/fullcircle\.partnertai\.com%\{REQUEST_URI\}/);
assert.ok(
  hostingerHeaders.lastIndexOf('^(index\\.html|sw\\.js|manifest\\.webmanifest|offline\\.html)$')
    > hostingerHeaders.indexOf('^(?!sw\\.js$).*\\.(js|css)$'),
  'Hostinger must override immutable JS caching for the service worker.',
);
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
for (const required of [
  'CREATE OR REPLACE FUNCTION public.get_my_quiz_runtime_state',
  "'server_now', v_server_now",
  'CREATE OR REPLACE FUNCTION public.prevent_early_quiz_timeout',
  'CREATE TRIGGER trg_prevent_early_quiz_timeout',
  'Quiz time is still running. Your attempt remains open.',
  'Backgrounding the app does not forfeit a quiz attempt.',
  'CREATE TEMP TABLE quiz_attempts_to_resume',
  'CREATE TEMP TABLE quiz_false_forfeit_recovery',
  'public.release_due_weekly_quiz_results()',
  'public.refresh_user_streak_snapshot(recovered.user_id)',
]) {
  assert.ok(resilientQuizAttempts.includes(required), `Missing resilient quiz boundary: ${required}`);
}
for (const required of [
  'fetchMyQuizRuntimeState',
  'serverClockOffsetMs',
  'verifyQuizDeadline',
  'withQuizNetworkRetry',
  'full-circle-quiz-draft:',
  "document.addEventListener('visibilitychange', reconcile)",
  'Saved answers remain safe if the app sleeps or reconnects',
]) {
  assert.ok(cadetQuiz.includes(required), `Missing resilient quiz client behavior: ${required}`);
}
assert.doesNotMatch(cadetQuiz, /forfeitQuizAttempt|forfeitTimerRef|8_000|8-second background/);
assert.match(appErrorBoundary, /window\.addEventListener\('online', this\.retryAfterResume\)/);
assert.match(appErrorBoundary, /document\.addEventListener\('visibilitychange', this\.retryAfterResume\)/);
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
for (const required of [
  'v_manual_baseline_date',
  'v_snapshot_baseline_date',
  'snapshot.snapshot_date < v_today',
  'snapshot.snapshot_date > v_manual_baseline_date',
  'ORDER BY snapshot.snapshot_date DESC',
  "date '2026-09-01'",
  "= 'ph'",
  "attendance_status = 'present'",
  'Restored PH continuity after verified 1 September weekday completion',
  'public.refresh_user_streak_snapshot(v_ph_user_id)',
]) {
  assert.ok(phStreakContinuity.includes(required), `Missing PH streak continuity boundary: ${required}`);
}
for (const required of [
  'CREATE TABLE IF NOT EXISTS public.dove_questions',
  'CREATE TABLE IF NOT EXISTS public.dove_question_targets',
  'CREATE TABLE IF NOT EXISTS public.dove_question_answers',
  'CREATE TABLE IF NOT EXISTS public.dove_question_participants',
  'ALTER TABLE public.dove_question_answers ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE public.dove_question_answers FROM PUBLIC, anon, authenticated',
  'CREATE OR REPLACE FUNCTION public.publish_dove_question',
  'CREATE OR REPLACE FUNCTION public.get_pending_dove_question',
  'CREATE OR REPLACE FUNCTION public.submit_dove_question_answer',
  'CREATE OR REPLACE FUNCTION public.dismiss_dove_question',
  'CREATE OR REPLACE FUNCTION public.close_dove_question',
  'FOR UPDATE',
  'pg_advisory_xact_lock',
  "'dove_question_cost'",
  "'dove_question_reward'",
  'uq_dove_question_ledger_settlement',
  "v_question.delivery_mode = 'required'",
  'A mandatory question must never lock a low-balance user out forever',
  "notification_type = 'dove_question'",
  "'dove_question_participants'",
]) {
  assert.ok(doveQuestions.includes(required), `Missing Dove Question authority boundary: ${required}`);
}
const pendingDoveQuestionFunction = doveQuestions.match(/CREATE OR REPLACE FUNCTION public\.get_pending_dove_question\(\)[\s\S]*?(?=CREATE OR REPLACE FUNCTION public\.get_dove_question_participants)/)?.[0] || '';
assert.ok(pendingDoveQuestionFunction, 'Pending Dove Question RPC could not be inspected.');
assert.doesNotMatch(pendingDoveQuestionFunction, /'correct_answer'/, 'Pending users must not receive the correct answer.');
for (const required of [
  'publishDoveQuestion',
  'fetchPendingDoveQuestion',
  'submitDoveQuestionAnswer',
  'dismissDoveQuestion',
  'closeDoveQuestion',
]) {
  assert.ok(doveQuestionApi.includes(required), `Missing typed Dove Question operation: ${required}`);
}
for (const required of [
  'Send a Dove Question',
  'Send with the Dove',
  "setDeliveryMode('optional')",
  "setDeliveryMode('required')",
  'sound-assets/dove-questions/',
  'ParticipantStack',
  'fetchInstructorDoveQuestionParticipants',
]) {
  assert.ok(doveQuestionManager.includes(required), `Missing instructor Dove Question behavior: ${required}`);
}
for (const required of [
  'createPortal',
  'fetchPendingDoveQuestion',
  'submitDoveQuestionAnswer',
  'dove_question_targets',
  'dove_question_participants',
  'Answer to continue',
  'z-[2147483600]',
  'isSoundscapeEnabled',
  'audio.loop = true',
]) {
  assert.ok(doveQuestionOverlay.includes(required), `Missing global Dove Question behavior: ${required}`);
}
assert.match(pushDelivery, /"challenge", "dove_question", "mine", "quiz", "quiz_release", "weekly_quiz_reminder"/);
assert.match(rootApp, /DoveQuestionOverlay/);
assert.match(instructorApp, /DoveQuestionManager/);
for (const required of [
  'streakboard_one_user_per_day_idx',
  'ON CONFLICT (snapshot_date, user_id) DO UPDATE',
  "date '2026-08-24'",
  'current_streak = 28',
  'Verified Courage Webnjoh at 28 through 2026-08-24',
  'SELECT public.refresh_all_streak_snapshots()',
  "'7 * * * *'",
]) {
  assert.ok(atomicStreakSnapshots.includes(required), `Missing atomic streak repair: ${required}`);
}
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
const signInHandler = authContext.match(/const signIn = useCallback\([\s\S]*?const signUp = useCallback/)?.[0] || '';
assert.ok(!signInHandler.includes("supabase.auth.signOut"), 'Sign-in must replace retained sessions without a SIGNED_OUT race.');
assert.match(authContext, /if \(!sess && authOperationRef\.current\) return/);
assert.match(authContext, /if \(sess && authOperationRef\.current && event !== 'TOKEN_REFRESHED'\) return/);
assert.match(authContext, /Account creation',/);
assert.match(authContext, /Account setup',/);
assert.match(authContext, /Primary account setup failed; trying profile bootstrap/);
assert.match(authContext, /profileRef\.current\?\.id === userId/);
assert.match(authContext, /supabase\.auth\.resend\(\{ type: 'signup', email: normalizedEmail \}\)/);
assert.match(rootApp, /<AuthScreen[\s\S]*initialMode="signin"/);
assert.match(authScreen, /initialMode = 'signin'/);
assert.match(authScreen, /<form[\s\S]*noValidate/);
assert.match(authScreen, /password\.length < 6/);
assert.match(authScreen, /signupNotice[\s\S]*setMode\('signin'\)[\s\S]*setConfirmPassword\(''\)/);
assert.match(authScreen, /role="alert" aria-live="assertive"/);
assert.match(readingDrafts, /full-circle-reading-draft-v1/);
assert.match(cadetNarrative, /readReadingDraft\(profile\.id, activeDate\)/);
assert.match(cadetNarrative, /writeReadingDraft\(profile\.id, activeDate, draftSnapshotRef\.current\)/);
assert.match(cadetNarrative, /document\.addEventListener\('visibilitychange', persistWhenHidden\)/);
assert.doesNotMatch(cadetNarrative, /drafts\[item\.verse_reference\] = item\.body/);
assert.match(cadetQuiz, /Update Answer/);
assert.ok(!cadetQuiz.includes('if (showFeedback) return;'), 'Saved quiz answers must remain editable until final submission.');
assert.match(cadetQuiz, /session\.status === 'scheduled'/);
assert.ok(!instructorApp.includes('Countdown (minutes)'), 'Quiz countdown must be derived from the programmed start time.');
assert.ok(!instructorApp.includes('Wait Time (min before quiz opens)'), 'Quiz builder must not expose a manual countdown setting.');
assert.match(instructorApp, /deleteQuizSession/);
assert.match(instructorApp, /destination="quiz"/);
assert.match(instructorApp, /destination="game"/);
assert.ok(!packageManifest.includes('preserve-release-assets'), 'Builds must not accumulate obsolete release chunks.');
assert.match(viteConfig, /inlineDynamicImports:\s*true/);
assert.ok(!rootApp.includes('lazy('), 'Role applications must ship in the executable release.');
assert.ok(!cadetApp.includes('lazy('), 'Cadet workspaces must not depend on later Hostinger chunk uploads.');
assert.match(pagesWorkflow, /cp dist\/index\.html dist\/404\.html/);
assert.ok(!pagesWorkflow.includes('npm ci'), 'The emergency mirror must publish the verified build without rebuilding it.');
assert.match(pagesWorkflow, /actions\/deploy-pages@v4/);
assert.match(doveComponent, /stableDoveArtwork = publicAsset\('icons\/fullcircle-dove-clean\.png'\)/);
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
assert.match(cadetLeaderboard, /resolveBoardMovement/);
assert.match(cadetLeaderboard, /useState<BoardTab>\('streak'\)/);
assert.match(cadetLeaderboard, /Streak board recovery/);
assert.match(cadetLeaderboard, /streakRowsWithHistory\.length === 0/);
assert.match(boardMovementResolver, /if \(current > previous\) return 1/);
assert.match(boardMovementResolver, /if \(rank > priorRank\) return -1/);
assert.match(boardRow, /data-board-movement="up"/);
assert.match(boardRow, /data-board-movement="down"/);
assert.match(repairedBoardMovements, /FOR v_live IN/);
assert.match(repairedBoardMovements, /WHEN v_live\.current_value > v_live\.previous_value THEN 1/);
assert.match(repairedBoardMovements, /ELSE snapshot\.day_movement/);
assert.match(repairedBoardMovements, /timezone\('Africa\/Douala', now\(\)\)::date/);
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
assert.ok(!cadetApp.includes('fetchLedgerTotal'), 'Cadet toolbar refresh must not duplicate the reliable balance request.');
assert.ok(!cadetApp.includes('fetchStrictStreak'), 'Cadet toolbar refresh must not duplicate the reliable streak request.');
assert.match(cadetApp, /toolbarRequestRef/);
assert.match(cadetApp, /notificationRefreshQueuedRef/);
assert.match(cadetDashboard, /if \(narr\.status === 'fulfilled'\) setNarrative\(narr\.value\)/);
assert.ok(
  !cadetDashboard.includes("setNarrative(narr.status === 'fulfilled' ? narr.value : null)"),
  'A transient dashboard request failure must not erase confirmed content.',
);
assert.match(sentryApp, /fetchPublicStreakDetails\(memberIds\)/);
assert.ok(!sentryApp.includes('Promise.all(memberIds.map'), 'Sentry startup must batch cadet streak reads.');
assert.match(batchedStreakHydration, /CREATE OR REPLACE FUNCTION public\.get_public_streak_details/);
assert.match(batchedStreakHydration, /LEFT JOIN LATERAL public\.get_authoritative_streak/);
assert.match(batchedStreakHydration, /REVOKE ALL ON FUNCTION public\.get_public_streak_details\(uuid\[\]\) FROM PUBLIC, anon/);
assert.match(batchedStreakHydration, /GRANT EXECUTE ON FUNCTION public\.get_public_streak_details\(uuid\[\]\)[\s\S]*authenticated, service_role/);
assert.match(sentryApp, /scheduleMemberRefresh/);
assert.match(quoteQueries, /bootstrapDailyRemindersInBackground\(\)/);
assert.ok(
  !quoteQueries.includes("try { await supabase.rpc('ensure_daily_reminders')"),
  'Reading announcements must not wait for reminder maintenance.',
);
assert.match(messagingContext, /if \(error\) return/);
assert.match(messagingContext, /window\.addEventListener\('online', refreshWhenVisible\)/);
assert.match(instructorApp, /if \(t\.status === 'fulfilled'\) setTents\(t\.value\)/);
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

assert.match(arenaGenerator, /\? 120 : 19/);
assert.match(arenaGenerator, /get_arena_quiz_question_pool/);
assert.match(arenaGenerator, /previous Weekly or Fortune quizzes/);
assert.doesNotMatch(arenaGenerator, /OPENAI_API_KEY|chat\/completions|FALLBACK_FACTS|ARENA_BANKS/);
const arenaQuizArchive = read('supabase/migrations/20260904120000_arena_uses_prior_quiz_questions.sql');
assert.match(arenaQuizArchive, /session\.quiz_type IN \('saturday', 'fortune'\)/);
assert.match(arenaQuizArchive, /session\.live_closes_at < now\(\)/);
assert.match(arenaQuizArchive, /REVOKE ALL ON FUNCTION public\.get_arena_quiz_question_pool\(integer\) FROM PUBLIC, anon, authenticated/);

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
for (const required of [
  'CREATE OR REPLACE FUNCTION public.has_current_subscription_access',
  "subscription.status = 'trial'",
  'subscription.trial_ends_at > now()',
  "subscription.status = 'active'",
  'subscription.current_period_end > now()',
  'SUBSCRIPTION_REQUIRED',
  'enforce_subscription_daily_records',
  'enforce_subscription_daily_game_runs',
  'enforce_subscription_game_attempts',
  'enforce_subscription_quiz_attempts',
  'enforce_subscription_denarii_ledger',
  'enforce_subscription_scripture_insights',
  'enforce_subscription_tent_messages',
  'enforce_subscription_tent_group_messages',
  'enforce_subscription_direct_messages',
  "notification_type NOT IN ('message', 'direct_message', 'message_mention')",
  'public.has_current_subscription_access(auth.uid())',
]) {
  assert.ok(subscriptionAccess.includes(required), `Missing expired-subscription boundary: ${required}`);
}
assert.match(subscriptionAccessContext, /trial_ends_at[\s\S]*getTime\(\) <= nowMs/);
assert.match(subscriptionAccessContext, /current_period_end[\s\S]*getTime\(\) <= nowMs/);
assert.match(tentMessenger, /requireSubscription\(\)/);
assert.match(tentMessenger, /if \(!hasAccess\) return null/);
assert.match(cadetNarrative, /Subscribe to write an insight/);
assert.match(cadetNarrative, /if \(!requireSubscription\(\)\) return/);
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
  '20260824120000_enforce_subscription_feature_access.sql',
  '20260824130000_courage_28_and_atomic_streak_snapshots.sql',
  '20260825100000_account_bootstrap_and_live_activity.sql',
  '20260825110000_repair_board_movement_visibility.sql',
  '20260825120000_fcx_guest_photos.sql',
  '20260826100000_account_access_bootstrap_repair.sql',
  '20260827100000_preserve_attendance_corrections.sql',
]) {
  const migration = read(`supabase/migrations/${migrationName}`);
  assert.equal((migration.match(/\$\$/g) || []).length % 2, 0, `Unbalanced SQL function delimiter in ${migrationName}`);
}

for (const required of [
  'INSERT INTO public.profiles',
  "VALUES (v_user_id, 'cadet', 'active'",
  "publication_table.pubname = 'supabase_realtime'",
  "'daily_records'",
  "'denarii_ledger_entries'",
  "'scripture_verse_insights'",
]) {
  assert.ok(accountBootstrapAndLiveActivity.includes(required), `Missing account/live-activity repair: ${required}`);
}

assert.match(rootApp, /Restoring your account/);
assert.match(rootApp, /DenariiGainAnimation/);
assert.match(authContext, /setSession\(recoveredSession\)/);
for (const required of [
  'ON CONFLICT (id) DO UPDATE',
  "assignment.status IN ('active', 'approved')",
  'NOT EXISTS (',
  'JOIN auth.users auth_user ON auth_user.id = profile.id',
  'GRANT EXECUTE ON FUNCTION public.get_my_app_bootstrap() TO authenticated',
]) {
  assert.ok(accountAccessBootstrapRepair.includes(required), `Missing account-access bootstrap repair: ${required}`);
}

for (const required of [
  "VALUES ('canonical', 1, 6000, 1, 6, 300, now())",
  'CREATE OR REPLACE FUNCTION public.calculate_normalized_marks',
  'CREATE TABLE IF NOT EXISTS public.denarii_achievement_entries',
  'CREATE UNIQUE INDEX IF NOT EXISTS denarii_achievement_reference_uidx',
  'ALTER TABLE public.denarii_achievement_entries ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE public.denarii_achievement_entries FROM PUBLIC, anon, authenticated',
  'CREATE TRIGGER denarii_achievement_capture',
  'public.get_qualifying_denarii_total(active.user_id, NULL)',
  'LEFT JOIN LATERAL public.compute_strict_streak(active.user_id)',
  'public.calculate_normalized_marks(',
  'CREATE TABLE IF NOT EXISTS public.normalized_economy_board_daily_snapshots',
  "snapshot.formula_version = 'phase1-v1'",
]) {
  assert.ok(normalizedEconomy.includes(required), `Missing normalized-economy boundary: ${required}`);
}
assert.doesNotMatch(
  normalizedEconomy.match(/CREATE OR REPLACE FUNCTION public\.get_marks_board_live\(\)[\s\S]*?\$\$;/)?.[0] || '',
  /wallet_denarii\s*\+|total_denarii[^\n]*\+|rhudes[^\n]*\*\s*5000|total_figs[^\n]*\*\s*100/,
);
assert.match(normalizedEconomy, /REVOKE ALL ON FUNCTION public\.calculate_normalized_marks[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(normalizedEconomy, /GRANT EXECUTE ON FUNCTION public\.get_marks_board_live\(\) TO authenticated, service_role/);

for (const required of [
  'CREATE TABLE IF NOT EXISTS public.streak_achievement_days',
  'PRIMARY KEY (user_id, achievement_date)',
  'CREATE TABLE IF NOT EXISTS public.streak_achievement_baselines',
  'ALTER TABLE public.streak_achievement_days ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE public.streak_achievement_days FROM PUBLIC, anon, authenticated',
  'ALTER TABLE public.streak_achievement_baselines ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE public.streak_achievement_baselines FROM PUBLIC, anon, authenticated',
  'CREATE OR REPLACE FUNCTION public.record_streak_achievement_day',
  'CREATE OR REPLACE FUNCTION public.get_lifetime_qualifying_streak_days',
  'public.get_lifetime_qualifying_streak_days(active.user_id, NULL)',
  'raw.lifetime_qualifying_streak_days',
  "snapshot.formula_version = 'phase1b-v2'",
]) {
  assert.ok(
    cumulativeStreakEconomy.includes(required),
    `Missing cumulative Streak economy boundary: ${required}`,
  );
}
assert.match(
  cumulativeStreakEconomy,
  /REVOKE ALL ON FUNCTION public\.record_streak_achievement_day\(uuid, date\)[\s\S]*FROM PUBLIC, anon, authenticated/,
);
assert.match(
  cumulativeStreakEconomy,
  /public\.calculate_normalized_marks\(\s*raw\.lifetime_qualifying_streak_days,/,
);
assert.doesNotMatch(
  cumulativeStreakEconomy.match(
    /CREATE OR REPLACE FUNCTION public\.get_member_mark_components\(\)[\s\S]*?\$\$;/,
  )?.[0] || '',
  /public\.calculate_normalized_marks\(\s*raw\.current_streak,/,
);
for (const required of [
  'CREATE TABLE IF NOT EXISTS public.streak_achievement_verified_restorations',
  'ALTER TABLE public.streak_achievement_verified_restorations ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE public.streak_achievement_verified_restorations',
  'CREATE OR REPLACE FUNCTION public.record_verified_streak_restoration',
  'DROP TRIGGER IF EXISTS capture_streak_achievement_from_freezer',
  'DROP TRIGGER IF EXISTS capture_streak_achievement_baseline_change',
  "CHECK (source_kind IN ('earned', 'restored'))",
  'Legacy phase 1B continuity anchors retained for audit only',
]) {
  assert.ok(
    correctedStreakAchievement.includes(required),
    `Missing corrected Streak-achievement boundary: ${required}`,
  );
}
for (const required of [
  'CREATE OR REPLACE FUNCTION public.mark_cadet_attendance',
  'WHEN public.daily_records.attendance_marked_at IS NOT NULL',
  'THEN public.daily_records.attendance_marked_at',
  'THEN coalesce(public.daily_records.attendance_late, false)',
  "record.record_date = date '2026-08-27'",
  "record.attendance_status = 'present'",
  'coalesce(record.meditation_submitted, false)',
  'public.record_verified_streak_restoration(',
  'public.refresh_user_streak_snapshot(v_user_id)',
]) {
  assert.ok(attendanceCorrection.includes(required), `Missing attendance-correction boundary: ${required}`);
}
for (const required of [
  "IN ('opondelindakarenb', 'geraldine', 'sentinelvedette')",
  "WHEN 'opondelindakarenb' THEN 29",
  "WHEN 'geraldine' THEN 4",
  "WHEN 'sentinelvedette' THEN 29",
  'IF v_target_count <> 3 THEN',
  'streak_manual_adjustments AS adjustment',
  'current_streak = greatest(',
  'public.refresh_user_streak_snapshot(v_target.user_id)',
  'IF v_restored_count <> 3 THEN',
]) {
  assert.ok(spadesStreakRestoration.includes(required), `Missing targeted streak-restoration boundary: ${required}`);
}
assert.doesNotMatch(spadesStreakRestoration, /UPDATE public\.daily_records/);
for (const required of [
  "WHEN 'opondelindakarenb' THEN 30",
  "WHEN 'geraldine' THEN 5",
  "WHEN 'sentinelvedette' THEN 30",
  'IF v_target_count <> 3 THEN',
  'current_streak = greatest(',
  'public.record_verified_streak_restoration(',
  'public.refresh_user_streak_snapshot(v_target.user_id)',
  'IF v_updated_count <> 3 THEN',
]) {
  assert.ok(spadesStreakAdvancement.includes(required), `Missing targeted streak-advancement boundary: ${required}`);
}
assert.doesNotMatch(spadesStreakAdvancement, /UPDATE public\.daily_records/);
assert.match(
  attendanceCorrection,
  /v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id/,
);
assert.match(
  attendanceCorrection,
  /REVOKE ALL ON FUNCTION public\.mark_cadet_attendance\(uuid, uuid, text, text\)[\s\S]*FROM PUBLIC, anon/,
);
const correctedStreakSource = correctedStreakAchievement.match(
  /CREATE OR REPLACE FUNCTION public\.streak_achievement_source\([\s\S]*?\n\$\$;/,
)?.[0] || '';
assert.match(correctedStreakSource, /public\.streak_requirement_met\(p_user_id, p_achievement_date\)/);
assert.match(correctedStreakSource, /public\.streak_achievement_verified_restorations/);
assert.doesNotMatch(
  correctedStreakSource,
  /streak_day_is_(?:purchased|protected|restored)|streak_freezers|streak_manual_adjustments|streakboard_snapshots/,
);
assert.match(
  correctedStreakAchievement,
  /REVOKE ALL ON FUNCTION public\.record_verified_streak_restoration\(uuid, date, text, uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/,
);
assert.doesNotMatch(
  correctedStreakAchievement.match(
    /CREATE OR REPLACE FUNCTION public\.get_lifetime_qualifying_streak_days\([\s\S]*?\n\$\$;/,
  )?.[0] || '',
  /streak_achievement_baselines|current_streak|longest_streak/,
);
assert.equal((cadetNarrative.match(/PanelImageBackdrop image=\{scriptureImage\}/g) || []).length, 2);
assert.match(cadetApp, /data-denarii-target/);

for (const required of [
  'blur: number',
  'roughness: number',
]) {
  assert.ok(panelImageTypes.includes(required), `Missing panel-image adjustment type: ${required}`);
}
for (const required of [
  'blur: 0',
  'roughness: 0',
  'input?.blur',
  'input?.roughness',
  '`blur(${(a.blur / 8).toFixed(2)}px)`',
]) {
  assert.ok(panelImages.includes(required), `Missing persisted panel-image adjustment: ${required}`);
}
for (const required of [
  'adjustments.blur / 1800',
  'adjustments.roughness / 560',
  'adjustments.grain + adjustments.noise + adjustments.roughness',
]) {
  assert.ok(panelImageBackdrop.includes(required), `Missing rendered panel-image adjustment: ${required}`);
}
for (const required of [
  "{ key: 'blur', label: 'Blur'",
  "{ key: 'roughness', label: 'Roughness'",
  "useState<keyof PanelImageAdjustments>('brightness')",
  'Photo adjustment tools',
  'activeImageAdjustmentControl',
]) {
  assert.ok(instructorApp.includes(required), `Missing phone-style image editor behavior: ${required}`);
}
for (const required of [
  'fcx-slide-content',
  'fcx-line',
  'fcx-seat-line',
]) {
  assert.ok(fcxExperience.includes(required), `Missing FCX contrast hook: ${required}`);
  assert.ok(read('src/index.css').includes(required), `Missing FCX light-mode contrast rule: ${required}`);
}

for (const required of [
  "date '2026-08-28'",
  "date '2026-08-29'",
  'baseline.baseline_streak > 0',
  'NOT public.streak_requirement_met(friday.user_id',
  'NOT public.streak_day_is_restored(friday.user_id',
  'NOT public.streak_day_is_purchased(friday.user_id',
  'NOT public.streak_day_is_protected(friday.user_id',
  "'founders_gift'",
  'public.refresh_user_streak_snapshot(v_recipient.user_id)',
  "'gift_key', 'first_fcx_founders_gift_2026'",
  "'Founder''s Gift'",
]) {
  assert.ok(foundersGiftRestoration.includes(required), `Missing first-FCX streak gift boundary: ${required}`);
}
assert.doesNotMatch(foundersGiftRestoration, /INSERT INTO public\.streak_achievement/);
assert.doesNotMatch(foundersGiftRestoration, /INSERT INTO public\.streak_manual_adjustments/);
for (const required of [
  'createPortal',
  'fetchUnreadFoundersGiftNotification',
  "const GIFT_KEY = 'first_fcx_founders_gift_2026'",
  'markNotificationRead',
  'Founder&apos;s Gift',
]) {
  assert.ok(foundersGiftPopup.includes(required), `Missing Founder gift popup behavior: ${required}`);
}
assert.match(rootApp, /FoundersGiftPopup/);

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

for (const required of [
  'subscription_payment_deliveries',
  "payment.purchase_kind = 'subscription'",
  'ON CONFLICT (payment_id) DO NOTHING',
  "session.status <> 'scheduled'",
  'now() >= session.live_opens_at',
  'Answer every question before submitting',
  'claim_shared_quiz_result',
  'claimed_by_user_id',
  'This guest quiz has already been claimed by another account.',
  'public_scripture_reaction_summary',
  'public_scripture_insight_reactions',
  "'Guest reader'",
  'get_scripture_insight_reaction_summaries',
]) {
  assert.ok(
    paymentAndPublicShareRecovery.includes(required),
    `Missing payment/public-share recovery boundary: ${required}`,
  );
}
assert.match(paymentAndPublicShareRecovery, /REVOKE ALL ON FUNCTION public\.public_scripture_reaction_summary[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(paymentAndPublicShareRecovery, /GRANT EXECUTE ON FUNCTION public\.get_scripture_insight_reaction_summaries[\s\S]*TO authenticated, service_role/);
assert.match(subscriptionScreen, /RECOVERABLE_PAYMENT_AGE_MS/);
assert.match(subscriptionScreen, /activePayment\.payment_id/);
assert.match(campayWebhook, /objectValue\(verifyData\.data\)/);
assert.match(campayWebhook, /authenticatedUserId/);
assert.match(campayCheckout, /payment_id: paymentId/);
assert.match(publicShareScreen, /payload\.question \|\| payload\.question_text/);
assert.match(publicShareScreen, /<Dove size=\{14\} \/>/);
assert.match(publicShareScreen, /\/>\s*Reply/);
assert.match(publicShareScreen, /\/>\s*Add insight/);
assert.match(publicShareScreen, /claim-quiz/);
assert.match(publicShareScreen, /full-circle-pending-quiz-claim/);
assert.match(publicShareScreen, /window\.location\.assign\(signupHref\)/);
assert.match(publicQuizResultClaim, /claimSharedQuizResult/);
assert.match(publicQuizResultClaim, /requestAppNavigation\('quiz'/);
assert.match(publicQuizResultClaim, /Your marked answer sheet stays sealed/);
assert.match(rootApp, /<PublicQuizResultClaim \/>/);
assert.match(quoteQueries, /supabase\.rpc\('claim_shared_quiz_result'/);
assert.match(paymentAndPublicShareRecovery, /REVOKE ALL ON FUNCTION public\.claim_shared_quiz_result\(uuid, text\)[\s\S]*FROM PUBLIC, anon/);

for (const required of [
  "'shield-of-faith'",
  "interval '15 seconds'",
  'protection_relic_slug',
  "'mine_blocked', true",
  'settle_hidden_challenge_failure_unprotected',
  'get_my_hidden_challenge_relics',
  'use_hidden_challenge_relic',
]) {
  assert.ok(hiddenChallengeHardening.includes(required), `Missing hidden-challenge hardening boundary: ${required}`);
}
assert.match(hiddenChallengeHardening, /'shield-of-faith'[\s\S]*?100,/);
assert.match(hiddenChallengeHardening, /REVOKE ALL ON FUNCTION public\.settle_hidden_challenge_failure_unprotected/);

for (const required of [
  "interval '40 seconds'",
  'get_my_pending_hidden_verse_markers',
  'notify_scripture_mine_as_verse_tag',
  "challenge.item_type <> 'mine'",
  "'scripture_insight_mention'",
  "'hidden_challenge_claim_id', NEW.id",
  "NEW.placement = 'verse'",
]) {
  assert.ok(mineVerseTags.includes(required), `Missing 40-second/Scripture Mine boundary: ${required}`);
}
assert.match(mineVerseTags, /claim\.current_target_id = auth\.uid\(\)/);
assert.match(mineVerseTags, /REVOKE ALL ON FUNCTION public\.get_my_pending_hidden_verse_markers\(uuid\[\]\)[\s\S]*FROM PUBLIC, anon/);
assert.match(hiddenChallengeOverlay, /HIDDEN_CHALLENGE_SECONDS = 40/);
assert.match(hiddenChallengeOverlay, /You stepped on a Mine/);
assert.match(cadetNarrative, /Tagged for you/);
assert.match(cadetNarrative, /fetchPendingHiddenVerseMarkers/);

for (const required of [
  'deliver_quiz_release_notifications',
  'notify_released_quiz_with_dove',
  "notification.notification_type = 'quiz_release'",
  "'quiz_session_id', v_session.id",
  "'quiz'",
]) {
  assert.ok(quizDoveArrivals.includes(required), `Missing quiz Dove arrival boundary: ${required}`);
}
assert.match(quizDoveArrivals, /AFTER UPDATE OF status ON public\.quiz_sessions/);
assert.match(quizDoveArrivals, /REVOKE ALL ON FUNCTION public\.deliver_quiz_release_notifications\(uuid\) FROM PUBLIC, anon, authenticated/);
assert.match(hiddenItemsMarket, /<select[\s\S]*No relic/);
assert.match(hiddenItemsMarket, /<select[\s\S]*No freezer/);
assert.match(hiddenItemsMarket, /Choose the verse/);
assert.match(hiddenItemsMarket, /matchAll/);
assert.doesNotMatch(hiddenItemsMarket, /AppSelect/);
assert.match(tentMessenger, /revealHiddenChallenge\(\{ claimIds: hiddenClaimIds \}\)/);
assert.doesNotMatch(tentMessenger, /Open hidden question/);
assert.match(hiddenChallengeOverlay, /for \(const claimId of detail\.claimIds\)/);
for (const required of [
  'direct_message',
  'weekly_quiz_reminder',
  'quiz_release',
]) {
  assert.ok(notificationArrival.includes(required), `Missing Dove notification classification: ${required}`);
}
for (const required of [
  'Delivered by the Dove',
  '<Mail',
  '<FileQuestion',
  'TentMessenger',
  'TentGroupMessenger',
]) {
  assert.ok(doveNotificationArrival.includes(required), `Missing Dove arrival behavior: ${required}`);
}
assert.match(appNavigation, /full-circle:navigate/);
assert.match(cadetApp, /<DoveNotificationArrival/);
assert.match(sentryApp, /<DoveNotificationArrival/);
assert.match(instructorApp, /<DoveNotificationArrival/);

for (const required of [
  ".ilike('title', 'Vallum')",
  "award.award_month === latestMonth",
  "table: 'awards'",
  '<ChiRhoMark',
]) {
  assert.ok(vallumAvatarBadge.includes(required), `Missing Vallum avatar badge behavior: ${required}`);
}
assert.match(tentMessenger, /<VallumAvatarBadge userId=\{profile\.id\}/);
assert.match(boardRow, /<MessageAvatar/);
assert.match(appShell, /<VallumAvatarBadge userId=\{profile\?\.id\}/);
for (const required of [
  'function ArenaBattleBoard',
  'const rollDie = useCallback',
  '!activeQuestion || !questionOpen',
  '<ArenaWaitingChat roomId={roomId} userId={userId} compact',
  'aria-label="Arena question"',
]) {
  assert.ok(cadetArena.includes(required), `Missing board-first Arena behavior: ${required}`);
}
assert.doesNotMatch(cadetArena, /Live Answers|Every player’s question, choice, and outcome/);

for (const required of [
  'CREATE OR REPLACE FUNCTION public.get_latest_weekly_quiz_rankings(',
  'pending.release_at <= statement_timestamp()',
  'PERFORM public.release_due_weekly_quiz_results(NULL)',
  "interval '24 hours'",
  'release.released_at IS NOT NULL',
  "attempt.status IN ('submitted', 'timed_out')",
  'row_number() OVER',
  'REVOKE ALL ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) FROM PUBLIC, anon',
]) {
  assert.ok(resultsReleaseRankingsAndWeeklyAwards.includes(required), `Missing quiz-day ranking boundary: ${required}`);
}
assert.match(resultsReleaseRankingsAndWeeklyAwards, /correct_count DESC[\s\S]*figs_earned DESC[\s\S]*answered_at ASC/);
assert.match(weeklyQuizRankings, /Weekly Quiz Ranking/);
assert.match(weeklyQuizRankings, /Released with quiz results/);
assert.match(weeklyQuizRankings, /fetchLatestWeeklyQuizRankings/);
assert.match(cadetQuiz, /<WeeklyQuizRankings sessionId=\{session\.id\} \/>/);
assert.match(cadetDashboard, /kind: 'quiz_podium'/);

for (const required of [
  'CREATE TABLE IF NOT EXISTS public.external_share_events',
  'CREATE OR REPLACE FUNCTION public.record_external_share(',
  'CREATE OR REPLACE FUNCTION public.get_weekly_award_metrics(',
  'FROM public.game_attempts attempt',
  'FROM public.arena_participants participant',
  'FROM public.quiz_attempts attempt',
  'FROM public.story_mode_fig_entries entry',
  'FROM public.daily_quote_reactions reaction',
  "reaction.reaction_type = 'heart'",
  'record.meditation_public = true',
  'FROM public.external_share_events share',
  "'Angel Award (Angelos)'",
]) {
  assert.ok(resultsReleaseRankingsAndWeeklyAwards.includes(required), `Missing weekly award rule: ${required}`);
}
for (const required of [
  'fetchWeeklyAwardMetrics()',
  "title: 'Scribe Award'",
  'metric.total_figs',
  "title: 'Rhetoric Award (Orator)'",
  'metric.quote_reactions',
  "title: 'Messenger Award (Nuncio)'",
  "title: 'Angel Award (Angelos)'",
]) {
  assert.ok(instructorApp.includes(required), `Missing instructor weekly award behavior: ${required}`);
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
