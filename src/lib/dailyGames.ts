export const DAILY_GAMES_HUB_TAB = 'games' as const;
export const DAILY_TRIVIA_TAB = 'game' as const;
export const ARENA_TAB = 'arena' as const;
export const STORY_MODE_TAB = 'story' as const;

const DAILY_GAMES_CHILD_TABS = new Set<string>([
  DAILY_TRIVIA_TAB,
  ARENA_TAB,
  STORY_MODE_TAB,
]);

export function dailyGamesNavigationKey(tab: string) {
  return DAILY_GAMES_CHILD_TABS.has(tab) ? DAILY_GAMES_HUB_TAB : tab;
}

export function activeArenaRoomStorageKey(userId: string) {
  return `full-circle-active-arena-room-${userId}`;
}
