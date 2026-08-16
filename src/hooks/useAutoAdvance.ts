import { useEffect, useRef } from 'react';

/** Keeps rotating UI alive after mobile browsers suspend and resume the page. */
export function useAutoAdvance(enabled: boolean, advance: () => void, delayMs = 6000) {
  const advanceRef = useRef(advance);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useEffect(() => {
    if (!enabled) return;
    let nextAdvanceAt = Date.now() + delayMs;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now < nextAdvanceAt) return;
      advanceRef.current();
      nextAdvanceAt = now + delayMs;
    };
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      tick();
      nextAdvanceAt = Date.now() + delayMs;
    };

    const interval = window.setInterval(tick, Math.min(1000, delayMs));
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [delayMs, enabled]);
}
