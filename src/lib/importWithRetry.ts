function waitForConnection(delayMs: number) {
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('online', finish);
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, delayMs);
    window.addEventListener('online', finish, { once: true });
  });
}

export async function importWithRetry<T>(loader: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await waitForConnection(650 * (attempt + 1));
    }
  }

  throw lastError;
}
