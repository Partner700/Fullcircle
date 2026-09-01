export interface ReadingReplyTarget {
  userId: string;
  displayName: string;
  parentCommentId?: string;
}

export interface ReadingDraft {
  meditation: string;
  bestVerse: string;
  dailyQuote: string;
  challengeText: string;
  challengeLink: string;
  insightDrafts: Record<string, string>;
  replyDrafts: Record<string, string>;
  replyTargets: Record<string, ReadingReplyTarget | null>;
  openUserInsights: string | null;
  openInsightReplies: string | null;
  editingInsightId: string | null;
  editingInsightBody: string;
  editingCommentId: string | null;
  editingCommentBody: string;
}

interface ReadingDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const READING_DRAFT_PREFIX = 'full-circle-reading-draft-v1';

export function emptyReadingDraft(): ReadingDraft {
  return {
    meditation: '',
    bestVerse: '',
    dailyQuote: '',
    challengeText: '',
    challengeLink: '',
    insightDrafts: {},
    replyDrafts: {},
    replyTargets: {},
    openUserInsights: null,
    openInsightReplies: null,
    editingInsightId: null,
    editingInsightBody: '',
    editingCommentId: null,
    editingCommentBody: '',
  };
}

export function readingDraftStorageKey(userId: string, readingDate: string) {
  return `${READING_DRAFT_PREFIX}:${userId}:${readingDate}`;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function replyTargetMap(value: unknown): Record<string, ReadingReplyTarget | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const targets: Record<string, ReadingReplyTarget | null> = {};
  Object.entries(value).forEach(([key, target]) => {
    if (target === null) {
      targets[key] = null;
      return;
    }
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;
    const candidate = target as Record<string, unknown>;
    if (typeof candidate.userId !== 'string' || typeof candidate.displayName !== 'string') return;
    targets[key] = {
      userId: candidate.userId,
      displayName: candidate.displayName,
      ...(typeof candidate.parentCommentId === 'string' ? { parentCommentId: candidate.parentCommentId } : {}),
    };
  });
  return targets;
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function normalizeReadingDraft(value: unknown): ReadingDraft {
  const empty = emptyReadingDraft();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const candidate = value as Record<string, unknown>;
  return {
    meditation: typeof candidate.meditation === 'string' ? candidate.meditation : '',
    bestVerse: typeof candidate.bestVerse === 'string' ? candidate.bestVerse : '',
    dailyQuote: typeof candidate.dailyQuote === 'string' ? candidate.dailyQuote : '',
    challengeText: typeof candidate.challengeText === 'string' ? candidate.challengeText : '',
    challengeLink: typeof candidate.challengeLink === 'string' ? candidate.challengeLink : '',
    insightDrafts: stringMap(candidate.insightDrafts),
    replyDrafts: stringMap(candidate.replyDrafts),
    replyTargets: replyTargetMap(candidate.replyTargets),
    openUserInsights: optionalString(candidate.openUserInsights),
    openInsightReplies: optionalString(candidate.openInsightReplies),
    editingInsightId: optionalString(candidate.editingInsightId),
    editingInsightBody: typeof candidate.editingInsightBody === 'string' ? candidate.editingInsightBody : '',
    editingCommentId: optionalString(candidate.editingCommentId),
    editingCommentBody: typeof candidate.editingCommentBody === 'string' ? candidate.editingCommentBody : '',
  };
}

function browserStorage(): ReadingDraftStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readReadingDraft(userId: string, readingDate: string, storage = browserStorage()): ReadingDraft {
  if (!storage) return emptyReadingDraft();
  try {
    const stored = storage.getItem(readingDraftStorageKey(userId, readingDate));
    return stored ? normalizeReadingDraft(JSON.parse(stored)) : emptyReadingDraft();
  } catch {
    return emptyReadingDraft();
  }
}

function hasDraftContent(draft: ReadingDraft) {
  return Boolean(
    draft.meditation ||
    draft.bestVerse ||
    draft.dailyQuote ||
    draft.challengeText ||
    draft.challengeLink ||
    draft.editingInsightBody ||
    draft.editingCommentBody ||
    Object.values(draft.insightDrafts).some(Boolean) ||
    Object.values(draft.replyDrafts).some(Boolean),
  );
}

export function writeReadingDraft(
  userId: string,
  readingDate: string,
  draft: ReadingDraft,
  storage = browserStorage(),
) {
  if (!storage) return;
  const key = readingDraftStorageKey(userId, readingDate);
  try {
    const normalized = normalizeReadingDraft(draft);
    if (!hasDraftContent(normalized)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(normalized));
  } catch (error) {
    console.warn('Today\'s Reading draft could not be stored:', error);
  }
}
