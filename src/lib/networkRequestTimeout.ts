const DEFAULT_TIMEOUT_MS = 10_000;
// Password exchanges can exceed the generic REST timeout when GoTrue waits on Postgres.
const AUTH_TOKEN_TIMEOUT_MS = 30_000;
const STORAGE_UPLOAD_TIMEOUT_MS = 90_000;
const SLOW_ARENA_READ_TIMEOUT_MS = 22_000;

/** Some Arena reads take longer than ten seconds under mobile-data congestion.
 * Avoid retrying an already-running slow read and doubling the load. */
export function isSlowArenaRead(input: RequestInfo | URL, method: string): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return /^(GET|HEAD)$/i.test(method)
    && /\/rest\/v1\/(?:arena_rooms|arena_journey_games)(?:[?#]|$)/.test(url);
}

export function networkAttemptTimeout(input: RequestInfo | URL, method: string): number {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^(POST|PUT|PATCH)$/i.test(method) && /\/storage\/v1\/object\/avatars\//.test(url)) {
    return STORAGE_UPLOAD_TIMEOUT_MS;
  }
  if (/^POST$/i.test(method) && /\/auth\/v1\/(?:token|signup)(?:[/?#]|$)/.test(url)) {
    return AUTH_TOKEN_TIMEOUT_MS;
  }
  return isSlowArenaRead(input, method) ? SLOW_ARENA_READ_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}
