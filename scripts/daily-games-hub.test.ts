import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const hub = read('src/screens/cadet/DailyGamesHub.tsx');
const story = read('src/screens/cadet/story-mode/StoryModeShell.tsx');
const routes = read('src/lib/dailyGames.ts');
const cadetApp = read('src/screens/cadet/CadetApp.tsx');
const sentryApp = read('src/screens/sentry/SentryApp.tsx');
const appShell = read('src/components/AppShell.tsx');
const dailyTrivia = read('src/screens/cadet/CadetGame.tsx');
const arena = read('src/screens/cadet/CadetArena.tsx');

for (const category of ['Daily Trivia', 'Arena', 'Story Mode']) {
  assert.ok(hub.includes(category), `Daily Games hub is missing ${category}.`);
}
assert.match(hub, /Master today&apos;s narrative\./);
assert.match(hub, /Compete\. Risk\. Win\./);
assert.match(hub, /Journey through the Bible\./);
assert.match(hub, /onClick=\{onOpenTrivia\}/);
assert.match(hub, /onClick=\{onOpenArena\}/);
assert.match(hub, /onClick=\{onOpenStory\}/);
assert.match(hub, /fetchGameAttempts\(profile\.id, today\)/);
assert.match(hub, /levelsCompleted} of \{DAILY_GAME_LEVELS\} cleared/);
assert.match(hub, /grid grid-cols-1 gap-4 lg:grid-cols-3/);

for (const routeBoundary of [
  "DAILY_GAMES_HUB_TAB = 'games'",
  "DAILY_TRIVIA_TAB = 'game'",
  "ARENA_TAB = 'arena'",
  "STORY_MODE_TAB = 'story'",
]) {
  assert.ok(routes.includes(routeBoundary), `Missing game route boundary: ${routeBoundary}`);
}

for (const app of [cadetApp, sentryApp]) {
  assert.match(app, /'games'[\s\S]*'game'[\s\S]*'arena'[\s\S]*'story'/);
  assert.match(app, /<DailyGamesHub[\s\S]*onOpenTrivia=\{\(\) => handleNavigate\('game'\)\}[\s\S]*onOpenArena=\{\(\) => handleNavigate\('arena'\)\}[\s\S]*onOpenStory=\{\(\) => handleNavigate\('story'\)\}/);
  assert.match(app, /<StoryModeShell onBackToDailyGames=\{\(\) => handleNavigate\('games'\)\}/);
  assert.match(app, /navActiveKey=\{dailyGamesNavigationKey\(tab\)\}/);
  assert.match(app, /PREMIUM_TABS = new Set<Tab>\(\['games', 'game', 'arena', 'story'/);
}
assert.match(cadetApp, /CADET_TABS[^\n]*'game', 'arena', 'story'/);
assert.match(sentryApp, /SENTRY_TABS[^\n]*'game', 'arena', 'story'/);
assert.match(appShell, /activeKey: string;\s+navActiveKey\?: string;/);
assert.match(appShell, /tabUrl\(activeKey\)/, 'Child hashes must remain the real history entries.');

for (const preservedTriviaBoundary of [
  'DAILY_GAME_LEVELS',
  'GAME_QUESTIONS_PER_ROUND',
  'fetchGameAttempts',
  'startDailyGameLevel',
  'submitDailyGameAnswer',
  'completeDailyGameRun',
  'Sunday Game Archive',
  "a.status === 'passed'",
]) {
  assert.ok(dailyTrivia.includes(preservedTriviaBoundary), `Daily Trivia lost: ${preservedTriviaBoundary}`);
}
assert.match(dailyTrivia, /Array\.from\(\{ length: DAILY_GAME_LEVELS \}/);
assert.match(dailyTrivia, /onBackToDailyGames &&[\s\S]*Back to Daily Games/);

for (const preservedArenaBoundary of [
  'activeArenaRoomStorageKey',
  'window.localStorage.getItem',
  'window.localStorage.setItem',
  'Standard Trivia',
  'Ludo Trivia',
  '<RoadHomeGame',
  'fetchArenaRoom(activeRoomId)',
]) {
  assert.ok(arena.includes(preservedArenaBoundary), `Arena lost: ${preservedArenaBoundary}`);
}
assert.match(arena, /if \(phase === 'playing' && activeRoomId\)/);
assert.match(arena, /if \(phase === 'waiting' && activeRoomId\)/);

assert.match(story, /Story Mode/);
assert.match(story, /Back to Daily Games/);
assert.match(story, /StoryModeHome/);
assert.match(story, /AbelOfferingLevel/);
assert.match(story, /startStoryModeLevel\(ABEL_LEVEL_SLUG\)/);
for (const forbiddenStoryDependency of ['fetchNarrative', 'game_attempts', 'startDailyGameLevel', 'finishArenaGame']) {
  assert.ok(!story.toLowerCase().includes(forbiddenStoryDependency), `Story shell must not depend on ${forbiddenStoryDependency}.`);
}

const phaseTwoSources = `${hub}\n${story}\n${routes}`;
for (const economyMutation of [
  '.from(\'denarii_ledger_entries\')',
  '.from("denarii_ledger_entries")',
  'calculate_normalized_marks',
  'get_marks_board_live',
  'complete_daily_game_level',
  'finish_arena_game',
]) {
  assert.ok(!phaseTwoSources.includes(economyMutation), `Phase 2 must not mutate economy/game authority: ${economyMutation}`);
}

console.log('Daily Games V2 hub checks passed.');
