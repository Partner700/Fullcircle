export type UserLiveStats = {
  user_id: string;
  total_denarii: number;
  current_streak: number;
  longest_streak: number;
  consecutive_inactive: number;
  cumulative_inactive: number;
  total_figs: number;
  rhudes: number;
  marks: number;
};

const STAT_FIELDS = [
  'total_denarii', 'current_streak', 'longest_streak', 'consecutive_inactive',
  'cumulative_inactive', 'total_figs', 'rhudes', 'marks',
] as const;

export function parseLiveStats(data: unknown, userId: string): UserLiveStats {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || row.user_id !== userId) throw new Error('Live user stats were unavailable.');
  const result = { user_id: userId } as UserLiveStats;
  for (const field of STAT_FIELDS) {
    const value = row[field];
    if ((typeof value !== 'number' && typeof value !== 'string')
      || String(value).trim() === '' || !Number.isFinite(Number(value))) {
      throw new Error(`Live ${field} data were unavailable.`);
    }
    result[field] = Number(value);
  }
  return result;
}

export type TopbarStats = { denarii: number; streak: number; marks: number };

export function hasCompleteTopbarStats(value: unknown): value is TopbarStats {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['denarii', 'streak', 'marks'].every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]));
}

export function mergeConfirmedTopbarStats(previous: TopbarStats, patch: Partial<TopbarStats>): TopbarStats {
  const next = { ...previous };
  for (const key of ['denarii', 'streak', 'marks'] as const) {
    const value = patch[key];
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
  }
  return next;
}
