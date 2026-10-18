import assert from 'node:assert/strict';
import {
  answerJourneyQuestion, createJourneyRuntime, journeyAnswerIsCorrect,
  publicJourneyRuntime, serveJourneySentence, type JourneyQuestion,
} from '../supabase/functions/_shared/biblicalJourneyRuntime.ts';

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

assert.equal(journeyAnswerIsCorrect(catalog[0], 'correct!'), true);
assert.equal(journeyAnswerIsCorrect(catalog[0], 'incorrect'), false);
const truth = { ...catalog[0], type: 'true_false' as const, correctAnswer: 'true' };
assert.equal(journeyAnswerIsCorrect(truth, 'YES'), true);
assert.equal(journeyAnswerIsCorrect(truth, ''), false);

const start = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
assert.equal(start.currentQuestion?.id, 'stage-1-question-1');
assert.equal(start.currentQuestionPlayerId, 'alpha');
assert.deepEqual(start.usedQuestionIds, ['stage-1-question-1']);
const publicStart = publicJourneyRuntime(start);
assert.equal(publicStart.currentQuestion?.question, catalog[0].question);
assert.equal('correctAnswer' in (publicStart.currentQuestion || {}), false);
assert.equal('questionIdsByStage' in publicStart, false);
assert.equal('usedQuestionIds' in publicStart, false);
assert.equal(JSON.stringify(publicStart).includes('The reviewed answer is Correct.'), false);

const correct = await answerJourneyQuestion(start, 'alpha', 'Correct', lookup, first);
assert.equal(correct.game.players[0].correctAnswers, 1);
assert.deepEqual(correct.game.players[0].location, { route: 'main', space: 2 });
assert.equal(correct.game.turnIndex, 1);
assert.equal(correct.lastVerdict?.die, 1);
assert.equal(correct.currentQuestionPlayerId, 'beta');
assert.equal(correct.currentQuestion?.id, 'stage-1-question-2');
assert.deepEqual(start.game.players[0].location, { route: 'main', space: 1 });
assert.rejects(() => answerJourneyQuestion(correct, 'alpha', 'Correct', lookup, first), /not open for you/);

const missed = await answerJourneyQuestion(correct, 'beta', 'Incorrect', lookup, first);
assert.equal(missed.game.players[1].correctAnswers, 0);
assert.deepEqual(missed.game.players[1].location, { route: 'main', space: 1 });
assert.equal(missed.game.turnIndex, 0);
assert.equal(missed.lastVerdict?.correct, false);
assert.equal(missed.currentQuestion?.id, 'stage-1-question-3');

const loopStart = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
loopStart.game.players[0].location = { route: 'loop', space: 1 };
loopStart.game.players[0].status = 'TRAPPED_IN_LOOP';
loopStart.game.players[0].loopEntryMainSpace = 30;
const loopMove = await answerJourneyQuestion(loopStart, 'alpha', 'Correct', lookup, first);
const betaMove = await answerJourneyQuestion(loopMove, 'beta', 'Incorrect', lookup, first);
assert.equal(betaMove.currentQuestionPlayerId, 'alpha');
assert.equal(betaMove.currentQuestion?.stage, 3);

const trialStart = await createJourneyRuntime('elisha', ['alpha', 'beta'], catalog, lookup, first);
trialStart.game.players[0].location = { route: 'main', space: 49 };
const trial = await answerJourneyQuestion(trialStart, 'alpha', 'Correct', lookup, first);
assert.equal(trial.game.pendingAction?.kind, 'trial');
assert.equal(trial.currentQuestion?.stage, 5);
assert.equal(trial.currentQuestionPlayerId, 'alpha');
const trialPassed = await answerJourneyQuestion(trial, 'alpha', 'Correct', lookup, first);
assert.equal(trialPassed.game.players[0].correctAnswers, 2);
assert.equal(trialPassed.game.turnIndex, 1);
assert.equal(trialPassed.game.pendingAction, null);

const trialFailed = await answerJourneyQuestion(trial, 'alpha', 'Incorrect', lookup, first);
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

await assert.rejects(
  () => createJourneyRuntime('elisha', ['alpha'], catalog.filter((question) => question.stage !== 5), lookup, first),
  /Stage 5 needs ten approved questions/,
);

console.log('Biblical Journey question secrecy, answer validation, turn flow, and trial tests passed.');
