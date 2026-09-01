import type {
  StoryBookDefinition,
  StoryCharacterPlacement,
  StoryEnvironment,
  StoryLevelDefinition,
  StoryQuestionType,
  StoryTimerSeconds,
} from './types';
import { GENERATIONS_LEVELS } from './generationsContent.ts';
import { ARK_CONSTRUCTION, NOAH_LEVELS } from './noahContent.ts';

export { GENERATIONS_LEVELS } from './generationsContent.ts';
export { ARK_CONSTRUCTION, NOAH_LEVELS } from './noahContent.ts';

export const ABEL_LEVEL_SLUG = 'abel-offering';
export const REGARD_LEVEL_SLUG = 'regard';
export const AT_THE_DOOR_LEVEL_SLUG = 'at-the-door';
export const THE_FIELD_LEVEL_SLUG = 'the-field';
export const YOUR_BROTHER_LEVEL_SLUG = 'your-brother';
export const ANOTHER_OFFSPRING_LEVEL_SLUG = 'another-offspring';

export const ABEL_QUESTION_ID = 'abel-offering-firstborn';
export const ABEL_START_CHECKPOINT = 'abel-field-start';
export const ABEL_QUESTION_CHECKPOINT = 'abel-offering-question';
export const ABEL_COMPLETE_CHECKPOINT = 'abel-offering-complete';
export const ABEL_CANONICAL_EVENT_ID = 'abel-canonical-death';
export const SETH_TRANSITION_EVENT_ID = 'seth-generational-transition';

const ABEL_FIELD: StoryEnvironment = {
  id: 'eden-east-field', palette: 'abel-field', weather: 'wind', timeOfDay: 'evening',
};
const REGARD_FIELD: StoryEnvironment = {
  id: 'two-offerings-late-field', palette: 'regard-field', weather: 'still', timeOfDay: 'afternoon',
};
const WARNING_PATH: StoryEnvironment = {
  id: 'warning-at-the-narrow-path', palette: 'warning-path', weather: 'wind', timeOfDay: 'evening',
};
const OMINOUS_FIELD: StoryEnvironment = {
  id: 'field-beyond-the-path', palette: 'ominous-field', weather: 'haze', timeOfDay: 'night',
};
const AFTERMATH_GROUND: StoryEnvironment = {
  id: 'ground-that-heard-abel', palette: 'aftermath-ground', weather: 'still', timeOfDay: 'night',
};
const SETH_DAWN: StoryEnvironment = {
  id: 'another-offspring-dawn', palette: 'seth-dawn', weather: 'clear', timeOfDay: 'dawn',
};

function abel(x: number, action: StoryCharacterPlacement['action'] = 'idle', role: StoryCharacterPlacement['role'] = 'player'): StoryCharacterPlacement {
  return { id: 'abel', role, x, action, active: role === 'player' };
}

function cain(
  x: number,
  action: StoryCharacterPlacement['action'] = 'idle',
  role: StoryCharacterPlacement['role'] = 'npc',
  facing: StoryCharacterPlacement['facing'] = 'left',
): StoryCharacterPlacement {
  return { id: 'cain', role, x, action, facing, active: role === 'player' };
}

function seth(x: number, action: StoryCharacterPlacement['action'] = 'idle'): StoryCharacterPlacement {
  return { id: 'seth', role: 'transition', x, action, active: false };
}

export const ABEL_OFFERING_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-1',
  slug: ABEL_LEVEL_SLUG,
  title: 'Abel Offering',
  subtitle: 'Bring what Scripture names.',
  bookSlug: 'beginnings',
  chapterSlug: 'brothers',
  order: 1,
  openingSceneId: 'abel-field-intro',
  continuationText: 'The two offerings now stand together.',
  scriptureLabel: 'Genesis 4',
  scenes: [
    {
      id: 'abel-field-intro', kind: 'narrative', environment: ABEL_FIELD,
      activeCharacterId: 'abel', characters: [abel(13)], action: 'idle', durationMs: 1_650,
      narrativeText: 'East of Eden, two brothers bring offerings before the Lord.',
      scriptureReference: 'Genesis 4:1-4', checkpointId: ABEL_START_CHECKPOINT, nextSceneId: 'abel-field-walk',
    },
    {
      id: 'abel-field-walk', kind: 'movement', environment: ABEL_FIELD,
      activeCharacterId: 'abel', characters: [abel(13, 'walk')],
      obstacles: [{ id: 'abel-path-rock', type: 'rock', x: 42, scale: 0.8 }],
      action: 'walk', durationMs: 3_800, narrativeText: 'Guide Abel toward the place of offering.',
      checkpointId: ABEL_START_CHECKPOINT, nextSceneId: 'abel-offering-event',
    },
    {
      id: 'abel-offering-event', kind: 'question_event', environment: ABEL_FIELD,
      activeCharacterId: 'abel', characters: [abel(55, 'stop')], action: 'stop', durationMs: 720,
      narrativeText: 'The offering place is near.', correctNarrativeText: 'Abel carries the offering Scripture names.',
      wrongNarrativeText: 'This is not the offering Scripture names.', questionId: ABEL_QUESTION_ID,
      questionPoolId: 'abel-offering-core', scriptureReference: 'Genesis 4:4', checkpointId: ABEL_QUESTION_CHECKPOINT,
      correctActions: ['carry', 'walk', 'kneel', 'offer'], wrongActions: ['carry', 'trip', 'fall', 'fade'],
      nextSceneId: 'abel-offering-complete',
    },
    {
      id: 'abel-offering-complete', kind: 'completion', environment: ABEL_FIELD,
      activeCharacterId: 'abel', characters: [abel(77, 'offer')], action: 'offer',
      narrativeText: 'The Lord regarded Abel and his offering.', scriptureReference: 'Genesis 4:4', checkpointId: ABEL_COMPLETE_CHECKPOINT,
    },
  ],
};

export const REGARD_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-2', slug: REGARD_LEVEL_SLUG, title: 'Regard',
  subtitle: 'Observe the two offerings and the response to each.', bookSlug: 'beginnings', chapterSlug: 'brothers',
  order: 2, openingSceneId: 'regard-intro', continuationText: 'Cain leaves the offering place angry, his face fallen.', scriptureLabel: 'Genesis 4',
  scenes: [
    {
      id: 'regard-intro', kind: 'narrative', environment: REGARD_FIELD,
      activeCharacterId: 'abel', characters: [abel(24, 'offer'), cain(72, 'kneel')], action: 'idle', durationMs: 1_850,
      narrativeText: 'Cain brings fruit from the ground. Abel brings from the firstborn of his flock and their fat portions.',
      scriptureReference: 'Genesis 4:2-4', checkpointId: 'regard-start', nextSceneId: 'regard-walk',
    },
    {
      id: 'regard-walk', kind: 'movement', environment: REGARD_FIELD,
      activeCharacterId: 'abel', characters: [abel(24, 'walk'), cain(77, 'idle')], action: 'walk', durationMs: 2_900,
      narrativeText: 'Move between the two offering places and attend to the text.', checkpointId: 'regard-start', nextSceneId: 'regard-observe',
    },
    {
      id: 'regard-observe', kind: 'question_event', environment: REGARD_FIELD,
      activeCharacterId: 'abel', characters: [abel(48, 'stop'), cain(76, 'idle')], action: 'stop', durationMs: 620,
      narrativeText: 'Remember the brothers and their work.', correctNarrativeText: 'The brothers remain in their Scriptural places.',
      wrongNarrativeText: 'Return to the offering path and read the detail again.', questionPoolId: 'regard-easy',
      checkpointId: 'regard-observe-question', scriptureReference: 'Genesis 4:2', correctActions: ['turn', 'walk'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'regard-response',
    },
    {
      id: 'regard-response', kind: 'question_event', environment: REGARD_FIELD,
      activeCharacterId: 'abel', characters: [abel(58, 'idle'), cain(78, 'idle')], action: 'stop', durationMs: 620,
      narrativeText: 'Compare the offerings without adding to the account.', correctNarrativeText: 'The details of both offerings remain clear.',
      wrongNarrativeText: 'The two offerings have been confused. Return to the checkpoint.', questionPoolId: 'regard-moderate',
      checkpointId: 'regard-response-question', scriptureReference: 'Genesis 4:3-4', correctActions: ['look_back', 'walk'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'regard-anger',
    },
    {
      id: 'regard-anger', kind: 'question_event', environment: REGARD_FIELD,
      activeCharacterId: 'abel', characters: [abel(62, 'idle'), cain(78, 'recoil')], action: 'stop', durationMs: 700,
      narrativeText: 'The light rests differently across the two offering places.', correctNarrativeText: 'Cain becomes very angry, and his face falls.',
      wrongNarrativeText: 'The response in the passage has been reversed.', questionPoolId: 'regard-hard',
      checkpointId: 'regard-anger-question', scriptureReference: 'Genesis 4:4-5', correctActions: ['look_back', 'stop'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'regard-complete',
    },
    {
      id: 'regard-complete', kind: 'completion', environment: REGARD_FIELD,
      activeCharacterId: null, characters: [abel(42, 'idle', 'observer'), cain(83, 'turn')], action: 'idle',
      narrativeText: 'The Lord had regard for Abel and his offering, but not for Cain and his offering.',
      scriptureReference: 'Genesis 4:4-5', checkpointId: 'regard-complete',
    },
  ],
};

export const AT_THE_DOOR_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-3', slug: AT_THE_DOOR_LEVEL_SLUG, title: 'At the Door',
  subtitle: 'Read the warning given to Cain.', bookSlug: 'beginnings', chapterSlug: 'brothers',
  order: 3, openingSceneId: 'door-intro', continuationText: 'The warning has been spoken. Cain must answer it.', scriptureLabel: 'Genesis 4',
  scenes: [
    {
      id: 'door-intro', kind: 'narrative', environment: WARNING_PATH,
      activeCharacterId: null, characters: [cain(32, 'stop', 'observer', 'right')], action: 'stop', durationMs: 1_750,
      narrativeText: 'Cain stands beneath a fallen countenance. The Lord addresses his anger directly.',
      scriptureReference: 'Genesis 4:6', checkpointId: 'door-start', nextSceneId: 'door-read',
    },
    {
      id: 'door-read', kind: 'read', environment: WARNING_PATH,
      activeCharacterId: null, characters: [cain(32, 'idle', 'observer', 'right')], action: 'stop',
      narrativeText: 'Read the warning before the path narrows.',
      readText: 'The Lord asks why Cain is angry and why his face has fallen. If he does well, he will be accepted. If he does not do well, sin is crouching at the door. Its desire is contrary to him, but he must rule over it.',
      scriptureReference: 'Genesis 4:6-7', checkpointId: 'door-start', nextSceneId: 'door-walk',
    },
    {
      id: 'door-walk', kind: 'movement', environment: WARNING_PATH,
      activeCharacterId: 'cain', characters: [cain(18, 'walk', 'player', 'right')],
      obstacles: [{ id: 'door-thorns', type: 'thorn', x: 43 }, { id: 'door-narrow', type: 'narrow_path', x: 70 }],
      action: 'walk', durationMs: 3_250, narrativeText: 'Follow the warning into the narrowing path.',
      checkpointId: 'door-start', nextSceneId: 'door-question',
    },
    {
      id: 'door-question', kind: 'question_event', environment: WARNING_PATH,
      activeCharacterId: 'cain', characters: [cain(48, 'stop', 'player', 'right')], action: 'stop', durationMs: 620,
      narrativeText: 'Recall the questions the Lord asked Cain.', correctNarrativeText: 'The warning begins with Cain\'s anger and fallen face.',
      wrongNarrativeText: 'Return to the warning and read its opening carefully.', questionPoolId: 'door-easy',
      checkpointId: 'door-question-checkpoint', scriptureReference: 'Genesis 4:6', correctActions: ['turn', 'walk'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'door-warning',
    },
    {
      id: 'door-warning', kind: 'question_event', environment: WARNING_PATH,
      activeCharacterId: 'cain', characters: [cain(58, 'stop', 'player', 'right')],
      obstacles: [{ id: 'door-shadow', type: 'narrow_path', x: 77, scale: 1.15 }], action: 'stop', durationMs: 650,
      narrativeText: 'The path tightens beside the doorway shadow.', correctNarrativeText: 'Sin is described as crouching at the door.',
      wrongNarrativeText: 'The image from the warning has been misplaced.', questionPoolId: 'door-moderate',
      checkpointId: 'door-warning-question', scriptureReference: 'Genesis 4:7', correctActions: ['look_back', 'walk'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'door-rule',
    },
    {
      id: 'door-rule', kind: 'question_event', environment: WARNING_PATH,
      activeCharacterId: 'cain', characters: [cain(68, 'confront', 'player', 'right')], action: 'confront', durationMs: 700,
      narrativeText: 'The final words of the warning remain before Cain.', correctNarrativeText: 'Cain is told that he must rule over it.',
      wrongNarrativeText: 'The command at the end of the warning has been missed.', questionPoolId: 'door-hard',
      checkpointId: 'door-rule-question', scriptureReference: 'Genesis 4:7', correctActions: ['confront', 'stop'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'door-complete',
    },
    {
      id: 'door-complete', kind: 'completion', environment: WARNING_PATH,
      activeCharacterId: null, characters: [cain(76, 'turn', 'observer', 'right')], action: 'stop',
      narrativeText: 'The warning ends, but the field lies ahead.', scriptureReference: 'Genesis 4:6-7', checkpointId: 'door-complete',
    },
  ],
};

export const THE_FIELD_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-4', slug: THE_FIELD_LEVEL_SLUG, title: 'The Field',
  subtitle: 'Walk the field without rewriting what Scripture records.', bookSlug: 'beginnings', chapterSlug: 'brothers',
  order: 4, openingSceneId: 'field-intro', continuationText: 'Abel\'s canonical exit opens the aftermath.', scriptureLabel: 'Genesis 4',
  scenes: [
    {
      id: 'field-intro', kind: 'narrative', environment: OMINOUS_FIELD,
      activeCharacterId: 'abel', characters: [abel(20), cain(8, 'follow', 'npc', 'right')], action: 'idle', durationMs: 1_850,
      narrativeText: 'Cain speaks to Abel. Scripture does not record the words. The brothers move into the field.',
      scriptureReference: 'Genesis 4:8', checkpointId: 'field-start', nextSceneId: 'field-walk',
    },
    {
      id: 'field-walk', kind: 'movement', environment: OMINOUS_FIELD,
      activeCharacterId: 'abel', characters: [abel(18, 'walk'), cain(7, 'pursue', 'threat', 'right')],
      obstacles: [{ id: 'field-log', type: 'log', x: 39 }, { id: 'field-ditch', type: 'ditch', x: 61 }, { id: 'field-rock', type: 'rock', x: 78 }],
      action: 'walk', durationMs: 3_500, narrativeText: 'Move through the field. Cain remains behind Abel.',
      checkpointId: 'field-start', nextSceneId: 'field-speech',
    },
    {
      id: 'field-speech', kind: 'question_event', environment: OMINOUS_FIELD,
      activeCharacterId: 'abel', characters: [abel(47, 'look_back'), cain(28, 'follow', 'threat', 'right')], action: 'look_back', durationMs: 620,
      narrativeText: 'Keep only what the passage actually says.', correctNarrativeText: 'The account remains restrained: Cain spoke, and they were in the field.',
      wrongNarrativeText: 'Do not add dialogue the passage does not provide.', questionPoolId: 'field-easy',
      checkpointId: 'field-speech-question', scriptureReference: 'Genesis 4:8', correctActions: ['look_back', 'walk'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'field-movement',
    },
    {
      id: 'field-movement', kind: 'question_event', environment: OMINOUS_FIELD,
      activeCharacterId: 'abel', characters: [abel(59, 'stop'), cain(42, 'pursue', 'threat', 'right')],
      obstacles: [{ id: 'field-thorn', type: 'thorn', x: 72 }], action: 'stop', durationMs: 650,
      narrativeText: 'The distance between the brothers closes.', correctNarrativeText: 'Cain rises against Abel in the field.',
      wrongNarrativeText: 'The sequence in Genesis 4:8 has been interrupted.', questionPoolId: 'field-moderate',
      checkpointId: 'field-movement-question', scriptureReference: 'Genesis 4:8', correctActions: ['run', 'look_back', 'stop'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'field-confrontation',
    },
    {
      id: 'field-confrontation', kind: 'question_event', environment: OMINOUS_FIELD,
      activeCharacterId: 'abel', characters: [abel(69, 'turn'), cain(57, 'confront', 'threat', 'right')], action: 'turn', durationMs: 720,
      narrativeText: 'Cain now stands as the narrative threat.', correctNarrativeText: 'The text names Cain as the one who killed Abel.',
      wrongNarrativeText: 'Return to the field checkpoint. The account must remain exact.', questionPoolId: 'field-hard',
      checkpointId: 'field-confrontation-question', scriptureReference: 'Genesis 4:8', correctActions: ['turn', 'confront', 'stop'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'field-canonical-death',
    },
    {
      id: 'field-canonical-death', kind: 'canonical_event', environment: OMINOUS_FIELD,
      activeCharacterId: null, characters: [abel(70, 'collapse'), cain(63, 'strike', 'threat', 'right')],
      action: 'collapse', durationMs: 3_100, narrativeText: 'Cain rose up against his brother Abel and killed him.',
      scriptureReference: 'Genesis 4:8', checkpointId: 'field-canonical-event', canonicalEventId: ABEL_CANONICAL_EVENT_ID,
      canonicalActions: ['confront', 'strike', 'recoil', 'collapse', 'lie_still', 'fade'], nextSceneId: 'field-complete',
    },
    {
      id: 'field-complete', kind: 'completion', environment: OMINOUS_FIELD,
      activeCharacterId: null, characters: [abel(70, 'lie_still', 'observer'), cain(84, 'turn', 'observer')], action: 'lie_still',
      narrativeText: 'Abel lies still. This is canonical progression, not gameplay failure.',
      scriptureReference: 'Genesis 4:8', checkpointId: 'field-complete',
    },
  ],
};

export const YOUR_BROTHER_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-5', slug: YOUR_BROTHER_LEVEL_SLUG, title: 'Your Brother',
  subtitle: 'Hear the question, the answer, and the consequence.', bookSlug: 'beginnings', chapterSlug: 'brothers',
  order: 5, openingSceneId: 'brother-intro', continuationText: 'The chapter now turns from Cain toward another offspring.', scriptureLabel: 'Genesis 4',
  scenes: [
    {
      id: 'brother-intro', kind: 'narrative', environment: AFTERMATH_GROUND,
      activeCharacterId: null, characters: [cain(48, 'stop', 'observer')], action: 'stop', durationMs: 1_850,
      narrativeText: 'The Lord asks Cain, "Where is Abel your brother?"', scriptureReference: 'Genesis 4:9',
      checkpointId: 'brother-start', nextSceneId: 'brother-walk',
    },
    {
      id: 'brother-walk', kind: 'movement', environment: AFTERMATH_GROUND,
      activeCharacterId: null, characters: [cain(48, 'recoil', 'observer')], action: 'stop', durationMs: 2_500,
      narrativeText: 'The camera remains with the aftermath. No runner replaces Abel.', checkpointId: 'brother-start', nextSceneId: 'brother-question',
    },
    {
      id: 'brother-question', kind: 'question_event', environment: AFTERMATH_GROUND,
      activeCharacterId: null, characters: [cain(48, 'turn', 'observer')], action: 'stop', durationMs: 620,
      narrativeText: 'Recall the confrontation exactly.', correctNarrativeText: 'Cain answers, "Am I my brother\'s keeper?"',
      wrongNarrativeText: 'Return to the question asked about Abel.', questionPoolId: 'brother-easy',
      checkpointId: 'brother-question-checkpoint', scriptureReference: 'Genesis 4:9', correctActions: ['turn', 'stop'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'brother-cry',
    },
    {
      id: 'brother-cry', kind: 'question_event', environment: AFTERMATH_GROUND,
      activeCharacterId: null, characters: [cain(52, 'recoil', 'observer')], action: 'recoil', durationMs: 650,
      narrativeText: 'The ground itself bears witness in the passage.', correctNarrativeText: 'The voice of Abel\'s blood cries from the ground.',
      wrongNarrativeText: 'The witness named in the passage has been missed.', questionPoolId: 'brother-moderate',
      checkpointId: 'brother-cry-question', scriptureReference: 'Genesis 4:10-11', correctActions: ['recoil', 'turn'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'brother-consequence',
    },
    {
      id: 'brother-consequence', kind: 'question_event', environment: AFTERMATH_GROUND,
      activeCharacterId: null, characters: [cain(61, 'walk', 'observer', 'right')],
      obstacles: [{ id: 'brother-barren-path', type: 'narrow_path', x: 78 }], action: 'walk', durationMs: 700,
      narrativeText: 'The ground will no longer yield its strength to Cain.', correctNarrativeText: 'Cain bears the consequence named in the passage.',
      wrongNarrativeText: 'Return to the consequence recorded after Abel\'s death.', questionPoolId: 'brother-hard',
      checkpointId: 'brother-consequence-question', scriptureReference: 'Genesis 4:11-15', correctActions: ['walk', 'look_back', 'fade'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'brother-complete',
    },
    {
      id: 'brother-complete', kind: 'completion', environment: AFTERMATH_GROUND,
      activeCharacterId: null, characters: [cain(82, 'fade', 'observer', 'right')], action: 'fade',
      narrativeText: 'Cain goes from the presence of the Lord under the consequence Scripture records.',
      scriptureReference: 'Genesis 4:11-16', checkpointId: 'brother-complete',
    },
  ],
};

export const ANOTHER_OFFSPRING_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-1-level-6', slug: ANOTHER_OFFSPRING_LEVEL_SLUG, title: 'Another Offspring',
  subtitle: 'Close Brothers and turn toward the next generation.', bookSlug: 'beginnings', chapterSlug: 'brothers',
  order: 6, openingSceneId: 'seth-intro', continuationText: 'The journey continues with Seth.', chapterConclusion: true,
  nextCharacterName: 'Seth', scriptureLabel: 'Genesis 4',
  chapterCompletionText: 'Brothers is complete. Seth now opens the next chapter.',
  scenes: [
    {
      id: 'seth-intro', kind: 'narrative', environment: SETH_DAWN,
      activeCharacterId: null, characters: [], action: 'idle', durationMs: 1_900,
      narrativeText: 'Time passes. Adam and Eve receive another son after Abel.',
      scriptureReference: 'Genesis 4:25', checkpointId: 'seth-transition-start', nextSceneId: 'seth-dawn-walk',
    },
    {
      id: 'seth-dawn-walk', kind: 'movement', environment: SETH_DAWN,
      activeCharacterId: null, characters: [], action: 'idle', durationMs: 2_100,
      narrativeText: 'The darkness clears as the story moves to another generation.',
      checkpointId: 'seth-transition-start', nextSceneId: 'seth-reveal',
    },
    {
      id: 'seth-reveal', kind: 'character_transition', environment: SETH_DAWN,
      activeCharacterId: null, characters: [seth(52, 'character_swap')], action: 'character_swap', durationMs: 2_600,
      narrativeText: 'Eve names him Seth: another offspring in place of Abel.', scriptureReference: 'Genesis 4:25',
      checkpointId: 'seth-generational-event', canonicalEventId: SETH_TRANSITION_EVENT_ID,
      canonicalActions: ['character_swap'], nextSceneId: 'seth-complete',
    },
    {
      id: 'seth-complete', kind: 'completion', environment: SETH_DAWN,
      activeCharacterId: null, characters: [seth(52)], action: 'idle',
      narrativeText: 'Brothers is complete. Seth is introduced, but his playable journey remains locked.',
      scriptureReference: 'Genesis 4:25', checkpointId: 'seth-transition-complete',
    },
  ],
};

export const BROTHERS_LEVELS = [
  ABEL_OFFERING_LEVEL,
  REGARD_LEVEL,
  AT_THE_DOOR_LEVEL,
  THE_FIELD_LEVEL,
  YOUR_BROTHER_LEVEL,
  ANOTHER_OFFSPRING_LEVEL,
];

export const STORY_BOOKS: StoryBookDefinition[] = [
  {
    id: 'story-book-1', slug: 'beginnings', numeral: 'Book I', title: 'Beginnings', order: 1,
    chapters: [
      { id: 'story-book-1-chapter-1', slug: 'brothers', title: 'Brothers', order: 1, levels: BROTHERS_LEVELS },
      { id: 'story-book-1-chapter-2', slug: 'generations', title: 'Generations', order: 2, levels: GENERATIONS_LEVELS },
      {
        id: 'story-book-1-chapter-3', slug: 'noah', title: 'Noah', order: 3, levels: NOAH_LEVELS,
        plannedLevelCount: 11,
        lockedContinuation: { title: 'The Flood', subtitle: 'Phase 3E continuation · locked' },
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

export function findStoryBuild(buildId: string) {
  return buildId === ARK_CONSTRUCTION.id ? ARK_CONSTRUCTION : null;
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
