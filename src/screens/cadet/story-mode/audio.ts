import { playSoundEffect, setScenarioSound } from '../../../lib/soundscape';

export type StorySoundEvent =
  | 'footsteps'
  | 'wind'
  | 'impact'
  | 'transition'
  | 'correct'
  | 'failure'
  | 'complete';

const STORY_SOUND_SLOTS: Record<StorySoundEvent, string> = {
  footsteps: 'sound_story_footsteps',
  wind: 'sound_story_wind',
  impact: 'sound_story_impact',
  transition: 'sound_story_transition',
  correct: 'sound_game_correct',
  failure: 'sound_game_incorrect',
  complete: 'sound_game_finish',
};

export function startStoryAmbience() {
  return setScenarioSound('sound_story_ambient');
}

export function stopStoryAmbience() {
  return setScenarioSound(null);
}

export function playStorySound(event: StorySoundEvent, volume = 0.52) {
  return playSoundEffect(STORY_SOUND_SLOTS[event], volume);
}
