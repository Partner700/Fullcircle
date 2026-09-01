import assert from 'node:assert/strict';
import {
  emptyReadingDraft,
  readReadingDraft,
  readingDraftStorageKey,
  writeReadingDraft,
} from '../src/lib/readingDrafts.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
const userId = 'reader-a';
const readingDate = '2026-09-01';
const draft = {
  ...emptyReadingDraft(),
  meditation: 'First paragraph.\n\nSecond paragraph keeps its spacing.',
  insightDrafts: { 'Genesis 1:1': 'An unfinished insight' },
  replyDrafts: { 'insight-1': '@Courage an unfinished reply' },
  replyTargets: {
    'insight-1': { userId: 'courage', displayName: 'Courage' },
  },
  openUserInsights: 'Genesis 1:1',
  openInsightReplies: 'insight-1',
};

writeReadingDraft(userId, readingDate, draft, storage);
assert.deepEqual(readReadingDraft(userId, readingDate, storage), draft);
assert.equal(readReadingDraft('reader-b', readingDate, storage).meditation, '');
assert.equal(readReadingDraft(userId, '2026-09-02', storage).meditation, '');
assert.notEqual(
  readingDraftStorageKey(userId, readingDate),
  readingDraftStorageKey(userId, '2026-09-02'),
);

storage.setItem(readingDraftStorageKey(userId, 'broken'), '{not valid json');
assert.deepEqual(readReadingDraft(userId, 'broken', storage), emptyReadingDraft());

writeReadingDraft(userId, readingDate, emptyReadingDraft(), storage);
assert.equal(storage.getItem(readingDraftStorageKey(userId, readingDate)), null);

console.log('Today\'s Reading draft persistence checks passed.');
