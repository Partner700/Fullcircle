import type {
  StoryCharacterId,
  StoryCharacterPlacement,
  StoryCharacterRole,
  StoryEnvironment,
  StoryLevelDefinition,
} from './types';

export const SETH_LEVEL_SLUG = 'seth';
export const LINE_CONTINUES_LEVEL_SLUG = 'the-line-continues';
export const ENOCH_WALKS_LEVEL_SLUG = 'enoch-walks';
export const WALKED_WITH_GOD_LEVEL_SLUG = 'walked-with-god';
export const TAKEN_LEVEL_SLUG = 'taken';
export const METHUSELAH_LEVEL_SLUG = 'methuselah';
export const LONG_YEARS_LEVEL_SLUG = 'long-years';
export const TOWARD_NOAH_LEVEL_SLUG = 'toward-noah';

export const ENOCH_TAKEN_EVENT_ID = 'enoch-canonical-taking';
export const NOAH_REVEAL_EVENT_ID = 'noah-generational-reveal';

const SETH_PATH: StoryEnvironment = {
  id: 'seth-path-beyond-brothers', palette: 'seth-path', weather: 'clear', timeOfDay: 'dawn',
  elevation: 0, timePassage: 'dawn_to_day',
};
const LINEAGE_DAWN: StoryEnvironment = {
  id: 'lineage-dawn', palette: 'lineage-dawn', weather: 'still', timeOfDay: 'morning',
  elevation: 0, timePassage: 'generations',
};
const ENOCH_PLAIN: StoryEnvironment = {
  id: 'enoch-low-plain', palette: 'enoch-plain', weather: 'wind', timeOfDay: 'morning',
  elevation: 1, timePassage: 'none',
};
const ENOCH_HILLS: StoryEnvironment = {
  id: 'enoch-rolling-hills', palette: 'enoch-hills', weather: 'still', timeOfDay: 'afternoon',
  elevation: 2, timePassage: 'day_to_dusk',
};
const ENOCH_RIDGE: StoryEnvironment = {
  id: 'enoch-rocky-ridge', palette: 'enoch-ridge', weather: 'wind', timeOfDay: 'evening',
  elevation: 3, timePassage: 'none',
};
const ENOCH_SUMMIT: StoryEnvironment = {
  id: 'enoch-pale-summit', palette: 'enoch-summit', weather: 'haze', timeOfDay: 'dawn',
  elevation: 5, timePassage: 'none',
};
const METHUSELAH_SEASONS: StoryEnvironment = {
  id: 'methuselah-passing-seasons', palette: 'methuselah-seasons', weather: 'still', timeOfDay: 'afternoon',
  elevation: 1, timePassage: 'seasons',
};
const NOAH_HORIZON: StoryEnvironment = {
  id: 'lineage-toward-noah', palette: 'noah-horizon', weather: 'clear', timeOfDay: 'evening',
  elevation: 2, timePassage: 'generations',
};

function person(
  id: StoryCharacterId,
  x: number,
  action: StoryCharacterPlacement['action'] = 'idle',
  role: StoryCharacterRole = 'player',
  facing: StoryCharacterPlacement['facing'] = 'right',
): StoryCharacterPlacement {
  return { id, role, x, action, facing, active: role === 'player' };
}

export const SETH_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-1', slug: SETH_LEVEL_SLUG, title: 'Seth',
  subtitle: 'Walk the brief bridge Scripture gives to Seth.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 1, openingSceneId: 'seth-bridge-intro', continuationText: 'The line continues through Seth and Enosh.',
  scriptureLabel: 'Genesis 4-5',
  scenes: [
    {
      id: 'seth-bridge-intro', kind: 'narrative', environment: SETH_PATH,
      activeCharacterId: 'seth', characters: [person('seth', 18, 'appear')], action: 'appear', durationMs: 1_700,
      narrativeText: 'Seth now enters the journey already opened at the close of Brothers.',
      scriptureReference: 'Genesis 4:25', checkpointId: 'seth-bridge-start', nextSceneId: 'seth-bridge-walk',
      titleReveal: 'SETH',
    },
    {
      id: 'seth-bridge-walk', kind: 'movement', environment: SETH_PATH,
      activeCharacterId: 'seth', characters: [person('seth', 17, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 4_900,
      narrativeText: 'Walk quietly through the short account of Seth.', scriptureReference: 'Genesis 4:25',
      checkpointId: 'seth-bridge-start', nextSceneId: 'seth-identity',
    },
    {
      id: 'seth-identity', kind: 'question_event', environment: SETH_PATH,
      activeCharacterId: 'seth', characters: [person('seth', 48, 'observe')], action: 'observe', durationMs: 650,
      narrativeText: 'Recall how Seth enters the account.', correctNarrativeText: 'Eve names Seth as another offspring after Abel.',
      wrongNarrativeText: 'Return to Genesis 4:25 and keep the relationship exact.', questionPoolId: 'seth-identity-easy',
      checkpointId: 'seth-identity-question', scriptureReference: 'Genesis 4:25', correctActions: ['observe', 'slow_walk'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'seth-appointed',
    },
    {
      id: 'seth-appointed', kind: 'question_event', environment: SETH_PATH,
      activeCharacterId: 'seth', characters: [person('seth', 64, 'slow_walk')], action: 'slow_walk', durationMs: 680,
      narrativeText: 'The text connects Seth with the loss that preceded him.', correctNarrativeText: 'Seth is named in place of Abel, whom Cain killed.',
      wrongNarrativeText: 'The connection Eve makes in the verse has been misplaced.', questionPoolId: 'seth-appointed-moderate',
      checkpointId: 'seth-appointed-question', scriptureReference: 'Genesis 4:25', correctActions: ['slow_walk', 'observe'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'seth-bridge-complete',
    },
    {
      id: 'seth-bridge-complete', kind: 'completion', environment: LINEAGE_DAWN,
      activeCharacterId: 'seth', characters: [person('seth', 78, 'observe')], action: 'observe',
      narrativeText: 'Seth remains a brief bridge in the line recorded by Scripture.',
      scriptureReference: 'Genesis 4:25', checkpointId: 'seth-bridge-complete',
    },
  ],
};

export const LINE_CONTINUES_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-2', slug: LINE_CONTINUES_LEVEL_SLUG, title: 'The Line Continues',
  subtitle: 'Follow the genealogy from Seth toward Enoch.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 2, openingSceneId: 'line-intro', continuationText: 'The generations now bring Jared and Enoch into view.',
  scriptureLabel: 'Genesis 4-5',
  scenes: [
    {
      id: 'line-intro', kind: 'narrative', environment: LINEAGE_DAWN,
      activeCharacterId: null, characters: [person('seth', 30, 'age_transition', 'lineage'), person('enosh', 62, 'appear', 'lineage')],
      action: 'lineage_transition', durationMs: 1_900, narrativeText: 'Seth fathers Enosh, and the genealogy continues.',
      scriptureReference: 'Genesis 4:26; 5:6', checkpointId: 'line-start', nextSceneId: 'line-walk',
      lineage: ['seth', 'enosh'], transitionLabel: 'The line continues',
    },
    {
      id: 'line-walk', kind: 'movement', environment: LINEAGE_DAWN,
      activeCharacterId: 'seth', characters: [person('seth', 16, 'slow_walk'), person('enosh', 7, 'follow', 'lineage')],
      action: 'slow_walk', locomotion: 'slow_walk', durationMs: 4_600, narrativeText: 'Time passes without inventing events beyond the genealogy.',
      scriptureReference: 'Genesis 4:26; 5:6-18', checkpointId: 'line-start', nextSceneId: 'line-enosh',
      lineage: ['seth', 'enosh'],
    },
    {
      id: 'line-enosh', kind: 'question_event', environment: LINEAGE_DAWN,
      activeCharacterId: null, characters: [person('seth', 34, 'observe', 'lineage'), person('enosh', 61, 'observe', 'lineage')],
      action: 'observe', durationMs: 650, narrativeText: 'Identify the next named generation.',
      correctNarrativeText: 'Enosh follows Seth in the recorded line.', wrongNarrativeText: 'The first handoff after Seth has been confused.',
      questionPoolId: 'line-enosh-easy', checkpointId: 'line-enosh-question', scriptureReference: 'Genesis 4:26; 5:6',
      correctActions: ['lineage_transition', 'appear'], wrongActions: ['recoil', 'fade'], nextSceneId: 'line-sequence',
      lineage: ['seth', 'enosh'],
    },
    {
      id: 'line-sequence', kind: 'question_event', environment: LINEAGE_DAWN,
      activeCharacterId: null,
      characters: [person('seth', 14, 'disappear', 'lineage'), person('enosh', 31, 'age_transition', 'lineage'), person('jared', 58, 'appear', 'lineage'), person('enoch', 80, 'appear', 'transition')],
      action: 'lineage_transition', durationMs: 760, narrativeText: 'Trace the named line toward Enoch.',
      correctNarrativeText: 'The genealogy moves through Enosh, Kenan, Mahalalel, and Jared to Enoch.',
      wrongNarrativeText: 'The generations must remain in their Scriptural order.', questionPoolId: 'line-sequence-hard',
      checkpointId: 'line-sequence-question', scriptureReference: 'Genesis 5:6-18',
      correctActions: ['lineage_transition', 'appear'], wrongActions: ['recoil', 'fade'], nextSceneId: 'line-complete',
      lineage: ['seth', 'enosh', 'jared', 'enoch'], transitionLabel: 'Generations pass',
    },
    {
      id: 'line-complete', kind: 'completion', environment: ENOCH_PLAIN,
      activeCharacterId: null, characters: [person('jared', 34, 'observe', 'lineage'), person('enoch', 64, 'appear', 'transition')],
      action: 'appear', narrativeText: 'Jared fathers Enoch. The journey narrows to Enoch\'s walk.',
      scriptureReference: 'Genesis 5:18', checkpointId: 'line-complete', lineage: ['jared', 'enoch'], titleReveal: 'ENOCH',
    },
  ],
};

export const ENOCH_WALKS_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-3', slug: ENOCH_WALKS_LEVEL_SLUG, title: 'Enoch Walks',
  subtitle: 'Begin Enoch\'s measured ascent through Genesis 5.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 3, openingSceneId: 'enoch-walks-intro', continuationText: 'The path rises as the text turns to Enoch\'s walk with God.',
  scriptureLabel: 'Genesis 5',
  scenes: [
    {
      id: 'enoch-walks-intro', kind: 'narrative', environment: ENOCH_PLAIN,
      activeCharacterId: 'enoch', characters: [person('jared', 19, 'disappear', 'lineage'), person('enoch', 44, 'appear')],
      action: 'appear', durationMs: 1_800, narrativeText: 'Jared fathers Enoch. Scripture then records Enoch\'s own son and years.',
      scriptureReference: 'Genesis 5:18-21', checkpointId: 'enoch-walks-start', nextSceneId: 'enoch-plain-walk',
      lineage: ['jared', 'enoch'],
    },
    {
      id: 'enoch-plain-walk', kind: 'movement', environment: ENOCH_PLAIN,
      activeCharacterId: 'enoch', characters: [person('enoch', 15, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_600,
      narrativeText: 'Enoch\'s movement is deliberate: walking, not racing.', scriptureReference: 'Genesis 5:18-21',
      checkpointId: 'enoch-walks-start', nextSceneId: 'enoch-ancestry',
    },
    {
      id: 'enoch-ancestry', kind: 'question_event', environment: ENOCH_PLAIN,
      activeCharacterId: 'enoch', characters: [person('jared', 23, 'observe', 'lineage'), person('enoch', 55, 'observe')], action: 'observe', durationMs: 660,
      narrativeText: 'Place Enoch correctly in the genealogy.', correctNarrativeText: 'Jared is Enoch\'s father.',
      wrongNarrativeText: 'Return to the opening of Enoch\'s genealogy.', questionPoolId: 'enoch-ancestry-easy',
      checkpointId: 'enoch-ancestry-question', scriptureReference: 'Genesis 5:18', correctActions: ['observe', 'slow_walk'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'enoch-methuselah', lineage: ['jared', 'enoch'],
    },
    {
      id: 'enoch-methuselah', kind: 'question_event', environment: ENOCH_HILLS,
      activeCharacterId: 'enoch', characters: [person('enoch', 56, 'slow_walk'), person('methuselah', 79, 'appear', 'lineage')], action: 'slow_walk', durationMs: 700,
      narrativeText: 'The next generation appears as the terrain begins to rise.', correctNarrativeText: 'At sixty-five, Enoch fathers Methuselah.',
      wrongNarrativeText: 'The age or relationship in Genesis 5:21 has been misplaced.', questionPoolId: 'enoch-methuselah-moderate',
      checkpointId: 'enoch-methuselah-question', scriptureReference: 'Genesis 5:21', correctActions: ['slow_walk', 'ascend'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'enoch-walks-complete', lineage: ['enoch', 'methuselah'],
    },
    {
      id: 'enoch-walks-complete', kind: 'completion', environment: ENOCH_HILLS,
      activeCharacterId: 'enoch', characters: [person('enoch', 77, 'slow_walk'), person('methuselah', 88, 'observe', 'lineage')], action: 'slow_walk',
      narrativeText: 'Enoch fathers Methuselah, and the account continues upward.', scriptureReference: 'Genesis 5:21',
      checkpointId: 'enoch-walks-complete', lineage: ['enoch', 'methuselah'],
    },
  ],
};

export const WALKED_WITH_GOD_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-4', slug: WALKED_WITH_GOD_LEVEL_SLUG, title: 'Walked with God',
  subtitle: 'Read closely, then continue Enoch\'s quiet ascent.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 4, openingSceneId: 'walked-intro', continuationText: 'The high path now approaches Enoch\'s canonical transition.',
  scriptureLabel: 'Genesis 5',
  scenes: [
    {
      id: 'walked-intro', kind: 'narrative', environment: ENOCH_HILLS,
      activeCharacterId: 'enoch', characters: [person('enoch', 24, 'slow_walk')], action: 'slow_walk', durationMs: 1_850,
      narrativeText: 'The account\'s central phrase is stated plainly: Enoch walked with God.',
      scriptureReference: 'Genesis 5:22', checkpointId: 'walked-start', nextSceneId: 'walked-read',
    },
    {
      id: 'walked-read', kind: 'read', environment: ENOCH_HILLS,
      activeCharacterId: 'enoch', characters: [person('enoch', 30, 'observe')], action: 'observe',
      narrativeText: 'Read the complete Enoch paragraph before the path rises.',
      readText: 'Enoch was sixty-five when he fathered Methuselah. After Methuselah\'s birth, Enoch walked with God for three hundred years and had other sons and daughters. His years were three hundred sixty-five. Enoch walked with God, and he was not, for God took him.',
      scriptureReference: 'Genesis 5:21-24', checkpointId: 'walked-start', nextSceneId: 'walked-hills',
    },
    {
      id: 'walked-hills', kind: 'movement', environment: ENOCH_HILLS,
      activeCharacterId: 'enoch', characters: [person('enoch', 15, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_900,
      narrativeText: 'Resume the journey at a measured pace; the timer begins only at the next question.',
      scriptureReference: 'Genesis 5:21-24', checkpointId: 'walked-start', nextSceneId: 'walked-phrase',
    },
    {
      id: 'walked-phrase', kind: 'question_event', environment: ENOCH_HILLS,
      activeCharacterId: 'enoch', characters: [person('enoch', 46, 'observe')], action: 'observe', durationMs: 650,
      narrativeText: 'Recall the phrase repeated in the paragraph.', correctNarrativeText: 'The text says Enoch walked with God.',
      wrongNarrativeText: 'Return to the phrase Scripture repeats about Enoch.', questionPoolId: 'walked-phrase-easy',
      checkpointId: 'walked-phrase-question', scriptureReference: 'Genesis 5:22, 24', correctActions: ['observe', 'slow_walk'],
      wrongActions: ['trip', 'fall'], nextSceneId: 'walked-years',
    },
    {
      id: 'walked-years', kind: 'question_event', environment: ENOCH_RIDGE,
      activeCharacterId: 'enoch', characters: [person('enoch', 58, 'ascend')], action: 'ascend', durationMs: 700,
      narrativeText: 'The ridge tests the years stated after Methuselah\'s birth.', correctNarrativeText: 'Enoch walked with God for three hundred more years.',
      wrongNarrativeText: 'The duration after Methuselah\'s birth needs another reading.', questionPoolId: 'walked-years-moderate',
      checkpointId: 'walked-years-question', scriptureReference: 'Genesis 5:22', correctActions: ['ascend', 'slow_walk'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'walked-total',
    },
    {
      id: 'walked-total', kind: 'question_event', environment: ENOCH_RIDGE,
      activeCharacterId: 'enoch', characters: [person('enoch', 69, 'ascend')], action: 'ascend', durationMs: 740,
      narrativeText: 'The final close-reading detail remains.', correctNarrativeText: 'The years of Enoch were three hundred sixty-five.',
      wrongNarrativeText: 'Keep the total distinct from the years after Methuselah\'s birth.', questionPoolId: 'walked-total-hard',
      checkpointId: 'walked-total-question', scriptureReference: 'Genesis 5:23', correctActions: ['ascend', 'observe'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'walked-complete',
    },
    {
      id: 'walked-complete', kind: 'completion', environment: ENOCH_RIDGE,
      activeCharacterId: 'enoch', characters: [person('enoch', 80, 'observe')], action: 'observe',
      narrativeText: 'The text has been read. The final elevated path lies ahead.', scriptureReference: 'Genesis 5:21-24',
      checkpointId: 'walked-complete',
    },
  ],
};

export const TAKEN_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-5', slug: TAKEN_LEVEL_SLUG, title: 'Taken',
  subtitle: 'Complete Enoch\'s canonical transition without rewriting it.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 5, openingSceneId: 'taken-intro', continuationText: 'The genealogy continues through Methuselah.',
  scriptureLabel: 'Genesis 5',
  scenes: [
    {
      id: 'taken-intro', kind: 'narrative', environment: ENOCH_SUMMIT,
      activeCharacterId: 'enoch', characters: [person('enoch', 22, 'slow_walk')], action: 'slow_walk', durationMs: 1_900,
      narrativeText: 'The terrain is symbolic; the canonical statement remains the text of Genesis 5:24.',
      scriptureReference: 'Genesis 5:24', checkpointId: 'taken-start', nextSceneId: 'taken-walk',
    },
    {
      id: 'taken-walk', kind: 'movement', environment: ENOCH_SUMMIT,
      activeCharacterId: 'enoch', characters: [person('enoch', 16, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 6_100,
      narrativeText: 'Walk toward the pale horizon. No invented figure accompanies Enoch.',
      scriptureReference: 'Genesis 5:23-24', checkpointId: 'taken-start', nextSceneId: 'taken-wording',
    },
    {
      id: 'taken-wording', kind: 'question_event', environment: ENOCH_SUMMIT,
      activeCharacterId: 'enoch', characters: [person('enoch', 52, 'observe')], action: 'observe', durationMs: 680,
      narrativeText: 'Recall what the text says happened.', correctNarrativeText: 'Enoch was not, for God took him.',
      wrongNarrativeText: 'Do not replace the passage\'s restrained wording.', questionPoolId: 'taken-wording-moderate',
      checkpointId: 'taken-wording-question', scriptureReference: 'Genesis 5:24', correctActions: ['observe', 'slow_walk'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'taken-distinction',
    },
    {
      id: 'taken-distinction', kind: 'question_event', environment: ENOCH_SUMMIT,
      activeCharacterId: 'enoch', characters: [person('enoch', 67, 'ascend')], action: 'ascend', durationMs: 720,
      narrativeText: 'Keep Enoch\'s closing formula distinct from the surrounding genealogy.',
      correctNarrativeText: 'The account closes: God took him.', wrongNarrativeText: 'The canonical wording cannot be exchanged for an invented outcome.',
      questionPoolId: 'taken-distinction-hard', checkpointId: 'taken-distinction-question', scriptureReference: 'Genesis 5:23-24',
      correctActions: ['slow_walk', 'ascend', 'disappear'], wrongActions: ['recoil', 'fall'], nextSceneId: 'enoch-taking',
    },
    {
      id: 'enoch-taking', kind: 'canonical_event', environment: ENOCH_SUMMIT,
      activeCharacterId: 'enoch', characters: [person('enoch', 73, 'ascend', 'transition')], action: 'ascend', durationMs: 3_400,
      narrativeText: 'Enoch walked with God, and he was not, for God took him.',
      scriptureReference: 'Genesis 5:24', checkpointId: 'enoch-taking-event', canonicalEventId: ENOCH_TAKEN_EVENT_ID,
      canonicalActions: ['slow_walk', 'ascend', 'disappear'], nextSceneId: 'taken-complete', titleReveal: 'TAKEN',
    },
    {
      id: 'taken-complete', kind: 'completion', environment: ENOCH_SUMMIT,
      activeCharacterId: null, characters: [], action: 'stop',
      narrativeText: 'The world remains after Enoch\'s canonical exit. This is progression, not failure.',
      scriptureReference: 'Genesis 5:24', checkpointId: 'taken-complete',
    },
  ],
};

export const METHUSELAH_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-6', slug: METHUSELAH_LEVEL_SLUG, title: 'Methuselah',
  subtitle: 'Continue through Enoch\'s son without invented adventures.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 6, openingSceneId: 'methuselah-intro', continuationText: 'The passage now measures long years and another handoff.',
  scriptureLabel: 'Genesis 5',
  scenes: [
    {
      id: 'methuselah-intro', kind: 'narrative', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('enoch', 20, 'disappear', 'lineage'), person('methuselah', 53, 'appear')],
      action: 'lineage_transition', durationMs: 1_900, narrativeText: 'The genealogy continues through Methuselah, Enoch\'s son.',
      scriptureReference: 'Genesis 5:21, 25', checkpointId: 'methuselah-start', nextSceneId: 'methuselah-walk',
      lineage: ['enoch', 'methuselah'], titleReveal: 'METHUSELAH',
    },
    {
      id: 'methuselah-walk', kind: 'movement', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('methuselah', 16, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_300,
      narrativeText: 'Seasons pass as the genealogy records relationships and years.',
      scriptureReference: 'Genesis 5:21-27', checkpointId: 'methuselah-start', nextSceneId: 'methuselah-relation',
    },
    {
      id: 'methuselah-relation', kind: 'question_event', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('enoch', 26, 'observe', 'lineage'), person('methuselah', 57, 'observe')], action: 'observe', durationMs: 650,
      narrativeText: 'Place Methuselah between the generations named around him.',
      correctNarrativeText: 'Methuselah is Enoch\'s son and Lamech\'s father.', wrongNarrativeText: 'The relationship chain has been displaced.',
      questionPoolId: 'methuselah-relation-easy', checkpointId: 'methuselah-relation-question', scriptureReference: 'Genesis 5:21, 25',
      correctActions: ['observe', 'lineage_transition'], wrongActions: ['trip', 'fall'], nextSceneId: 'methuselah-lamech',
      lineage: ['enoch', 'methuselah', 'lamech'],
    },
    {
      id: 'methuselah-lamech', kind: 'question_event', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('methuselah', 58, 'age_transition'), person('lamech', 79, 'appear', 'lineage')], action: 'age_transition', durationMs: 720,
      narrativeText: 'The next named son enters the line.', correctNarrativeText: 'At one hundred eighty-seven, Methuselah fathers Lamech.',
      wrongNarrativeText: 'The age or the son named in Genesis 5:25 has been confused.', questionPoolId: 'methuselah-lamech-moderate',
      checkpointId: 'methuselah-lamech-question', scriptureReference: 'Genesis 5:25-26', correctActions: ['age_transition', 'lineage_transition'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'methuselah-complete', lineage: ['methuselah', 'lamech'],
    },
    {
      id: 'methuselah-complete', kind: 'completion', environment: METHUSELAH_SEASONS,
      activeCharacterId: null, characters: [person('methuselah', 44, 'observe', 'lineage'), person('lamech', 70, 'appear', 'lineage')], action: 'lineage_transition',
      narrativeText: 'Methuselah fathers Lamech, and the genealogy continues.', scriptureReference: 'Genesis 5:25',
      checkpointId: 'methuselah-complete', lineage: ['methuselah', 'lamech'],
    },
  ],
};

export const LONG_YEARS_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-7', slug: LONG_YEARS_LEVEL_SLUG, title: 'Long Years',
  subtitle: 'Read Methuselah\'s years as genealogy, not fantasy.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 7, openingSceneId: 'long-years-intro', continuationText: 'Lamech now stands before the final handoff to Noah.',
  scriptureLabel: 'Genesis 5',
  scenes: [
    {
      id: 'long-years-intro', kind: 'narrative', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('methuselah', 31, 'age_transition')], action: 'age_transition', durationMs: 1_850,
      narrativeText: 'Genesis records Methuselah\'s years without assigning him an invented adventure.',
      scriptureReference: 'Genesis 5:25-27', checkpointId: 'long-years-start', nextSceneId: 'long-years-walk',
    },
    {
      id: 'long-years-walk', kind: 'movement', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('methuselah', 16, 'slow_walk')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 5_800,
      narrativeText: 'Day, dusk, and seasons mark time while the Scripture remains concise.',
      scriptureReference: 'Genesis 5:25-27', checkpointId: 'long-years-start', nextSceneId: 'long-years-total',
    },
    {
      id: 'long-years-total', kind: 'question_event', environment: METHUSELAH_SEASONS,
      activeCharacterId: 'methuselah', characters: [person('methuselah', 54, 'age_transition')], action: 'age_transition', durationMs: 700,
      narrativeText: 'Recall the total stated in the genealogy.', correctNarrativeText: 'All the days of Methuselah were nine hundred sixty-nine years.',
      wrongNarrativeText: 'Keep Methuselah\'s total distinct from the other patriarchs.', questionPoolId: 'long-years-total-moderate',
      checkpointId: 'long-years-total-question', scriptureReference: 'Genesis 5:27', correctActions: ['age_transition', 'slow_walk'],
      wrongActions: ['recoil', 'fall'], nextSceneId: 'long-years-detail',
    },
    {
      id: 'long-years-detail', kind: 'question_event', environment: METHUSELAH_SEASONS,
      activeCharacterId: null, characters: [person('methuselah', 48, 'observe', 'lineage'), person('lamech', 74, 'appear', 'lineage')], action: 'lineage_transition', durationMs: 740,
      narrativeText: 'Hold together the age at Lamech\'s birth and the years afterward.',
      correctNarrativeText: 'One hundred eighty-seven and seven hundred eighty-two form the recorded total.',
      wrongNarrativeText: 'The two figures in Genesis 5:25-27 have been interchanged.', questionPoolId: 'long-years-detail-hard',
      checkpointId: 'long-years-detail-question', scriptureReference: 'Genesis 5:25-27', correctActions: ['lineage_transition', 'appear'],
      wrongActions: ['recoil', 'fade'], nextSceneId: 'long-years-complete', lineage: ['methuselah', 'lamech'],
    },
    {
      id: 'long-years-complete', kind: 'completion', environment: NOAH_HORIZON,
      activeCharacterId: null, characters: [person('methuselah', 27, 'disappear', 'lineage'), person('lamech', 58, 'appear', 'lineage')], action: 'lineage_transition',
      narrativeText: 'The years pass. Lamech becomes the next named father in the line.',
      scriptureReference: 'Genesis 5:28', checkpointId: 'long-years-complete', lineage: ['methuselah', 'lamech'],
    },
  ],
};

export const TOWARD_NOAH_LEVEL: StoryLevelDefinition = {
  id: 'book-1-chapter-2-level-8', slug: TOWARD_NOAH_LEVEL_SLUG, title: 'Toward Noah',
  subtitle: 'Complete the lineage handoff and stop before Noah\'s gameplay.', bookSlug: 'beginnings', chapterSlug: 'generations',
  order: 8, openingSceneId: 'toward-noah-intro', continuationText: 'The journey continues with Noah.',
  scriptureLabel: 'Genesis 5', chapterConclusion: true, nextCharacterName: 'Noah',
  chapterCompletionText: 'Generations is complete. Noah has been introduced, but his playable journey remains locked.',
  scenes: [
    {
      id: 'toward-noah-intro', kind: 'narrative', environment: NOAH_HORIZON,
      activeCharacterId: null, characters: [person('methuselah', 20, 'disappear', 'lineage'), person('lamech', 48, 'observe', 'lineage')], action: 'lineage_transition', durationMs: 1_850,
      narrativeText: 'Methuselah fathers Lamech, and Lamech later fathers a son.',
      scriptureReference: 'Genesis 5:25, 28', checkpointId: 'toward-noah-start', nextSceneId: 'toward-noah-walk',
      lineage: ['methuselah', 'lamech'],
    },
    {
      id: 'toward-noah-walk', kind: 'movement', environment: NOAH_HORIZON,
      activeCharacterId: 'lamech', characters: [person('lamech', 48, 'slow_walk', 'lineage')], action: 'slow_walk', locomotion: 'slow_walk', durationMs: 4_900,
      narrativeText: 'The final bridge approaches Noah\'s name and then stops.', scriptureReference: 'Genesis 5:28-29',
      checkpointId: 'toward-noah-start', nextSceneId: 'toward-noah-lineage', lineage: ['methuselah', 'lamech'],
    },
    {
      id: 'toward-noah-lineage', kind: 'question_event', environment: NOAH_HORIZON,
      activeCharacterId: null, characters: [person('methuselah', 20, 'observe', 'lineage'), person('lamech', 52, 'observe', 'lineage')], action: 'observe', durationMs: 660,
      narrativeText: 'Identify Noah\'s place in this line.', correctNarrativeText: 'Lamech is Noah\'s father; Methuselah is his grandfather.',
      wrongNarrativeText: 'The final two relationships before Noah have been reversed.', questionPoolId: 'toward-noah-lineage-easy',
      checkpointId: 'toward-noah-lineage-question', scriptureReference: 'Genesis 5:25, 28',
      correctActions: ['observe', 'lineage_transition'], wrongActions: ['recoil', 'fade'], nextSceneId: 'toward-noah-name',
      lineage: ['methuselah', 'lamech'],
    },
    {
      id: 'toward-noah-name', kind: 'question_event', environment: NOAH_HORIZON,
      activeCharacterId: null, characters: [person('lamech', 45, 'observe', 'lineage'), person('noah', 78, 'appear', 'future')], action: 'lineage_transition', durationMs: 740,
      narrativeText: 'Read only the hope Lamech states when naming his son.',
      correctNarrativeText: 'Lamech names him Noah while speaking of relief from work and painful toil.',
      wrongNarrativeText: 'Do not move Ark or Flood material into this earlier verse.', questionPoolId: 'toward-noah-name-hard',
      checkpointId: 'toward-noah-name-question', scriptureReference: 'Genesis 5:28-29',
      correctActions: ['lineage_transition', 'appear'], wrongActions: ['recoil', 'fade'], nextSceneId: 'noah-reveal',
      lineage: ['methuselah', 'lamech', 'noah'],
    },
    {
      id: 'noah-reveal', kind: 'character_transition', environment: NOAH_HORIZON,
      activeCharacterId: 'noah',
      characters: [person('methuselah', 18, 'disappear', 'lineage'), person('lamech', 47, 'lineage_transition', 'lineage'), person('noah', 75, 'appear', 'future')],
      action: 'lineage_transition', durationMs: 3_000, narrativeText: 'Lamech fathers a son and calls his name Noah.',
      scriptureReference: 'Genesis 5:28-29', checkpointId: 'noah-reveal-event', canonicalEventId: NOAH_REVEAL_EVENT_ID,
      canonicalActions: ['lineage_transition', 'appear'], nextSceneId: 'toward-noah-complete',
      lineage: ['methuselah', 'lamech', 'noah'], transitionLabel: 'The line reaches Noah', titleReveal: 'NOAH',
    },
    {
      id: 'toward-noah-complete', kind: 'completion', environment: NOAH_HORIZON,
      activeCharacterId: null, characters: [person('noah', 64, 'observe', 'future')], action: 'observe',
      narrativeText: 'Noah is introduced by name. His playable story has not begun.',
      scriptureReference: 'Genesis 5:28-29', checkpointId: 'toward-noah-complete', lineage: ['noah'],
    },
  ],
};

export const GENERATIONS_LEVELS = [
  SETH_LEVEL,
  LINE_CONTINUES_LEVEL,
  ENOCH_WALKS_LEVEL,
  WALKED_WITH_GOD_LEVEL,
  TAKEN_LEVEL,
  METHUSELAH_LEVEL,
  LONG_YEARS_LEVEL,
  TOWARD_NOAH_LEVEL,
];
