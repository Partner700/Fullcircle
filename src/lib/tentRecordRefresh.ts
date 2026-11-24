import type { DailyRecord } from './types';

export function mergeTentDailyRecords(
  previous: Record<string, DailyRecord[]>,
  memberIds: string[],
  incoming: DailyRecord[],
  replaceHistory: boolean,
): Record<string, DailyRecord[]> {
  const incomingByUser = new Map<string, Map<string, DailyRecord>>();
  for (const record of incoming) {
    if (!incomingByUser.has(record.user_id)) incomingByUser.set(record.user_id, new Map());
    incomingByUser.get(record.user_id)!.set(record.record_date, record);
  }
  return Object.fromEntries(memberIds.map((userId) => {
    const records = replaceHistory
      ? new Map<string, DailyRecord>()
      : new Map((previous[userId] || []).map((record) => [record.record_date, record]));
    for (const [date, record] of incomingByUser.get(userId) || []) records.set(date, record);
    return [userId, [...records.values()].sort((left, right) => left.record_date.localeCompare(right.record_date))];
  }));
}
