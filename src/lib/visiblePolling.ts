/** Poll only while visible and online, with at most one request in flight. */
export function startVisiblePolling(load: () => Promise<unknown>, intervalMs: number) {
  let stopped = false;
  let pending = false;
  let timer: number | undefined;
  let lastStartedAt = -Infinity;
  let followUp = false;
  const available = () => document.visibilityState === 'visible' && navigator.onLine !== false;
  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    if (!stopped && available()) timer = window.setTimeout(refresh, delay);
  };
  const refresh = () => {
    if (stopped || !available()) return;
    if (pending) { followUp = true; return; }
    // Focus, online and visibility events often arrive together on a phone.
    const wait = 1000 - (Date.now() - lastStartedAt);
    if (wait > 0) { schedule(wait); return; }
    window.clearTimeout(timer);
    pending = true;
    followUp = false;
    lastStartedAt = Date.now();
    void Promise.resolve().then(load).catch(() => undefined).finally(() => {
      pending = false;
      schedule(followUp ? 1000 : intervalMs);
    });
  };
  const visibility = () => {
    window.clearTimeout(timer);
    if (available()) refresh();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', refresh);
  window.addEventListener('offline', visibility);
  refresh();
  return {
    refresh,
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', visibility);
    },
  };
}
