import type { StoryBookDefinition, StoryLevelDefinition, StoryQuestionType, StoryTimerSeconds } from './types';

export const ABEL_LEVEL_SLUG = 'abel-offering';
export const ABEL_QUESTION_ID = 'abel-offering-firstborn';
export const ABEL_START_CHECKPOINT = 'abel-field-start';
export const ABEL_QUESTION_CHECKPOINT = 'abel-offering-question';
export const ABEL_COMPLETE_CHECKPOINT = 'abel-offering-complete';

const ABEL_FIELD = {
  id: 'eden-east-field',
  palette: 'abel-field' as const,
  weather: 'wind' as const,
  timeOfDay: 'evening' as const,
};

export const ABEL_OFFERING_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-1',
  slug: ABEL_LEVEL_SLUG,
  title: 'Abel Offering',
  subtitle: 'Bring what Scripture names.',
  bookSlug: 'beginnings',
  chapterSlug: 'brothers',
  order: 1,
  openingSceneId: 'abel-field-intro',
  continuationText: 'Chapter 1 continues in a future update.',
  scenes: [
    {
      id: 'abel-field-intro',
      kind: 'narrative',
      environment: ABEL_FIELD,
      character: 'abel',
      action: 'idle',
      durationMs: 1_650,
      narrativeText: 'East of Eden, two brothers bring offerings before the Lord.',
      scriptureReference: 'Genesis 4:1-4',
      checkpointId: ABEL_START_CHECKPOINT,
      nextSceneId: 'abel-field-walk',
    },
    {
      id: 'abel-field-walk',
      kind: 'movement',
      environment: ABEL_FIELD,
      character: 'abel',
      action: 'walk',
      durationMs: 4_150,
      narrativeText: 'Guide Abel toward the place of offering.',
      checkpointId: ABEL_START_CHECKPOINT,
      nextSceneId: 'abel-offering-event',
    },
    {
      id: 'abel-offering-event',
      kind: 'question_event',
      environment: ABEL_FIELD,
      character: 'abel',
      action: 'stop',
      durationMs: 720,
      narrativeText: 'The offering place is near.',
      correctNarrativeText: 'Abel carries the offering Scripture names.',
      wrongNarrativeText: 'This is not the offering Scripture names.',
      questionId: ABEL_QUESTION_ID,
      scriptureReference: 'Genesis 4:4',
      checkpointId: ABEL_QUESTION_CHECKPOINT,
      correctActions: ['carry', 'walk', 'kneel', 'offer'],
      wrongActions: ['carry', 'trip', 'fall', 'fade'],
      nextSceneId: 'abel-offering-complete',
    },
    {
      id: 'abel-offering-complete',
      kind: 'completion',
      environment: ABEL_FIELD,
      character: 'abel',
      action: 'offer',
      narrativeText: 'The Lord regarded Abel and his offering.',
      scriptureReference: 'Genesis 4:4',
      checkpointId: ABEL_COMPLETE_CHECKPOINT,
    },
  ],
};

export const STORY_BOOKS: StoryBookDefinition[] = [
  {
    id: 'story-book-1',
    slug: 'beginnings',
    numeral: 'Book I',
    title: 'Beginnings',
    order: 1,
    chapters: [
      {
        id: 'story-book-1-chapter-1',
        slug: 'brothers',
        title: 'Brothers',
        order: 1,
        levels: [ABEL_OFFERING_LEVEL],
      },
    ],
  },
];

export function findStoryLevel(levelSlug: string): StoryLevelDefinition | null {
  for (const book of STORY_BOOKS) {
    for (const chapter of book.chapters) {
      const level = chapter.levels.find((candidate) => candidate.slug === levelSlug);
      if (level) return level;
    }
  }
  return null;
}

export function findStoryLocation(levelSlug: string) {
  for (const book of STORY_BOOKS) {
    for (const chapter of book.chapters) {
      const level = chapter.levels.find((candidate) => candidate.slug === levelSlug);
      if (level) return { book, chapter, level };
    }
  }
  return null;
}

export function storyQuestionOptions(type: StoryQuestionType, options: string[]) {
  return type === 'true_false' ? ['True', 'False'] : options;
}

export function isStoryTimerSeconds(value: number): value is StoryTimerSeconds {
  return value === 5 || value === 7 || value === 10;
}
