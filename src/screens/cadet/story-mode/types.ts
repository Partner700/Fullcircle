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
  | 'strike'
  | 'fly'
  | 'transform'
  | 'character_swap';

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
  palette: 'abel-field';
  weather: 'clear' | 'wind';
  timeOfDay: 'morning' | 'evening';
};

export type StorySceneDefinition = {
  id: string;
  kind: 'narrative' | 'movement' | 'read' | 'question_event' | 'completion';
  environment: StoryEnvironment;
  character: 'abel';
  action: StoryActionName;
  durationMs?: number;
  narrativeText?: string;
  correctNarrativeText?: string;
  wrongNarrativeText?: string;
  scriptureReference?: string;
  checkpointId?: string;
  questionId?: string;
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
  type: StoryQuestionType;
  prompt: string;
  options: string[];
  timerSeconds: StoryTimerSeconds;
  difficulty: StoryDifficulty;
  scriptureReference: string;
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
};

export type StoryAttempt = {
  attemptId: string;
  levelSlug: string;
  checkpointId: string;
  checkpointState: 'intro' | 'question_approach' | 'level_complete';
  isReplay: boolean;
  restored: boolean;
  paused: boolean;
  questionStartedAt: string | null;
  questionDeadline: string | null;
  serverNow: string;
  question: StoryQuestionPayload;
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
  checkpointId: string;
  actionId: string;
  explanation: string;
  replay: boolean;
};

export type StoryDeadline = {
  deadline: string | null;
  serverNow: string;
  paused: boolean;
};
