type ErrorLike = { message?: unknown; name?: unknown; code?: unknown; status?: unknown };
export type ConnectionIssue = 'offline' | 'timeout' | 'interrupted' | 'busy' | 'unavailable' | 'service-slow' | 'cancelled';
const messages: Record<ConnectionIssue, string> = {
  offline: 'You appear to be offline. Reconnect to the internet, then try again.',
  timeout: 'The connection is taking too long. Check your internet connection, then try again.',
  interrupted: 'The connection was interrupted before this could finish. Check your internet connection and try again.',
  busy: 'Full Circle is receiving many requests. Please wait a moment before trying again.',
  unavailable: 'Full Circle is temporarily unable to respond. Please try again shortly.',
  'service-slow': 'Full Circle is taking longer than usual to load this information. Please try again shortly.',
  cancelled: 'This request was interrupted. Please try again when you are ready.',
};

export function connectionIssue(error: unknown, options: { offline?: boolean; timedOut?: boolean } = {}): ConnectionIssue | null {
  const value = error && typeof error === 'object' ? error as ErrorLike : {};
  const text = typeof error === 'string' ? error : String(value.message || '');
  const status = Number(value.status);
  const transport = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network.*(?:lost|error)|connection.*(?:closed|reset|lost|terminated)|ECONN|ENOTFOUND|ERR_NETWORK|FunctionsFetchError/i.test(`${value.name || ''} ${text}`);
  if (status === 429) return 'busy';
  if (status === 504 || value.code === '57014' || /statement timeout|query.*timed out/i.test(text)) return 'service-slow';
  if (status === 502 || status === 503) return 'unavailable';
  if (options.timedOut || status === 408 || /timeout|timed out|took too long/i.test(text)) return options.offline ? 'offline' : 'timeout';
  if (transport) return options.offline ? 'offline' : 'interrupted';
  if (value.name === 'AbortError') return 'cancelled';
  return null;
}

export function userFacingError(error: unknown, fallback = 'This could not be completed. Please try again.'): string {
  const kind = connectionIssue(error, { offline: typeof navigator !== 'undefined' && navigator.onLine === false });
  if (kind) return messages[kind];
  const value = error && typeof error === 'object' ? error as ErrorLike : {};
  const message = typeof error === 'string' ? error : typeof value.message === 'string' ? value.message : '';
  if (!message || /syntax error|unexpected token|invalid.*response|schema cache|SQLSTATE|PostgREST|TypeError|ReferenceError|violates.*constraint|database request failed|<html|<!doctype|stack trace/i.test(message)) return fallback;
  return message;
}

export function connectionError(error: unknown, options: { offline?: boolean; timedOut?: boolean } = {}): Error {
  const kind = connectionIssue(error, { offline: typeof navigator !== 'undefined' && navigator.onLine === false, ...options });
  if (!kind) return error instanceof Error ? error : new Error(userFacingError(error));
  const readable = Object.assign(new Error(messages[kind]), { cause: error });
  // PostgREST stringifies thrown fetch errors. An empty name avoids a technical prefix.
  readable.name = '';
  return readable;
}

/** Keep status codes and application error fields, but never display a gateway's HTML. */
export async function readableFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (response.ok) return response;
    let body: Record<string, unknown> = {};
    try { body = await response.clone().json(); } catch { /* A gateway may send HTML instead of JSON. */ }
    const kind = connectionIssue({ ...body, status: response.status });
    if (!kind) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json');
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    return new Response(JSON.stringify({ ...body, message: messages[kind], error: messages[kind] }), { status: response.status, statusText: response.statusText, headers });
  } catch (error) { throw connectionError(error); }
}
