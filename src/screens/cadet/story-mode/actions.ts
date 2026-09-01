import type { StoryActionName } from './types';

export type StoryActionDefinition = {
  name: StoryActionName;
  cssClass: string;
  durationMs: number;
};

export const STORY_ACTIONS: Record<StoryActionName, StoryActionDefinition> = {
  idle: { name: 'idle', cssClass: 'story-action-idle', durationMs: 900 },
  slow_walk: { name: 'slow_walk', cssClass: 'story-action-slow-walk', durationMs: 5_800 },
  walk: { name: 'walk', cssClass: 'story-action-walk', durationMs: 4_200 },
  brisk_walk: { name: 'brisk_walk', cssClass: 'story-action-brisk-walk', durationMs: 3_100 },
  run: { name: 'run', cssClass: 'story-action-run', durationMs: 2_100 },
  stop: { name: 'stop', cssClass: 'story-action-stop', durationMs: 450 },
  carry: { name: 'carry', cssClass: 'story-action-carry', durationMs: 1_100 },
  measure: { name: 'measure', cssClass: 'story-action-measure', durationMs: 900 },
  cut: { name: 'cut', cssClass: 'story-action-cut', durationMs: 850 },
  place: { name: 'place', cssClass: 'story-action-place', durationMs: 900 },
  raise: { name: 'raise', cssClass: 'story-action-raise', durationMs: 1_050 },
  hammer: { name: 'hammer', cssClass: 'story-action-hammer', durationMs: 780 },
  seal: { name: 'seal', cssClass: 'story-action-seal', durationMs: 1_000 },
  build: { name: 'build', cssClass: 'story-action-build', durationMs: 1_100 },
  load: { name: 'load', cssClass: 'story-action-load', durationMs: 980 },
  store: { name: 'store', cssClass: 'story-action-store', durationMs: 900 },
  open_door: { name: 'open_door', cssClass: 'story-action-open-door', durationMs: 900 },
  animal_enter: { name: 'animal_enter', cssClass: 'story-action-animal-enter', durationMs: 1_150 },
  group_enter: { name: 'group_enter', cssClass: 'story-action-group-enter', durationMs: 1_250 },
  inspect: { name: 'inspect', cssClass: 'story-action-inspect', durationMs: 900 },
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
  ascend: { name: 'ascend', cssClass: 'story-action-ascend', durationMs: 1_600 },
  observe: { name: 'observe', cssClass: 'story-action-observe', durationMs: 900 },
  age_transition: { name: 'age_transition', cssClass: 'story-action-age-transition', durationMs: 1_350 },
  lineage_transition: { name: 'lineage_transition', cssClass: 'story-action-lineage-transition', durationMs: 1_450 },
  appear: { name: 'appear', cssClass: 'story-action-appear', durationMs: 900 },
  disappear: { name: 'disappear', cssClass: 'story-action-disappear', durationMs: 1_300 },
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
