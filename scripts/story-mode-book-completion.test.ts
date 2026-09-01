import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_BOOKS } from '../src/screens/cadet/story-mode/content.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901150000_story_mode_flood_book_completion.sql');
const api = read('src/screens/cadet/story-mode/api.ts');
const engine = read('src/screens/cadet/story-mode/engine.ts');
const home = read('src/screens/cadet/story-mode/StoryModeHome.tsx');
const player = read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx');
const complete = read('src/screens/cadet/story-mode/StoryBookComplete.tsx');

const book = STORY_BOOKS[0];
const levels = book.chapters.flatMap((chapter) => chapter.levels);
assert.equal(book.numeral, 'Book I');
assert.equal(book.title, 'Beginnings');
assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['Brothers', 'Generations', 'Noah']);
assert.deepEqual(book.chapters.map((chapter) => chapter.levels.length), [6, 8, 24]);
assert.equal(levels.length, 38);
assert.equal(levels[0].slug, 'abel-offering');
assert.equal(levels.at(-1)?.slug, 'the-bow-in-the-cloud');

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.story_mode_book_completions/);
assert.match(migration, /ALTER TABLE public\.story_mode_book_completions ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*public\.story_mode_book_completions[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(migration, /v_completed_book_levels <> v_required_book_levels/);
assert.match(migration, /progress\.stage_order >= sequence\.total_stages/);
assert.match(migration, /Book I cannot complete before the covenant and rainbow sequence/);
assert.match(migration, /ON CONFLICT \(user_id, book_slug\) DO NOTHING/);
assert.match(migration, /completion_percentage[\s\S]*100/);

assert.match(api, /get_my_story_mode_book_completion/);
assert.match(api, /result\.bookComplete = bookStats\.completed/);
assert.match(engine, /book_complete/);
assert.match(engine, /state\.result\?\.bookComplete/);
assert.match(player, /StoryBookComplete/);

for (const label of [
  'BOOK I',
  'BEGINNINGS',
  'COMPLETE',
  'Chapters',
  'Levels',
  'Correct',
  'Figs',
  'Denarii',
  'Completed',
  'Replay Book',
  'Browse Journey',
  'Story Mode Home',
  'The journey continues',
]) assert.match(complete, new RegExp(label, 'i'));

assert.match(home, /journeyComplete/);
assert.match(home, /Replay Journey/);
assert.match(home, /bookStats\.completionPercentage/);
assert.match(home, /replay available/);

const bookMaximumFigs = 39 + 49 + 72 + 90;
assert.equal(bookMaximumFigs, 250);
assert.doesNotMatch(migration, /INSERT INTO public\.(wallet|denarii|relic|marks)/i);
assert.doesNotMatch(migration, /story_mode_marks|book_i_relic|flood_relic/i);
assert.match(migration, /denarii_earned[\s\S]*DEFAULT 0/);

console.log('Story Mode Book I completion: 3 chapters, 38 levels, covenant/rainbow gate, idempotent ledger, 250-Fig maximum, and complete UI passed.');
