import assert from 'node:assert/strict';
import {
  createJourneyGame, LEGACY_JOURNEY_CONFIG as DEFAULT_JOURNEY_CONFIG, DEFAULT_JOURNEY_CONFIG as SMALL_BOARD_CONFIG, JOURNEY_TRAP_LIBRARY,
  journeyQuestionStage, resolveJourneyAction, resolveJourneyMiss, resolveJourneyRoll, serveJourneyPrisonTurn,
  type JourneyConfig, type JourneyGame, type JourneyLocation,
} from '../supabase/functions/_shared/biblicalJourney.ts';
import { LEGACY_JOURNEY_MAIN_POINTS as JOURNEY_MAIN_POINTS, JOURNEY_MAIN_POINTS as SMALL_BOARD_POINTS, JOURNEY_LOOP_POINTS } from '../src/lib/journeyBoardLayout.ts';
import { journeyEventSquare } from '../src/lib/journeyPresentation.ts';

const plain = (): JourneyConfig => ({ ...DEFAULT_JOURNEY_CONFIG, traps: {} });
const located = (location: JourneyLocation, playerIds = ['alpha']): JourneyGame => {
  const game = createJourneyGame(playerIds);
  delete game.boardSpaces;
  game.players[0].location = location;
  game.players[0].status = location.route === 'loop' ? 'TRAPPED_IN_LOOP' : location.route === 'prison' ? 'IN_HOLDING_PRISON' : 'ACTIVE';
  return game;
};
const space = (game: JourneyGame) => game.players[0].location;

assert.equal(JOURNEY_MAIN_POINTS.length, 51);
assert.equal(JOURNEY_LOOP_POINTS.length, 10);
assert.equal(new Set(JOURNEY_MAIN_POINTS.map(({ x, y }) => `${x}:${y}`)).size, 51);
assert.ok(JOURNEY_MAIN_POINTS.every(({ x, y }) => x === 32 || x === 688 || y === 32 || y === 688));
assert.ok(JOURNEY_LOOP_POINTS.every(({ x, y }) => x === 200 || x === 520 || y === 285 || y === 525));
assert.equal(DEFAULT_JOURNEY_CONFIG.winningLaps, 3);
assert.equal(new Set(DEFAULT_JOURNEY_CONFIG.loopEntrances).size, 2);
assert.notEqual(DEFAULT_JOURNEY_CONFIG.ordinaryExit, DEFAULT_JOURNEY_CONFIG.surpriseExit);
assert.equal(Object.keys(DEFAULT_JOURNEY_CONFIG.prisonTurns).length, 2);
assert.equal(DEFAULT_JOURNEY_CONFIG.milestones.length, 7);
assert.deepEqual(DEFAULT_JOURNEY_CONFIG.milestones.map((beat) => beat.questionStage), [1, 1, 2, 3, 4, 5, 5]);
assert.equal(journeyQuestionStage(DEFAULT_JOURNEY_CONFIG, { route: 'main', space: 31 }), 4);

const missedQuestion = resolveJourneyMiss(createJourneyGame(['alpha', 'beta']), 'alpha');
assert.equal(missedQuestion.turnIndex, 1);
assert.deepEqual(missedQuestion.players[0].location, { route: 'main', space: 1 });
assert.equal(missedQuestion.players[0].correctAnswers, 0);
assert.equal(missedQuestion.events[0].effectType, 'incorrect-answer');
assert.throws(() => resolveJourneyMiss(missedQuestion, 'alpha'), /not this player's turn/);
const correctQuestion = resolveJourneyRoll(createJourneyGame(['alpha', 'beta']), 'alpha', 2, plain());
assert.equal(correctQuestion.players[0].correctAnswers, 1);
assert.equal(correctQuestion.turnIndex, 1);

for (const entrance of DEFAULT_JOURNEY_CONFIG.loopEntrances) {
  const entered = resolveJourneyRoll(located({ route: 'main', space: entrance - 1 }), 'alpha', 1, plain());
  assert.deepEqual(space(entered), { route: 'loop', space: 1 });
  assert.equal(entered.players[0].loopEntryMainSpace, entrance);
  assert.equal(entered.players[0].status, 'TRAPPED_IN_LOOP');
  const ordinary = resolveJourneyRoll(entered, 'alpha', 5, plain());
  assert.deepEqual(space(ordinary), { route: 'main', space: entrance + 1 });
  assert.equal(ordinary.players[0].loopEntryMainSpace, null);
  assert.equal(ordinary.players[0].loopEscapes, 1);

  const awaitingCard = located({ route: 'loop', space: 8 });
  awaitingCard.players[0].loopEntryMainSpace = entrance;
  const promoted = resolveJourneyRoll(awaitingCard, 'alpha', 2, plain());
  assert.deepEqual(space(promoted), { route: 'main', space: entrance + 1 + DEFAULT_JOURNEY_CONFIG.promotionBonus });
  assert.equal(promoted.events.at(-1)?.source, 'surprise-card');
}

const passedEntrance = resolveJourneyRoll(located({ route: 'main', space: 21 }), 'alpha', 3, plain());
assert.deepEqual(space(passedEntrance), { route: 'main', space: 24 });
const passedOrdinary = resolveJourneyRoll(located({ route: 'loop', space: 4 }), 'alpha', 3, plain());
assert.deepEqual(space(passedOrdinary), { route: 'loop', space: 7 });
const passedSurprise = resolveJourneyRoll(located({ route: 'loop', space: 8 }), 'alpha', 4, plain());
assert.deepEqual(space(passedSurprise), { route: 'loop', space: 2 });
assert.equal(passedSurprise.players[0].completedLoopCircuits, 1);

const nearFinish = located({ route: 'loop', space: 8 });
nearFinish.players[0].loopEntryMainSpace = 45;
const nearFinishConfig = { ...plain(), loopEntrances: [23, 45] as [number, number] };
const capped = resolveJourneyRoll(nearFinish, 'alpha', 2, nearFinishConfig);
assert.deepEqual(space(capped), { route: 'main', space: 49 });
assert.equal(capped.status, 'playing');

const holdingConfig: JourneyConfig = { ...plain(), traps: { 20: JOURNEY_TRAP_LIBRARY.captured } };
let holding = resolveJourneyRoll(located({ route: 'main', space: 19 }), 'alpha', 1, holdingConfig);
assert.deepEqual(space(holding), { route: 'prison', prison: 'holding' });
assert.equal(holding.players[0].prisonTurnsRemaining, 2);
assert.throws(() => resolveJourneyRoll(holding, 'alpha', 1, holdingConfig), /serve a turn/);
holding = serveJourneyPrisonTurn(holding, 'alpha', holdingConfig);
assert.equal(holding.players[0].prisonTurnsRemaining, 1);
holding = serveJourneyPrisonTurn(holding, 'alpha', holdingConfig);
assert.deepEqual(space(holding), { route: 'main', space: 20 });

const deepConfig: JourneyConfig = { ...plain(), traps: { 20: JOURNEY_TRAP_LIBRARY.condemned } };
let deep = resolveJourneyRoll(located({ route: 'main', space: 19 }), 'alpha', 1, deepConfig);
for (let turn = 0; turn < 3; turn += 1) deep = serveJourneyPrisonTurn(deep, 'alpha', deepConfig);
assert.deepEqual(space(deep), { route: 'main', space: 13 });
const loopPrison = located({ route: 'prison', prison: 'deep' });
loopPrison.players[0].status = 'IN_DEEP_PRISON';
loopPrison.players[0].prisonTurnsRemaining = 1;
loopPrison.players[0].savedLocation = { route: 'loop', space: 4 };
loopPrison.players[0].loopEntryMainSpace = 23;
const releasedLoop = serveJourneyPrisonTurn(loopPrison, 'alpha', plain());
assert.deepEqual(space(releasedLoop), { route: 'loop', space: 4 });
assert.equal(releasedLoop.players[0].loopEntryMainSpace, 23);

const directConfig: JourneyConfig = { ...plain(), traps: {
  10: JOURNEY_TRAP_LIBRARY.return_start,
  20: JOURNEY_TRAP_LIBRARY.seven_behind,
  40: JOURNEY_TRAP_LIBRARY.ten_forward,
} };
assert.deepEqual(space(resolveJourneyRoll(located({ route: 'main', space: 9 }), 'alpha', 1, directConfig)), { route: 'main', space: 1 });
assert.deepEqual(space(resolveJourneyRoll(located({ route: 'main', space: 19 }), 'alpha', 1, directConfig)), { route: 'main', space: 13 });
assert.deepEqual(space(resolveJourneyRoll(located({ route: 'main', space: 39 }), 'alpha', 1, directConfig)), { route: 'main', space: 49 });

const swap = located({ route: 'main', space: 25 }, ['alpha', 'beta']);
swap.players[1].location = { route: 'main', space: 40 };
const swapped = resolveJourneyRoll(swap, 'alpha', 1);
assert.deepEqual(space(swapped), { route: 'main', space: 40 });
assert.deepEqual(swapped.players[1].location, { route: 'main', space: 26 });

const chained = resolveJourneyRoll(located({ route: 'main', space: 23 }), 'alpha', 1);
assert.deepEqual(space(chained), { route: 'prison', prison: 'deep' });
assert.ok(chained.events.some((event) => event.source === 'main:24'));
assert.ok(chained.events.some((event) => event.source === 'main:37'));
const automaticChainConfig: JourneyConfig = { ...plain(), traps: {
  12: { id: 'push-to-next-trap', name: 'Push to next trap', effect: { kind: 'move', to: 18 } },
  18: JOURNEY_TRAP_LIBRARY.captured,
} };
const automaticChain = resolveJourneyRoll(located({ route: 'main', space: 11 }), 'alpha', 1, automaticChainConfig);
assert.deepEqual(space(automaticChain), { route: 'prison', prison: 'holding' });
assert.ok(automaticChain.events.some((event) => event.source === 'main:18'));

const loopingTrap: JourneyConfig = { ...plain(), traps: { 24: { id: 'looping-test', name: 'Looping test', effect: { kind: 'move', to: 24, activateLanding: true } } } };
const stopped = resolveJourneyRoll(located({ route: 'main', space: 23 }), 'alpha', 1, loopingTrap);
assert.deepEqual(space(stopped), { route: 'main', space: 24 });
assert.equal(stopped.events.at(-1)?.reason, 'repeated-state');
const depthLimited = resolveJourneyRoll(located({ route: 'main', space: 23 }), 'alpha', 1,
  { ...loopingTrap, maximumChainDepth: 1 });
assert.equal(depthLimited.events.at(-1)?.reason, 'chain-depth-limit');

const choiceConfig: JourneyConfig = { ...plain(), traps: { 20: JOURNEY_TRAP_LIBRARY.rivals_choice } };
const chosen = resolveJourneyRoll(located({ route: 'main', space: 19 }, ['alpha', 'beta']), 'alpha', 1, choiceConfig);
assert.equal(chosen.pendingAction?.kind, 'choice');
assert.throws(() => resolveJourneyAction(chosen, 'alpha', 0, choiceConfig), /opposing player/);
assert.deepEqual(space(resolveJourneyAction(chosen, 'beta', 0, choiceConfig)), { route: 'main', space: 1 });

const finalChallenge = resolveJourneyRoll(located({ route: 'main', space: 49 }), 'alpha', 1);
assert.equal(finalChallenge.pendingAction?.kind, 'trial');
const passedFinalChallenge = resolveJourneyAction(finalChallenge, 'alpha', 0);
assert.deepEqual(space(passedFinalChallenge), { route: 'main', space: 50 });
assert.equal(passedFinalChallenge.status, 'playing');
assert.equal(passedFinalChallenge.players[0].correctAnswers, 2);
const homeStretch = resolveJourneyRoll(passedFinalChallenge, 'alpha', 1);
assert.equal(homeStretch.status, 'playing');
assert.deepEqual(space(homeStretch), { route: 'main', space: 51 });
let laps = resolveJourneyRoll(homeStretch, 'alpha', 1);
assert.equal(laps.players[0].completedLaps, 1);
assert.equal(laps.status, 'playing');
laps.players[0].location = { route: 'main', space: 51 };
laps = resolveJourneyRoll(laps, 'alpha', 1);
assert.equal(laps.players[0].completedLaps, 2);
assert.equal(laps.status, 'playing');
laps.players[0].location = { route: 'main', space: 51 };
const finished = resolveJourneyRoll(laps, 'alpha', 6);
assert.equal(finished.winnerId, 'alpha');
assert.equal(finished.players[0].status, 'FINISHED');
assert.equal(finished.players[0].completedLaps, 3);
assert.deepEqual(space(finished), { route: 'main', space: 1 });
const wrap = resolveJourneyRoll(located({ route: 'main', space: 49 }), 'alpha', 5, plain());
assert.deepEqual(space(wrap), { route: 'main', space: 3 });
assert.equal(wrap.players[0].completedLaps, 1);
const noLap = resolveJourneyMiss(located({ route: 'main', space: 51 }), 'alpha');
assert.equal(noLap.players[0].completedLaps, 0);
assert.equal(capped.players[0].completedLaps, 0);
assert.equal(passedSurprise.players[0].completedLaps, 0);
assert.equal(swapped.players[0].completedLaps, 0);
const legacy = located({ route: 'main', space: 51 });
delete legacy.players[0].completedLaps;
assert.equal(resolveJourneyRoll(legacy, 'alpha', 1).players[0].completedLaps, 1);

const cursedConfig: JourneyConfig = { ...plain(), traps: { 20: JOURNEY_TRAP_LIBRARY.cursed_step } };
const cursed = resolveJourneyRoll(located({ route: 'main', space: 19 }), 'alpha', 1, cursedConfig);
assert.deepEqual(space(cursed), { route: 'main', space: 20 });
assert.equal(cursed.players[0].pendingEffects.length, 1);
const afterCurse = resolveJourneyRoll(cursed, 'alpha', 2, cursedConfig);
assert.deepEqual(space(afterCurse), { route: 'main', space: 15 });
assert.equal(afterCurse.players[0].pendingEffects.length, 0);

const forcedFinishConfig: JourneyConfig = { ...plain(), traps: {
  30: { id: 'forced-finish', name: 'Forced finish', effect: { kind: 'move', to: 51 } },
} };
const forcedFinish = resolveJourneyRoll(located({ route: 'main', space: 29 }), 'alpha', 1, forcedFinishConfig);
// Space 30 is a loop entrance in the default graph; use another trap position.
assert.equal(forcedFinish.players[0].status, 'TRAPPED_IN_LOOP');
const jumpConfig: JourneyConfig = { ...plain(), traps: {
  28: { id: 'forced-finish', name: 'Forced finish', effect: { kind: 'move', to: 51 } },
} };
assert.deepEqual(space(resolveJourneyRoll(located({ route: 'main', space: 27 }), 'alpha', 1, jumpConfig)), { route: 'main', space: 49 });

let longMatch = located({ route: 'main', space: 50 });
for (let turn = 0; turn < 120; turn += 1) longMatch = resolveJourneyRoll(longMatch, 'alpha', 6, { ...plain(), winningLaps: 1000 });
assert.equal(longMatch.events.length, 100);
assert.ok(longMatch.events[0].sequence > 1);
assert.equal(longMatch.events.at(-1)?.sequence, longMatch.events[0].sequence + 99);

console.log('Biblical Journey rules, routes, traps, prisons, chains, and finish tests passed.');

assert.equal(SMALL_BOARD_CONFIG.finishSpace, 45);
assert.equal(SMALL_BOARD_POINTS.length, 45);
assert.equal(new Set(SMALL_BOARD_POINTS.map(({ x, y }) => `${x}:${y}`)).size, 45);
const smaller = (location: JourneyLocation) => {
  const game = located(location);
  game.boardSpaces = 45;
  return game;
};
const lap45 = resolveJourneyRoll(smaller({ route: 'main', space: 45 }), 'alpha', 1);
assert.equal(lap45.players[0].completedLaps, 1);
assert.deepEqual(space(lap45), { route: 'main', space: 1 });
const thirdLap45 = smaller({ route: 'main', space: 45 });
thirdLap45.players[0].completedLaps = 2;
assert.equal(resolveJourneyRoll(thirdLap45, 'alpha', 4).winnerId, 'alpha');
for (const [start, die] of [[1, 1], [1, 5], [8, 2]]) {
  const trials = smaller({ route: 'loop', space: start });
  trials.players[0].correctAnswers = 7;
  trials.players[0].loopEntryMainSpace = 26;
  const answered = resolveJourneyRoll(trials, 'alpha', die);
  assert.equal(answered.players[0].correctAnswers, 7, 'Trials moves and both exits award no points');
  assert.equal(resolveJourneyMiss(trials, 'alpha').players[0].correctAnswers, 7);
}
const enter45 = resolveJourneyRoll(smaller({ route: 'main', space: 19 }), 'alpha', 1);
assert.deepEqual(space(enter45), { route: 'loop', space: 1 });
assert.equal(enter45.players[0].correctAnswers, 1, 'Entering from the main path still earns a point');
assert.equal(journeyEventSquare(enter45.events.at(-1)!, SMALL_BOARD_CONFIG)?.tone, 'red');
const bonus45 = resolveJourneyRoll(smaller({ route: 'main', space: 4 }), 'alpha', 1);
assert.deepEqual(space(bonus45), { route: 'main', space: 15 });
assert.equal(journeyEventSquare(bonus45.events.at(-1)!, SMALL_BOARD_CONFIG)?.tone, 'gold');
const final45 = resolveJourneyRoll(smaller({ route: 'main', space: 43 }), 'alpha', 1);
const pass45 = resolveJourneyAction(final45, 'alpha', 0);
const fail45 = resolveJourneyAction(final45, 'alpha', 1);
assert.equal(journeyEventSquare(pass45.events.at(-1)!, SMALL_BOARD_CONFIG)?.tone, 'gold');
assert.equal(journeyEventSquare(fail45.events.at(-1)!, SMALL_BOARD_CONFIG)?.tone, 'red');
assert.deepEqual(space(pass45), { route: 'main', space: 44 });
const chain45 = resolveJourneyRoll(smaller({ route: 'main', space: 20 }), 'alpha', 1);
assert.deepEqual(space(chain45), { route: 'prison', prison: 'deep' });
const elevation45 = resolveJourneyRoll(smaller({ route: 'main', space: 35 }), 'alpha', 1);
assert.deepEqual(space(elevation45), { route: 'main', space: 37 });
const trialLoop = smaller({ route: 'loop', space: 2 });
trialLoop.pendingAction = { playerId: 'alpha', kind: 'trial', source: 'main:44', choices: [{ kind: 'no_op' }, { kind: 'no_op' }] };
assert.equal(resolveJourneyAction(trialLoop, 'alpha', 0).players[0].correctAnswers, 0);
console.log('45-space board, legacy compatibility, Trials scoring and outcome colors passed.');
