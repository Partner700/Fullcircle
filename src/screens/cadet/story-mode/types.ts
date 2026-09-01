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
  | 'build'
  | 'enter'
  | 'exit'
  | 'hide'
  | 'fly'
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
  | 'noah';
export type StoryCharacterRole =
  | 'player'
  | 'npc'
  | 'threat'
  | 'transition'
  | 'observer'
  | 'lineage'
  | 'future';

export type StoryLocomotion = 'slow_walk' | 'walk' | 'brisk_walk' | 'run';
export type StoryTimePassage = 'none' | 'dawn_to_day' | 'day_to_dusk' | 'seasons' | 'generations';

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
    | 'noah-horizon';
  weather: 'clear' | 'wind' | 'still' | 'haze';
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | 'dawn';
  elevation?: 0 | 1 | 2 | 3 | 4 | 5;
  timePassage?: StoryTimePassage;
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
};

export type StoryAttempt = {
  attemptId: string;
  levelSlug: string;
  checkpointId: string;
  checkpointState: 'intro' | 'question_approach' | 'canonical_event' | 'level_complete' | 'chapter_complete';
  isReplay: boolean;
  restored: boolean;
  paused: boolean;
  questionStartedAt: string | null;
  questionDeadline: string | null;
  serverNow: string;
  question: StoryQuestionPayload | null;
  pendingEventId: string | null;
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
};

export type StoryDeadline = {
  deadline: string | null;
  serverNow: string;
  paused: boolean;
};
