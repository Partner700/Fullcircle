import assert from 'node:assert/strict';
import { groupArenaScoreTeams } from '../src/lib/arenaScorecard.ts';
import type { ArenaFinalScorecard } from '../src/lib/queries.ts';

const players: ArenaFinalScorecard['players'] = [
  { user_id: 'a', display_name: 'Ada', avatar_url: null, tent_id: 'one', tent_house_id: 'squares', tent_name: 'Square A0', correct_count: 3 },
  { user_id: 'b', display_name: 'Bea', avatar_url: null, tent_id: 'two', tent_house_id: 'spades', tent_name: 'Spades', correct_count: 2 },
  { user_id: 'c', display_name: 'Cai', avatar_url: null, tent_id: 'one', tent_house_id: 'squares', tent_name: 'Square A0', correct_count: 4 },
];

const teams = groupArenaScoreTeams(players);
assert.equal(teams.length, 2);
assert.deepEqual(teams.map((team) => [team.name, team.total]), [['Square A0', 7], ['Spades', 2]]);
assert.deepEqual(teams[0].players.map((player) => [player.display_name, player.correct_count]), [['Ada', 3], ['Cai', 4]]);
assert.equal(teams[0].houseId, 'squares');

const untented = groupArenaScoreTeams([
  { ...players[0], tent_id: null, tent_house_id: null, tent_name: null },
  { ...players[1], tent_id: null, tent_house_id: null, tent_name: null },
]);
assert.equal(untented.length, 2, 'Unassigned players must not be merged into one team.');

console.log('Arena final-score tent grouping and individual correct counts passed.');
