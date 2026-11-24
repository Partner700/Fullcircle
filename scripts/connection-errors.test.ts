import assert from 'node:assert/strict';
import { connectionIssue, connectionError, readableFetch, userFacingError } from '../src/lib/connectionErrors.ts';

assert.equal(connectionIssue(new TypeError('Failed to fetch'), { offline: true }), 'offline');
assert.equal(connectionIssue(new TypeError('Load failed')), 'interrupted');
assert.equal(connectionIssue(new DOMException('Aborted', 'AbortError')), 'cancelled');
assert.equal(connectionIssue(new DOMException('Aborted', 'AbortError'), { timedOut: true }), 'timeout');
assert.equal(connectionIssue({ status: 429 }), 'busy');
assert.equal(connectionIssue({ status: 503 }), 'unavailable');
assert.equal(connectionIssue({ status: 504 }), 'service-slow');
assert.equal(connectionIssue({ code: '57014', message: 'canceling statement due to statement timeout' }), 'service-slow');
assert.equal(userFacingError(new Error('Not enough Denarii.')), 'Not enough Denarii.');
assert.equal(userFacingError(new Error('syntax error at or near SELECT'), 'Please try again.'), 'Please try again.');
assert.equal(String(connectionError(new TypeError('Load failed'))).includes('TypeError'), false);
const originalFetch = globalThis.fetch;
try {
  const messages = new Set<string>();
  for (const status of [408, 429, 503, 504]) {
    globalThis.fetch = async () => new Response('<html>upstream failure</html>', { status });
    const response = await readableFetch('https://example.invalid');
    assert.equal(response.status, status);
    const body = await response.json();
    messages.add(body.message);
    assert.ok(!body.message.includes('<html>'));
    assert.equal(body.error, body.message);
  }
  assert.equal(messages.size, 4);
  globalThis.fetch = async () => Response.json({ code: '57014', message: 'statement timeout' }, { status: 500 });
  const slow = await (await readableFetch('https://example.invalid')).json();
  assert.equal(slow.code, '57014');
  assert.match(slow.message, /longer than usual/);
  globalThis.fetch = async () => Response.json({ error: 'Not enough Denarii.' }, { status: 400 });
  assert.deepEqual(await (await readableFetch('https://example.invalid')).json(), { error: 'Not enough Denarii.' });
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => readableFetch('https://example.invalid', { method: 'POST' }), /connection was interrupted/);
  assert.equal(requests, 1, 'Never automatically retry a mutation');
} finally { globalThis.fetch = originalFetch; }
console.log('Distinct connection messages, preserved business errors, and no mutation retries passed.');
