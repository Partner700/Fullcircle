import assert from 'node:assert/strict';
import {
  safeJsonStorageGet,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
} from '../src/lib/safeStorage.ts';

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    get localStorage() { throw new DOMException('Storage denied', 'SecurityError'); },
    get sessionStorage() { throw new DOMException('Storage denied', 'SecurityError'); },
  },
});

assert.equal(safeStorageGet('local', 'theme'), null);
assert.equal(safeStorageSet('local', 'theme', 'night'), false);
assert.equal(safeStorageRemove('session', 'target'), false);
assert.deepEqual(safeJsonStorageGet('local', 'broken', { safe: true }), { safe: true });

const values = new Map<string, string>([['broken', '{not-json']]);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage, sessionStorage: storage },
});

assert.deepEqual(safeJsonStorageGet('local', 'broken', []), []);
assert.equal(values.has('broken'), false, 'Malformed storage should be removed instead of crashing every launch.');
assert.equal(safeStorageSet('local', 'theme', 'day'), true);
assert.equal(safeStorageGet('local', 'theme'), 'day');

delete (globalThis as { window?: unknown }).window;
console.log('Mobile storage-denial and malformed-cache resilience checks passed.');
