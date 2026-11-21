import { resolveBoardMovement } from './boardMovement.ts';

type Entry = { day: string; baseline: number; baselineRank: number; last: number; lastRank: number; max: number; recordDay?: string };
export type LeadershipHistory = Record<string, Entry>;
export type LeadershipMovement = { movement: -1 | 0 | 1 | null; isRecord: boolean };

/** Compare each snapshot with the start of the day, not the preceding refresh. */
export function updateLeadershipHistory<T extends { user_id: string; rank: number }>(
  rows: readonly T[], score: (row: T) => number, history: LeadershipHistory, day: string,
) {
  const next = { ...history };
  const enriched = rows.map(row => {
    const current = score(row);
    const previous = history[row.user_id];
    const sameDay = previous?.day === day;
    const baseline = previous ? sameDay ? previous.baseline : previous.last : current;
    const baselineRank = previous ? sameDay ? previous.baselineRank : previous.lastRank : row.rank;
    const newRecord = Boolean(previous && current > previous.max);
    const recordDay = newRecord ? day : previous?.recordDay;
    const isRecord = recordDay === day;
    next[row.user_id] = { day, baseline, baselineRank, last: current, lastRank: row.rank, max: Math.max(previous?.max ?? current, current), recordDay };
    return { ...row, movement: resolveBoardMovement({ currentValue: current, previousValue: baseline, currentRank: row.rank, previousRank: baselineRank }), isRecord };
  });
  return { rows: enriched, history: next };
}
