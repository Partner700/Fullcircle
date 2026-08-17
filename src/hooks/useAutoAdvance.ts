import { useEffect, useRef } from 'react';

/** Keeps rotating UI alive after mobile browsers suspend and resume the page. */
export function useAutoAdvance(enabled: boolean, advance: () => void, delayMs = 6000) {
  const advanceRef = useRef(advance);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => {
        advanceRef.current();
        schedule();
      }, delayMs);
    };
    const handleVisibilityChange = () => schedule();

    schedule();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [delayMs, enabled]);
}
