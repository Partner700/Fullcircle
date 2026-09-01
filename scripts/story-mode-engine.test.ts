import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_ACTIONS, storyActionAt, storyActionDuration } from '../src/screens/cadet/story-mode/actions.ts';
import {
  ABEL_LEVEL_SLUG,
  ABEL_QUESTION_CHECKPOINT,
  ABEL_START_CHECKPOINT,
  ANOTHER_OFFSPRING_LEVEL_SLUG,
  STORY_BOOKS,
  findStoryLevel,
  isStoryTimerSeconds,
  storyQuestionOptions,
} from '../src/screens/cadet/story-mode/content.ts';
import { INITIAL_STORY_MACHINE, transitionStoryState, type StoryMachineState } from '../src/screens/cadet/story-mode/engine.ts';
import type { StoryAnswerResult } from '../src/screens/cadet/story-mode/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const book = STORY_BOOKS[0];
const chapter = book.chapters[0];
assert.equal(book.numeral, 'Book I');
assert.equal(book.title, 'Beginnings');
assert.equal(chapter.title, 'Brothers');
assert.deepEqual(chapter.levels.map((level) => level.title), [
  'Abel Offering', 'Regard', 'At the Door', 'The Field', 'Your Brother', 'Another Offspring',
]);
assert.equal(chapter.levels.length, 6);
assert.equal(findStoryLevel(ABEL_LEVEL_SLUG)?.title, 'Abel Offering');
assert.equal(findStoryLevel(ANOTHER_OFFSPRING_LEVEL_SLUG)?.chapterConclusion, true);
assert.equal(findStoryLevel('seth-gameplay'), null, 'Future Seth gameplay must stay unavailable.');

const abelLevel = findStoryLevel(ABEL_LEVEL_SLUG);
assert.ok(abelLevel);
assert.deepEqual(abelLevel.scenes.map((scene) => scene.kind), ['narrative', 'movement', 'question_event', 'completion']);
assert.equal(abelLevel.scenes.find((scene) => scene.kind === 'question_event')?.checkpointId, ABEL_QUESTION_CHECKPOINT);

const doorRead = findStoryLevel('at-the-door')?.scenes.find((scene) => scene.kind === 'read');
assert.equal(doorRead?.scriptureReference, 'Genesis 4:6-7');
assert.match(doorRead?.readText || '', /sin is crouching at the door/i);
assert.match(doorRead?.readText || '', /must rule over it/i);

for (const timer of [5, 7, 10]) assert.equal(isStoryTimerSeconds(timer), true);
for (const timer of [0, 6, 8, 11]) assert.equal(isStoryTimerSeconds(timer), false);
assert.deepEqual(storyQuestionOptions('true_false', ['ignored']), ['True', 'False']);
assert.deepEqual(storyQuestionOptions('multiple_choice', ['A', 'B']), ['A', 'B']);

const expectedActions = [
  'idle', 'walk', 'run', 'stop', 'carry', 'kneel', 'offer', 'trip', 'fall', 'follow', 'pursue',
  'turn', 'confront', 'strike', 'recoil', 'collapse', 'lie_still', 'look_back', 'character_swap', 'fade',
] as const;
for (const action of expectedActions) {
  assert.ok(STORY_ACTIONS[action].durationMs > 0, `${action} needs a controlled duration.`);
  assert.match(STORY_ACTIONS[action].cssClass, /^story-action-/);
}
const correctActions = abelLevel.scenes.find((scene) => scene.kind === 'question_event')?.correctActions || [];
assert.deepEqual(correctActions, ['carry', 'walk', 'kneel', 'offer']);
assert.equal(storyActionAt(correctActions, 0).name, 'carry');
assert.equal(storyActionAt(correctActions, STORY_ACTIONS.carry.durationMs).name, 'walk');
assert.ok(storyActionDuration(correctActions) > 0);

const answerResult = (overrides: Partial<StoryAnswerResult> = {}): StoryAnswerResult => ({
  correct: true,
  timedOut: false,
  figsEarned: 3,
  denariiEarned: 0,
  totalFigs: 3,
  correctCount: 1,
  questionCount: 3,
  completionPercentage: 33,
  levelComplete: false,
  chapterComplete: false,
  canonicalEventPending: false,
  canonicalEventId: null,
  checkpointId: 'next-question',
  actionId: 'advance',
  explanation: 'Server explanation',
  replay: false,
  nextQuestion: null,
  levelsCompleted: 1,
  ...overrides,
});

let state: StoryMachineState = transitionStoryState(INITIAL_STORY_MACHINE, { type: 'HOME_READY' });
assert.equal(state.phase, 'home');
state = transitionStoryState(state, { type: 'START_LEVEL', checkpointId: ABEL_START_CHECKPOINT, checkpointState: 'intro' });
assert.equal(state.phase, 'intro');
state = transitionStoryState(state, { type: 'OPEN_READ' });
assert.equal(state.phase, 'reading');
state = transitionStoryState(state, { type: 'READ_COMPLETE' });
assert.equal(state.phase, 'intro');
state = transitionStoryState(state, { type: 'INTRO_COMPLETE' });
assert.equal(state.phase, 'walking');
state = transitionStoryState(state, { type: 'EVENT_REACHED', checkpointId: ABEL_QUESTION_CHECKPOINT });
state = transitionStoryState(state, { type: 'QUESTION_READY' });
assert.equal(state.phase, 'question_active');

let nextQuestionState = transitionStoryState(state, { type: 'ANSWER_CORRECT', result: answerResult() });
assert.equal(nextQuestionState.phase, 'correct_action');
nextQuestionState = transitionStoryState(nextQuestionState, { type: 'ACTION_COMPLETE' });
assert.equal(nextQuestionState.phase, 'checkpoint', 'A nonterminal correct answer must continue the scene, not end the level.');

let completeState = transitionStoryState(state, {
  type: 'ANSWER_CORRECT',
  result: answerResult({ levelComplete: true, completionPercentage: 100 }),
});
completeState = transitionStoryState(completeState, { type: 'ACTION_COMPLETE' });
assert.equal(completeState.phase, 'level_complete');

let canonicalState = transitionStoryState(state, {
  type: 'ANSWER_CORRECT',
  result: answerResult({ canonicalEventPending: true, canonicalEventId: 'abel-canonical-death' }),
});
canonicalState = transitionStoryState(canonicalState, { type: 'ACTION_COMPLETE' });
assert.equal(canonicalState.phase, 'canonical_transition');
canonicalState = transitionStoryState(canonicalState, {
  type: 'CANONICAL_EVENT_SETTLED',
  result: answerResult({ levelComplete: true, checkpointId: 'field-complete' }),
});
assert.equal(canonicalState.phase, 'level_complete');
assert.notEqual(canonicalState.phase, 'failure');

const restoredCanonical = transitionStoryState(INITIAL_STORY_MACHINE, {
  type: 'START_LEVEL', checkpointId: 'field-canonical-event', checkpointState: 'canonical_event',
});
assert.equal(restoredCanonical.phase, 'canonical_transition');

const chapterState = transitionStoryState(restoredCanonical, {
  type: 'CANONICAL_EVENT_SETTLED',
  result: answerResult({ levelComplete: true, chapterComplete: true, levelsCompleted: 6 }),
});
assert.equal(chapterState.phase, 'chapter_complete');

let failureState = transitionStoryState(state, {
  type: 'ANSWER_WRONG', result: answerResult({ correct: false, figsEarned: 0, timedOut: true }),
});
failureState = transitionStoryState(failureState, { type: 'ACTION_COMPLETE' });
assert.equal(failureState.phase, 'failure');
failureState = transitionStoryState(failureState, { type: 'RETRY' });
assert.equal(failureState.phase, 'checkpoint');

const player = read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx');
const world = read('src/screens/cadet/story-mode/StoryWorld.tsx');
const home = read('src/screens/cadet/story-mode/StoryModeHome.tsx');
const shell = read('src/screens/cadet/story-mode/StoryModeShell.tsx');
assert.doesNotMatch(player, /ABEL_/);
assert.match(player, /settleStoryCanonicalEvent/);
assert.match(player, /The question timer is stopped while Scripture is open/);
assert.match(world, /scene\.characters\.map/);
assert.match(world, /story-obstacle-/);
assert.match(home, /book\.chapters\.map/);
assert.match(home, /Next chronological character/);
assert.match(shell, /findStoryLevel\(attempt\.levelSlug\)/);
assert.match(shell, /startStoryModeLevel\(levelSlug\)/);

const clientStorySource = fs.readdirSync(path.join(root, 'src/screens/cadet/story-mode'))
  .filter((entry) => /\.(?:ts|tsx)$/.test(entry))
  .map((entry) => read(path.join('src/screens/cadet/story-mode', entry)))
  .join('\n');
assert.doesNotMatch(clientStorySource, /correctAnswer|correct_answer/);
assert.doesNotMatch(clientStorySource, /correctAnswerId|answerKey/);

console.log('Story Mode engine and Brothers chapter client checks passed.');
