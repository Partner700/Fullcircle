import assert from 'node:assert/strict';
import { shortArenaName } from '../src/lib/arenaMatchup.ts';

assert.equal(shortArenaName('PH'), 'PH');
assert.equal(shortArenaName('Sentinel Vedette'), 'Vedette');
assert.equal(shortArenaName('The Scribe'), 'Scribe');
assert.equal(shortArenaName(''), 'Player');
assert.equal(shortArenaName('Linda Karen'), 'Linda');

console.log('Arena matchup name tests passed.');
