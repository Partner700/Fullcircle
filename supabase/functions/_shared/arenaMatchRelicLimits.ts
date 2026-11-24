export const ARENA_MATCH_RELIC_LIMITS = {
  standstill: 1,
  undo: 3,
  'shield-of-faith': 5,
  boomerang: 5,
} as const;

export type ArenaMatchRelic = keyof typeof ARENA_MATCH_RELIC_LIMITS;
export type ArenaMatchRelicUses = Record<string, Partial<Record<ArenaMatchRelic, number>>>;

export function arenaMatchRelicIsMuted(uses: ArenaMatchRelicUses | undefined, playerId: string,
  relic: ArenaMatchRelic, machineMatch: boolean): boolean {
  return !machineMatch && (uses?.[playerId]?.[relic] ?? 0) >= ARENA_MATCH_RELIC_LIMITS[relic];
}

export function countArenaMatchRelicUse(state: { matchRelicUses?: ArenaMatchRelicUses }, playerId: string, relic: ArenaMatchRelic) {
  const uses = state.matchRelicUses ??= {};
  const player = uses[playerId] ??= {};
  player[relic] = (player[relic] ?? 0) + 1;
}
