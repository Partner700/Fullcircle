import assert from 'node:assert/strict';
import { arenaTournamentEntrants, arenaTournamentSlots, placeTournamentFixturePlayer, tournamentAutomaticPlayerLabel, tournamentFixtureRoster, validateTournamentFixturePlayers, validateArenaTournamentTimes, type ArenaTournamentPair } from '../src/lib/arenaTournament.ts';

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

const fourSlots = arenaTournamentSlots(4);
const pairs: ArenaTournamentPair[] = [['a', 'c'], ['b', 'd'], ['', '']];
assert.equal(validateTournamentFixturePlayers(fourSlots, pairs), null);
assert.deepEqual(tournamentFixtureRoster(fourSlots, pairs), ['a', 'c', 'b', 'd']);
assert.equal(tournamentAutomaticPlayerLabel(fourSlots, fourSlots[2], 0), 'Winner: Semi-final 1');
assert.equal(validateTournamentFixturePlayers(fourSlots, [['a', 'c'], ['b', 'd'], ['d', 'a']]), null);
assert.match(validateTournamentFixturePlayers(fourSlots, [['a', 'c'], ['c', 'd'], ['', '']]) || '', /one match/);
assert.match(validateTournamentFixturePlayers(fourSlots, [['a', 'c'], ['b', ''], ['', '']]) || '', /both required players/);
assert.equal(validateTournamentFixturePlayers(fourSlots, [['a', 'c'], ['b', 'd'], ['new-entrant', '']]), null);
const groupPairs: ArenaTournamentPair[] = [
  ['a', 'd'], ['a', 'b'], ['a', 'c'], ['b', 'c'], ['b', 'd'], ['c', 'd'],
  ['e', 'f'], ['e', 'g'], ['e', 'h'], ['f', 'g'], ['f', 'h'], ['g', 'h'], ['', ''], ['', ''], ['', ''],
];
assert.equal(validateTournamentFixturePlayers(groupSlots, groupPairs), null);
assert.equal(tournamentAutomaticPlayerLabel(groupSlots, groupSlots[12], 1), 'Group B runner-up');
assert.equal(tournamentAutomaticPlayerLabel(groupSlots, groupSlots[13], 0), 'Group B winner');
assert.match(validateTournamentFixturePlayers(groupSlots, [groupPairs[1], ...groupPairs.slice(1)]) || '', /meet once/);
assert.match(validateTournamentFixturePlayers(groupSlots, groupPairs.map((pair) => pair.map((id) => id === 'h' ? 'a' : id) as ArenaTournamentPair)) || '', /one group/);
console.log('Inline per-match selection, future automatic seats, and group membership checks passed.');

assert.equal(validateTournamentFixturePlayers(fourSlots, [['a', 'b', 'e'], ['c', 'd', 'f', 'g'], ['', '', '', '']]), null);
assert.equal(validateTournamentFixturePlayers(arenaTournamentSlots(2), [['a', 'b', 'c', 'd']]), null);
assert.match(validateTournamentFixturePlayers(arenaTournamentSlots(2), [['a']]) || '', /2 to 4/);
assert.match(validateTournamentFixturePlayers(arenaTournamentSlots(2), [['a', 'b', 'c', 'd', 'e']]) || '', /2 to 4/);
assert.match(validateTournamentFixturePlayers(arenaTournamentSlots(2), [['a', 'b', 'a']]) || '', /different players/);
assert.match(validateTournamentFixturePlayers(fourSlots, [['a', 'b', 'e'], ['c', 'd', 'e'], ['', '']]) || '', /one match/);
assert.equal(validateTournamentFixturePlayers(groupSlots, [['a','b','c','d'], ...groupPairs.slice(1)]), null);
assert.deepEqual(tournamentFixtureRoster(fourSlots, [['a','b','e'], ['c','d','f','g'], ['', '', 'h', '']]), ['a','b','e','c','d','f','g','h']);
console.log('Each match independently accepts 2, 3 or 4 players; bracket size is unchanged.');
