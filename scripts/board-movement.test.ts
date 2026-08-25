import assert from 'node:assert/strict';
import { resolveBoardMovement } from '../src/lib/boardMovement.ts';

assert.equal(resolveBoardMovement({ currentValue: 11, previousValue: 10, reportedMovement: 0 }), 1);
assert.equal(resolveBoardMovement({ currentValue: 9, previousValue: 10, reportedMovement: 0 }), -1);
assert.equal(resolveBoardMovement({ currentValue: 10, previousValue: 10, currentRank: 1, previousRank: 2 }), 1);
assert.equal(resolveBoardMovement({ currentValue: 10, previousValue: 10, currentRank: 3, previousRank: 2 }), -1);
assert.equal(resolveBoardMovement({ currentValue: 10, previousValue: 10, currentRank: 2, previousRank: 2, reportedMovement: 1 }), 1);
assert.equal(resolveBoardMovement({ currentValue: 10, previousValue: 10, currentRank: 2, previousRank: 2 }), 0);
assert.equal(resolveBoardMovement({ reportedMovement: -1 }), -1);
assert.equal(resolveBoardMovement({}), null);

console.log('Challenge-board movement checks passed.');
