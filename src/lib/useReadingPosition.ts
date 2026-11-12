import { useLayoutEffect, useRef, type RefObject } from 'react';
import { safeJsonStorageGet, safeStorageSet } from './safeStorage';

type ReadingPosition = { top: number; verse?: string; offset?: number };
const verseSelector = '[data-verse-reference]';

export function useReadingPosition(
  rootRef: RefObject<HTMLDivElement>,
  userId: string | undefined,
  date: string,
  ready: boolean,
  hasScriptureTarget: boolean,
) {
  const cancelRestore = useRef<(() => void) | null>(null);
  const targetRef = useRef(hasScriptureTarget);
  targetRef.current = hasScriptureTarget;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !userId || !ready) return;

    const key = `full-circle-reading-position-v1:${userId}:${date}`;
    const saved = safeJsonStorageGet<ReadingPosition | null>('local', key, null);
    let position = saved && Number.isFinite(saved.top) && saved.top >= 0 ? saved : { top: 0 };
    let restoring = !targetRef.current;
    let saveTimer: number | undefined;

    const persist = () => {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
      safeStorageSet('local', key, JSON.stringify(position));
    };

    const restore = () => {
      if (!restoring || targetRef.current || document.visibilityState === 'hidden') return;
      const anchor = position.verse && Array.from(root.querySelectorAll<HTMLElement>(verseSelector))
        .find((verse) => verse.dataset.verseReference === position.verse);
      const offset = position.offset;
      const top = anchor && typeof offset === 'number' && Number.isFinite(offset)
        ? window.scrollY + anchor.getBoundingClientRect().top - offset
        : position.top;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const target = Math.min(max, Math.max(0, top));
      if (Math.abs(window.scrollY - target) > 1) window.scrollTo({ top: target, behavior: 'instant' });
    };

    const trackScroll = () => {
      if (restoring || document.visibilityState === 'hidden') return;
      const rect = root.getBoundingClientRect();
      const verse = document.elementFromPoint(rect.left + rect.width / 2, window.innerHeight / 3)
        ?.closest<HTMLElement>(verseSelector);
      position = verse && root.contains(verse) && verse.dataset.verseReference
        ? { top: Math.max(0, window.scrollY), verse: verse.dataset.verseReference, offset: verse.getBoundingClientRect().top }
        : { top: Math.max(0, window.scrollY) };
      if (saveTimer === undefined) saveTimer = window.setTimeout(persist, 150);
    };

    const stopRestoring = () => { restoring = false; };
    cancelRestore.current = stopRestoring;
    const resume = () => {
      if (document.visibilityState === 'hidden') {
        persist();
      } else {
        restoring = true;
        restore();
      }
    };

    restore();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restore);
    observer?.observe(root);
    root.addEventListener('animationend', restore);
    window.addEventListener('resize', restore);
    window.addEventListener('scroll', trackScroll, { passive: true });
    window.addEventListener('pointerdown', stopRestoring, { passive: true });
    window.addEventListener('touchstart', stopRestoring, { passive: true });
    window.addEventListener('wheel', stopRestoring, { passive: true });
    window.addEventListener('keydown', stopRestoring);
    window.addEventListener('pagehide', persist);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);

    return () => {
      persist();
      cancelRestore.current = null;
      observer?.disconnect();
      root.removeEventListener('animationend', restore);
      window.removeEventListener('resize', restore);
      window.removeEventListener('scroll', trackScroll);
      window.removeEventListener('pointerdown', stopRestoring);
      window.removeEventListener('touchstart', stopRestoring);
      window.removeEventListener('wheel', stopRestoring);
      window.removeEventListener('keydown', stopRestoring);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [date, ready, rootRef, userId]);

  return cancelRestore;
}
