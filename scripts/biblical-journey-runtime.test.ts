import assert from 'node:assert/strict';
import {
  advanceMachineJourney, answerJourneyQuestion, createJourneyRuntime, expireJourneyQuestion, journeyAnswerIsCorrect,
  machineJourneyMayAct,
  publicJourneyRuntime, rollJourneyDie, serveJourneySentence, type JourneyQuestion, type JourneyRuntime,
} from '../supabase/functions/_shared/biblicalJourneyRuntime.ts';
import { JOURNEY_MACHINE_ID } from '../supabase/functions/_shared/biblicalJourney.ts';

const catalog: JourneyQuestion[] = Array.from({ length: 5 }, (_, stageIndex) =>
  Array.from({ length: 10 }, (_, index): JourneyQuestion => ({
    id: `stage-${stageIndex + 1}-question-${index + 1}`,
    stage: stageIndex + 1,
    type: 'multiple_choice',
    question: `Which answer belongs to Stage ${stageIndex + 1}, question ${index + 1}?`,
    options: ['Correct', 'Incorrect', 'Another option'],
    correctAnswer: 'Correct',
    acceptedAnswers: [],
    reference: '2 Kings 2:1',
    explanation: 'The reviewed answer is Correct.',
  })),
).flat();
const byId = new Map(catalog.map((question) => [question.id, question]));
const lookup = async (id: string) => byId.get(id) || null;
const first = () => 0;
function ready(runtime: JourneyRuntime) {
  const next = runtime.awaitingRoll ? rollJourneyDie(runtime, runtime.currentQuestionPlayerId!, first) : structuredClone(runtime);
  next.questionOpensAt = new Date(Date.now() - 1).toISOString();
  return next;
}

assert.equal(journeyAnswerIsCorrect(catalog[0], 'correct!'), true);
assert.equal(journeyAnswerIsCorrect(catalog[0], 'incorrect'), false);
const truth = { ...catalog[0], type: 'true_false' as const, correctAnswer: 'true' };
assert.equal(journeyAnswerIsCorrect(truth, 'YES'), true);
assert.equal(journeyAnswerIsCorrect(truth, ''), false);

const start = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
assert.equal(start.currentQuestion?.id, 'stage-1-question-1');
assert.equal(start.currentQuestionPlayerId, 'alpha');
assert.equal(start.awaitingRoll, true);
assert.equal(start.questionDeadline, null);
assert.deepEqual(start.usedQuestionIds, ['stage-1-question-1']);
const publicStart = publicJourneyRuntime(start);
assert.equal(publicStart.currentQuestion, null);
assert.equal('correctAnswer' in (publicStart.currentQuestion || {}), false);
assert.equal('questionIdsByStage' in publicStart, false);
assert.equal('usedQuestionIds' in publicStart, false);
assert.equal(publicStart.questionDeadline, start.questionDeadline);
assert.equal(JSON.stringify(publicStart).includes('The reviewed answer is Correct.'), false);

await assert.rejects(() => answerJourneyQuestion(start, 'alpha', 'Correct', lookup, first), /not open/);
assert.throws(() => rollJourneyDie(start, 'beta', first), /not your turn/);
const rolled = rollJourneyDie(start, 'alpha', first);
assert.equal(rolled.pendingDie, 1);
assert.equal(rolled.game.version, start.game.version + 1);
assert.equal(Date.parse(rolled.questionDeadline!) - Date.parse(rolled.questionOpensAt!), 30_000);
assert.equal(publicJourneyRuntime(rolled).currentQuestion?.question, catalog[0].question);
assert.equal('correctAnswer' in publicJourneyRuntime(rolled).currentQuestion!, false);
assert.throws(() => rollJourneyDie(rolled, 'alpha', first), /not your turn/);
await assert.rejects(() => answerJourneyQuestion(rolled, 'alpha', 'Correct', lookup, first), /Wait for the question/);
const correct = await answerJourneyQuestion(ready(rolled), 'alpha', 'Correct', lookup, () => 0.99);
assert.equal(correct.game.players[0].correctAnswers, 1);
assert.deepEqual(correct.game.players[0].location, { route: 'main', space: 2 });
assert.equal(correct.game.turnIndex, 1);
assert.equal(correct.lastVerdict?.die, 1);
assert.equal(correct.lastVerdict?.question, catalog[0].question);
assert.equal(correct.currentQuestionPlayerId, 'beta');
assert.equal(correct.awaitingRoll, true);
assert.deepEqual(start.game.players[0].location, { route: 'main', space: 1 });
await assert.rejects(() => answerJourneyQuestion(correct, 'alpha', 'Correct', lookup, first), /not open for you/);

const missed = await answerJourneyQuestion(ready(correct), 'beta', 'Incorrect', lookup, first);
assert.equal(missed.game.players[1].correctAnswers, 0);
assert.deepEqual(missed.game.players[1].location, { route: 'main', space: 1 });
assert.equal(missed.game.turnIndex, 0);
assert.equal(missed.lastVerdict?.correct, false);
assert.ok(missed.currentQuestion?.id !== correct.currentQuestion?.id);

const expired = ready(start);
expired.questionDeadline = new Date(Date.now() - 1000).toISOString();
const expiredMove = await expireJourneyQuestion(expired, lookup, first);
assert.equal(expiredMove.lastVerdict?.correct, false);
assert.equal(expiredMove.lastVerdict?.selectedAnswer, 'Time expired');
assert.equal(expiredMove.game.players[0].correctAnswers, 0);
const lateAnswer = await answerJourneyQuestion(expired, 'alpha', 'Correct', lookup, first);
assert.equal(lateAnswer.lastVerdict?.correct, false);
await assert.rejects(() => expireJourneyQuestion(start, lookup, first), /not timed out/);

const loopStart = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
loopStart.game.players[0].location = { route: 'loop', space: 1 };
loopStart.game.players[0].status = 'TRAPPED_IN_LOOP';
loopStart.game.players[0].loopEntryMainSpace = 26;
const loopMove = await answerJourneyQuestion(ready(loopStart), 'alpha', 'Correct', lookup, first);
assert.equal(loopMove.game.players[0].correctAnswers, 0);
const betaMove = await answerJourneyQuestion(ready(loopMove), 'beta', 'Incorrect', lookup, first);
assert.equal(betaMove.currentQuestionPlayerId, 'alpha');
assert.equal(betaMove.currentQuestion?.stage, 3);

const trialStart = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
trialStart.game.players[0].location = { route: 'main', space: 43 };
const trial = await answerJourneyQuestion(ready(trialStart), 'alpha', 'Correct', lookup, first);
assert.equal(trial.game.pendingAction?.kind, 'trial');
assert.equal(trial.currentQuestion?.stage, 5);
assert.equal(trial.currentQuestionPlayerId, 'alpha');
assert.equal(trial.awaitingRoll, false);
const trialPassed = await answerJourneyQuestion(ready(trial), 'alpha', 'Correct', lookup, first);
assert.equal(trialPassed.game.players[0].correctAnswers, 2);
assert.equal(trialPassed.game.turnIndex, 1);
assert.equal(trialPassed.game.pendingAction, null);

const trialFailed = await answerJourneyQuestion(ready(trial), 'alpha', 'Incorrect', lookup, first);
assert.deepEqual(trialFailed.game.players[0].location, { route: 'prison', prison: 'deep' });
assert.equal(trialFailed.game.players[0].correctAnswers, 1);
assert.equal(trialFailed.currentQuestionPlayerId, 'beta');

const prisoner = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
prisoner.game.players[0].location = { route: 'prison', prison: 'holding' };
prisoner.game.players[0].status = 'IN_HOLDING_PRISON';
prisoner.game.players[0].savedLocation = { route: 'main', space: 1 };
prisoner.game.players[0].prisonTurnsRemaining = 2;
prisoner.currentQuestion = null;
prisoner.currentQuestionPlayerId = null;
const served = await serveJourneySentence(prisoner, 'alpha', lookup, first);
assert.equal(served.game.players[0].prisonTurnsRemaining, 1);
assert.equal(served.currentQuestionPlayerId, 'beta');

const machineStart = await createJourneyRuntime('elisha', ['alpha', JOURNEY_MACHINE_ID], catalog, lookup, first);
assert.equal(machineJourneyMayAct(machineStart), false);
const humanMoved = await answerJourneyQuestion(ready(machineStart), 'alpha', 'Correct', lookup, first);
assert.equal(machineJourneyMayAct(humanMoved), true);
const botRolled = await advanceMachineJourney(humanMoved, lookup, first, 1);
assert.equal(botRolled.pendingDie, 1);
assert.equal(botRolled.lastVerdict, null);
assert.equal(botRolled.game.players[1].correctAnswers, 0);
const botMoved = await advanceMachineJourney(ready(botRolled), lookup, first, 1);
assert.equal(botMoved.game.players[1].correctAnswers, 1);
assert.deepEqual(botMoved.game.players[1].location, { route: 'main', space: 2 });
assert.equal(botMoved.game.turnIndex, 0);
assert.equal(botMoved.lastVerdict?.playerId, JOURNEY_MACHINE_ID);
assert.equal(botMoved.lastVerdict?.correct, true);
assert.equal(machineJourneyMayAct(botMoved), false);

const botMissed = await advanceMachineJourney(ready(botRolled), lookup, first, 0);
assert.equal(botMissed.game.players[1].correctAnswers, 0);
assert.equal(botMissed.lastVerdict?.selectedAnswer, 'No answer');
assert.equal(botMissed.lastVerdict?.correct, false);
await assert.rejects(() => advanceMachineJourney(machineStart, lookup, first, 1), /Scribe's turn/);

const botPrison = structuredClone(humanMoved);
botPrison.game.players[1].location = { route: 'prison', prison: 'holding' };
botPrison.game.players[1].status = 'IN_HOLDING_PRISON';
botPrison.game.players[1].savedLocation = { route: 'main', space: 1 };
botPrison.game.players[1].prisonTurnsRemaining = 2;
botPrison.currentQuestion = null;
botPrison.currentQuestionPlayerId = null;
botPrison.awaitingRoll = false;
const botServed = await advanceMachineJourney(botPrison, lookup, first, 1);
assert.equal(botServed.game.players[1].prisonTurnsRemaining, 1);
assert.equal(botServed.game.turnIndex, 0);

const botChoice = structuredClone(humanMoved);
botChoice.game.pendingAction = { playerId: 'alpha', kind: 'choice', source: 'test',
  choices: [{ kind: 'move', by: -7 }, { kind: 'prison', prison: 'deep' }] };
botChoice.currentQuestion = null;
botChoice.currentQuestionPlayerId = null;
botChoice.awaitingRoll = false;
assert.equal(machineJourneyMayAct(botChoice), true);
const choiceResolved = await advanceMachineJourney(botChoice, lookup, first, 1);
assert.equal(choiceResolved.game.pendingAction, null);
botChoice.game.pendingAction.playerId = JOURNEY_MACHINE_ID;
assert.equal(machineJourneyMayAct(botChoice), false);

await assert.rejects(
  () => createJourneyRuntime('elisha', ['alpha'], catalog.filter((question) => question.stage !== 5), lookup, first),
  /Stage 5 needs ten approved questions/,
);

console.log('Biblical Journey question secrecy, human and machine turns, trials, and prison tests passed.');
