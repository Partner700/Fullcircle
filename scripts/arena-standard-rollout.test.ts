import assert from 'node:assert/strict';
import { arenaGameOptions, preferredArenaGameType } from '../src/lib/arenaJourneyRollout.ts';

assert.equal(preferredArenaGameType('standard', 'players', 0), 'standard');
assert.equal(preferredArenaGameType('standard', 'players', 1), 'journey');
assert.equal(preferredArenaGameType('standard', 'machine', 1), 'journey');
assert.equal(preferredArenaGameType('journey', 'machine', 1), 'journey');
assert.equal(preferredArenaGameType('ludo', 'players', 1), 'ludo');
assert.deepEqual(arenaGameOptions('players', 1).map((option) => option.value),
  ['journey', 'standard', 'ludo']);
assert.deepEqual(arenaGameOptions('machine', 1).map((option) => option.value),
  ['journey', 'standard', 'ludo']);
assert.deepEqual(arenaGameOptions('players', 0).map((option) => option.value),
  ['standard', 'ludo']);
console.log('Standard Trivia rollout selects ready Journey for human and machine matches.');
