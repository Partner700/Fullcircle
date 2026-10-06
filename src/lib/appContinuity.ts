import { safeStorageGet, safeStorageRemove, safeStorageSet } from './safeStorage.ts';

type ContinuityState = {
  tab?: string;
  scrollByTab?: Record<string, number>;
  updatedAt?: number;
};

const CONTINUITY_VERSION = 'v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function storageKey(userId: string, role: string) {
  return `fc-app-continuity-${CONTINUITY_VERSION}:${role}:${userId}`;
}

function readState(userId: string, role: string): ContinuityState {
  if (!userId) return {};

  const key = storageKey(userId, role);
  const raw = safeStorageGet('local', key);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as ContinuityState;
    if (
      parsed.updatedAt
      && Number.isFinite(parsed.updatedAt)
      && Date.now() - parsed.updatedAt > MAX_AGE_MS
    ) {
      safeStorageRemove('local', key);
      return {};
    }
    return parsed;
  } catch {
    safeStorageRemove('local', key);
    return {};
  }
}

function writeState(userId: string, role: string, state: ContinuityState) {
  if (!userId) return;
  safeStorageSet('local', storageKey(userId, role), JSON.stringify({
    ...state,
    updatedAt: Date.now(),
  }));
}

export function readContinuedTab<T extends string>(
  userId: string,
  role: string,
  allowedTabs: readonly T[],
  fallback: T,
  excludedTabs: readonly string[] = [],
) {
  const hashValue = typeof window !== 'undefined'
    ? window.location.hash.replace(/^#/, '')
    : '';
  const hashTab = new URLSearchParams(hashValue).get('fc-tab') || hashValue;
  if (allowedTabs.includes(hashTab as T)) return hashTab as T;

  const storedTab = readState(userId, role).tab;
  if (
    storedTab
    && !excludedTabs.includes(storedTab)
    && allowedTabs.includes(storedTab as T)
  ) {
    return storedTab as T;
  }

  return fallback;
}

export function persistContinuedTab(
  userId: string,
  role: string,
  tab: string,
  excludedTabs: readonly string[] = [],
) {
  if (!userId || excludedTabs.includes(tab)) return;
  const current = readState(userId, role);
  writeState(userId, role, { ...current, tab });
}

export function readContinuedScroll(userId: string, role: string, tab: string) {
  const value = readState(userId, role).scrollByTab?.[tab];
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : null;
}

export function persistContinuedScroll(
  userId: string,
  role: string,
  tab: string,
  scrollTop: number,
  excludedTabs: readonly string[] = [],
) {
  if (!userId || excludedTabs.includes(tab) || !Number.isFinite(scrollTop)) return;
  const current = readState(userId, role);
  writeState(userId, role, {
    ...current,
    scrollByTab: {
      ...current.scrollByTab,
      [tab]: Math.max(0, Math.round(scrollTop)),
    },
  });
}
