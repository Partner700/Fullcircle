import assert from 'node:assert/strict';
import { groupArenaMatchupSides, shortArenaName, type ArenaMatchupPlayer } from '../src/lib/arenaMatchup.ts';

assert.equal(shortArenaName('PH'), 'PH');
assert.equal(shortArenaName('Sentinel Vedette'), 'Vedette');
assert.equal(shortArenaName('The Scribe'), 'The Scribe');
assert.equal(shortArenaName(''), 'Player');
assert.equal(shortArenaName('Linda Karen'), 'Linda');

const players: ArenaMatchupPlayer[] = [
  { user_id: 'a', display_name: 'A', avatar_url: null, tent_house_id: 'laurel', tent_id: 'tent-1', player_number: 7, correct_count: 3 },
  { user_id: 'b', display_name: 'B', avatar_url: null, tent_house_id: 'spades', tent_id: 'tent-2', player_number: 8, correct_count: 4 },
  { user_id: 'c', display_name: 'C', avatar_url: null, tent_house_id: 'laurel', tent_id: 'tent-1', player_number: 9, correct_count: 5 },
  { user_id: 'd', display_name: 'D', avatar_url: null, tent_house_id: 'laurel', tent_id: 'tent-3', player_number: 10, correct_count: 6 },
];
assert.deepEqual(groupArenaMatchupSides(players).map(side => side.players.map(p => p.user_id)), [['a','c'],['b'],['d']]);
assert.equal(groupArenaMatchupSides([players[0],players[3]]).length, 2, 'Same house but different tents must remain opponents');
console.log('Arena matchup names and exact-tent teams passed.');
