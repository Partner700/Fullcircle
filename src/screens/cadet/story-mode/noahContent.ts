import type {
  StoryActionName,
  StoryBuildDefinition,
  StoryBuildFailureEffect,
  StoryCharacterId,
  StoryCharacterPlacement,
  StoryCharacterRole,
  StoryCreatureGroup,
  StoryEnvironment,
  StoryLevelDefinition,
  StorySceneDefinition,
  StorySupplyGroup,
} from './types';

export const CORRUPTION_LEVEL_SLUG = 'corruption';
export const NOAH_FAVOR_LEVEL_SLUG = 'noah-found-favor';
export const MAKE_ARK_LEVEL_SLUG = 'make-yourself-an-ark';
export const GOPHER_WOOD_LEVEL_SLUG = 'gopher-wood';
export const THREE_HUNDRED_CUBITS_LEVEL_SLUG = 'three-hundred-cubits';
export const ROOMS_DOOR_DECKS_LEVEL_SLUG = 'rooms-door-and-decks';
export const COVENANT_LEVEL_SLUG = 'the-covenant';
export const EVERY_LIVING_THING_LEVEL_SLUG = 'every-living-thing';
export const PROVISIONS_LEVEL_SLUG = 'provisions';
export const ARK_STANDS_LEVEL_SLUG = 'the-ark-stands';
export const ARK_CONSTRUCTION_ID = 'noah-ark';

export const ARK_CONSTRUCTION: StoryBuildDefinition = {
  id: ARK_CONSTRUCTION_ID,
  label: 'The Ark',
  visual: 'ark',
  stages: [
    { id: 'foundation', order: 1, componentKey: 'foundation', label: 'Foundation laid' },
    { id: 'frame', order: 2, componentKey: 'frame', label: 'Timber frame raised and sealed' },
    { id: 'hull', order: 3, componentKey: 'hull', label: 'Hull brought to scale' },
    { id: 'opening', order: 4, componentKey: 'opening', label: 'Opening and side door formed' },
    { id: 'decks', order: 5, componentKey: 'decks', label: 'Rooms and three decks arranged' },
    { id: 'household', order: 6, componentKey: 'household', label: 'Household prepared under the covenant' },
    { id: 'animals', order: 7, componentKey: 'animals', label: 'Living-creature groups assembled' },
    { id: 'provisions', order: 8, componentKey: 'provisions', label: 'Food stored' },
    { id: 'complete', order: 9, componentKey: 'complete', label: 'Ark prepared' },
  ],
};

const CORRUPTION: StoryEnvironment = {
  id: 'earth-filled-with-violence', palette: 'noah-corruption', weather: 'haze', timeOfDay: 'evening', elevation: 0,
};
const FAVOR: StoryEnvironment = {
  id: 'noah-walks-amid-corruption', palette: 'noah-favor', weather: 'still', timeOfDay: 'dawn', elevation: 1,
};
const INSTRUCTION: StoryEnvironment = {
  id: 'open-ground-for-the-ark', palette: 'ark-instruction', weather: 'still', timeOfDay: 'morning', elevation: 0,
};
const EARLY_SITE: StoryEnvironment = {
  id: 'ark-foundation-site', palette: 'ark-site-early', weather: 'clear', timeOfDay: 'afternoon', elevation: 0,
};
const MIDDLE_SITE: StoryEnvironment = {
  id: 'ark-rising-site', palette: 'ark-site-middle', weather: 'wind', timeOfDay: 'afternoon', elevation: 0,
};
const LATE_SITE: StoryEnvironment = {
  id: 'ark-preparation-site', palette: 'ark-site-late', weather: 'clouding', timeOfDay: 'evening', elevation: 0,
};
const STORM_HORIZON: StoryEnvironment = {
  id: 'completed-ark-before-the-flood', palette: 'ark-storm', weather: 'clouding', timeOfDay: 'evening', elevation: 0,
};

function person(
  id: StoryCharacterId,
  x: number,
  action: StoryActionName = 'idle',
  role: StoryCharacterRole = 'player',
  facing: StoryCharacterPlacement['facing'] = 'right',
): StoryCharacterPlacement {
  return { id, x, action, role, facing, active: role === 'player' };
}

function noah(x: number, action: StoryActionName = 'idle'): StoryCharacterPlacement {
  return person('noah', x, action, 'player');
}

const FAMILY: StoryCharacterPlacement[] = [
  person('noahs-wife', 55, 'observe', 'family'),
  person('shem', 64, 'observe', 'family'),
  person('ham', 72, 'observe', 'family'),
  person('japheth', 80, 'observe', 'family'),
];

const ANIMAL_GROUPS: StoryCreatureGroup[] = [
  { id: 'land-pairs', category: 'land-animals', state: 'waiting', x: 63 },
  { id: 'bird-groups', category: 'birds', state: 'entering', x: 74 },
  { id: 'creeping-groups', category: 'creeping-things', state: 'waiting', x: 84 },
];

const SUPPLY_GROUPS: StorySupplyGroup[] = [
  { id: 'food-sacks', kind: 'sacks', state: 'loading', x: 65 },
  { id: 'food-bundles', kind: 'bundles', state: 'waiting', x: 76 },
  { id: 'storage-vessels', kind: 'vessels', state: 'stored', x: 86 },
];

function question(input: {
  id: string;
  poolId: string;
  checkpointId: string;
  environment: StoryEnvironment;
  narrative: string;
  correct: string;
  wrong: string;
  scripture: string;
  action?: StoryActionName;
  correctActions?: StoryActionName[];
  wrongActions?: StoryActionName[];
  failure?: StoryBuildFailureEffect;
  characters?: StoryCharacterPlacement[];
  creatureGroups?: StoryCreatureGroup[];
  supplyGroups?: StorySupplyGroup[];
  construction?: boolean;
  camera?: StorySceneDefinition['camera'];
}): StorySceneDefinition {
  return {
    id: input.id,
    kind: 'question_event',
    environment: input.environment,
    activeCharacterId: 'noah',
    characters: input.characters || [noah(52, input.action || 'inspect')],
    action: input.action || 'inspect',
    durationMs: 680,
    narrativeText: input.narrative,
    correctNarrativeText: input.correct,
    wrongNarrativeText: input.wrong,
    scriptureReference: input.scripture,
    questionPoolId: input.poolId,
    checkpointId: input.checkpointId,
    correctActions: input.correctActions || ['inspect', 'build'],
    wrongActions: input.wrongActions || ['recoil', 'stop'],
    buildFailureEffect: input.failure,
    constructionId: input.construction === false ? undefined : ARK_CONSTRUCTION_ID,
    creatureGroups: input.creatureGroups,
    supplyGroups: input.supplyGroups,
    camera: input.camera || { framing: 'focus', target: input.construction === false ? 'character' : 'construction' },
  };
}

function completion(
  id: string,
  environment: StoryEnvironment,
  text: string,
  scripture: string,
  checkpointId: string,
  options: Partial<StorySceneDefinition> = {},
): StorySceneDefinition {
  return {
    id, kind: 'completion', environment, activeCharacterId: 'noah', characters: [noah(25, 'inspect')],
    action: 'inspect', narrativeText: text, scriptureReference: scripture, checkpointId,
    constructionId: options.constructionId, camera: options.camera, creatureGroups: options.creatureGroups,
    supplyGroups: options.supplyGroups, titleReveal: options.titleReveal,
  };
}

export const CORRUPTION_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-1', slug: CORRUPTION_LEVEL_SLUG, title: 'Corruption',
  subtitle: 'Walk through the restrained witness of a violent earth.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 1, openingSceneId: 'corruption-intro', continuationText: 'One man now stands in contrast to his generation.',
  scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'corruption-intro', kind: 'narrative', environment: CORRUPTION, activeCharacterId: null, characters: [],
      action: 'observe', durationMs: 1_900, narrativeText: 'The earth was corrupt before God and filled with violence.',
      scriptureReference: 'Genesis 6:1-13', checkpointId: 'corruption-start', camera: { framing: 'wide', target: 'environment' },
      nextSceneId: 'corruption-walk',
    },
    {
      id: 'corruption-walk', kind: 'movement', environment: CORRUPTION, activeCharacterId: 'noah',
      characters: [noah(14, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_300,
      narrativeText: 'Move through damaged ground without adding violence beyond the passage.', scriptureReference: 'Genesis 6:5, 11-13',
      checkpointId: 'corruption-start', camera: { framing: 'follow', target: 'character' }, nextSceneId: 'corruption-violence',
    },
    question({
      id: 'corruption-violence', poolId: 'corruption-violence-easy', checkpointId: 'corruption-violence-question',
      environment: CORRUPTION, narrative: 'Name what filled the earth.', correct: 'The earth was filled with violence.',
      wrong: 'The condition named in Genesis 6 has been displaced.', scripture: 'Genesis 6:11, 13', construction: false,
      correctActions: ['observe', 'slow_walk'], failure: 'block',
    }),
    question({
      id: 'corruption-earth', poolId: 'corruption-earth-moderate', checkpointId: 'corruption-earth-question',
      environment: CORRUPTION, narrative: 'Hold together corruption, violence, and the judgment announced.',
      correct: 'The passage presents a corrupted earth moving toward judgment.',
      wrong: 'Return to the sequence in Genesis 6:11-13.', scripture: 'Genesis 6:11-13', construction: false,
      correctActions: ['observe', 'stop'], failure: 'collapse',
    }),
    completion('corruption-complete', FAVOR, 'Noah now appears as the point of contrast in the account.', 'Genesis 6:8-9', 'corruption-complete'),
  ],
};

export const NOAH_FAVOR_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-2', slug: NOAH_FAVOR_LEVEL_SLUG, title: 'Noah Found Favor',
  subtitle: 'Follow Noah and meet the household named in the text.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 2, openingSceneId: 'favor-intro', continuationText: 'The instruction to make an Ark now follows.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'favor-intro', kind: 'narrative', environment: FAVOR, activeCharacterId: 'noah', characters: [noah(30, 'appear')],
      action: 'appear', durationMs: 1_850, narrativeText: 'Noah found favor in the eyes of the Lord.', scriptureReference: 'Genesis 6:8-10',
      checkpointId: 'favor-start', titleReveal: 'NOAH', nextSceneId: 'favor-walk', camera: { framing: 'reveal', target: 'character' },
    },
    {
      id: 'favor-walk', kind: 'movement', environment: FAVOR, activeCharacterId: 'noah', characters: [noah(15, 'slow_walk'), ...FAMILY],
      action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_000, narrativeText: 'Noah walks with God amid his generation; Scripture names his three sons.',
      scriptureReference: 'Genesis 6:9-10', checkpointId: 'favor-start', nextSceneId: 'favor-noah', camera: { framing: 'follow', target: 'character' },
    },
    question({
      id: 'favor-noah', poolId: 'favor-noah-easy', checkpointId: 'favor-noah-question', environment: FAVOR,
      narrative: 'Recall what Noah found.', correct: 'Noah found favor in the eyes of the Lord.',
      wrong: 'Do not replace favor with a claim the passage does not make.', scripture: 'Genesis 6:8-9', construction: false,
      correctActions: ['observe', 'slow_walk'], failure: 'reject',
    }),
    question({
      id: 'favor-sons', poolId: 'favor-sons-moderate', checkpointId: 'favor-sons-question', environment: FAVOR,
      narrative: 'Identify the sons named with Noah.', correct: 'Shem, Ham, and Japheth stand in the recorded household.',
      wrong: 'The names or relationship in Genesis 6:10 have been confused.', scripture: 'Genesis 6:10', construction: false,
      characters: [noah(38, 'observe'), ...FAMILY], correctActions: ['observe', 'group_enter'], failure: 'misplace',
    }),
    completion('favor-complete', INSTRUCTION, 'Noah is righteous and blameless in his generation, and he walks with God.', 'Genesis 6:9-10', 'favor-complete'),
  ],
};

export const MAKE_ARK_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-3', slug: MAKE_ARK_LEVEL_SLUG, title: 'Make Yourself an Ark',
  subtitle: 'Read the instruction, then begin the work.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 3, openingSceneId: 'ark-command-intro', continuationText: 'The first stable foundation now marks the site.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'ark-command-intro', kind: 'narrative', environment: INSTRUCTION, activeCharacterId: 'noah', characters: [noah(28, 'observe')],
      action: 'observe', durationMs: 1_850, narrativeText: 'The instruction is given through Scripture: make yourself an Ark.',
      scriptureReference: 'Genesis 6:13-14', checkpointId: 'ark-command-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'ark-command-read',
    },
    {
      id: 'ark-command-read', kind: 'read', environment: INSTRUCTION, activeCharacterId: 'noah', characters: [noah(24, 'observe')],
      action: 'observe', narrativeText: 'Read the full instruction before construction begins.',
      readText: 'The earth was corrupt before God and filled with violence. God told Noah that judgment was coming and instructed him to make an Ark of gopher wood, with rooms, covered inside and outside with pitch. Its length was three hundred cubits, its breadth fifty cubits, and its height thirty cubits. It was to have an opening, a side door, and lower, second, and third decks. God spoke of bringing the Flood, establishing his covenant with Noah, bringing Noah\'s household into the Ark, preserving living creatures by their kinds, and storing food for them all. Noah did according to all that God commanded him.',
      scriptureReference: 'Genesis 6:11-22', checkpointId: 'ark-command-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'focus', target: 'character' }, nextSceneId: 'ark-command-walk',
    },
    {
      id: 'ark-command-walk', kind: 'movement', environment: INSTRUCTION, activeCharacterId: 'noah', characters: [noah(14, 'measure')],
      action: 'measure', locomotion: 'slow_walk', durationMs: 5_200, narrativeText: 'Measure the open ground. The question timer begins only after Scripture closes.',
      scriptureReference: 'Genesis 6:14-22', checkpointId: 'ark-command-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'ark-command-basic',
    },
    question({
      id: 'ark-command-basic', poolId: 'ark-command-easy', checkpointId: 'ark-command-question', environment: INSTRUCTION,
      narrative: 'Identify the object Noah was commanded to make.', correct: 'The work begins with the Ark God commanded.',
      wrong: 'The construction objective has been replaced.', scripture: 'Genesis 6:14', action: 'measure',
      correctActions: ['measure', 'place'], failure: 'reject',
    }),
    question({
      id: 'ark-command-read-detail', poolId: 'ark-read-hard', checkpointId: 'ark-read-question', environment: EARLY_SITE,
      narrative: 'Bring the whole instruction into the correct sequence.', correct: 'The measured foundation settles into the site.',
      wrong: 'The foundation cannot settle while the instruction is out of order.', scripture: 'Genesis 6:11-22', action: 'place',
      correctActions: ['measure', 'place', 'hammer'], failure: 'collapse', camera: { framing: 'reveal', target: 'construction' },
    }),
    completion('ark-command-complete', EARLY_SITE, 'The first authoritative Ark milestone is fixed in place.', 'Genesis 6:14, 22', 'ark-command-complete', {
      constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'reveal', target: 'construction' },
    }),
  ],
};

export const GOPHER_WOOD_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-4', slug: GOPHER_WOOD_LEVEL_SLUG, title: 'Gopher Wood',
  subtitle: 'Raise the frame from the material named in the passage.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 4, openingSceneId: 'wood-intro', continuationText: 'The timber frame now stands above the foundation.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'wood-intro', kind: 'narrative', environment: EARLY_SITE, activeCharacterId: 'noah', characters: [noah(22, 'inspect')],
      action: 'inspect', durationMs: 1_700, narrativeText: 'The wording used here follows the passage: gopher wood.', scriptureReference: 'Genesis 6:14',
      checkpointId: 'wood-start', constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'focus', target: 'construction' }, nextSceneId: 'wood-walk',
    },
    {
      id: 'wood-walk', kind: 'movement', environment: EARLY_SITE, activeCharacterId: 'noah', characters: [noah(14, 'carry')],
      action: 'carry', locomotion: 'brisk_walk', durationMs: 4_700, narrativeText: 'Carry the prepared timber toward the foundation.', scriptureReference: 'Genesis 6:14',
      checkpointId: 'wood-start', constructionId: ARK_CONSTRUCTION_ID, nextSceneId: 'wood-material', camera: { framing: 'follow', target: 'character' },
    },
    question({
      id: 'wood-material', poolId: 'gopher-material-moderate', checkpointId: 'wood-material-question', environment: EARLY_SITE,
      narrative: 'Select the material named in this Story Mode text.', correct: 'Gopher wood is carried to the Ark site.',
      wrong: 'The material does not match the displayed Scripture wording.', scripture: 'Genesis 6:14', action: 'carry',
      correctActions: ['carry', 'cut', 'place'], failure: 'reject',
    }),
    question({
      id: 'wood-covering', poolId: 'gopher-covering-hard', checkpointId: 'wood-covering-question', environment: EARLY_SITE,
      narrative: 'Recall how the Ark was to be covered.', correct: 'The frame rises with the inside-and-outside covering instruction preserved.',
      wrong: 'The covering detail has been misplaced; the beam will not remain.', scripture: 'Genesis 6:14', action: 'raise',
      correctActions: ['cut', 'raise', 'hammer', 'seal'], failure: 'lean', camera: { framing: 'reveal', target: 'construction' },
    }),
    completion('wood-complete', EARLY_SITE, 'The timber frame is now an authoritative part of the Ark.', 'Genesis 6:14', 'wood-complete', {
      constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'wide', target: 'construction' },
    }),
  ],
};

export const THREE_HUNDRED_CUBITS_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-5', slug: THREE_HUNDRED_CUBITS_LEVEL_SLUG, title: 'Three Hundred Cubits',
  subtitle: 'Bring the frame to the dimensions stated in Scripture.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 5, openingSceneId: 'dimensions-intro', continuationText: 'The Ark now dominates the construction ground.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'dimensions-intro', kind: 'narrative', environment: MIDDLE_SITE, activeCharacterId: 'noah', characters: [noah(19, 'measure')],
      action: 'measure', durationMs: 1_750, narrativeText: 'The text gives the Ark\'s length, breadth, and height in cubits.', scriptureReference: 'Genesis 6:15',
      checkpointId: 'dimensions-start', constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'dimensions-walk',
    },
    {
      id: 'dimensions-walk', kind: 'movement', environment: MIDDLE_SITE, activeCharacterId: 'noah', characters: [noah(12, 'measure')],
      action: 'measure', locomotion: 'brisk_walk', durationMs: 5_200, narrativeText: 'Walk the long frame while keeping textual cubits, not speculative conversions.',
      scriptureReference: 'Genesis 6:15', checkpointId: 'dimensions-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'dimensions-length',
    },
    question({
      id: 'dimensions-length', poolId: 'dimensions-length-easy', checkpointId: 'dimensions-length-question', environment: MIDDLE_SITE,
      narrative: 'Set the Ark\'s stated length.', correct: 'The frame extends to represent three hundred cubits.',
      wrong: 'The long measurement is incorrect and the guide line resets.', scripture: 'Genesis 6:15', action: 'measure',
      correctActions: ['measure', 'place'], failure: 'misplace', camera: { framing: 'wide', target: 'construction' },
    }),
    question({
      id: 'dimensions-width', poolId: 'dimensions-width-moderate', checkpointId: 'dimensions-width-question', environment: MIDDLE_SITE,
      narrative: 'Set the breadth stated in the verse.', correct: 'The breadth is represented as fifty cubits.',
      wrong: 'The breadth does not match Genesis 6:15.', scripture: 'Genesis 6:15', action: 'measure',
      correctActions: ['measure', 'raise'], failure: 'lean', camera: { framing: 'focus', target: 'construction' },
    }),
    question({
      id: 'dimensions-height', poolId: 'dimensions-height-hard', checkpointId: 'dimensions-height-question', environment: MIDDLE_SITE,
      narrative: 'Complete the three-part measurement.', correct: 'Three hundred by fifty by thirty cubits now governs the hull.',
      wrong: 'One of the three textual dimensions is wrong; the raised section settles back.', scripture: 'Genesis 6:15', action: 'raise',
      correctActions: ['measure', 'raise', 'hammer'], failure: 'collapse', camera: { framing: 'reveal', target: 'construction' },
    }),
    completion('dimensions-complete', MIDDLE_SITE, 'The hull now communicates the scale of the dimensions in Genesis 6:15.', 'Genesis 6:15', 'dimensions-complete', {
      constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'wide', target: 'construction' },
    }),
  ],
};

export const ROOMS_DOOR_DECKS_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-6', slug: ROOMS_DOOR_DECKS_LEVEL_SLUG, title: 'Rooms, Door, and Decks',
  subtitle: 'Shape only the structure named in Genesis 6.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 6, openingSceneId: 'structure-intro', continuationText: 'The side opening and interior divisions are now settled.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'structure-intro', kind: 'narrative', environment: MIDDLE_SITE, activeCharacterId: 'noah', characters: [noah(24, 'inspect')],
      action: 'inspect', durationMs: 1_750, narrativeText: 'Rooms, covering, an opening, a side door, and three deck levels are named.',
      scriptureReference: 'Genesis 6:14-16', checkpointId: 'structure-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'focus', target: 'construction' }, nextSceneId: 'structure-walk',
    },
    {
      id: 'structure-walk', kind: 'movement', environment: MIDDLE_SITE, activeCharacterId: 'noah', characters: [noah(14, 'inspect')],
      action: 'inspect', locomotion: 'slow_walk', durationMs: 4_800, narrativeText: 'Inspect the growing shell without borrowing details from children\'s illustrations.',
      scriptureReference: 'Genesis 6:14-16', checkpointId: 'structure-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'structure-rooms',
    },
    question({
      id: 'structure-rooms', poolId: 'structure-rooms-moderate', checkpointId: 'structure-rooms-question', environment: MIDDLE_SITE,
      narrative: 'Recall what was to be made within the Ark.', correct: 'Rooms or compartments are marked within the hull.',
      wrong: 'The interior detail is unsupported and must be removed.', scripture: 'Genesis 6:14', action: 'place',
      correctActions: ['place', 'hammer'], failure: 'misplace',
    }),
    question({
      id: 'structure-opening-door', poolId: 'structure-opening-door-hard', checkpointId: 'structure-opening-question', environment: MIDDLE_SITE,
      narrative: 'Place the opening and door according to the passage.', correct: 'The opening and side door take their restrained visual form.',
      wrong: 'The doorway has been misplaced and returns to the prior checkpoint.', scripture: 'Genesis 6:16', action: 'open_door',
      correctActions: ['measure', 'place', 'open_door'], failure: 'misplace', camera: { framing: 'reveal', target: 'construction' },
    }),
    question({
      id: 'structure-decks', poolId: 'structure-decks-hard', checkpointId: 'structure-decks-question', environment: MIDDLE_SITE,
      narrative: 'Complete the arrangement of deck levels.', correct: 'Lower, second, and third decks become visible in the Ark.',
      wrong: 'The deck arrangement is incomplete and the section lowers again.', scripture: 'Genesis 6:16', action: 'raise',
      correctActions: ['raise', 'place', 'hammer', 'seal'], failure: 'collapse', camera: { framing: 'wide', target: 'construction' },
    }),
    completion('structure-complete', LATE_SITE, 'The Ark has rooms, a side door, an opening, and lower, second, and third decks.', 'Genesis 6:14-16', 'structure-complete', {
      constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'wide', target: 'construction' },
    }),
  ],
};

export const COVENANT_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-7', slug: COVENANT_LEVEL_SLUG, title: 'The Covenant',
  subtitle: 'Attend closely to the covenant language before the Flood.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 7, openingSceneId: 'covenant-intro', continuationText: 'Noah\'s household now stands prepared beside the Ark.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'covenant-intro', kind: 'narrative', environment: LATE_SITE, activeCharacterId: 'noah', characters: [noah(26, 'observe'), ...FAMILY],
      action: 'observe', durationMs: 1_800, narrativeText: 'Before the Flood, God speaks of establishing his covenant with Noah.',
      scriptureReference: 'Genesis 6:17-18', checkpointId: 'covenant-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'covenant-walk',
    },
    {
      id: 'covenant-walk', kind: 'movement', environment: LATE_SITE, activeCharacterId: 'noah', characters: [noah(14, 'slow_walk'), ...FAMILY],
      action: 'slow_walk', locomotion: 'slow_walk', durationMs: 4_800, narrativeText: 'Walk toward the household named in the pre-Flood instruction.',
      scriptureReference: 'Genesis 6:17-18', checkpointId: 'covenant-start', constructionId: ARK_CONSTRUCTION_ID,
      camera: { framing: 'follow', target: 'character' }, nextSceneId: 'covenant-judgment',
    },
    question({
      id: 'covenant-judgment', poolId: 'covenant-judgment-moderate', checkpointId: 'covenant-judgment-question', environment: LATE_SITE,
      narrative: 'Keep the announced event in its place before it begins.', correct: 'The Flood is announced, but no rain or rising water begins here.',
      wrong: 'The narrative has moved into the Flood too early.', scripture: 'Genesis 6:17', action: 'observe',
      correctActions: ['observe', 'stop'], failure: 'block',
    }),
    question({
      id: 'covenant-household', poolId: 'covenant-household-hard', checkpointId: 'covenant-household-question', environment: LATE_SITE,
      narrative: 'Identify who is named to enter with Noah.', correct: 'Noah, his wife, his sons, and his sons\' wives are prepared.',
      wrong: 'The household in Genesis 6:18 has been altered.', scripture: 'Genesis 6:18', action: 'group_enter',
      characters: [noah(35, 'observe'), ...FAMILY, person('shems-wife', 85, 'appear', 'family'), person('hams-wife', 89, 'appear', 'family'), person('japheths-wife', 93, 'appear', 'family')],
      correctActions: ['observe', 'group_enter'], failure: 'misplace', camera: { framing: 'wide', target: 'construction' },
    }),
    completion('covenant-complete', LATE_SITE, 'The household is represented without naming the wives Scripture leaves unnamed.', 'Genesis 6:17-18', 'covenant-complete', {
      constructionId: ARK_CONSTRUCTION_ID, camera: { framing: 'wide', target: 'construction' },
    }),
  ],
};

export const EVERY_LIVING_THING_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-8', slug: EVERY_LIVING_THING_LEVEL_SLUG, title: 'Every Living Thing',
  subtitle: 'Prepare representative creature groups from Genesis 6.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 8, openingSceneId: 'animals-intro', continuationText: 'Representative creature groups now wait near the Ark.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'animals-intro', kind: 'narrative', environment: LATE_SITE, activeCharacterId: 'noah', characters: [noah(24, 'observe')],
      action: 'observe', durationMs: 1_800, narrativeText: 'Genesis 6 speaks of living creatures coming to Noah to be kept alive.',
      scriptureReference: 'Genesis 6:19-20', checkpointId: 'animals-start', constructionId: ARK_CONSTRUCTION_ID,
      creatureGroups: ANIMAL_GROUPS, camera: { framing: 'wide', target: 'procession' }, nextSceneId: 'animals-walk',
    },
    {
      id: 'animals-walk', kind: 'movement', environment: LATE_SITE, activeCharacterId: 'noah', characters: [noah(14, 'slow_walk')],
      action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_100, narrativeText: 'Follow the light procession; it represents categories, not an exhaustive animal roster.',
      scriptureReference: 'Genesis 6:19-20', checkpointId: 'animals-start', constructionId: ARK_CONSTRUCTION_ID,
      creatureGroups: ANIMAL_GROUPS, camera: { framing: 'wide', target: 'procession' }, nextSceneId: 'animals-pairs',
    },
    question({
      id: 'animals-pairs', poolId: 'animals-pairs-easy', checkpointId: 'animals-pairs-question', environment: LATE_SITE,
      narrative: 'Recall the preservation instruction in Genesis 6.', correct: 'Two of every kind are described as being kept alive with Noah.',
      wrong: 'The Genesis 6 preservation instruction has been changed.', scripture: 'Genesis 6:19', action: 'animal_enter',
      correctActions: ['observe', 'animal_enter'], failure: 'block', creatureGroups: ANIMAL_GROUPS,
    }),
    question({
      id: 'animals-kinds', poolId: 'animals-kinds-moderate', checkpointId: 'animals-kinds-question', environment: LATE_SITE,
      narrative: 'Keep the creature categories in the verse.', correct: 'Birds, livestock, and creeping things remain grouped by their kinds.',
      wrong: 'A category has been omitted or imported from another passage.', scripture: 'Genesis 6:20', action: 'group_enter',
      correctActions: ['group_enter', 'observe'], failure: 'misplace', creatureGroups: ANIMAL_GROUPS,
    }),
    question({
      id: 'animals-life', poolId: 'animals-life-hard', checkpointId: 'animals-life-question', environment: LATE_SITE,
      narrative: 'Distinguish the Genesis 6 instruction from later distinctions.', correct: 'The representative groups assemble under the exact Genesis 6 context.',
      wrong: 'The instruction has been flattened across chapters and the route closes.', scripture: 'Genesis 6:19-20', action: 'group_enter',
      correctActions: ['animal_enter', 'group_enter'], failure: 'block', creatureGroups: ANIMAL_GROUPS,
      camera: { framing: 'reveal', target: 'procession' },
    }),
    completion('animals-complete', LATE_SITE, 'The procession remains prepared; actual entry into Flood gameplay has not begun.', 'Genesis 6:19-20', 'animals-complete', {
      constructionId: ARK_CONSTRUCTION_ID, creatureGroups: ANIMAL_GROUPS, camera: { framing: 'wide', target: 'procession' },
    }),
  ],
};

export const PROVISIONS_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-9', slug: PROVISIONS_LEVEL_SLUG, title: 'Provisions',
  subtitle: 'Gather and store the food named in the command.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 9, openingSceneId: 'provisions-intro', continuationText: 'The Ark now holds the food gathered under the instruction.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'provisions-intro', kind: 'narrative', environment: LATE_SITE, activeCharacterId: 'noah', characters: [noah(23, 'inspect')],
      action: 'inspect', durationMs: 1_750, narrativeText: 'Noah is told to take every kind of food that is eaten and store it.',
      scriptureReference: 'Genesis 6:21', checkpointId: 'provisions-start', constructionId: ARK_CONSTRUCTION_ID,
      supplyGroups: SUPPLY_GROUPS, camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'provisions-walk',
    },
    {
      id: 'provisions-walk', kind: 'movement', environment: LATE_SITE, activeCharacterId: 'noah', characters: [noah(14, 'carry')],
      action: 'carry', locomotion: 'brisk_walk', durationMs: 4_700, narrativeText: 'Carry general provisions toward storage without inventing a menu.',
      scriptureReference: 'Genesis 6:21', checkpointId: 'provisions-start', constructionId: ARK_CONSTRUCTION_ID,
      supplyGroups: SUPPLY_GROUPS, camera: { framing: 'follow', target: 'character' }, nextSceneId: 'provisions-food',
    },
    question({
      id: 'provisions-food', poolId: 'provisions-food-easy', checkpointId: 'provisions-food-question', environment: LATE_SITE,
      narrative: 'Identify what Noah was told to gather.', correct: 'General food supplies move toward the Ark.',
      wrong: 'The text does not command the item selected.', scripture: 'Genesis 6:21', action: 'load',
      correctActions: ['carry', 'load'], failure: 'spill', supplyGroups: SUPPLY_GROUPS,
    }),
    question({
      id: 'provisions-storage', poolId: 'provisions-storage-moderate', checkpointId: 'provisions-storage-question', environment: LATE_SITE,
      narrative: 'Complete the purpose of the gathered food.', correct: 'Food is stored for Noah\'s household and the creatures.',
      wrong: 'The storage purpose is wrong and the supplies spill back to the checkpoint.', scripture: 'Genesis 6:21', action: 'store',
      correctActions: ['load', 'store'], failure: 'spill', supplyGroups: SUPPLY_GROUPS, camera: { framing: 'reveal', target: 'construction' },
    }),
    completion('provisions-complete', STORM_HORIZON, 'The provisions are stored. The Ark is nearly ready.', 'Genesis 6:21-22', 'provisions-complete', {
      constructionId: ARK_CONSTRUCTION_ID, supplyGroups: SUPPLY_GROUPS, camera: { framing: 'wide', target: 'construction' },
    }),
  ],
};

export const ARK_STANDS_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-3-level-10', slug: ARK_STANDS_LEVEL_SLUG, title: 'The Ark Stands',
  subtitle: 'Inspect the completed preparation before the Flood.', bookSlug: 'beginnings', chapterSlug: 'noah',
  order: 10, openingSceneId: 'ark-stands-intro', continuationText: 'The Flood is coming. Flood gameplay remains locked.', scriptureLabel: 'Genesis 6',
  scenes: [
    {
      id: 'ark-stands-intro', kind: 'narrative', environment: STORM_HORIZON, activeCharacterId: 'noah', characters: [noah(20, 'inspect'), ...FAMILY],
      action: 'inspect', durationMs: 1_900, narrativeText: 'The Ark stands beneath gathering clouds. No rain has begun.',
      scriptureReference: 'Genesis 6:14-22', checkpointId: 'ark-stands-start', constructionId: ARK_CONSTRUCTION_ID,
      creatureGroups: ANIMAL_GROUPS, supplyGroups: SUPPLY_GROUPS, camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'ark-stands-walk',
    },
    {
      id: 'ark-stands-walk', kind: 'movement', environment: STORM_HORIZON, activeCharacterId: 'noah', characters: [noah(13, 'slow_walk'), ...FAMILY],
      action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_400, narrativeText: 'Walk the prepared site one final time before the locked Flood continuation.',
      scriptureReference: 'Genesis 6:14-22', checkpointId: 'ark-stands-start', constructionId: ARK_CONSTRUCTION_ID,
      creatureGroups: ANIMAL_GROUPS, supplyGroups: SUPPLY_GROUPS, camera: { framing: 'wide', target: 'construction' }, nextSceneId: 'ark-stands-obedience',
    },
    question({
      id: 'ark-stands-obedience', poolId: 'final-obedience-easy', checkpointId: 'ark-stands-obedience-question', environment: STORM_HORIZON,
      narrative: 'Recall how Genesis 6 closes the construction command.', correct: 'Noah did according to all that God commanded him.',
      wrong: 'The closing statement of Genesis 6:22 has been altered.', scripture: 'Genesis 6:22', action: 'inspect',
      correctActions: ['inspect', 'observe'], failure: 'block', creatureGroups: ANIMAL_GROUPS, supplyGroups: SUPPLY_GROUPS,
    }),
    question({
      id: 'ark-stands-family', poolId: 'final-family-easy', checkpointId: 'ark-stands-family-question', environment: STORM_HORIZON,
      narrative: 'Keep the prepared household together.', correct: 'Noah\'s family remains assembled without invented names or dialogue.',
      wrong: 'The household has been changed beyond the text.', scripture: 'Genesis 6:18', action: 'group_enter',
      characters: [noah(28, 'observe'), ...FAMILY], correctActions: ['observe', 'group_enter'], failure: 'misplace',
      creatureGroups: ANIMAL_GROUPS, supplyGroups: SUPPLY_GROUPS,
    }),
    question({
      id: 'ark-stands-readiness', poolId: 'final-readiness-hard', checkpointId: 'ark-stands-readiness-question', environment: STORM_HORIZON,
      narrative: 'Confirm every mandatory preparation without beginning the Flood.', correct: 'The full Ark settles into its authoritative prepared state.',
      wrong: 'A required preparation is missing; the final reveal returns to the last stable stage.', scripture: 'Genesis 6:14-22', action: 'inspect',
      correctActions: ['inspect', 'open_door', 'store', 'build'], failure: 'collapse', creatureGroups: ANIMAL_GROUPS,
      supplyGroups: SUPPLY_GROUPS, camera: { framing: 'reveal', target: 'construction' },
    }),
    completion('ark-stands-complete', STORM_HORIZON, 'The Ark is prepared. The Flood is coming.', 'Genesis 6:22', 'ark-stands-complete', {
      constructionId: ARK_CONSTRUCTION_ID, creatureGroups: ANIMAL_GROUPS.map((group) => ({ ...group, state: 'waiting' })),
      supplyGroups: SUPPLY_GROUPS.map((group) => ({ ...group, state: 'stored' })), camera: { framing: 'wide', target: 'construction' },
      titleReveal: 'THE ARK STANDS',
    }),
  ],
};

export const NOAH_LEVELS = [
  CORRUPTION_LEVEL,
  NOAH_FAVOR_LEVEL,
  MAKE_ARK_LEVEL,
  GOPHER_WOOD_LEVEL,
  THREE_HUNDRED_CUBITS_LEVEL,
  ROOMS_DOOR_DECKS_LEVEL,
  COVENANT_LEVEL,
  EVERY_LIVING_THING_LEVEL,
  PROVISIONS_LEVEL,
  ARK_STANDS_LEVEL,
];
