import type { DayType, DailyRecord, StreakInfo, RemovalState } from './types';
import {
  ATTENDANCE_CUTOFF_HOUR,
  MEDITATION_CUTOFF_HOUR,
  MEDITATION_CUTOFF_MINUTE,
  AT_RISK_CONSECUTIVE_THRESHOLD,
  REMOVAL_CONSECUTIVE_THRESHOLD,
  REMOVAL_CUMULATIVE_THRESHOLD,
} from './constants';

export function getDayType(date: Date): DayType {
  const dow = date.getDay();
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  return 'weekday';
}

export function isAttendanceOnTime(markedAt: Date): boolean {
  return markedAt.getHours() < ATTENDANCE_CUTOFF_HOUR;
}

export function isMeditationOnTime(submittedAt: Date): boolean {
  const h = submittedAt.getHours();
  const m = submittedAt.getMinutes();
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
    (a, b) => new Date(a.record_date).getTime() - new Date(b.record_date).getTime(),
  );

  let currentStreak = 0;
  let longestStreak = 0;
  let consecutiveInactive = 0;
  let cumulativeInactive = 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let volumeThisMonth = 0;

  for (const record of sorted) {
    const recordDate = new Date(record.record_date);
    if (record.day_type === 'sunday') continue;

    const valid = isWeekdayValid(record);
    if (valid === null) continue;

    if (valid) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      consecutiveInactive = 0;
      if (recordDate >= monthStart) {
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
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  const dow = now.getDay();
  if (dow === 6 && now.getHours() >= 17) return true;
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
  return new Date().toISOString().split('T')[0];
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
