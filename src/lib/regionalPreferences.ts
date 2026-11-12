export function interfaceLanguage(language?: string | null, deviceLanguage = globalThis.navigator?.language) {
  return (language || deviceLanguage || 'en').toLowerCase().split('-')[0] === 'fr' ? 'fr' : 'en';
}

export function preferredTimeZone(timeZone?: string | null) {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone });
      return timeZone;
    } catch {
      // A saved value can be unsupported by the current browser's time-zone data.
    }
  }
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function regionalDateTime(
  value: string | number | Date,
  profile?: { timezone?: string | null; language_code?: string | null } | null,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(interfaceLanguage(profile?.language_code), {
    ...options,
    timeZone: preferredTimeZone(profile?.timezone),
  }).format(date);
}
