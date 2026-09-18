import assert from 'node:assert/strict';
import { hasCompleteTopbarStats, mergeConfirmedTopbarStats, parseLiveStats } from '../src/lib/liveStats.ts';

const confirmed = {
  user_id: 'member-a', total_denarii: 1234, current_streak: 28,
  longest_streak: 30, consecutive_inactive: 0, cumulative_inactive: 3,
  total_figs: 74, rhudes: 5, marks: 148.75,
};

assert.deepEqual(parseLiveStats([confirmed], 'member-a'), confirmed);
assert.deepEqual(parseLiveStats(confirmed, 'member-a'), confirmed);
assert.equal(parseLiveStats({ ...confirmed, marks: '148.75' }, 'member-a').marks, 148.75);
assert.equal(parseLiveStats({ ...confirmed, marks: 0 }, 'member-a').marks, 0);
assert.equal(parseLiveStats({ ...confirmed, current_streak: 0 }, 'member-a').current_streak, 0);
for (const missing of [undefined, null, '', ' ', NaN, Infinity, 'unavailable', false]) {
  assert.throws(() => parseLiveStats({ ...confirmed, marks: missing }, 'member-a'));
}
for (const data of [null, [], {}, { ...confirmed, user_id: 'member-b' }]) {
  assert.throws(() => parseLiveStats(data, 'member-a'));
}

const previous = { denarii: 1234, streak: 28, marks: 148.75 };
assert.deepEqual(mergeConfirmedTopbarStats(previous, { streak: 29 }), { ...previous, streak: 29 });
assert.deepEqual(mergeConfirmedTopbarStats(previous, { marks: undefined, denarii: NaN }), previous);
assert.deepEqual(mergeConfirmedTopbarStats(previous, { marks: 0, streak: 0, denarii: 0 }), { marks: 0, streak: 0, denarii: 0 });
assert.deepEqual(previous, { denarii: 1234, streak: 28, marks: 148.75 });
assert.equal(hasCompleteTopbarStats(previous), true);
assert.equal(hasCompleteTopbarStats({ denarii: 0, streak: 0, marks: 0 }), true);
for (const partial of [null, {}, { streak: 29 }, { ...previous, marks: undefined }, { ...previous, marks: NaN }]) {
  assert.equal(hasCompleteTopbarStats(partial), false, 'A partial event must not expose or cache unconfirmed zero marks.');
}

console.log('Live stats validation, partial refresh preservation, and confirmed zero tests passed.');
