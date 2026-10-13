import assert from 'node:assert/strict';
import { arenaTournamentSlots, validateArenaTournamentTimes } from '../src/lib/arenaTournament.ts';

assert.deepEqual(arenaTournamentSlots(4).map((slot) => [slot.label, slot.sourceIndexes]), [
  ['Semi-final 1', null], ['Semi-final 2', null], ['Final', [0, 1]],
]);
assert.deepEqual(arenaTournamentSlots(8).map((slot) => slot.sourceIndexes), [
  null, null, null, null, [0, 1], [2, 3], [4, 5],
]);

const now = Date.parse('2026-10-13T12:00:00Z');
const valid = [
  '2026-10-14T14:00:00Z', '2026-10-14T14:00:00Z', '2026-10-14T15:00:00Z',
];
assert.equal(validateArenaTournamentTimes(4, valid, now), null);
assert.match(validateArenaTournamentTimes(4, [...valid.slice(0, 2), '2026-10-14T14:15:00Z'], now) || '', /20 minutes/);
assert.match(validateArenaTournamentTimes(4, ['', ...valid.slice(1)], now) || '', /every game/);

console.log('Arena tournament slots and match-time validation passed.');
