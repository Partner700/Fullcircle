export const STORY_TIMER_OPTIONS = [5, 7, 10] as const;

export type StoryTimerSeconds = (typeof STORY_TIMER_OPTIONS)[number];
export type StoryQuestionType = 'multiple_choice' | 'true_false';
export type StoryDifficulty = 'easy' | 'moderate' | 'hard';

export type StoryActionName =
  | 'idle'
  | 'walk'
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
  | 'fade';

export type FutureStoryActionName =
  | 'jump'
  | 'duck'
  | 'climb'
  | 'ascend'
  | 'build'
  | 'enter'
  | 'exit'
  | 'hide'
  | 'fly'
  | 'transform';

export type StoryCharacterId = 'abel' | 'cain' | 'seth';
export type StoryCharacterRole = 'player' | 'npc' | 'threat' | 'transition' | 'observer';

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
    | 'seth-dawn';
  weather: 'clear' | 'wind' | 'still' | 'haze';
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | 'dawn';
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

export type StoryProgress = {
  currentBookSlug: string;
  currentChapterSlug: string;
  currentLevelSlug: string;
  checkpointId: string;
  completedLevelCount: number;
  totalLevelCount: number;
  levels: StoryLevelProgress[];
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
