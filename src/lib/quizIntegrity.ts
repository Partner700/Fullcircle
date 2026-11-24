export const ACTIVE_QUIZ_EXIT_INTENT_EVENT = 'full-circle:active-quiz-exit-intent';

export function signalActiveQuizExitIntent() {
  window.dispatchEvent(new Event(ACTIVE_QUIZ_EXIT_INTENT_EVENT));
}
