export const STORY_TIMER_OPTIONS = [5, 7, 10] as const;

export type StoryTimerSeconds = (typeof STORY_TIMER_OPTIONS)[number];
export type StoryQuestionType = 'multiple_choice' | 'true_false';
export type StoryDifficulty = 'easy' | 'moderate' | 'hard';

export type StoryActionName =
  | 'idle'
  | 'slow_walk'
  | 'walk'
  | 'brisk_walk'
  | 'run'
  | 'stop'
  | 'carry'
  | 'measure'
  | 'cut'
  | 'place'
  | 'raise'
  | 'hammer'
  | 'seal'
  | 'build'
  | 'load'
  | 'store'
  | 'open_door'
  | 'animal_enter'
  | 'group_enter'
  | 'inspect'
  | 'enter'
  | 'exit'
  | 'release'
  | 'fly'
  | 'return'
  | 'receive'
  | 'rest'
  | 'sway'
  | 'gather'
  | 'circle'
  | 'kneel'
  | 'offer'
  | 'trip'
  | 'fall'
  | 'follow'
  | 'pursue'
  | 'turn'
  | 'confront'
  | 'strike'
  | 'recoil'
  | 'collapse'
  | 'lie_still'
  | 'look_back'
  | 'character_swap'
  | 'ascend'
  | 'observe'
  | 'age_transition'
  | 'lineage_transition'
  | 'appear'
  | 'disappear'
  | 'fade';

export type FutureStoryActionName =
  | 'jump'
  | 'duck'
  | 'climb'
  | 'hide'
  | 'transform';

export type StoryCharacterId =
  | 'abel'
  | 'cain'
  | 'seth'
  | 'enosh'
  | 'jared'
  | 'enoch'
  | 'methuselah'
  | 'lamech'
  | 'noah'
  | 'noahs-wife'
  | 'shem'
  | 'ham'
  | 'japheth'
  | 'shems-wife'
  | 'hams-wife'
  | 'japheths-wife';
export type StoryCharacterRole =
  | 'player'
  | 'npc'
  | 'threat'
  | 'transition'
  | 'observer'
  | 'lineage'
  | 'future'
  | 'family'
  | 'helper'
  | 'procession';

export type StoryLocomotion = 'slow_walk' | 'walk' | 'brisk_walk' | 'run';
export type StoryTimePassage =
  | 'none'
  | 'dawn_to_day'
  | 'day_to_dusk'
  | 'seasons'
  | 'generations'
  | 'seven_days'
  | 'forty_days'
  | 'flood_months';

export type StoryCharacterPlacement = {
  id: StoryCharacterId;
  role: StoryCharacterRole;
  x: number;
  facing?: 'left' | 'right';
  action: StoryActionName;
  active?: boolean;
};

export type StoryObstacleType = 'rock' | 'ditch' | 'log' | 'thorn' | 'narrow_path';

export type StoryObstacleDefinition = {
  id: string;
  type: StoryObstacleType;
  x: number;
  scale?: number;
};

export type StoryPowerUpDefinition = {
  id: string;
  kind: 'story_power_up';
  durationMs: number;
  effect: string;
};

export type StoryRelicReference = {
  id: string;
  kind: 'full_circle_relic';
  relicSlug: string;
};

export type StoryEnvironment = {
  id: string;
  palette:
    | 'abel-field'
    | 'regard-field'
    | 'warning-path'
    | 'ominous-field'
    | 'aftermath-ground'
    | 'seth-dawn'
    | 'seth-path'
    | 'lineage-dawn'
    | 'enoch-plain'
    | 'enoch-hills'
    | 'enoch-ridge'
    | 'enoch-summit'
    | 'methuselah-seasons'
    | 'noah-horizon'
    | 'noah-corruption'
    | 'noah-favor'
    | 'ark-instruction'
    | 'ark-site-early'
    | 'ark-site-middle'
    | 'ark-site-late'
    | 'ark-storm'
    | 'flood-entry'
    | 'flood-waiting'
    | 'flood-rain'
    | 'flood-rising'
    | 'flood-high'
    | 'flood-receding'
    | 'flood-mountains'
    | 'flood-birds'
    | 'flood-dry'
    | 'flood-altar'
    | 'flood-covenant';
  weather: 'none' | 'clear' | 'wind' | 'still' | 'haze' | 'clouding' | 'drizzle' | 'rain' | 'heavy_rain' | 'storm';
  weatherIntensity?: 0 | 1 | 2 | 3 | 4;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | 'dawn';
  elevation?: 0 | 1 | 2 | 3 | 4 | 5;
  timePassage?: StoryTimePassage;
};

export type StoryCameraDirective = {
  framing: 'follow' | 'focus' | 'reveal' | 'wide';
  target?: 'character' | 'construction' | 'procession' | 'environment' | 'ark' | 'bird' | 'altar' | 'sky';
};

export type StoryWaterTrend = 'none' | 'rising' | 'stable' | 'falling';
export type StoryTerrainState = 'dry' | 'wet' | 'covered' | 'submerged' | 'emerging' | 'muddy';
export type StoryTraversalMode = 'ground' | 'ark_approach' | 'ark_interior' | 'ark_floating' | 'ark_resting' | 'dry_land';
export type StoryArkState = 'prepared' | 'sealed' | 'floating' | 'resting' | 'opened';
export type StoryBirdKind = 'none' | 'raven' | 'dove';
export type StoryBirdState = 'none' | 'waiting' | 'released' | 'flying' | 'returned' | 'carrying' | 'no_return';

export type StoryEnvironmentState = {
  sequenceId: string;
  label: string;
  stageOrder: number;
  stageSlug: string;
  totalStages: number;
  completed: boolean;
  weather: StoryEnvironment['weather'];
  weatherIntensity: 0 | 1 | 2 | 3 | 4;
  waterStage: number;
  waterTrend: StoryWaterTrend;
  terrainState: StoryTerrainState;
  traversalMode: StoryTraversalMode;
  arkState: StoryArkState;
  birdKind: StoryBirdKind;
  birdState: StoryBirdState;
  oliveLeafVisible: boolean;
  altarVisible: boolean;
  rainbowVisible: boolean;
  checkpointId: string;
};

export type StoryBuildFailureEffect = 'lean' | 'collapse' | 'reject' | 'misplace' | 'block' | 'spill';

export type StoryBuildComponentKey =
  | 'foundation'
  | 'frame'
  | 'hull'
  | 'opening'
  | 'decks'
  | 'household'
  | 'animals'
  | 'provisions'
  | 'complete';

export type StoryBuildStageDefinition = {
  id: string;
  order: number;
  componentKey: StoryBuildComponentKey;
  label: string;
};

export type StoryBuildDefinition = {
  id: string;
  label: string;
  visual: 'ark';
  stages: StoryBuildStageDefinition[];
};

export type StoryBuildState = {
  constructionId: string;
  label: string;
  stageOrder: number;
  stageSlug: string;
  totalStages: number;
  completed: boolean;
  completedComponents: StoryBuildComponentKey[];
  checkpointId: string;
};

export type StoryCreatureGroup = {
  id: string;
  category: 'land-animals' | 'birds' | 'creeping-things';
  state: 'waiting' | 'entering' | 'stored';
  x: number;
};

export type StorySupplyGroup = {
  id: string;
  kind: 'sacks' | 'bundles' | 'vessels';
  state: 'waiting' | 'loading' | 'stored';
  x: number;
};

export type StorySceneDefinition = {
  id: string;
  kind:
    | 'narrative'
    | 'movement'
    | 'read'
    | 'question_event'
    | 'canonical_event'
    | 'character_transition'
    | 'completion';
  environment: StoryEnvironment;
  activeCharacterId: StoryCharacterId | null;
  characters: StoryCharacterPlacement[];
  locomotion?: StoryLocomotion;
  lineage?: StoryCharacterId[];
  transitionLabel?: string;
  titleReveal?: string;
  camera?: StoryCameraDirective;
  constructionId?: string;
  creatureGroups?: StoryCreatureGroup[];
  supplyGroups?: StorySupplyGroup[];
  buildFailureEffect?: StoryBuildFailureEffect;
  obstacles?: StoryObstacleDefinition[];
  action: StoryActionName;
  durationMs?: number;
  narrativeText?: string;
  correctNarrativeText?: string;
  wrongNarrativeText?: string;
  scriptureReference?: string;
  checkpointId?: string;
  questionId?: string;
  questionPoolId?: string;
  readText?: string;
  canonicalEventId?: string;
  canonicalActions?: StoryActionName[];
  correctActions?: StoryActionName[];
  wrongActions?: StoryActionName[];
  nextSceneId?: string;
};

export type StoryLevelDefinition = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  bookSlug: string;
  chapterSlug: string;
  order: number;
  openingSceneId: string;
  continuationText?: string;
  chapterConclusion?: boolean;
  nextCharacterName?: string;
  chapterCompletionText?: string;
  scriptureLabel?: string;
  scenes: StorySceneDefinition[];
};

export type StoryChapterDefinition = {
  id: string;
  slug: string;
  title: string;
  order: number;
  levels: StoryLevelDefinition[];
  plannedLevelCount?: number;
  lockedContinuation?: { title: string; subtitle: string };
};

export type StoryBookDefinition = {
  id: string;
  slug: string;
  numeral: string;
  title: string;
  order: number;
  chapters: StoryChapterDefinition[];
};

export type StoryQuestionPayload = {
  id: string;
  levelSlug: string;
  checkpointId: string;
  poolId: string;
  sceneId: string;
  type: StoryQuestionType;
  prompt: string;
  options: string[];
  timerSeconds: StoryTimerSeconds;
  difficulty: StoryDifficulty;
  scriptureReference: string;
  isReadFollowUp: boolean;
};

export type StoryLevelProgress = {
  levelSlug: string;
  completed: boolean;
  unlocked: boolean;
  timesCompleted: number;
  firstCompletedAt: string | null;
  figsEarned: number;
  denariiEarned: number;
};

export type StoryChapterProgress = {
  bookSlug: string;
  chapterSlug: string;
  completed: boolean;
  timesCompleted: number;
  firstCompletedAt: string | null;
  figsEarned: number;
  denariiEarned: number;
};

export type StoryBookCompletionStats = {
  bookSlug: string;
  completed: boolean;
  chaptersCompleted: number;
  levelsCompleted: number;
  questionsEncountered: number;
  successfulResponses: number;
  completionPercentage: number;
  figsEarned: number;
  denariiEarned: number;
  completedAt: string | null;
};

export type StoryProgress = {
  currentBookSlug: string;
  currentChapterSlug: string;
  currentLevelSlug: string;
  checkpointId: string;
  completedLevelCount: number;
  totalLevelCount: number;
  levels: StoryLevelProgress[];
  chapters: StoryChapterProgress[];
  activeAttemptId: string | null;
  chapterCompleted: boolean;
  chapterFigsEarned: number;
  chapterDenariiEarned: number;
  bookCompleted: boolean;
  bookStats: StoryBookCompletionStats;
};

export type StoryAttempt = {
  attemptId: string;
  levelSlug: string;
  checkpointId: string;
  checkpointState: 'intro' | 'question_approach' | 'canonical_event' | 'level_complete' | 'chapter_complete' | 'book_complete';
  isReplay: boolean;
  restored: boolean;
  paused: boolean;
  questionStartedAt: string | null;
  questionDeadline: string | null;
  serverNow: string;
  question: StoryQuestionPayload | null;
  pendingEventId: string | null;
  buildState: StoryBuildState | null;
  environmentState: StoryEnvironmentState | null;
};

export type StoryAnswerResult = {
  correct: boolean;
  timedOut: boolean;
  figsEarned: number;
  denariiEarned: number;
  totalFigs: number;
  correctCount: number;
  questionCount: number;
  completionPercentage: number;
  levelComplete: boolean;
  chapterComplete: boolean;
  canonicalEventPending: boolean;
  canonicalEventId: string | null;
  checkpointId: string;
  actionId: string;
  explanation: string;
  replay: boolean;
  nextQuestion: StoryQuestionPayload | null;
  levelsCompleted: number;
  buildState: StoryBuildState | null;
  environmentState: StoryEnvironmentState | null;
  bookComplete: boolean;
  bookStats: StoryBookCompletionStats | null;
};

export type StoryDeadline = {
  deadline: string | null;
  serverNow: string;
  paused: boolean;
};
