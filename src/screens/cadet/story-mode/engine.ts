import type { StoryActionName, StoryAnswerResult } from './types';

export type StoryPhase =
  | 'loading'
  | 'home'
  | 'browser'
  | 'intro'
  | 'reading'
  | 'walking'
  | 'running'
  | 'cinematic'
  | 'question_approach'
  | 'question_active'
  | 'correct_action'
  | 'wrong_action'
  | 'failure'
  | 'checkpoint'
  | 'canonical_transition'
  | 'character_transition'
  | 'level_complete'
  | 'chapter_complete'
  | 'book_complete'
  | 'paused';

export type StoryMachineState = {
  phase: StoryPhase;
  resumePhase: StoryPhase | null;
  checkpointId: string;
  action: StoryActionName;
  result: StoryAnswerResult | null;
};

export type StoryMachineEvent =
  | { type: 'HOME_READY' }
  | { type: 'OPEN_BROWSER' }
  | { type: 'CLOSE_BROWSER' }
  | { type: 'START_LEVEL'; checkpointId: string; checkpointState: 'intro' | 'question_approach' | 'canonical_event' | 'level_complete' | 'chapter_complete' | 'book_complete'; questionActive?: boolean; paused?: boolean }
  | { type: 'INTRO_COMPLETE' }
  | { type: 'OPEN_READ'; returnPhase?: StoryPhase }
  | { type: 'READ_COMPLETE' }
  | { type: 'BEGIN_RUN' }
  | { type: 'STOP_RUNNING' }
  | { type: 'EVENT_REACHED'; checkpointId: string }
  | { type: 'QUESTION_READY' }
  | { type: 'ANSWER_CORRECT'; result: StoryAnswerResult }
  | { type: 'ANSWER_WRONG'; result: StoryAnswerResult }
  | { type: 'ACTION_COMPLETE' }
  | { type: 'CANONICAL_EVENT_REACHED'; checkpointId: string }
  | { type: 'CANONICAL_EVENT_SETTLED'; result: StoryAnswerResult }
  | { type: 'RETRY' }
  | { type: 'RESTART_FROM_CHECKPOINT' }
  | { type: 'CHECKPOINT_READY' }
  | { type: 'BEGIN_CHARACTER_TRANSITION' }
  | { type: 'COMPLETE_CHAPTER' }
  | { type: 'COMPLETE_BOOK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'EXIT_LEVEL' };

export const INITIAL_STORY_MACHINE: StoryMachineState = {
  phase: 'loading',
  resumePhase: null,
  checkpointId: '',
  action: 'idle',
  result: null,
};

function playablePhase(phase: StoryPhase) {
  return !['loading', 'home', 'browser', 'failure', 'canonical_transition', 'character_transition', 'level_complete', 'chapter_complete', 'book_complete', 'paused'].includes(phase);
}

export function transitionStoryState(state: StoryMachineState, event: StoryMachineEvent): StoryMachineState {
  switch (event.type) {
    case 'HOME_READY':
      return { ...INITIAL_STORY_MACHINE, phase: 'home' };
    case 'OPEN_BROWSER':
      return state.phase === 'home' ? { ...state, phase: 'browser' } : state;
    case 'CLOSE_BROWSER':
      return state.phase === 'browser' ? { ...state, phase: 'home' } : state;
    case 'START_LEVEL': {
      const restoredAtQuestion = event.checkpointState === 'question_approach';
      const restoredAtCanonicalEvent = event.checkpointState === 'canonical_event';
      const phase: StoryPhase = event.paused
        ? 'paused'
        : event.checkpointState === 'book_complete'
          ? 'book_complete'
        : event.checkpointState === 'chapter_complete'
          ? 'chapter_complete'
        : restoredAtCanonicalEvent
          ? 'canonical_transition'
        : event.questionActive
          ? 'question_active'
          : event.checkpointState === 'level_complete'
            ? 'level_complete'
          : restoredAtQuestion
            ? 'checkpoint'
            : 'intro';
      return {
        phase,
        resumePhase: event.paused
          ? (event.checkpointState === 'book_complete' ? 'book_complete' : restoredAtCanonicalEvent ? 'canonical_transition' : event.questionActive ? 'question_active' : event.checkpointState === 'level_complete' ? 'level_complete' : restoredAtQuestion ? 'checkpoint' : 'intro')
          : null,
        checkpointId: event.checkpointId,
        action: restoredAtQuestion ? 'stop' : 'idle',
        result: null,
      };
    }
    case 'INTRO_COMPLETE':
      return state.phase === 'intro' ? { ...state, phase: 'walking', action: 'walk' } : state;
    case 'OPEN_READ':
      return playablePhase(state.phase)
        ? { ...state, phase: 'reading', resumePhase: event.returnPhase || state.phase, action: 'stop' }
        : state;
    case 'READ_COMPLETE':
      return state.phase === 'reading'
        ? { ...state, phase: state.resumePhase || 'walking', resumePhase: null, action: 'walk' }
        : state;
    case 'BEGIN_RUN':
      return state.phase === 'walking' ? { ...state, phase: 'running', action: 'run' } : state;
    case 'STOP_RUNNING':
      return state.phase === 'running' ? { ...state, phase: 'walking', action: 'walk' } : state;
    case 'EVENT_REACHED':
      return state.phase === 'walking' || state.phase === 'running'
        ? { ...state, phase: 'question_approach', checkpointId: event.checkpointId, action: 'stop' }
        : state;
    case 'QUESTION_READY':
      return state.phase === 'question_approach' ? { ...state, phase: 'question_active', action: 'idle' } : state;
    case 'ANSWER_CORRECT':
      return state.phase === 'question_active'
        ? { ...state, phase: 'correct_action', action: 'carry', result: event.result }
        : state;
    case 'ANSWER_WRONG':
      return state.phase === 'question_active'
        ? { ...state, phase: 'wrong_action', action: 'carry', result: event.result }
        : state;
    case 'ACTION_COMPLETE':
      if (state.phase === 'correct_action') {
        if (state.result?.canonicalEventPending) return { ...state, phase: 'canonical_transition', action: 'confront' };
        if (state.result?.bookComplete) return { ...state, phase: 'book_complete', action: 'observe' };
        if (state.result?.chapterComplete) return { ...state, phase: 'chapter_complete', action: 'idle' };
        if (state.result?.levelComplete) return { ...state, phase: 'level_complete', action: 'offer' };
        return { ...state, phase: 'checkpoint', checkpointId: state.result?.checkpointId || state.checkpointId, action: 'idle' };
      }
      if (state.phase === 'wrong_action') return { ...state, phase: 'failure', action: 'fall' };
      return state;
    case 'CANONICAL_EVENT_REACHED':
      return state.phase === 'walking' || state.phase === 'cinematic'
        ? { ...state, phase: 'canonical_transition', checkpointId: event.checkpointId, action: 'confront' }
        : state;
    case 'CANONICAL_EVENT_SETTLED':
      if (state.phase !== 'canonical_transition' && state.phase !== 'character_transition') return state;
      return {
        ...state,
        phase: event.result.bookComplete ? 'book_complete' : event.result.chapterComplete ? 'chapter_complete' : 'level_complete',
        checkpointId: event.result.checkpointId,
        action: event.result.bookComplete ? 'observe' : event.result.chapterComplete ? 'character_swap' : 'lie_still',
        result: event.result,
      };
    case 'RETRY':
      return state.phase === 'failure'
        ? { ...state, phase: 'checkpoint', action: 'idle', result: null }
        : state;
    case 'RESTART_FROM_CHECKPOINT':
      if (state.phase === 'walking') return { ...state, phase: 'intro', action: 'idle', result: null };
      return state.phase === 'question_approach' || state.phase === 'question_active'
        ? { ...state, phase: 'checkpoint', action: 'idle', result: null }
        : state;
    case 'CHECKPOINT_READY':
      return state.phase === 'checkpoint' ? { ...state, phase: 'question_approach', action: 'stop' } : state;
    case 'BEGIN_CHARACTER_TRANSITION':
      return state.phase === 'level_complete' ? { ...state, phase: 'character_transition', action: 'character_swap' } : state;
    case 'COMPLETE_CHAPTER':
      return state.phase === 'level_complete' || state.phase === 'character_transition'
        ? { ...state, phase: 'chapter_complete', action: 'idle' }
        : state;
    case 'COMPLETE_BOOK':
      return state.phase === 'chapter_complete' ? { ...state, phase: 'book_complete', action: 'idle' } : state;
    case 'PAUSE':
      return playablePhase(state.phase) ? { ...state, phase: 'paused', resumePhase: state.phase, action: 'stop' } : state;
    case 'RESUME':
      return state.phase === 'paused' && state.resumePhase
        ? { ...state, phase: state.resumePhase, resumePhase: null }
        : state;
    case 'EXIT_LEVEL':
      return { ...INITIAL_STORY_MACHINE, phase: 'home' };
    default:
      return state;
  }
}

export function storyPhaseProgress(phase: StoryPhase) {
  const positions: Partial<Record<StoryPhase, number>> = {
    intro: 10,
    reading: 10,
    walking: 48,
    running: 52,
    question_approach: 55,
    question_active: 55,
    correct_action: 78,
    wrong_action: 67,
    failure: 55,
    checkpoint: 55,
    cinematic: 68,
    canonical_transition: 72,
    character_transition: 72,
    level_complete: 82,
    chapter_complete: 90,
    book_complete: 100,
    paused: 55,
  };
  return positions[phase] ?? 10;
}
