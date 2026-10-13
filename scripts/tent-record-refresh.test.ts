import assert from 'node:assert/strict';
import { mergeTentDailyRecords } from '../src/lib/tentRecordRefresh.ts';
import type { DailyRecord } from '../src/lib/types.ts';

const record = (user_id: string, record_date: string, attendance_status: DailyRecord['attendance_status']) =>
  ({ user_id, record_date, attendance_status }) as DailyRecord;

const initial = mergeTentDailyRecords({}, ['a', 'b'], [
  record('a', '2026-10-11', 'present'),
  record('a', '2026-10-12', 'unmarked'),
  record('b', '2026-10-12', 'absent'),
], true);
assert.equal(initial.a.length, 2);
assert.equal(initial.b.length, 1);

const refreshed = mergeTentDailyRecords(initial, ['a', 'b'], [
  record('a', '2026-10-12', 'present'),
  record('a', '2026-10-13', 'present'),
], false);
assert.deepEqual(refreshed.a.map((row) => row.record_date), ['2026-10-11', '2026-10-12', '2026-10-13']);
assert.equal(refreshed.a[1].attendance_status, 'present');
assert.equal(refreshed.b[0].attendance_status, 'absent');
assert.equal(initial.a[1].attendance_status, 'unmarked', 'Refresh must not mutate previous state');

const changedMembers = mergeTentDailyRecords(refreshed, ['b', 'c'], [record('c', '2026-10-13', 'present')], true);
assert.deepEqual(Object.keys(changedMembers), ['b', 'c']);
assert.equal(changedMembers.b.length, 0, 'A full refresh removes stale history');
assert.equal(changedMembers.c.length, 1);

console.log('Tent history refresh preserves older records and updates recent days without duplication');
