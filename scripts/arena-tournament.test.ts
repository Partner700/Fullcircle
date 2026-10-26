import assert from 'node:assert/strict';
import { arenaTournamentEntrants, arenaTournamentSlots, placeTournamentFixturePlayer, validateArenaTournamentTimes } from '../src/lib/arenaTournament.ts';

assert.equal(arenaTournamentEntrants('final'), 2);
assert.equal(arenaTournamentEntrants('semifinal'), 4);
assert.equal(arenaTournamentEntrants('quarterfinal'), 8);
assert.equal(arenaTournamentEntrants('round_of_16'), 16);
assert.equal(arenaTournamentEntrants('groups', 32), 32);
assert.deepEqual(arenaTournamentSlots(2).map((slot) => slot.label), ['Final']);

assert.deepEqual(arenaTournamentSlots(4).map((slot) => [slot.label, slot.sourceIndexes]), [
  ['Semi-final 1', null], ['Semi-final 2', null], ['Final', [0, 1]],
]);
assert.deepEqual(arenaTournamentSlots(8).map((slot) => slot.sourceIndexes), [
  null, null, null, null, [0, 1], [2, 3], [4, 5],
]);
assert.equal(arenaTournamentSlots(16).length, 15);
assert.equal(arenaTournamentSlots(16)[0].label, 'Round of 16 - Game 1');
for (const size of [8, 16, 32]) {
  const slots = arenaTournamentSlots(size, true);
  assert.equal(slots.filter((slot) => slot.round === 0).length, size * 6 / 4);
  assert.equal(slots.length, size * 6 / 4 + size / 2 - 1);
  assert.equal(slots.at(-1)?.label, 'Final');
  assert.equal(slots.filter((slot) => slot.round === 1).length, size / 4);
}
assert.throws(() => arenaTournamentSlots(32), /supported tournament size/);

const now = Date.parse('2026-10-13T12:00:00Z');
const valid = [
  '2026-10-14T14:00:00Z', '2026-10-14T14:00:00Z', '2026-10-14T15:00:00Z',
];
assert.equal(validateArenaTournamentTimes(4, valid, now), null);
assert.match(validateArenaTournamentTimes(4, [...valid.slice(0, 2), '2026-10-14T14:15:00Z'], now) || '', /20 minutes/);
assert.match(validateArenaTournamentTimes(4, ['', ...valid.slice(1)], now) || '', /every game/);

const groupSlots = arenaTournamentSlots(8, true);
const groupTimes = groupSlots.map((slot) => slot.round === 0
  ? '2026-10-14T14:00:00Z' : slot.round === 1
    ? '2026-10-14T15:00:00Z' : '2026-10-14T16:00:00Z');
assert.equal(validateArenaTournamentTimes(8, groupTimes, now, true), null);
const earlyKnockout = [...groupTimes];
earlyKnockout[12] = '2026-10-14T14:15:00Z';
assert.match(validateArenaTournamentTimes(8, earlyKnockout, now, true) || '', /group stage/);

const fixtureDraft: Record<string, [string, string]> = {
  first: ['a', 'b'], second: ['c', 'd'],
};
assert.deepEqual(placeTournamentFixturePlayer(fixtureDraft, 'first', 1, 'c', true), {
  first: ['a', 'c'], second: ['b', 'd'],
});
assert.deepEqual(fixtureDraft, { first: ['a', 'b'], second: ['c', 'd'] });
assert.equal(placeTournamentFixturePlayer(fixtureDraft, 'first', 1, 'c', true, new Set(['second'])), fixtureDraft);
assert.equal(placeTournamentFixturePlayer(fixtureDraft, 'first', 1, 'a', true), fixtureDraft);
assert.deepEqual(placeTournamentFixturePlayer(fixtureDraft, 'first', 1, 'c', false), {
  first: ['a', 'c'], second: ['c', 'd'],
});

console.log('Arena tournament slots and match-time validation passed.');
