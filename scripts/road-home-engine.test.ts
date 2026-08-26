import assert from 'node:assert/strict';
import {
  applyRoadHomeCommand,
  createRoadHomeGame,
  legalPawnIds,
  normalizeRoadHomeEconomyState,
  publicRoadHomeState,
  ROAD_HOME_CONFIG,
  type RoadHomeState,
} from '../supabase/functions/_shared/road-home-engine.ts';

const participants = [
  { id: 'player-a', name: 'A' },
  { id: 'player-b', name: 'B' },
  { id: 'player-c', name: 'C' },
];

const fixed = (value: number) => () => value;
const game = () => createRoadHomeGame('test-room', participants, [], fixed(0.5));

function makeSelectable(state: RoadHomeState, value: number, pawnId: string) {
  state.phase = 'SELECTING_PAWN';
  state.pendingMoveValue = value;
  state.diceValue = value;
  state.legalPawnIds = [pawnId];
  state.moveContinuation = 'END_TURN';
}

assert.equal(ROAD_HOME_CONFIG.startingMatchDenarii, 50);
assert.deepEqual(ROAD_HOME_CONFIG.rewards, {
  ownQuestion: 10,
  inheritedQuestion: 20,
  inheritedPenalty: 20,
  capture: 30,
  pawnHome: 40,
  firstPlace: 100,
});

// Correct normal question: roll 4, earn 10 Match Denarii, then move four.
{
  let state = game();
  const player = state.players[0];
  player.pawns[0].progress = 0;
  const before = player.matchDenarii;
  state = applyRoadHomeCommand(state, player.id, { action: 'ROLL' }, [], fixed(0.51));
  assert.equal(state.diceValue, 4);
  assert.equal(state.currentQuestion?.timerSeconds, 14);
  const answer = state.currentQuestion!.correctAnswer;
  state = applyRoadHomeCommand(state, player.id, { action: 'ANSWER', answer }, [], fixed(0.1));
  assert.equal(state.phase, 'SELECTING_PAWN');
  assert.equal(state.players[0].matchDenarii, before + ROAD_HOME_CONFIG.rewards.ownQuestion);
  state = applyRoadHomeCommand(state, player.id, { action: 'MOVE', pawnId: player.pawns[0].id }, [], fixed(0.1));
  assert.equal(state.players[0].pawns[0].progress, 4);
}

// Arena difficulty timers become shorter as the question becomes harder.
{
  const easy = game();
  easy.players[0].pawns[0].progress = 0;
  const easyQuestion = applyRoadHomeCommand(easy, easy.players[0].id, { action: 'ROLL' }, [], fixed(0.01));
  assert.equal(easyQuestion.diceValue, 1);
  assert.equal(easyQuestion.currentQuestion?.timerSeconds, 17);

  const hard = game();
  hard.players[0].pawns[0].progress = 0;
  const hardQuestion = applyRoadHomeCommand(hard, hard.players[0].id, { action: 'ROLL' }, [], fixed(0.7));
  assert.equal(hardQuestion.diceValue, 5);
  assert.equal(hardQuestion.currentQuestion?.timerSeconds, 11);
}

// Failed question creates a FIFO inherited challenge; the next player can claim it.
{
  let state = game();
  const origin = state.players[0];
  const inheritor = state.players[1];
  origin.pawns[0].progress = 0;
  inheritor.pawns[0].progress = 0;
  state = applyRoadHomeCommand(state, origin.id, { action: 'ROLL' }, [], fixed(0.7));
  assert.equal(state.diceValue, 5);
  state = applyRoadHomeCommand(state, origin.id, { action: 'ANSWER', answer: 'wrong' }, [], fixed(0.1));
  assert.equal(state.challengeQueue.length, 1);
  assert.equal(state.phase, 'INHERITED_OFFER');
  state = applyRoadHomeCommand(state, inheritor.id, { action: 'CHALLENGE_DECISION', decision: 'accept' }, [], fixed(0.1));
  const answer = state.currentQuestion!.correctAnswer;
  state = applyRoadHomeCommand(state, inheritor.id, { action: 'ANSWER', answer }, [], fixed(0.1));
  assert.equal(state.pendingMoveValue, 5);
  state = applyRoadHomeCommand(state, inheritor.id, { action: 'MOVE', pawnId: inheritor.pawns[0].id }, [], fixed(0.1));
  assert.equal(state.players[1].pawns[0].progress, 5);
  assert.equal(state.phase, 'AWAITING_ROLL');
}

// Declining an inherited challenge forfeits the whole normal turn.
{
  let state = game();
  state.players[0].pawns[0].progress = 0;
  state = applyRoadHomeCommand(state, state.players[0].id, { action: 'ROLL' }, [], fixed(0.2));
  state = applyRoadHomeCommand(state, state.players[0].id, { action: 'ANSWER', answer: 'wrong' }, [], fixed(0.1));
  const decliningId = state.players[state.activePlayerIndex].id;
  state = applyRoadHomeCommand(state, decliningId, { action: 'CHALLENGE_DECISION', decision: 'decline' }, [], fixed(0.1));
  assert.notEqual(state.players[state.activePlayerIndex].id, decliningId);
}

// Exact Home entry excludes an overshooting pawn.
{
  const state = game();
  const player = state.players[0];
  player.pawns[0].progress = ROAD_HOME_CONFIG.finalHome - 2;
  assert.deepEqual(legalPawnIds(state, player.id, 3), []);
  assert.deepEqual(legalPawnIds(state, player.id, 2), [player.pawns[0].id]);
}

// Capture returns a single unsafe opponent pawn to base and awards 30 Match Denarii.
{
  let state = game();
  const attacker = state.players[0];
  const victim = state.players[1];
  attacker.pawns[0].progress = 0;
  const targetGlobal = (attacker.startOffset + 3) % 52;
  victim.pawns[0].progress = (targetGlobal - victim.startOffset + 52) % 52;
  const before = attacker.matchDenarii;
  makeSelectable(state, 3, attacker.pawns[0].id);
  state = applyRoadHomeCommand(state, attacker.id, { action: 'MOVE', pawnId: attacker.pawns[0].id }, [], fixed(0.1));
  assert.equal(state.players[1].pawns[0].progress, -1);
  assert.equal(state.players[0].matchDenarii, before + ROAD_HOME_CONFIG.rewards.capture);
}

// Two enemy pawns form a blockade that cannot be crossed.
{
  const state = game();
  const mover = state.players[0];
  const blocker = state.players[1];
  mover.pawns[0].progress = 0;
  const blockedGlobal = (mover.startOffset + 3) % 52;
  const blockerProgress = (blockedGlobal - blocker.startOffset + 52) % 52;
  blocker.pawns[0].progress = blockerProgress;
  blocker.pawns[1].progress = blockerProgress;
  assert.deepEqual(legalPawnIds(state, mover.id, 4), []);
}

// Private state upgrades old temporary Denarii without changing the amount.
{
  const legacy = game() as RoadHomeState;
  const expected = legacy.players[0].matchDenarii;
  delete (legacy.players[0] as any).matchDenarii;
  (legacy.players[0] as any).denarii = expected;
  delete (legacy.players[0].stats as any).matchDenariiEarned;
  delete (legacy.players[0].stats as any).matchDenariiSpent;
  (legacy.players[0].stats as any).denariiEarned = 12;
  (legacy.players[0].stats as any).denariiSpent = 4;
  const normalized = normalizeRoadHomeEconomyState(legacy);
  assert.equal(normalized.players[0].matchDenarii, expected);
  assert.equal(normalized.players[0].stats.matchDenariiEarned, 12);
  assert.equal(normalized.players[0].stats.matchDenariiSpent, 4);
  assert.equal(normalized.players[0].denarii, undefined);
  const publicState = publicRoadHomeState(normalized);
  assert.equal(publicState.players[0].denarii, expected, 'cached old clients receive a read-only public alias');
}

console.log('Road Home engine acceptance tests passed.');
