const DEFAULT_TIMEOUT_MS = 10_000;
const STORAGE_UPLOAD_TIMEOUT_MS = 90_000;

export function networkAttemptTimeout(input: RequestInfo | URL, method: string): number {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return /^(POST|PUT|PATCH)$/i.test(method) && /\/storage\/v1\/object\/avatars\//.test(url)
    ? STORAGE_UPLOAD_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}
