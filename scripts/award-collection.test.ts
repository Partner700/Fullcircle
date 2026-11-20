import assert from 'node:assert/strict';
import { awardCategoryKey, buildAwardCategories, isPersonalAward, AWARD_CATEGORIES } from '../src/lib/awardCollection.ts';
import type { Award } from '../src/lib/types.ts';

const award = (id: string, title: string, award_type: string, overrides: Partial<Award> = {}): Award => ({
  id, title, award_type, user_id: 'me', award_target_id: 'me', award_target_type: 'cadet',
  award_month: '2026-10', description: null, metric_value: null, created_at: '2026-11-01T00:00:00Z', ...overrides,
});
const records = [
  award('1', 'Vallum', 'cadet'),
  award('2', 'Vallum', 'vallum', { award_month: '2026-08' }),
  award('3', 'Grand Vallum', 'leadership'),
  award('4', 'Centurion', 'leadership', { award_target_type: 'sentry' }),
  award('5', 'Muralis', 'cadet'),
  award('6', 'The Lord’s Secret', 'tent', { award_target_type: 'tent', award_target_id: 'tent-1' }),
  award('7', 'Scribe Award', 'cadet', { user_id: 'other', award_target_id: 'other' }),
  award('8', 'Rhetoric Award (Orator)', 'cadet', { award_month: 'week-2026-11-16' }),
  award('9', 'Special Distinction', 'cadet', { description: 'Exceptional contribution.' }),
  award('10', 'Tutorix', 'leadership', { user_id: '', award_target_id: 'me' }),
];
const personal = records.filter(row => isPersonalAward(row, 'me'));
assert.equal(personal.length, 8);
assert.equal(awardCategoryKey(records[5]), 'lords_secret');
assert.equal(awardCategoryKey(records[2]), 'grand_vallum');
const categories = buildAwardCategories(personal);
const count = (key: string) => categories.find(row => row.key === key)?.count;
assert.equal(count('vallum'), 2);
assert.equal(count('grand_vallum'), 1);
assert.equal(count('centurion'), 1);
assert.equal(count('muralis'), 1);
assert.equal(count('rhetoric'), 1);
assert.equal(count('tutorix'), 1);
assert.equal(count('scribe'), 0);
assert.equal(count('lords_secret'), 0);
assert.equal(count('other:special distinction'), 1);
assert.equal(categories.length, Object.keys(AWARD_CATEGORIES).length + 1);
assert.equal(categories.reduce((sum, row) => sum + row.count, 0), personal.length);
assert.ok(categories.every(row => row.meaning.trim().length > 0));
assert.ok(buildAwardCategories([]).every(row => row.count === 0));
console.log('Award collection: lifetime totals, role/title mapping, unearned categories, collective exclusions and custom honors passed.');
