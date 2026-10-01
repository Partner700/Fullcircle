type Metric = { requests: number; failures: number; decodedBytes: number; incompleteSamples: number; elapsedMs: number };
const MAX_SAMPLE_BYTES = 2 * 1024 * 1024;

// Route names only: never log filters, IDs, request bodies, headers or response contents.
export function diagnosticRoute(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'rest' && parts[1] === 'v1') {
    const name = parts[2] === 'rpc' ? parts[3] : parts[2];
    return /^[a-z_][a-z0-9_]*$/i.test(name || '') ? `database/${name}` : 'database';
  }
  return ['auth', 'storage', 'functions'].includes(parts[0]) ? parts[0] : 'other';
}

export function createEgressDiagnostics() {
  const metrics = new Map<string, Metric>();
  let generation = 0;
  return {
    reset() { generation++; metrics.clear(); },
    report() {
      return [...metrics].map(([route, metric]) => ({ route, ...metric }))
        .sort((a, b) => b.decodedBytes - a.decodedBytes);
    },
    async record(input: RequestInfo | URL, method: string, response: Response | null, elapsedMs: number) {
      const route = `${method} ${diagnosticRoute(input)}`;
      const metric = metrics.get(route) || { requests: 0, failures: 0, decodedBytes: 0, incompleteSamples: 0, elapsedMs: 0 };
      metrics.set(route, metric);
      metric.requests++;
      metric.failures += response?.ok ? 0 : 1;
      metric.elapsedMs += elapsedMs;
      // Auth payloads are deliberately not copied, even in development.
      if (!response || route.endsWith(' auth') || !response.body) return;
      const version = generation;
      let bytes = 0;
      const reader = response.clone().body!.getReader();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5000);
      let complete = false;
      try {
        while (bytes < MAX_SAMPLE_BYTES) {
          const part = await reader.read();
          if (part.done) { complete = !timedOut; break; }
          bytes += part.value.byteLength;
        }
      } catch { /* Diagnostics must not interfere with a real request. */ }
      finally {
        clearTimeout(timeout);
        if (!complete) void reader.cancel().catch(() => undefined);
        if (generation === version) {
          metric.decodedBytes += bytes;
          metric.incompleteSamples += complete ? 0 : 1;
        }
      }
    },
  };
}
