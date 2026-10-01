/** Short-lived, memory-only reads. Never keep a failed request or revive an invalidated entry. */
export function createReadCache<T>(ttlMs: number, maxEntries = 100) {
  const entries = new Map<string, { promise: Promise<T>; expiresAt: number }>();
  return {
    clear: () => entries.clear(),
    read(key: string, load: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.promise;
      entries.delete(key);
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      const entry = { promise: Promise.resolve().then(load), expiresAt: Infinity };
      entry.promise = entry.promise.then((value) => {
        entry.expiresAt = Date.now() + ttlMs;
        return value;
      }, (error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      return entry.promise;
    },
  };
}
