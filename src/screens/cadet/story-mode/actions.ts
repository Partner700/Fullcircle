import type { StoryActionName } from './types';

export type StoryActionDefinition = {
  name: StoryActionName;
  cssClass: string;
  durationMs: number;
};

export const STORY_ACTIONS: Record<StoryActionName, StoryActionDefinition> = {
  idle: { name: 'idle', cssClass: 'story-action-idle', durationMs: 900 },
  walk: { name: 'walk', cssClass: 'story-action-walk', durationMs: 4_200 },
  run: { name: 'run', cssClass: 'story-action-run', durationMs: 2_100 },
  stop: { name: 'stop', cssClass: 'story-action-stop', durationMs: 450 },
  carry: { name: 'carry', cssClass: 'story-action-carry', durationMs: 1_100 },
  kneel: { name: 'kneel', cssClass: 'story-action-kneel', durationMs: 900 },
  offer: { name: 'offer', cssClass: 'story-action-offer', durationMs: 1_500 },
  trip: { name: 'trip', cssClass: 'story-action-trip', durationMs: 750 },
  fall: { name: 'fall', cssClass: 'story-action-fall', durationMs: 850 },
  follow: { name: 'follow', cssClass: 'story-action-follow', durationMs: 1_500 },
  pursue: { name: 'pursue', cssClass: 'story-action-pursue', durationMs: 1_350 },
  turn: { name: 'turn', cssClass: 'story-action-turn', durationMs: 650 },
  confront: { name: 'confront', cssClass: 'story-action-confront', durationMs: 900 },
  strike: { name: 'strike', cssClass: 'story-action-strike', durationMs: 720 },
  recoil: { name: 'recoil', cssClass: 'story-action-recoil', durationMs: 620 },
  collapse: { name: 'collapse', cssClass: 'story-action-collapse', durationMs: 1_050 },
  lie_still: { name: 'lie_still', cssClass: 'story-action-lie-still', durationMs: 1_300 },
  look_back: { name: 'look_back', cssClass: 'story-action-look-back', durationMs: 680 },
  character_swap: { name: 'character_swap', cssClass: 'story-action-character-swap', durationMs: 1_100 },
  fade: { name: 'fade', cssClass: 'story-action-fade', durationMs: 700 },
};

export function storyActionAt(sequence: StoryActionName[], elapsedMs: number) {
  let cursor = Math.max(0, elapsedMs);
  for (const action of sequence) {
    const definition = STORY_ACTIONS[action];
    if (cursor < definition.durationMs) return definition;
    cursor -= definition.durationMs;
  }
  return STORY_ACTIONS[sequence[sequence.length - 1] || 'idle'];
}

export function storyActionDuration(sequence: StoryActionName[]) {
  return sequence.reduce((total, action) => total + STORY_ACTIONS[action].durationMs, 0);
}
