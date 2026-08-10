export const TENT_HOUSES = [
  {
    id: 'squares',
    name: 'The Squares',
    symbol: 'Square',
    motif: "The mason's square — construction tool",
    color: '#4A90D9',
    motto: 'Built on the level, rising true.',
  },
  {
    id: 'spades',
    name: 'The Spades',
    symbol: 'Spade',
    motif: 'The upper blade of a farming spade',
    color: '#6BAA52',
    motto: 'Turn the soil, plant the seed.',
  },
  {
    id: 'darics',
    name: 'The Darics',
    symbol: 'Column',
    motif: 'The gold standard — a Roman column, tested and proven',
    color: '#D4A03C',
    motto: 'Faith tested, proven as gold.',
  },
  {
    id: 'rudes',
    name: 'The Rudes',
    symbol: 'Sword',
    motif: 'The wooden sword awarded to a freed gladiator',
    color: '#B8553E',
    motto: 'Trained for the arena, freed for the field.',
  },
  {
    id: 'laureats',
    name: 'The Laureats',
    symbol: 'Crown',
    motif: 'The crown won by a Roman athlete',
    color: '#8B6FB5',
    motto: 'Press on for the prize.',
  },
] as const;

export const TENT_HOUSE_MAP = Object.fromEntries(
  TENT_HOUSES.map((h) => [h.id, h]),
) as Record<string, (typeof TENT_HOUSES)[number]>;

export const TALENTS_TO_DENARII = 6000;
export const FULL_QUIZ_TALENTS = 5;
export const FULL_QUIZ_DENARII = TALENTS_TO_DENARII * FULL_QUIZ_TALENTS;

export const ATTENDANCE_CUTOFF_HOUR = 12;
export const MEDITATION_CUTOFF_HOUR = 21;
export const MEDITATION_CUTOFF_MINUTE = 0;

export const STREAKBOARD_UPDATE_HOUR = 21;
export const LEADERBOARD_WEEKLY_CLOSE_HOUR = 18;
export const GAME_PAUSE_START_HOUR = 17;
export const GAME_RESUME_DAY = 1;
export const GAME_RESUME_HOUR = 7;

export const REMOVAL_CONSECUTIVE_THRESHOLD = 5;
export const REMOVAL_CUMULATIVE_THRESHOLD = 10;
export const AT_RISK_CONSECUTIVE_THRESHOLD = 3;

export const DAILY_GAME_LEVELS = 7;
export const DAILY_GAME_CAP = 1000;
export const PERFECT_LEVEL_REWARD = 100;

// ── Game type per level ──
// Level 1: True or False
// Level 2: Reading Comprehension (multiple choice)
// Level 3: Fill in the Blanks
// Level 4: Word to Meaning (matching)
// Level 5: First Letter (type the rest of the verse)
// Level 6: Build the Verse (arrange random words)
// Level 7: Final — one of each type, hardest, shortest timers
export const LEVEL_GAME_TYPES = [
  'true_false',      // L1
  'comprehension',   // L2
  'fill_blank',      // L3
  'word_to_meaning', // L4
  'first_letter',    // L5
  'build_verse',     // L6
  'final_mixed',     // L7 — boss level
] as const;

export const LEVEL_TIMERS = [60, 55, 50, 45, 40, 35, 20]; // seconds per question per level (final = shortest)

// Relic slugs
export const RELIC_SLUGS = {
  HINT: 'hint',
  ELIMINATE: 'eliminate',
  FREEZE_TIMER: 'freeze-timer',
  SKIP: 'skip',
  REVEAL_REFERENCE: 'reveal-reference',
  WITCH_BALL: 'witch-ball-endor',
  SWORD_GOLIATH: 'sword-goliath',
  TALKING_DONKEY: 'talking-donkey',
  SIMONS_PURSE: 'simons-purse',
  THIEVES_REQUEST: 'thieves-request',
  MASTERS_REWARD: 'masters-reward',
  LAZARUS_COIN: 'lazarus-coin',
  REDEMPTION_COIN: 'redemption-coin',
} as const;

export const QUIZ_LIVE_DURATION_MINUTES = 30;
export const QUIZ_COUNTDOWN_DURATION_MINUTES = 15;
export const QUIZ_QUESTION_COUNT = 10;

export const SATURDAY_QUIZ_START_HOUR = 9;
export const SATURDAY_QUIZ_END_HOUR = 9; // 9:30 AM
export const SATURDAY_QUIZ_END_MINUTE = 30;
export const SATURDAY_QUIZ_BUFFER_MINUTES = 15;

export const GAME_QUESTIONS_PER_LEVEL = 15;
export const GAME_ROUNDS_PER_LEVEL = 3;
export const GAME_QUESTIONS_PER_ROUND = 5;
export const GAME_PASS_THRESHOLD = 0.6; // 60% to advance
export const GAME_FAILED_REPEAT_LIMIT = 1; // failed questions repeat once

export const MONTHLY_RANKING_WEIGHTS = {
  volume: 0.4,
  consistency: 0.2,
  improvement: 0.15,
  quiz: 0.15,
  challenge: 0.05,
  game: 0.05,
} as const;

// ── Game economy: hint & answer-reveal costs ──
export const HINT_COST = 50;
export const ANSWER_REVEAL_COST = 100;
export const FREEZER_DAILY_COST = 500;
export const FREEZER_WEEKLY_PRICE = 2;

export const ARENA_GAME_CALL_FEE = 10;

export const TRIAL_DURATION_DAYS = 31;

export const CHALLENGE_PROOF_FORMATS: { value: import('./types').ChallengeProofFormat; label: string }[] = [
  { value: 'text', label: 'Text write-up' },
  { value: 'png', label: 'PNG image upload' },
  { value: 'pdf', label: 'PDF upload' },
  { value: 'image', label: 'Image upload (any format)' },
  { value: 'link', label: 'External link' },
];
