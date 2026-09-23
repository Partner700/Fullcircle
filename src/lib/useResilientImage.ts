import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const RETRY_DELAYS_MS = [500, 1_500, 4_000];

function retrySource(source: string, attempt: number) {
  if (!source || attempt === 0 || /^(?:data|blob):/i.test(source)) return source;

  try {
    const url = new URL(source, window.location.href);
    url.searchParams.set('fc-image-retry', String(attempt));
    return url.href;
  } catch {
    return source;
  }
}

export function useResilientImage(source?: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<number | null>(null);
  const needsRetry = useRef(false);

  const clearRetryTimer = useCallback(() => {
    if (retryTimer.current === null) return;
    window.clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  useEffect(() => {
    clearRetryTimer();
    needsRetry.current = false;
    setAttempt(0);
    setFailed(false);
  }, [clearRetryTimer, source]);

  useEffect(() => {
    const retryWhenOnline = () => {
      if (!needsRetry.current) return;
      clearRetryTimer();
      setFailed(false);
      setAttempt((current) => current + 1);
    };
    window.addEventListener('online', retryWhenOnline);
    return () => {
      window.removeEventListener('online', retryWhenOnline);
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  const onError = useCallback(() => {
    if (!source || retryTimer.current !== null) return;
    needsRetry.current = true;
    const retryIndex = Math.min(attempt, RETRY_DELAYS_MS.length);
    if (retryIndex >= RETRY_DELAYS_MS.length) {
      setFailed(true);
      return;
    }

    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      setAttempt((current) => current + 1);
    }, RETRY_DELAYS_MS[retryIndex]);
  }, [attempt, source]);

  const onLoad = useCallback(() => {
    clearRetryTimer();
    needsRetry.current = false;
    setFailed(false);
  }, [clearRetryTimer]);

  const resolvedSource = useMemo(
    () => retrySource(String(source || ''), attempt),
    [attempt, source],
  );

  return { failed, onError, onLoad, source: resolvedSource };
}
