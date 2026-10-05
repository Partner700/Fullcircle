import { createClient } from '@supabase/supabase-js';
import { createEgressDiagnostics } from './egressDiagnostics';

const diagnostics = import.meta.env.DEV ? createEgressDiagnostics() : null;
if (diagnostics && typeof window !== 'undefined') {
  Object.assign(window, { fullCircleEgress: diagnostics });
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building.'
    : null;

const NETWORK_ATTEMPT_TIMEOUT_MS = 10_000;
const RETRYABLE_RESPONSE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForApiBody(response: Response, method: string) {
  if (method === 'HEAD' || !response.body) return;
  const contentType = response.headers.get('content-type') || '';
  if (!/(?:json|text\/|vnd\.pgrst)/i.test(contentType)) return;
  // fetch() resolves when headers arrive. Reading a clone keeps the deadline
  // active until the small Auth/REST/Function payload has actually arrived,
  // while preserving the original Response for supabase-js to consume.
  await response.clone().arrayBuffer();
}

/**
 * Mobile carriers occasionally leave a request pending instead of reporting a
 * disconnect. Bound every attempt and retry read-only requests once so screens
 * recover without asking the person to refresh the whole application.
 */
async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = requestMethod(input, init);
  const canRetry = method === 'GET' || method === 'HEAD';
  const attempts = canRetry ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const upstreamSignal = init?.signal
      || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    const relayAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) relayAbort();
    else upstreamSignal?.addEventListener('abort', relayAbort, { once: true });

    const timeout = window.setTimeout(() => controller.abort(), NETWORK_ATTEMPT_TIMEOUT_MS);
    try {
      const requestInput = typeof Request !== 'undefined' && input instanceof Request
        ? input.clone()
        : input;
      const response = await fetch(requestInput, { ...init, signal: controller.signal });
      await waitForApiBody(response, method);
      void diagnostics?.record(input, method, response, Date.now() - startedAt).catch(() => undefined);
      if (canRetry && attempt === 0 && RETRYABLE_RESPONSE_STATUSES.has(response.status)) {
        await pause(350);
        continue;
      }
      return response;
    } catch (error) {
      void diagnostics?.record(input, method, null, Date.now() - startedAt).catch(() => undefined);
      lastError = error;
      if (!canRetry || attempt === attempts - 1 || upstreamSignal?.aborted) throw error;
      await pause(350);
    } finally {
      window.clearTimeout(timeout);
      upstreamSignal?.removeEventListener('abort', relayAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('The network request could not finish.');
}

export const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseAnonKey || 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: resilientFetch,
  },
});
