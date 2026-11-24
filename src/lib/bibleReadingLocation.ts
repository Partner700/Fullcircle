import { validBibleReadingLocation, type BibleReadingLocation } from './bibleBooks.ts';
import { safeJsonStorageGet, safeStorageSet } from './safeStorage.ts';

const key = (userId: string) => `full-circle-bible-location-v1:${userId}`;
export function readBibleReadingLocation(userId?: string): BibleReadingLocation {
  return (userId && validBibleReadingLocation(safeJsonStorageGet('local', key(userId), null))) || { bookIndex: 0, chapter: 1 };
}
export function saveBibleReadingLocation(userId: string | undefined, location: BibleReadingLocation) {
  if (!userId) return;
  const valid = validBibleReadingLocation(location);
  if (valid) safeStorageSet('local', key(userId), JSON.stringify(valid));
}
