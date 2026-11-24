export type ShareDestination =
  | { kind: 'reading'; date: string }
  | { kind: 'game'; date: string }
  | { kind: 'quiz'; id: string }
  | { kind: 'arena'; id: string }
  | { kind: 'birthday'; id: string; date: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function readShareDestination(search: string): ShareDestination | null {
  const params = new URLSearchParams(search);
  const kind = params.get('share');
  const id = params.get('id');
  const date = params.get('date');
  if ((kind === 'reading' || kind === 'game') && validDate(date)) return { kind, date };
  if ((kind === 'quiz' || kind === 'arena') && id && uuid.test(id)) return { kind, id };
  if (kind === 'birthday' && id && uuid.test(id) && validDate(date)) return { kind, id, date };
  return null;
}

export function shareDestinationMode(hasSession: boolean, installed: boolean, explicitlyOpened: boolean) {
  return hasSession ? 'member' : installed || explicitlyOpened ? 'sign-in' : 'visitor';
}

export function openShareInAppUrl(href: string) {
  const url = new URL(href);
  url.searchParams.set('fc-open-app', '1');
  return url.toString();
}

export function closeShareUrl(href: string) {
  const url = new URL(href);
  for (const key of ['share', 'id', 'date', 'fc-open-app']) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}
