import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_BOOKS } from '../src/screens/cadet/story-mode/content.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260901150000_story_mode_flood_book_completion.sql'), 'utf8');
const book = STORY_BOOKS[0];
const levels = book.chapters.flatMap((chapter) => chapter.levels);
const slugs = levels.map((level) => level.slug);

const requiredChronology = [
  'abel-offering',
  'the-field',
  'another-offspring',
  'seth',
  'enoch-walks',
  'taken',
  'methuselah',
  'toward-noah',
  'corruption',
  'make-yourself-an-ark',
  'the-ark-stands',
  'enter-the-ark',
  'forty-days',
  'waters-prevailed',
  'god-remembered-noah',
  'the-raven',
  'the-dove',
  'an-olive-leaf',
  'dry-ground',
  'come-out',
  'an-altar',
  'my-covenant',
  'the-bow-in-the-cloud',
];

let previous = -1;
for (const slug of requiredChronology) {
  const index = slugs.indexOf(slug);
  assert.ok(index > previous, `${slug} must occur after the previous canonical milestone.`);
  previous = index;
}

const phase3eUnlocks = [...migration.matchAll(/\('([^']+)', 'beginnings', 'noah', '[^']+', (\d+), (?:NULL|'([^']+)'), true\)/g)]
  .map((match) => ({ slug: match[1], order: Number(match[2]), prerequisite: match[3] || null }));
assert.equal(phase3eUnlocks.length, 14);
assert.equal(phase3eUnlocks[0].prerequisite, 'the-ark-stands');
for (let index = 1; index < phase3eUnlocks.length; index += 1) {
  assert.equal(phase3eUnlocks[index].prerequisite, phase3eUnlocks[index - 1].slug);
  assert.equal(phase3eUnlocks[index].order, phase3eUnlocks[index - 1].order + 1);
}

const environmentContexts = [...migration.matchAll(/\('([^']+)', 'noah-flood-environment', (\d+), (\d+)\)/g)]
  .map((match) => ({ slug: match[1], start: Number(match[2]), end: Number(match[3]) }));
assert.equal(environmentContexts.length, 14);
for (let index = 1; index < environmentContexts.length; index += 1) {
  assert.equal(environmentContexts[index].start, environmentContexts[index - 1].end);
}
assert.equal(environmentContexts[0].start, 0);
assert.equal(environmentContexts.at(-1)?.end, 17);

const finalGateOrder = [
  migration.indexOf("'dry-ground', 'noah-flood-environment', 12, 13"),
  migration.indexOf("'come-out', 'noah-flood-environment', 13, 14"),
  migration.indexOf("'an-altar', 'noah-flood-environment', 14, 15"),
  migration.indexOf("'my-covenant', 'noah-flood-environment', 15, 16"),
  migration.indexOf("'the-bow-in-the-cloud', 'noah-flood-environment', 16, 17"),
];
assert.ok(finalGateOrder.every((index) => index >= 0));
assert.match(migration, /v_completed_book_levels <> v_required_book_levels/);
assert.match(migration, /covenant and rainbow sequence/);

const allStoryText = levels.map((level) => `${level.slug} ${level.title} ${level.continuationText || ''}`).join(' ');
assert.doesNotMatch(allStoryText, /babel|abraham|isaac|jacob|joseph|book ii/i);

console.log('Story Mode Book I chronology from Abel through rainbow, 14-level unlock chain, 17-stage environment chain, and future-content boundary passed.');
