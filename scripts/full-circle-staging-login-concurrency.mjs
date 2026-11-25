// Full Circle dedicated staging only: real password-login concurrency probe.
// Usage: FULL_CIRCLE_ALLOW_STAGING_TEST=yes FULL_CIRCLE_STAGING_SUPABASE_URL=...
// FULL_CIRCLE_STAGING_PUBLISHABLE_KEY=... FULL_CIRCLE_TEST_ACCOUNTS_FILE=/private/test-users.json
// node scripts/full-circle-staging-login-concurrency.mjs
// Accounts file: [{ "email": "test1@...", "password": "..." }, ...]
// Use synthetic staging-only identities. Never commit credentials, production keys,
// or real users' passwords. No production API calls are permitted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = (process.env.FULL_CIRCLE_STAGING_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.FULL_CIRCLE_STAGING_PUBLISHABLE_KEY || '';
const accountsPath = process.env.FULL_CIRCLE_TEST_ACCOUNTS_FILE || '';
assert.equal(process.env.FULL_CIRCLE_ALLOW_STAGING_TEST, 'yes', 'Staging test must be explicitly enabled');
assert.match(base, /^https:\/\/[a-z0-9-]+\.supabase\.co$/i, 'Expected exact staging Supabase origin');
for (const forbidden of [
  'ovusyeqbmtvfcrlflrbf', // Full Circle v3 production
  'nffqohxdelaglrmuzjwb', // historic Full Circle production
]) assert.ok(!base.includes(forbidden), 'Production Supabase URL refused');
assert.ok(key.startsWith('sb_publishable_') || key.startsWith('eyJ'), 'A staging publishable key is required');
assert.ok(accountsPath, 'Provide a private, locally stored staging test account JSON file');
const accounts = JSON.parse(await readFile(accountsPath, 'utf8'));
assert.ok(Array.isArray(accounts), 'Credentials JSON must be an array');
const desired = (process.env.LOAD_CHECK_USERS || '10,25,50').split(',')
  .map(x => Number.parseInt(x.trim(), 10)).filter(n => Number.isInteger(n) && n > 0 && n <= 100);
assert.ok(desired.length > 0, 'Specify at least one size from 1–100');
assert.ok(accounts.length >= Math.max(...desired), 'Prepare one distinct synthetic staging account per concurrent user');
assert.ok(new Set(accounts.map(x => x.email)).size === accounts.length, 'Accounts must have unique emails');
for (const user of accounts) {
  assert.ok(typeof user.email === 'string' && typeof user.password === 'string' && user.password.length > 0);
}

async function login(user) {
  const started = performance.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 35_000);
  try {
    const result = await fetch(base + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
      signal: controller.signal,
    });
    const payload = await result.json().catch(() => ({}));
    return { ok: result.ok && Boolean(payload.access_token), status: result.status,
      ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, status: 'network-error', ms: Math.round(performance.now() - started),
      reason: error?.name === 'AbortError' ? 'timeout' : 'connection' };
  } finally {
    clearTimeout(deadline);
  }
}

const results = [];
for (const count of desired) {
  // A fresh test account for every participant in this wave; each request
  // is a real authentication exchange, not an Auth /health probe.
  const wave = await Promise.all(accounts.slice(0, count).map(login));
  const sorted = wave.map(x => x.ms).sort((a, b) => a - b);
  const bad = wave.filter(x => !x.ok);
  const record = {
    users: count,
    passed: wave.length - bad.length,
    failed: bad.length,
    p95_ms: sorted[Math.ceil(sorted.length * .95) - 1],
    max_ms: sorted.at(-1),
    error_codes: bad.reduce((acc, x) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, {}),
  };
  results.push(record);
  // Do not escalate load in an already failing staging environment.
  if (bad.length) break;
  await new Promise(resolve => setTimeout(resolve, 1_500));
}
console.log(JSON.stringify({ staging: true, results }, null, 2));
if (results.some(x => x.failed)) process.exitCode = 1;
