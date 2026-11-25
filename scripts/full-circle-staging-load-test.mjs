// Conservative load probe for a *separate staging* Supabase project.
// Refuses the production Full Circle project and any URL without staging confirmation.
// Not a password-login test: measures Auth health and REST gateway response latency.
import assert from 'node:assert/strict';

const base = process.env.FULL_CIRCLE_STAGING_SUPABASE_URL || '';
const pubKey = process.env.FULL_CIRCLE_STAGING_PUBLISHABLE_KEY || '';
assert.equal(process.env.FULL_CIRCLE_ALLOW_STAGING_TEST, 'yes', 'Explicit staging permission is required');
assert.match(base, /^https:\/\/[a-z0-9-]+\.supabase\.co$/, 'Supabase staging URL required');
assert.ok(!base.includes('ovusyeqbmtvfcrlflrbf'), 'Never load-test production');
assert.ok(pubKey, 'Staging publishable key required');

const count = Math.min(60, Math.max(1, Number(process.env.LOAD_CHECK_REQUESTS) || 30));
const concurrency = Math.min(5, Math.max(1, Number(process.env.LOAD_CHECK_CONCURRENCY) || 3));
const results = [];
let next = 0;

async function probe() {
  const endpoint = next++ % 2 === 0 ? '/auth/v1/health' : '/rest/v1/';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const start = performance.now();
  try {
    const result = await fetch(base + endpoint, {
      headers: { apikey: pubKey }, signal: controller.signal,
    });
    results.push({ endpoint, status: result.status, ms: Math.round(performance.now() - start),
      success: endpoint === '/auth/v1/health' ? result.ok : result.status < 500 && result.status !== 429 });
  } catch (error) {
    results.push({ endpoint, status: 'network-error', ms: Math.round(performance.now() - start),
      success: false, error: String(error).slice(0, 100) });
  } finally {
    clearTimeout(timeout);
  }
}
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (results.length < count) {
    if (next >= count) return;
    await probe();
  }
}));
const times = results.map(x => x.ms).sort((a, b) => a - b);
const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)];
const errors = results.filter(x => !x.success);
console.log(JSON.stringify({ target: base, total: results.length, errors: errors.length,
  p95_ms: p95, max_ms: times.at(-1), failureExamples: errors.slice(0, 3) }, null, 2));
if (errors.length) process.exitCode = 1;
