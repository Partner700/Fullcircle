import assert from 'node:assert/strict';
import { readShareDestination, shareDestinationMode, openShareInAppUrl, closeShareUrl } from '../src/lib/shareDestination.ts';

const id = '00000000-0000-4000-8000-000000000001';
for (const kind of ['reading', 'game'] as const) {
  assert.deepEqual(readShareDestination(`?share=${kind}&date=2026-11-06`), { kind, date: '2026-11-06' });
  assert.equal(readShareDestination(`?share=${kind}&date=2026-02-30`), null);
}
for (const kind of ['quiz', 'arena'] as const) {
  assert.deepEqual(readShareDestination(`?share=${kind}&id=${id}`), { kind, id });
  assert.equal(readShareDestination(`?share=${kind}&id=https://other.example`), null);
}
assert.deepEqual(readShareDestination(`?share=birthday&id=${id}&date=2026-11-06`), { kind: 'birthday', id, date: '2026-11-06' });
assert.equal(readShareDestination(`?share=birthday&id=${id}`), null);
assert.equal(readShareDestination('?share=unknown'), null);
assert.equal(shareDestinationMode(false, false, false), 'visitor');
assert.equal(shareDestinationMode(false, true, false), 'sign-in');
assert.equal(shareDestinationMode(false, false, true), 'sign-in');
assert.equal(shareDestinationMode(true, false, false), 'member');
for (const base of ['https://fullcircle.partnertai.com/', 'https://tnsorganization.github.io/Full-Circle/']) {
  const original = `${base}?share=birthday&id=${id}&date=2026-11-06`;
  const opened = openShareInAppUrl(original);
  assert.deepEqual(readShareDestination(new URL(opened).search), readShareDestination(new URL(original).search));
  assert.equal(new URL(opened).origin, new URL(original).origin);
  assert.equal(new URL(opened).pathname, new URL(original).pathname);
  assert.equal(shareDestinationMode(false, false, new URL(opened).searchParams.get('fc-open-app') === '1'), 'sign-in');
  assert.equal(shareDestinationMode(true, false, true), 'member', 'Signing in resumes the retained destination');
  assert.equal(closeShareUrl(opened), base);
}
console.log('Share routing passed: every share kind, exact IDs/dates, visitor/member/sign-in paths, target preservation, both hosts, invalid inputs and return home.');
