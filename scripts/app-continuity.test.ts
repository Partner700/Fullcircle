import assert from 'node:assert/strict';
import {
  persistContinuedScroll,
  persistContinuedTab,
  readContinuedScroll,
  readContinuedTab,
} from '../src/lib/appContinuity.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const localStorage = new MemoryStorage();
const browserWindow = {
  localStorage,
  sessionStorage: new MemoryStorage(),
  location: { hash: '' },
};
Object.defineProperty(globalThis, 'window', { value: browserWindow, configurable: true });

const tabs = ['dashboard', 'narrative', 'quiz'] as const;

persistContinuedTab('reader-a', 'cadet', 'narrative', ['quiz']);
persistContinuedScroll('reader-a', 'cadet', 'narrative', 874, ['quiz']);
assert.equal(readContinuedTab('reader-a', 'cadet', tabs, 'dashboard', ['quiz']), 'narrative');
assert.equal(readContinuedScroll('reader-a', 'cadet', 'narrative'), 874);

persistContinuedTab('reader-a', 'cadet', 'quiz', ['quiz']);
persistContinuedScroll('reader-a', 'cadet', 'quiz', 500, ['quiz']);
assert.equal(readContinuedTab('reader-a', 'cadet', tabs, 'dashboard', ['quiz']), 'narrative');
assert.equal(readContinuedScroll('reader-a', 'cadet', 'quiz'), null);

browserWindow.location.hash = '#fc-tab=quiz';
assert.equal(readContinuedTab('reader-a', 'cadet', tabs, 'dashboard', ['quiz']), 'quiz');

browserWindow.location.hash = '';
assert.equal(readContinuedTab('reader-b', 'cadet', tabs, 'dashboard', ['quiz']), 'dashboard');

console.log('App continuation tests passed.');
