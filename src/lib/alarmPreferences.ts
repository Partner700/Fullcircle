const ALARM_VOLUME_KEY = 'full-circle-scripture-alarm-volume';
const ALARM_VOLUME_EVENT = 'full-circle-scripture-alarm-volume-change';

export const MAX_ALARM_VOLUME = 200;
export const DEFAULT_ALARM_VOLUME = 200;

export function clampAlarmVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ALARM_VOLUME;
  return Math.min(MAX_ALARM_VOLUME, Math.max(0, Math.round(value)));
}

export function getAlarmVolume() {
  if (typeof window === 'undefined') return DEFAULT_ALARM_VOLUME;
  try {
    const stored = window.localStorage.getItem(ALARM_VOLUME_KEY);
    return stored === null ? DEFAULT_ALARM_VOLUME : clampAlarmVolume(Number(stored));
  } catch {
    return DEFAULT_ALARM_VOLUME;
  }
}

export function setAlarmVolume(value: number) {
  const next = clampAlarmVolume(value);
  if (typeof window === 'undefined') return next;
  try {
    window.localStorage.setItem(ALARM_VOLUME_KEY, String(next));
  } catch {
    // Private browsing can deny storage; the current component still keeps the value.
  }
  window.dispatchEvent(new CustomEvent<number>(ALARM_VOLUME_EVENT, { detail: next }));
  return next;
}

export function subscribeToAlarmVolume(listener: (volume: number) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handleChange = (event: Event) => {
    listener(clampAlarmVolume((event as CustomEvent<number>).detail));
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === ALARM_VOLUME_KEY) listener(getAlarmVolume());
  };
  window.addEventListener(ALARM_VOLUME_EVENT, handleChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(ALARM_VOLUME_EVENT, handleChange);
    window.removeEventListener('storage', handleStorage);
  };
}
