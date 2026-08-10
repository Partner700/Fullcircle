import type { DayType, DailyRecord, StreakInfo, RemovalState } from './types';
import {
  ATTENDANCE_CUTOFF_HOUR,
  MEDITATION_CUTOFF_HOUR,
  MEDITATION_CUTOFF_MINUTE,
  AT_RISK_CONSECUTIVE_THRESHOLD,
  REMOVAL_CONSECUTIVE_THRESHOLD,
  REMOVAL_CUMULATIVE_THRESHOLD,
  APP_TIME_ZONE,
} from './constants';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseCalendarDate(date: string): Date {
  if (ISO_DATE_PATTERN.test(date)) {
    return new Date(`${date}T12:00:00.000Z`);
  }
  return new Date(date);
}

function appDateParts(date: Date = new Date()): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
}

export function getDayType(date: Date | string): DayType {
  const weekday = typeof date === 'string' && ISO_DATE_PATTERN.test(date)
    ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(parseCalendarDate(date))
    : appDateParts(typeof date === 'string' ? new Date(date) : date).weekday;
  const dow = weekday === 'Sat' ? 6 : weekday === 'Sun' ? 0 : 1;
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  return 'weekday';
}

export function isAttendanceOnTime(markedAt: Date): boolean {
  const { hour } = appDateParts(markedAt);
  return Number(hour) < ATTENDANCE_CUTOFF_HOUR;
}

export function isMeditationOnTime(submittedAt: Date): boolean {
  const { hour, minute } = appDateParts(submittedAt);
  const h = Number(hour);
  const m = Number(minute);
  return h < MEDITATION_CUTOFF_HOUR || (h === MEDITATION_CUTOFF_HOUR && m <= MEDITATION_CUTOFF_MINUTE);
}

export function isWeekdayValid(record: DailyRecord): boolean | null {
  if (record.day_type === 'sunday') return null;
  if (record.day_type === 'saturday') {
    return !!record.quiz_attempt_id || record.streak_valid === true;
  }
  if (record.day_type === 'weekday') {
    return record.attendance_status === 'present' && record.meditation_submitted === true;
  }
  return null;
}

export function computeStreak(records: DailyRecord[]): StreakInfo {
  const sorted = [...records].sort(
    (a, b) => a.record_date.localeCompare(b.record_date),
  );

  let currentStreak = 0;
  let longestStreak = 0;
  let consecutiveInactive = 0;
  let cumulativeInactive = 0;
  const monthPrefix = getTodayISODate().slice(0, 7);
  let volumeThisMonth = 0;

  for (const record of sorted) {
    if (record.day_type === 'sunday') continue;

    const valid = isWeekdayValid(record);
    if (valid === null) continue;

    if (valid) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      consecutiveInactive = 0;
      if (record.record_date.startsWith(monthPrefix)) {
        volumeThisMonth += 1;
      }
    } else {
      currentStreak = 0;
      consecutiveInactive += 1;
      cumulativeInactive += 1;
    }
  }

  const removalState: RemovalState = getRemovalState(consecutiveInactive, cumulativeInactive);

  return {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    consecutive_inactive: consecutiveInactive,
    cumulative_inactive: cumulativeInactive,
    removal_state: removalState,
    volume_this_month: volumeThisMonth,
  };
}

export function getRemovalState(consecutive: number, cumulative: number): RemovalState {
  if (consecutive >= REMOVAL_CONSECUTIVE_THRESHOLD || cumulative >= REMOVAL_CUMULATIVE_THRESHOLD) {
    return 'flagged';
  }
  if (consecutive >= AT_RISK_CONSECUTIVE_THRESHOLD) {
    return 'at_risk';
  }
  return 'active';
}

export function formatDenarii(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 1_000) {
    return `${(amount / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(amount);
}

export function formatFullDenarii(amount: number): string {
  return amount.toLocaleString('en-US');
}

export function formatXaf(amount: number | string | null | undefined): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '0 FCFA';
  return `${Math.round(value).toLocaleString('en-US')} FCFA`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseCalendarDate(date) : date;
  return d.toLocaleDateString('en-US', {
    timeZone: typeof date === 'string' && ISO_DATE_PATTERN.test(date) ? 'UTC' : APP_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseCalendarDate(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: typeof date === 'string' && ISO_DATE_PATTERN.test(date) ? 'UTC' : APP_TIME_ZONE,
  });
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
  });
}

export function talentsToDenarii(talents: number): number {
  return Math.round(talents * 6000);
}

export function quizScoreToTalents(correctAnswers: number): number {
  if (correctAnswers >= 10) return 5;
  if (correctAnswers >= 8) return 4;
  if (correctAnswers >= 6) return 3;
  if (correctAnswers >= 4) return 2;
  if (correctAnswers >= 2) return 1;
  return 0;
}

export function calcLevelReward(score: number, maxScore: number, perfectReward = 100): number {
  if (maxScore === 0) return 0;
  const ratio = score / maxScore;
  if (ratio >= 1) return perfectReward;
  const passRatio = 0.6;
  if (ratio < passRatio) return 0;
  return Math.round(perfectReward * ratio);
}

export function isGamePausedNow(): boolean {
  const now = new Date();
  const { weekday, hour } = appDateParts(now);
  if (weekday === 'Sat' && Number(hour) >= 17) return true;
  return false;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function getTodayISODate(): string {
  const { year, month, day } = appDateParts();
  return `${year}-${month}-${day}`;
}

export function shiftISODate(date: string, days: number): string {
  if (!ISO_DATE_PATTERN.test(date)) throw new Error(`Invalid ISO calendar date: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

export function getDateDaysAgoISO(days: number): string {
  return shiftISODate(getTodayISODate(), -days);
}

export function getAppClock(): { date: string; weekday: string; hour: number; minute: number } {
  const parts = appDateParts();
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function getAppDateTimeMs(date: string, hour = 0, minute = 0): number {
  if (!ISO_DATE_PATTERN.test(date)) throw new Error(`Invalid ISO calendar date: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  const desiredWallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = desiredWallClock;

  // Resolve the wall-clock value through Intl instead of assuming a fixed UTC
  // offset. The second pass also keeps this correct if the configured timezone
  // ever adopts daylight-saving rules.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = appDateParts(new Date(candidate));
    const representedWallClock = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
      0,
    );
    candidate -= representedWallClock - desiredWallClock;
  }

  return candidate;
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function whatsappUrl(number: string | null): string | null {
  if (!number) return null;
  const digits = number.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}
