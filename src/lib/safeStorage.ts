type BrowserStorageKind = 'local' | 'session';

function browserStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeStorageGet(kind: BrowserStorageKind, key: string): string | null {
  try {
    return browserStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeStorageSet(kind: BrowserStorageKind, key: string, value: string): boolean {
  try {
    const storage = browserStorage(kind);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(kind: BrowserStorageKind, key: string): boolean {
  try {
    const storage = browserStorage(kind);
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeJsonStorageGet<T>(kind: BrowserStorageKind, key: string, fallback: T): T {
  const stored = safeStorageGet(kind, key);
  if (stored === null) return fallback;
  try {
    return JSON.parse(stored) as T;
  } catch {
    safeStorageRemove(kind, key);
    return fallback;
  }
}
