import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORY_ACTIONS,
  storyActionAt,
  storyActionDuration,
} from '../src/screens/cadet/story-mode/actions.ts';
import {
  ABEL_LEVEL_SLUG,
  ABEL_QUESTION_CHECKPOINT,
  ABEL_START_CHECKPOINT,
  STORY_BOOKS,
  findStoryLevel,
  isStoryTimerSeconds,
  storyQuestionOptions,
} from '../src/screens/cadet/story-mode/content.ts';
import {
  INITIAL_STORY_MACHINE,
  transitionStoryState,
  type StoryMachineState,
} from '../src/screens/cadet/story-mode/engine.ts';
import type { StoryAnswerResult, StorySceneDefinition } from '../src/screens/cadet/story-mode/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const book = STORY_BOOKS[0];
const chapter = book.chapters[0];
const level = chapter.levels[0];
assert.equal(book.numeral, 'Book I');
assert.equal(book.title, 'Beginnings');
assert.equal(chapter.title, 'Brothers');
assert.equal(level.slug, ABEL_LEVEL_SLUG);
assert.equal(level.title, 'Abel Offering');
assert.equal(findStoryLevel(ABEL_LEVEL_SLUG), level);
assert.equal(findStoryLevel('locked-future-level'), null);
assert.deepEqual(level.scenes.map((scene) => scene.kind), [
  'narrative',
  'movement',
  'question_event',
  'completion',
]);
assert.equal(level.scenes.find((scene) => scene.kind === 'question_event')?.checkpointId, ABEL_QUESTION_CHECKPOINT);
const questionScene = level.scenes.find((scene) => scene.kind === 'question_event');
const correctActions = questionScene?.correctActions || [];
const wrongActions = questionScene?.wrongActions || [];

const futureReadMoment: StorySceneDefinition = {
  id: 'read-genesis-4',
  kind: 'read',
  environment: level.scenes[0].environment,
  character: 'abel',
  action: 'stop',
  scriptureReference: 'Genesis 4:1-4',
  nextSceneId: level.openingSceneId,
};
assert.equal(futureReadMoment.kind, 'read');
assert.equal(futureReadMoment.scriptureReference, 'Genesis 4:1-4');

for (const timer of [5, 7, 10]) assert.equal(isStoryTimerSeconds(timer), true, `${timer}s must be supported.`);
for (const timer of [0, 6, 8, 11]) assert.equal(isStoryTimerSeconds(timer), false, `${timer}s must remain invalid.`);
assert.deepEqual(storyQuestionOptions('true_false', ['ignored']), ['True', 'False']);
assert.deepEqual(storyQuestionOptions('multiple_choice', ['A', 'B']), ['A', 'B']);

for (const action of ['idle', 'walk', 'run', 'stop', 'carry', 'kneel', 'offer', 'trip', 'fall', 'fade'] as const) {
  assert.ok(STORY_ACTIONS[action].durationMs > 0, `${action} needs a controlled duration.`);
  assert.ok(STORY_ACTIONS[action].cssClass.startsWith('story-action-'));
}
assert.deepEqual(correctActions, ['carry', 'walk', 'kneel', 'offer']);
assert.deepEqual(wrongActions, ['carry', 'trip', 'fall', 'fade']);
assert.equal(storyActionAt(correctActions, 0).name, 'carry');
assert.equal(storyActionAt(correctActions, STORY_ACTIONS.carry.durationMs).name, 'walk');
assert.ok(storyActionDuration(correctActions) > storyActionDuration(wrongActions));

const answerResult = (correct: boolean, timedOut = false): StoryAnswerResult => ({
  correct,
  timedOut,
  figsEarned: correct ? 3 : 0,
  denariiEarned: 0,
  totalFigs: correct ? 3 : 0,
  correctCount: correct ? 1 : 0,
  questionCount: 1,
  completionPercentage: correct ? 100 : 0,
  levelComplete: correct,
  checkpointId: correct ? 'abel-offering-complete' : ABEL_QUESTION_CHECKPOINT,
  actionId: correct ? 'offer-firstborn' : 'offering-misdirection',
  explanation: 'Server explanation',
  replay: false,
});

let state: StoryMachineState = INITIAL_STORY_MACHINE;
assert.equal(state.phase, 'loading');
state = transitionStoryState(state, { type: 'HOME_READY' });
assert.equal(state.phase, 'home');
state = transitionStoryState(state, { type: 'OPEN_BROWSER' });
assert.equal(state.phase, 'browser');
state = transitionStoryState(state, { type: 'CLOSE_BROWSER' });
assert.equal(state.phase, 'home');
state = transitionStoryState(state, {
  type: 'START_LEVEL',
  checkpointId: ABEL_START_CHECKPOINT,
  checkpointState: 'intro',
});
assert.equal(state.phase, 'intro');
state = transitionStoryState(state, { type: 'OPEN_READ' });
assert.equal(state.phase, 'reading');
state = transitionStoryState(state, { type: 'READ_COMPLETE' });
assert.equal(state.phase, 'intro');
state = transitionStoryState(state, { type: 'INTRO_COMPLETE' });
assert.equal(state.phase, 'walking');
state = transitionStoryState(state, { type: 'BEGIN_RUN' });
assert.equal(state.phase, 'running');
state = transitionStoryState(state, { type: 'STOP_RUNNING' });
assert.equal(state.phase, 'walking');
state = transitionStoryState(state, { type: 'EVENT_REACHED', checkpointId: ABEL_QUESTION_CHECKPOINT });
assert.equal(state.phase, 'question_approach');
assert.equal(state.checkpointId, ABEL_QUESTION_CHECKPOINT);
state = transitionStoryState(state, { type: 'QUESTION_READY' });
assert.equal(state.phase, 'question_active');

const paused = transitionStoryState(state, { type: 'PAUSE' });
assert.equal(paused.phase, 'paused');
assert.equal(paused.resumePhase, 'question_active');
state = transitionStoryState(paused, { type: 'RESUME' });
assert.equal(state.phase, 'question_active');

let correctState = transitionStoryState(state, { type: 'ANSWER_CORRECT', result: answerResult(true) });
assert.equal(correctState.phase, 'correct_action');
correctState = transitionStoryState(correctState, { type: 'ACTION_COMPLETE' });
assert.equal(correctState.phase, 'level_complete');
let transitionState = transitionStoryState(correctState, { type: 'BEGIN_CHARACTER_TRANSITION' });
assert.equal(transitionState.phase, 'character_transition');
transitionState = transitionStoryState(transitionState, { type: 'COMPLETE_CHAPTER' });
assert.equal(transitionState.phase, 'chapter_complete');
transitionState = transitionStoryState(transitionState, { type: 'COMPLETE_BOOK' });
assert.equal(transitionState.phase, 'book_complete');

let wrongState = transitionStoryState(state, { type: 'ANSWER_WRONG', result: answerResult(false) });
assert.equal(wrongState.phase, 'wrong_action');
wrongState = transitionStoryState(wrongState, { type: 'ACTION_COMPLETE' });
assert.equal(wrongState.phase, 'failure');
wrongState = transitionStoryState(wrongState, { type: 'RETRY' });
assert.equal(wrongState.phase, 'checkpoint');
wrongState = transitionStoryState(wrongState, { type: 'CHECKPOINT_READY' });
assert.equal(wrongState.phase, 'question_approach');

const timeoutState = transitionStoryState(state, { type: 'ANSWER_WRONG', result: answerResult(false, true) });
assert.equal(timeoutState.result?.timedOut, true);
assert.equal(timeoutState.result?.figsEarned, 0);

const restored = transitionStoryState(INITIAL_STORY_MACHINE, {
  type: 'START_LEVEL',
  checkpointId: ABEL_QUESTION_CHECKPOINT,
  checkpointState: 'question_approach',
});
assert.equal(restored.phase, 'checkpoint');
const restoredQuestion = transitionStoryState(INITIAL_STORY_MACHINE, {
  type: 'START_LEVEL',
  checkpointId: ABEL_QUESTION_CHECKPOINT,
  checkpointState: 'question_approach',
  questionActive: true,
});
assert.equal(restoredQuestion.phase, 'question_active');
const restoredPaused = transitionStoryState(INITIAL_STORY_MACHINE, {
  type: 'START_LEVEL',
  checkpointId: ABEL_QUESTION_CHECKPOINT,
  checkpointState: 'question_approach',
  questionActive: true,
  paused: true,
});
assert.equal(restoredPaused.phase, 'paused');
assert.equal(transitionStoryState(restoredPaused, { type: 'RESUME' }).phase, 'question_active');

const home = read('src/screens/cadet/story-mode/StoryModeHome.tsx');
const shell = read('src/screens/cadet/story-mode/StoryModeShell.tsx');
const levelUi = read('src/screens/cadet/story-mode/AbelOfferingLevel.tsx');
const levelPlayer = read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx');
assert.match(home, /Story Mode/);
assert.match(home, /Book I/);
assert.match(home, /Chapter \{chapter\.order\}/);
assert.match(home, /Abel Offering|ABEL_OFFERING_LEVEL\.title/);
assert.match(home, /Continue Journey/);
assert.match(home, /Browse Journey/);
assert.match(home, /Replay Level/);
assert.match(shell, /startStoryModeLevel\(ABEL_LEVEL_SLUG\)/);
assert.match(levelUi, /StoryLevelPlayer/);
assert.match(levelUi, /ABEL_OFFERING_LEVEL/);
assert.match(levelPlayer, /level\.scenes/);
assert.match(levelPlayer, /correctActions/);
assert.match(levelPlayer, /wrongActions/);
assert.doesNotMatch(levelPlayer, /ABEL_/);
assert.match(levelPlayer, /StoryQuestionOverlay/);
assert.match(levelPlayer, /Retry checkpoint/);
assert.match(levelPlayer, /pendingSubmissionRef/);
assert.match(levelPlayer, /Retry answer/);
assert.match(levelPlayer, /Replay level/);
assert.match(levelPlayer, /Browse journey/);

const clientStorySource = fs.readdirSync(path.join(root, 'src/screens/cadet/story-mode'))
  .filter((entry) => /\.(?:ts|tsx)$/.test(entry))
  .map((entry) => read(path.join('src/screens/cadet/story-mode', entry)))
  .join('\n');
assert.doesNotMatch(clientStorySource, /correctAnswer|correct_answer/);
assert.doesNotMatch(clientStorySource, /The firstborn of his flock and their fat portions/);

console.log('Story Mode engine and Abel vertical-slice checks passed.');
