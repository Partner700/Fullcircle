export const ARENA_UNDO = 'undo';
export const ARENA_STANDSTILL = 'standstill';
export const ARENA_STANDSTILL_MS = 10 * 60 * 1000;

export const ROAD_HOME_MARKET_REWARDS = [
  { slug: 'skip', name: 'Skip' },
  { slug: 'reveal-reference', name: 'Reveal Reference' },
  { slug: 'shield-of-faith', name: 'Shield of Faith' },
  { slug: 'freeze-timer', name: 'Freeze Timer' },
] as const;
