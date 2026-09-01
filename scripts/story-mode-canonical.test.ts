import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THE_FIELD_LEVEL, ANOTHER_OFFSPRING_LEVEL } from '../src/screens/cadet/story-mode/content.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260831160000_complete_brothers_chapter.sql');
const engine = read('src/screens/cadet/story-mode/engine.ts');
const player = read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx');

const deathScene = THE_FIELD_LEVEL.scenes.find((scene) => scene.canonicalEventId === 'abel-canonical-death');
assert.equal(deathScene?.kind, 'canonical_event');
assert.equal(deathScene?.scriptureReference, 'Genesis 4:8');
assert.match(deathScene?.narrativeText || '', /Cain.*killed him/i);
assert.deepEqual(deathScene?.canonicalActions, ['confront', 'strike', 'recoil', 'collapse', 'lie_still', 'fade']);
assert.ok(deathScene?.characters.some((item) => item.id === 'cain' && item.role === 'threat' && item.action === 'strike'));
assert.ok(deathScene?.characters.some((item) => item.id === 'abel' && item.action === 'collapse'));

assert.match(migration, /'abel-canonical-death'.*'canonical_death'.*'Genesis 4:8'/);
assert.match(migration, /Complete the server-selected questions before the canonical transition/);
assert.match(migration, /v_attempt\.checkpoint_id IS DISTINCT FROM v_event\.checkpoint_id/);
assert.match(migration, /'canonical_event_pending', v_pending_event_id IS NOT NULL/);
assert.match(migration, /'canonical-character-exit'/);
assert.match(migration, /canonical death advances the story and is not gameplay failure/i);
assert.match(migration, /status = 'completed',[\s\S]*checkpoint_id = v_event\.completion_checkpoint_id/);
assert.match(migration, /current_level_slug = coalesce\(v_next_level_slug, v_attempt\.level_slug\)/);
assert.match(migration, /UNIQUE \(attempt_id, event_id\)/);
assert.match(migration, /settlement\.submission_id = p_submission_id/);

const canonicalFunction = migration.match(/CREATE OR REPLACE FUNCTION public\.settle_story_mode_canonical_event[\s\S]*?\$\$;/)?.[0] || '';
assert.ok(canonicalFunction);
assert.doesNotMatch(canonicalFunction, /p_(?:outcome|survived|success|level_complete|chapter_complete|figs|denarii|marks)/i);
assert.doesNotMatch(canonicalFunction, /selected_answer|correct_answer/);
assert.doesNotMatch(canonicalFunction, /INSERT INTO public\.(?:denarii|marks|game_attempts|arena_)/i);

for (const alternateEnding of ['abel-survives', 'save-abel', 'cain-defeated', 'alternate-ending', 'boss-fight', 'you died']) {
  assert.doesNotMatch(`${migration}\n${player}`, new RegExp(alternateEnding, 'i'));
}
assert.match(engine, /canonical_transition/);
assert.match(engine, /CANONICAL_EVENT_SETTLED/);
assert.match(engine, /state\.result\?\.canonicalEventPending/);
assert.doesNotMatch(engine.match(/case 'CANONICAL_EVENT_SETTLED':[\s\S]*?case /)?.[0] || '', /phase: 'failure'/);
assert.match(player, /Generational transition/);
assert.match(player, /prefers-reduced-motion: reduce/);

const sethScene = ANOTHER_OFFSPRING_LEVEL.scenes.find((scene) => scene.canonicalEventId === 'seth-generational-transition');
assert.equal(sethScene?.kind, 'character_transition');
assert.equal(sethScene?.scriptureReference, 'Genesis 4:25');
assert.match(migration, /'seth-generational-transition'.*'character_transition'.*'Genesis 4:25'.*true/);
assert.match(migration, /INSERT INTO public\.story_mode_chapter_completions/);
assert.match(migration, /'chapter_complete', v_event\.completes_chapter/);

assert.match(migration, /checkpoint_state', coalesce\(v_checkpoint_state, 'intro'\)/);
assert.match(engine, /event\.checkpointState === 'canonical_event'/);
assert.equal(
  migration.indexOf("checkpoint_id = v_event.completion_checkpoint_id") < migration.indexOf("INSERT INTO public.story_mode_event_settlements"),
  true,
  'The canonical exit must be persisted before its response is stored.',
);

console.log('Story Mode canonical narrative, refresh recovery, and Seth-transition checks passed.');
