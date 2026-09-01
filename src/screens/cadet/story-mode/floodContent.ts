import type {
  StoryActionName,
  StoryCharacterPlacement,
  StoryCreatureGroup,
  StoryEnvironment,
  StoryLevelDefinition,
  StoryLocomotion,
  StorySceneDefinition,
  StorySupplyGroup,
} from './types';
import { ARK_CONSTRUCTION_ID } from './noahContent.ts';

export const FLOOD_ENVIRONMENT_SEQUENCE_ID = 'noah-flood-environment';

export const ENTER_ARK_LEVEL_SLUG = 'enter-the-ark';
export const SEVEN_DAYS_LEVEL_SLUG = 'seven-days';
export const FORTY_DAYS_LEVEL_SLUG = 'forty-days';
export const WATERS_PREVAILED_LEVEL_SLUG = 'waters-prevailed';
export const GOD_REMEMBERED_LEVEL_SLUG = 'god-remembered-noah';
export const MOUNTAINS_APPEAR_LEVEL_SLUG = 'the-mountains-appear';
export const RAVEN_LEVEL_SLUG = 'the-raven';
export const DOVE_LEVEL_SLUG = 'the-dove';
export const OLIVE_LEAF_LEVEL_SLUG = 'an-olive-leaf';
export const DRY_GROUND_LEVEL_SLUG = 'dry-ground';
export const COME_OUT_LEVEL_SLUG = 'come-out';
export const ALTAR_LEVEL_SLUG = 'an-altar';
export const MY_COVENANT_LEVEL_SLUG = 'my-covenant';
export const BOW_CLOUD_LEVEL_SLUG = 'the-bow-in-the-cloud';

const ENTRY: StoryEnvironment = {
  id: 'completed-ark-entry', palette: 'flood-entry', weather: 'clouding', weatherIntensity: 1, timeOfDay: 'morning',
};
const WAITING: StoryEnvironment = {
  id: 'seven-days-within-the-ark', palette: 'flood-waiting', weather: 'clouding', weatherIntensity: 2,
  timeOfDay: 'evening', timePassage: 'seven_days',
};
const RAIN: StoryEnvironment = {
  id: 'forty-days-of-rain', palette: 'flood-rain', weather: 'storm', weatherIntensity: 4,
  timeOfDay: 'night', timePassage: 'forty_days',
};
const HIGH_WATER: StoryEnvironment = {
  id: 'waters-prevail-over-earth', palette: 'flood-high', weather: 'storm', weatherIntensity: 3,
  timeOfDay: 'evening', timePassage: 'flood_months',
};
const RECEDING: StoryEnvironment = {
  id: 'wind-over-receding-water', palette: 'flood-receding', weather: 'wind', weatherIntensity: 2, timeOfDay: 'dawn',
};
const MOUNTAINS: StoryEnvironment = {
  id: 'mountain-tops-revealed', palette: 'flood-mountains', weather: 'clear', weatherIntensity: 0, timeOfDay: 'morning', elevation: 3,
};
const BIRDS: StoryEnvironment = {
  id: 'birds-released-from-ark', palette: 'flood-birds', weather: 'still', weatherIntensity: 0, timeOfDay: 'morning', elevation: 2,
};
const DRY: StoryEnvironment = {
  id: 'changed-dry-ground', palette: 'flood-dry', weather: 'clear', weatherIntensity: 0, timeOfDay: 'morning', elevation: 1,
};
const ALTAR: StoryEnvironment = {
  id: 'altar-on-dry-ground', palette: 'flood-altar', weather: 'still', weatherIntensity: 0, timeOfDay: 'evening', elevation: 1,
};
const COVENANT: StoryEnvironment = {
  id: 'covenant-under-clearing-sky', palette: 'flood-covenant', weather: 'clear', weatherIntensity: 0, timeOfDay: 'dawn', elevation: 1,
};

function person(
  id: StoryCharacterPlacement['id'],
  x: number,
  action: StoryActionName = 'idle',
  role: StoryCharacterPlacement['role'] = 'family',
): StoryCharacterPlacement {
  return { id, x, action, role, facing: 'right', active: role === 'player' };
}

function noah(x = 24, action: StoryActionName = 'idle'): StoryCharacterPlacement {
  return person('noah', x, action, 'player');
}

const WHOLE_HOUSEHOLD: StoryCharacterPlacement[] = [
  noah(18, 'observe'),
  person('noahs-wife', 30, 'observe'),
  person('shem', 42, 'observe'),
  person('shems-wife', 51, 'observe'),
  person('ham', 60, 'observe'),
  person('hams-wife', 69, 'observe'),
  person('japheth', 78, 'observe'),
  person('japheths-wife', 87, 'observe'),
];

const ENTERING_CREATURES: StoryCreatureGroup[] = [
  { id: 'clean-groups', category: 'land-animals', state: 'entering', x: 60 },
  { id: 'bird-groups', category: 'birds', state: 'entering', x: 73 },
  { id: 'other-groups', category: 'creeping-things', state: 'waiting', x: 85 },
];

const STORED_CREATURES = ENTERING_CREATURES.map((group) => ({ ...group, state: 'stored' as const }));

const PROVISIONS: StorySupplyGroup[] = [
  { id: 'flood-sacks', kind: 'sacks', state: 'stored', x: 67 },
  { id: 'flood-bundles', kind: 'bundles', state: 'stored', x: 77 },
  { id: 'flood-vessels', kind: 'vessels', state: 'stored', x: 87 },
];

type FloodQuestionScene = {
  id: string;
  poolId: string;
  checkpointId: string;
  narrative: string;
  correct: string;
  wrong: string;
  scripture: string;
  action?: StoryActionName;
  correctActions?: StoryActionName[];
  wrongActions?: StoryActionName[];
  camera?: StorySceneDefinition['camera'];
  characters?: StoryCharacterPlacement[];
  creatureGroups?: StoryCreatureGroup[];
  supplyGroups?: StorySupplyGroup[];
};

type FloodLevelInput = {
  order: number;
  slug: string;
  title: string;
  subtitle: string;
  environment: StoryEnvironment;
  intro: string;
  scripture: string;
  movement: string;
  movementAction?: StoryActionName;
  locomotion?: StoryLocomotion;
  continuation: string;
  completion: string;
  questions: FloodQuestionScene[];
  read?: { text: string; scripture: string };
  characters?: StoryCharacterPlacement[];
  creatureGroups?: StoryCreatureGroup[];
  supplyGroups?: StorySupplyGroup[];
  camera?: StorySceneDefinition['camera'];
  chapterConclusion?: boolean;
  chapterCompletionText?: string;
  titleReveal?: string;
};

function floodQuestion(
  environment: StoryEnvironment,
  item: FloodQuestionScene,
  nextSceneId: string,
  fallbackCharacters: StoryCharacterPlacement[],
  fallbackCreatures?: StoryCreatureGroup[],
  fallbackSupplies?: StorySupplyGroup[],
): StorySceneDefinition {
  return {
    id: item.id,
    kind: 'question_event',
    environment,
    activeCharacterId: 'noah',
    characters: item.characters || fallbackCharacters,
    action: item.action || 'observe',
    durationMs: 680,
    narrativeText: item.narrative,
    correctNarrativeText: item.correct,
    wrongNarrativeText: item.wrong,
    scriptureReference: item.scripture,
    questionPoolId: item.poolId,
    checkpointId: item.checkpointId,
    correctActions: item.correctActions || ['observe', 'walk'],
    wrongActions: item.wrongActions || ['recoil', 'stop'],
    constructionId: ARK_CONSTRUCTION_ID,
    creatureGroups: item.creatureGroups || fallbackCreatures,
    supplyGroups: item.supplyGroups || fallbackSupplies,
    camera: item.camera || { framing: 'focus', target: 'ark' },
    nextSceneId,
  };
}

function createFloodLevel(input: FloodLevelInput): StoryLevelDefinition {
  const startCheckpoint = `${input.slug}-start`;
  const introId = `${input.slug}-intro`;
  const readId = `${input.slug}-read`;
  const movementId = `${input.slug}-movement`;
  const completionId = `${input.slug}-complete`;
  const characters = input.characters || [noah(24, input.movementAction || 'observe')];
  const firstAfterIntro = input.read ? readId : movementId;

  const scenes: StorySceneDefinition[] = [
    {
      id: introId,
      kind: 'narrative',
      environment: input.environment,
      activeCharacterId: 'noah',
      characters,
      action: 'observe',
      durationMs: 1_850,
      narrativeText: input.intro,
      scriptureReference: input.scripture,
      checkpointId: startCheckpoint,
      constructionId: ARK_CONSTRUCTION_ID,
      creatureGroups: input.creatureGroups,
      supplyGroups: input.supplyGroups,
      camera: input.camera || { framing: 'wide', target: 'ark' },
      nextSceneId: firstAfterIntro,
    },
  ];

  if (input.read) {
    scenes.push({
      id: readId,
      kind: 'read',
      environment: input.environment,
      activeCharacterId: 'noah',
      characters,
      action: 'stop',
      narrativeText: 'Read the passage before the next canonical movement.',
      readText: input.read.text,
      scriptureReference: input.read.scripture,
      checkpointId: startCheckpoint,
      constructionId: ARK_CONSTRUCTION_ID,
      creatureGroups: input.creatureGroups,
      supplyGroups: input.supplyGroups,
      camera: { framing: 'focus', target: 'ark' },
      nextSceneId: movementId,
    });
  }

  scenes.push({
    id: movementId,
    kind: 'movement',
    environment: input.environment,
    activeCharacterId: 'noah',
    characters,
    action: input.movementAction || 'slow_walk',
    locomotion: input.locomotion || 'slow_walk',
    durationMs: 4_800,
    narrativeText: input.movement,
    scriptureReference: input.scripture,
    checkpointId: startCheckpoint,
    constructionId: ARK_CONSTRUCTION_ID,
    creatureGroups: input.creatureGroups,
    supplyGroups: input.supplyGroups,
    camera: input.camera || { framing: 'wide', target: 'ark' },
    nextSceneId: input.questions[0].id,
  });

  input.questions.forEach((item, index) => {
    scenes.push(floodQuestion(
      input.environment,
      item,
      input.questions[index + 1]?.id || completionId,
      characters,
      input.creatureGroups,
      input.supplyGroups,
    ));
  });

  scenes.push({
    id: completionId,
    kind: 'completion',
    environment: input.environment,
    activeCharacterId: 'noah',
    characters,
    action: input.questions[input.questions.length - 1]?.correctActions?.slice(-1)[0] || 'observe',
    narrativeText: input.completion,
    scriptureReference: input.scripture,
    checkpointId: completionId,
    constructionId: ARK_CONSTRUCTION_ID,
    creatureGroups: input.creatureGroups,
    supplyGroups: input.supplyGroups,
    camera: input.camera || { framing: 'wide', target: 'ark' },
    titleReveal: input.titleReveal,
  });

  return {
    id: `book-1-chapter-3-level-${input.order}`,
    slug: input.slug,
    title: input.title,
    subtitle: input.subtitle,
    bookSlug: 'beginnings',
    chapterSlug: 'noah',
    order: input.order,
    openingSceneId: introId,
    continuationText: input.continuation,
    scriptureLabel: input.scripture,
    chapterConclusion: input.chapterConclusion,
    chapterCompletionText: input.chapterCompletionText,
    scenes,
  };
}

export const ENTER_ARK_LEVEL = createFloodLevel({
  order: 11,
  slug: ENTER_ARK_LEVEL_SLUG,
  title: 'Enter the Ark',
  subtitle: 'Bring the household and creature groups through the prepared door.',
  environment: ENTRY,
  intro: 'The completed Ark stands ready. Noah, his household, and the living creatures approach its door.',
  scripture: 'Genesis 7:1-12',
  movement: 'Move toward the Ark while the household, creatures, and stored provisions remain in their textual order.',
  movementAction: 'enter',
  continuation: 'The door is shut, and the seven-day interval begins.',
  completion: 'Noah, his household, and the creatures are within the Ark. The Lord shuts him in.',
  read: {
    scripture: 'Genesis 7:1-12',
    text: 'The Lord tells Noah to enter the Ark with his household. The passage distinguishes clean animals, animals that are not clean, and birds, preserving male and female. Seven days remain before rain comes upon the earth. Noah enters with his sons, his wife, and his sons\' wives, and the creatures come as God commanded.',
  },
  characters: WHOLE_HOUSEHOLD,
  creatureGroups: ENTERING_CREATURES,
  supplyGroups: PROVISIONS,
  questions: [
    {
      id: 'entry-household', poolId: 'entry-household-moderate', checkpointId: 'entry-household-question',
      narrative: 'Keep the household named in Genesis 7 together.', correct: 'Noah and the seven members of his household move toward the Ark.',
      wrong: 'The entering household has been changed beyond the passage.', scripture: 'Genesis 7:1, 7, 13',
      action: 'group_enter', correctActions: ['group_enter', 'enter'], characters: WHOLE_HOUSEHOLD,
    },
    {
      id: 'entry-animals', poolId: 'entry-animals-moderate', checkpointId: 'entry-animals-question',
      narrative: 'Preserve the clean, not-clean, and bird distinctions in this passage.', correct: 'The creature groups advance with male-and-female detail intact.',
      wrong: 'The intake detail has been flattened or contradicted.', scripture: 'Genesis 7:2-3, 8-9',
      action: 'animal_enter', correctActions: ['animal_enter', 'enter'], creatureGroups: ENTERING_CREATURES,
    },
    {
      id: 'entry-door', poolId: 'entry-door-hard', checkpointId: 'entry-door-question',
      narrative: 'Complete the entry without assigning the final action to Noah.', correct: 'The Lord shuts Noah in; the prepared Ark is sealed.',
      wrong: 'The passage does not say Noah performed the final shutting action.', scripture: 'Genesis 7:16',
      action: 'open_door', correctActions: ['enter', 'open_door', 'stop'], creatureGroups: STORED_CREATURES,
      camera: { framing: 'focus', target: 'ark' },
    },
  ],
});

export const SEVEN_DAYS_LEVEL = createFloodLevel({
  order: 12,
  slug: SEVEN_DAYS_LEVEL_SLUG,
  title: 'Seven Days',
  subtitle: 'Let the waiting interval pass without real-time delay.',
  environment: WAITING,
  intro: 'Inside the sealed Ark, the promised seven-day interval passes.',
  scripture: 'Genesis 7:4, 10',
  movement: 'Dawn, day, dusk, and night pass in a restrained seven-day montage.',
  movementAction: 'rest',
  continuation: 'The seven days end. The waters of the Flood come upon the earth.',
  completion: 'After seven days, the waters of the Flood are upon the earth.',
  characters: [noah(35, 'rest'), person('noahs-wife', 48, 'rest')],
  supplyGroups: PROVISIONS,
  questions: [
    {
      id: 'seven-wait', poolId: 'seven-wait-easy', checkpointId: 'seven-wait-question',
      narrative: 'Recall the interval before the waters came.', correct: 'Seven days pass within the Ark.',
      wrong: 'The waiting period does not match Genesis 7.', scripture: 'Genesis 7:4, 10',
      action: 'rest', correctActions: ['rest', 'observe'],
    },
    {
      id: 'seven-rain', poolId: 'seven-rain-moderate', checkpointId: 'seven-rain-question',
      narrative: 'Place the beginning of the Flood after the stated interval.', correct: 'The first rain follows the completed seven-day wait.',
      wrong: 'The rain cannot begin before the textual interval is complete.', scripture: 'Genesis 7:10-12',
      action: 'observe', correctActions: ['observe', 'sway'], camera: { framing: 'wide', target: 'environment' },
    },
  ],
});

export const FORTY_DAYS_LEVEL = createFloodLevel({
  order: 13,
  slug: FORTY_DAYS_LEVEL_SLUG,
  title: 'Forty Days',
  subtitle: 'Endure the Scripture-defined duration as the waters rise.',
  environment: RAIN,
  intro: 'Rain falls while the fountains of the great deep and the windows of heaven mark the beginning of the Flood.',
  scripture: 'Genesis 7:11-17',
  movement: 'The Ark interior sways through a time-passage of forty days and forty nights.',
  movementAction: 'sway',
  continuation: 'The waters increase and lift the Ark high above the earth.',
  completion: 'Forty days of Flood conditions have passed; the Ark is lifted by the increasing waters.',
  characters: [noah(38, 'sway'), person('shem', 53, 'store')],
  creatureGroups: STORED_CREATURES,
  supplyGroups: PROVISIONS,
  camera: { framing: 'wide', target: 'ark' },
  questions: [
    {
      id: 'forty-duration', poolId: 'forty-duration-easy', checkpointId: 'forty-duration-question',
      narrative: 'Name the duration of the rain stated in Genesis 7:12.', correct: 'Forty days and forty nights pass in the montage.',
      wrong: 'The duration of the rain has been changed.', scripture: 'Genesis 7:12, 17',
      action: 'sway', correctActions: ['sway', 'rest'],
    },
    {
      id: 'forty-fountains', poolId: 'forty-fountains-hard', checkpointId: 'forty-fountains-question',
      narrative: 'Keep both sources named at the Flood\'s opening in view.', correct: 'The deep and the heavens remain joined in the passage\'s description.',
      wrong: 'One of the paired opening details has been misplaced.', scripture: 'Genesis 7:11-12',
      action: 'observe', correctActions: ['observe', 'sway'], camera: { framing: 'reveal', target: 'environment' },
    },
  ],
});

export const WATERS_PREVAILED_LEVEL = createFloodLevel({
  order: 14,
  slug: WATERS_PREVAILED_LEVEL_SLUG,
  title: 'Waters Prevailed',
  subtitle: 'Watch terrain disappear as the Ark becomes the principal world.',
  environment: HIGH_WATER,
  intro: 'The waters increase greatly, cover the high mountains, and prevail upon the earth.',
  scripture: 'Genesis 7:17-24',
  movement: 'The world scrolls beneath the floating Ark; normal ground traversal has ended.',
  movementAction: 'sway',
  continuation: 'At the high-water stage, the Ark alone remains central in the visible world.',
  completion: 'The waters prevail, and the Ark moves upon the face of the waters.',
  characters: [noah(42, 'sway')],
  creatureGroups: STORED_CREATURES,
  supplyGroups: PROVISIONS,
  camera: { framing: 'wide', target: 'ark' },
  questions: [
    {
      id: 'waters-lift', poolId: 'waters-lift-easy', checkpointId: 'waters-lift-question',
      narrative: 'Recall what the increasing waters did to the Ark.', correct: 'The waters lift the Ark above the earth.',
      wrong: 'The Ark\'s relationship to the rising waters has been reversed.', scripture: 'Genesis 7:17-18',
      action: 'sway', correctActions: ['sway', 'observe'],
    },
    {
      id: 'waters-prevail', poolId: 'waters-prevail-hard', checkpointId: 'waters-prevail-question',
      narrative: 'Hold together the high-water scope and duration stated in the text.', correct: 'Terrain disappears beneath the authoritative high-water stage.',
      wrong: 'The high-water sequence cannot settle from that detail.', scripture: 'Genesis 7:19-24',
      action: 'observe', correctActions: ['observe', 'sway'], camera: { framing: 'reveal', target: 'environment' },
    },
  ],
});

export const GOD_REMEMBERED_LEVEL = createFloodLevel({
  order: 15,
  slug: GOD_REMEMBERED_LEVEL_SLUG,
  title: 'God Remembered Noah',
  subtitle: 'Move from storm toward wind, restraint, and receding waters.',
  environment: RECEDING,
  intro: 'God remembered Noah and every living thing with him in the Ark; God made a wind pass over the earth.',
  scripture: 'Genesis 8:1-4',
  movement: 'The storm softens, wind passes, and the same water system begins moving in reverse.',
  movementAction: 'observe',
  continuation: 'The Ark comes to rest on the mountains of Ararat.',
  completion: 'The waters recede, and the Ark rests on the mountains of Ararat.',
  read: {
    scripture: 'Genesis 8:1-12',
    text: 'God remembered Noah and the living creatures in the Ark. A wind passed over the earth, the sources of the waters were restrained, and the waters receded. The Ark rested on the mountains of Ararat. As the waters continued to decrease, mountain tops appeared. Noah later sent out a raven and then a dove to learn whether the waters had subsided.',
  },
  characters: [noah(38, 'observe')],
  creatureGroups: STORED_CREATURES,
  supplyGroups: PROVISIONS,
  camera: { framing: 'wide', target: 'ark' },
  questions: [
    {
      id: 'remembered-wind', poolId: 'remembered-wind-moderate', checkpointId: 'remembered-wind-question',
      narrative: 'Identify the change God causes over the earth.', correct: 'Wind passes over the earth and the waters begin to subside.',
      wrong: 'The transition in Genesis 8:1 has been replaced.', scripture: 'Genesis 8:1-3',
      action: 'observe', correctActions: ['observe', 'sway'], camera: { framing: 'wide', target: 'environment' },
    },
    {
      id: 'remembered-rest', poolId: 'remembered-rest-hard', checkpointId: 'remembered-rest-question',
      narrative: 'Settle the Ark where and when the passage places it.', correct: 'The Ark settles on the mountains of Ararat.',
      wrong: 'The Ark cannot rest at an unsupported place or stage.', scripture: 'Genesis 8:4',
      action: 'rest', correctActions: ['sway', 'rest'], camera: { framing: 'reveal', target: 'ark' },
    },
  ],
});

export const MOUNTAINS_APPEAR_LEVEL = createFloodLevel({
  order: 16,
  slug: MOUNTAINS_APPEAR_LEVEL_SLUG,
  title: 'The Mountains Appear',
  subtitle: 'Let distant terrain return as the waters continue downward.',
  environment: MOUNTAINS,
  intro: 'The waters continue to decrease until the tops of the mountains become visible.',
  scripture: 'Genesis 8:4-5',
  movement: 'The camera steadies with the resting Ark while distant mountain silhouettes emerge.',
  movementAction: 'observe',
  continuation: 'Noah waits before opening the Ark window and sending out a bird.',
  completion: 'The mountain tops are visible beyond the resting Ark.',
  characters: [noah(40, 'observe')],
  camera: { framing: 'wide', target: 'environment' },
  questions: [
    {
      id: 'mountains-date', poolId: 'mountains-date-hard', checkpointId: 'mountains-date-question',
      narrative: 'Distinguish the Ark\'s resting date from the later visibility of mountain tops.', correct: 'The two dated stages remain in their Genesis 8 order.',
      wrong: 'The resting and visibility stages have been collapsed together.', scripture: 'Genesis 8:4-5',
      action: 'observe', correctActions: ['observe', 'rest'],
    },
    {
      id: 'mountains-visible', poolId: 'mountains-visible-easy', checkpointId: 'mountains-visible-question',
      narrative: 'Name what becomes visible as the waters decrease.', correct: 'The tops of the mountains emerge above the water.',
      wrong: 'The returning terrain does not match Genesis 8:5.', scripture: 'Genesis 8:5',
      action: 'observe', correctActions: ['observe', 'appear'], camera: { framing: 'reveal', target: 'environment' },
    },
  ],
});

export const RAVEN_LEVEL = createFloodLevel({
  order: 17,
  slug: RAVEN_LEVEL_SLUG,
  title: 'The Raven',
  subtitle: 'Release the first bird without inventing a moral contrast.',
  environment: BIRDS,
  intro: 'After forty days, Noah opens the Ark window and sends out a raven.',
  scripture: 'Genesis 8:6-7',
  movement: 'The lightweight bird silhouette moves out over the receding waters.',
  movementAction: 'release',
  continuation: 'The account turns from the raven to Noah\'s three releases of the dove.',
  completion: 'The raven goes to and fro until the waters are dried up from the earth.',
  characters: [noah(36, 'release')],
  camera: { framing: 'focus', target: 'bird' },
  questions: [
    {
      id: 'raven-release', poolId: 'raven-release-easy', checkpointId: 'raven-release-question',
      narrative: 'Identify the first bird Noah sends out.', correct: 'The raven leaves the Ark window.',
      wrong: 'The first bird in this sequence has been changed.', scripture: 'Genesis 8:6-7',
      action: 'release', correctActions: ['release', 'fly'], camera: { framing: 'focus', target: 'bird' },
    },
    {
      id: 'raven-movement', poolId: 'raven-movement-moderate', checkpointId: 'raven-movement-question',
      narrative: 'Keep the raven\'s movement within the wording of the passage.', correct: 'The raven continues to and fro over the water.',
      wrong: 'The passage does not support the invented bird behavior.', scripture: 'Genesis 8:7',
      action: 'circle', correctActions: ['fly', 'circle'], camera: { framing: 'wide', target: 'bird' },
    },
  ],
});

export const DOVE_LEVEL = createFloodLevel({
  order: 18,
  slug: DOVE_LEVEL_SLUG,
  title: 'The Dove',
  subtitle: 'Send the dove and receive it when no resting place is found.',
  environment: BIRDS,
  intro: 'Noah sends out a dove to see whether the waters have subsided from the ground.',
  scripture: 'Genesis 8:8-9',
  movement: 'The dove leaves the Ark, finds no resting place, and returns.',
  movementAction: 'release',
  continuation: 'Noah waits seven more days before sending the dove again.',
  completion: 'Noah reaches out, takes the returned dove, and brings it into the Ark.',
  characters: [noah(40, 'receive')],
  camera: { framing: 'focus', target: 'bird' },
  questions: [
    {
      id: 'dove-first', poolId: 'dove-first-easy', checkpointId: 'dove-first-question',
      narrative: 'Recall why Noah sent the dove.', correct: 'The dove is sent to learn whether waters had subsided from the ground.',
      wrong: 'The purpose of the first dove release has been changed.', scripture: 'Genesis 8:8',
      action: 'release', correctActions: ['release', 'fly'],
    },
    {
      id: 'dove-return', poolId: 'dove-return-moderate', checkpointId: 'dove-return-question',
      narrative: 'Complete the first dove release from the actual account.', correct: 'The dove returns, and Noah receives it into the Ark.',
      wrong: 'The dove cannot remain away during its first release.', scripture: 'Genesis 8:9',
      action: 'return', correctActions: ['return', 'receive'], camera: { framing: 'focus', target: 'bird' },
    },
  ],
});

export const OLIVE_LEAF_LEVEL = createFloodLevel({
  order: 19,
  slug: OLIVE_LEAF_LEVEL_SLUG,
  title: 'An Olive Leaf',
  subtitle: 'Follow the second and third dove releases in their proper order.',
  environment: BIRDS,
  intro: 'After seven more days, Noah sends the dove from the Ark again.',
  scripture: 'Genesis 8:10-12',
  movement: 'Two restrained time passages separate the dove releases; no real-time week is required.',
  movementAction: 'rest',
  continuation: 'After the final wait and release, the dove does not return.',
  completion: 'The freshly plucked olive leaf has testified to receding waters, and after the third release the dove does not return.',
  characters: [noah(40, 'receive')],
  camera: { framing: 'focus', target: 'bird' },
  questions: [
    {
      id: 'olive-wait', poolId: 'olive-wait-moderate', checkpointId: 'olive-wait-question',
      narrative: 'Keep the interval before the second release.', correct: 'Seven more days pass before Noah sends the dove again.',
      wrong: 'The wait between releases does not match Genesis 8.', scripture: 'Genesis 8:10',
      action: 'rest', correctActions: ['rest', 'release'],
    },
    {
      id: 'olive-leaf', poolId: 'olive-leaf-easy', checkpointId: 'olive-leaf-question',
      narrative: 'Identify what the dove brings back in the evening.', correct: 'A freshly plucked olive leaf appears with the returning dove.',
      wrong: 'The carried object does not match Genesis 8:11.', scripture: 'Genesis 8:11',
      action: 'return', correctActions: ['fly', 'return', 'receive'], camera: { framing: 'reveal', target: 'bird' },
    },
    {
      id: 'olive-third', poolId: 'olive-third-hard', checkpointId: 'olive-third-question',
      narrative: 'Complete the third release only after the second seven-day wait.', correct: 'The third dove leaves and does not return to Noah.',
      wrong: 'The final release cannot occur before the required sequence.', scripture: 'Genesis 8:12',
      action: 'release', correctActions: ['rest', 'release', 'fly'], camera: { framing: 'wide', target: 'bird' },
    },
  ],
});

export const DRY_GROUND_LEVEL = createFloodLevel({
  order: 20,
  slug: DRY_GROUND_LEVEL_SLUG,
  title: 'Dry Ground',
  subtitle: 'Reveal wet, changed terrain in the dated sequence of Genesis 8.',
  environment: DRY,
  intro: 'The covering is removed, and Noah sees that the face of the ground is drying.',
  scripture: 'Genesis 8:13-14',
  movement: 'Water withdraws from exposed rock and muddy ground; the world does not instantly reset.',
  movementAction: 'observe',
  continuation: 'Dry ground is visible, but Noah still waits for the command to leave.',
  completion: 'The earth is dry in the passage\'s sequence. The Ark remains closed until God speaks.',
  characters: [noah(36, 'observe')],
  camera: { framing: 'wide', target: 'environment' },
  questions: [
    {
      id: 'dry-uncover', poolId: 'dry-uncover-moderate', checkpointId: 'dry-uncover-question',
      narrative: 'Recall what Noah removes before looking at the ground.', correct: 'Noah removes the covering of the Ark and sees the drying ground.',
      wrong: 'The observation sequence has been altered.', scripture: 'Genesis 8:13',
      action: 'open_door', correctActions: ['open_door', 'observe'], camera: { framing: 'focus', target: 'ark' },
    },
    {
      id: 'dry-complete', poolId: 'dry-complete-hard', checkpointId: 'dry-complete-question',
      narrative: 'Distinguish the ground drying from the later declaration that the earth was dry.', correct: 'The final dry-ground stage settles without authorizing an early exit.',
      wrong: 'Genesis 8:13-14 keeps these observations distinct.', scripture: 'Genesis 8:13-14',
      action: 'observe', correctActions: ['observe', 'rest'],
    },
  ],
});

export const COME_OUT_LEVEL = createFloodLevel({
  order: 21,
  slug: COME_OUT_LEVEL_SLUG,
  title: 'Come Out',
  subtitle: 'Leave only after the authoritative command.',
  environment: DRY,
  intro: 'God tells Noah to come out of the Ark with his household and every living thing.',
  scripture: 'Genesis 8:15-19',
  movement: 'The opened Ark becomes a procession from interior traversal to changed dry land.',
  movementAction: 'exit',
  continuation: 'On the changed ground, Noah prepares an altar to the Lord.',
  completion: 'Noah, his household, and the living creatures have left the Ark by the command in Genesis 8.',
  characters: WHOLE_HOUSEHOLD.map((item) => ({ ...item, action: 'exit' as const })),
  creatureGroups: ENTERING_CREATURES.map((group) => ({ ...group, state: 'entering' as const })),
  camera: { framing: 'wide', target: 'procession' },
  questions: [
    {
      id: 'exit-command', poolId: 'exit-command-easy', checkpointId: 'exit-command-question',
      narrative: 'Identify who authorizes the departure.', correct: 'God\'s command opens the exit sequence.',
      wrong: 'Noah may not leave merely because the ground looks dry.', scripture: 'Genesis 8:15-17',
      action: 'exit', correctActions: ['open_door', 'exit'],
    },
    {
      id: 'exit-groups', poolId: 'exit-groups-moderate', checkpointId: 'exit-groups-question',
      narrative: 'Bring out the household and creatures in the broad groups the passage names.', correct: 'Family and creature groups proceed onto dry land.',
      wrong: 'The exit procession no longer matches Genesis 8:18-19.', scripture: 'Genesis 8:18-19',
      action: 'group_enter', correctActions: ['exit', 'group_enter'], camera: { framing: 'reveal', target: 'procession' },
    },
  ],
});

export const ALTAR_LEVEL = createFloodLevel({
  order: 22,
  slug: ALTAR_LEVEL_SLUG,
  title: 'An Altar',
  subtitle: 'Build and offer with restraint on the changed earth.',
  environment: ALTAR,
  intro: 'Noah builds an altar to the Lord and takes from every clean animal and every clean bird.',
  scripture: 'Genesis 8:20-22',
  movement: 'Gather and place stones for a restrained altar scene without graphic imagery.',
  movementAction: 'gather',
  continuation: 'The post-Flood declaration leads into God\'s covenant with Noah and every living creature.',
  completion: 'The altar stands, and the recurring order of seedtime, harvest, seasons, and day and night is declared.',
  read: {
    scripture: 'Genesis 8:20-22',
    text: 'Noah builds an altar to the Lord and presents burnt offerings from every clean animal and clean bird. The Lord declares that he will never again curse the ground in the same way because of humanity, nor strike down every living creature as he had done. While the earth remains, seedtime and harvest, cold and heat, summer and winter, day and night shall not cease.',
  },
  characters: [noah(34, 'gather')],
  camera: { framing: 'focus', target: 'altar' },
  questions: [
    {
      id: 'altar-build', poolId: 'altar-build-easy', checkpointId: 'altar-build-question',
      narrative: 'Identify what Noah builds after leaving the Ark.', correct: 'A restrained stone altar takes shape.',
      wrong: 'The first post-Ark structure in this passage has been changed.', scripture: 'Genesis 8:20',
      action: 'gather', correctActions: ['gather', 'place', 'kneel'], camera: { framing: 'reveal', target: 'altar' },
    },
    {
      id: 'altar-declaration', poolId: 'altar-declaration-hard', checkpointId: 'altar-declaration-question',
      narrative: 'Preserve the paired rhythms named in the declaration.', correct: 'The post-Flood declaration remains in the order given by Scripture.',
      wrong: 'The declaration in Genesis 8:21-22 has been altered.', scripture: 'Genesis 8:21-22',
      action: 'offer', correctActions: ['kneel', 'offer', 'observe'], camera: { framing: 'focus', target: 'altar' },
    },
  ],
});

export const MY_COVENANT_LEVEL = createFloodLevel({
  order: 23,
  slug: MY_COVENANT_LEVEL_SLUG,
  title: 'My Covenant',
  subtitle: 'Hear the covenant established with descendants and living creatures.',
  environment: COVENANT,
  intro: 'God establishes the covenant with Noah, his descendants, and every living creature with them.',
  scripture: 'Genesis 9:1-17',
  movement: 'The household stands beneath a clearing sky while the covenant terms remain textual, not economic.',
  movementAction: 'observe',
  continuation: 'The sign of this covenant is ready to appear in the cloud.',
  completion: 'The covenant promise has been stated for Noah, his descendants, and every living creature.',
  read: {
    scripture: 'Genesis 9:8-17',
    text: 'God establishes his covenant with Noah, Noah\'s sons, their descendants, and every living creature that came out of the Ark. Never again will all flesh be cut off by the waters of a Flood, and never again will a Flood destroy the earth. God sets his bow in the cloud as the sign of the covenant between God and the earth.',
  },
  characters: WHOLE_HOUSEHOLD,
  camera: { framing: 'wide', target: 'sky' },
  questions: [
    {
      id: 'covenant-parties', poolId: 'covenant-parties-moderate', checkpointId: 'covenant-parties-question',
      narrative: 'Name the covenant parties without narrowing the text.', correct: 'Noah, descendants, and every living creature remain within the stated covenant.',
      wrong: 'The covenant has been narrowed beyond Genesis 9.', scripture: 'Genesis 9:8-10',
      action: 'observe', correctActions: ['observe', 'group_enter'], characters: WHOLE_HOUSEHOLD,
    },
    {
      id: 'covenant-promise', poolId: 'covenant-promise-hard', checkpointId: 'covenant-promise-question',
      narrative: 'State the Flood promise with its actual scope.', correct: 'The promise against another all-destroying Flood settles authoritatively.',
      wrong: 'The scope of the covenant promise has been changed.', scripture: 'Genesis 9:11, 15',
      action: 'observe', correctActions: ['observe', 'rest'], camera: { framing: 'focus', target: 'sky' },
    },
  ],
});

export const BOW_CLOUD_LEVEL = createFloodLevel({
  order: 24,
  slug: BOW_CLOUD_LEVEL_SLUG,
  title: 'The Bow in the Cloud',
  subtitle: 'Answer from Scripture and reveal the final sign of Book I.',
  environment: COVENANT,
  intro: 'Cloud remains over the changed earth. The covenant sign has not yet been revealed.',
  scripture: 'Genesis 9:12-17',
  movement: 'The camera turns from Noah and his household toward the clearing sky.',
  movementAction: 'observe',
  continuation: 'Book I — Beginnings is complete. The journey will continue.',
  completion: 'The bow appears in the cloud as the sign of the covenant between God and the earth.',
  characters: WHOLE_HOUSEHOLD,
  camera: { framing: 'reveal', target: 'sky' },
  chapterConclusion: true,
  chapterCompletionText: 'Noah is complete: Ark, Flood, dry ground, altar, covenant, and bow have settled in canonical order.',
  titleReveal: 'THE BOW IN THE CLOUD',
  questions: [
    {
      id: 'bow-sign', poolId: 'bow-sign-easy', checkpointId: 'bow-sign-question',
      narrative: 'Identify the sign God gives for the covenant.', correct: 'The answer prepares the cloud for the bow.',
      wrong: 'The selected sign is not the sign named in Genesis 9.', scripture: 'Genesis 9:12-13',
      action: 'observe', correctActions: ['observe', 'appear'], camera: { framing: 'focus', target: 'sky' },
    },
    {
      id: 'bow-cloud', poolId: 'bow-cloud-hard', checkpointId: 'bow-cloud-question',
      narrative: 'Complete the covenant sequence from the exact passage.', correct: 'The sky clears and the bow appears only after the final correct answer.',
      wrong: 'The Book cannot close before the covenant sign is understood.', scripture: 'Genesis 9:13-17',
      action: 'observe', correctActions: ['observe', 'appear'], camera: { framing: 'reveal', target: 'sky' },
    },
  ],
});

export const FLOOD_LEVELS = [
  ENTER_ARK_LEVEL,
  SEVEN_DAYS_LEVEL,
  FORTY_DAYS_LEVEL,
  WATERS_PREVAILED_LEVEL,
  GOD_REMEMBERED_LEVEL,
  MOUNTAINS_APPEAR_LEVEL,
  RAVEN_LEVEL,
  DOVE_LEVEL,
  OLIVE_LEAF_LEVEL,
  DRY_GROUND_LEVEL,
  COME_OUT_LEVEL,
  ALTAR_LEVEL,
  MY_COVENANT_LEVEL,
  BOW_CLOUD_LEVEL,
];
