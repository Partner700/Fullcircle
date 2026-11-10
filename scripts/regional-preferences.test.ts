import assert from 'node:assert/strict';
import { interfaceLanguage, preferredTimeZone, regionalDateTime } from '../src/lib/regionalPreferences.ts';
import { fetchEditionVerses, readScriptureEdition } from '../src/lib/scriptureEditions.ts';

assert.equal(interfaceLanguage(null, 'fr-CM'), 'fr');
assert.equal(interfaceLanguage('en', 'fr-CM'), 'en');
assert.equal(readScriptureEdition(undefined, 'fr-CM'), 'lsg');
assert.equal(preferredTimeZone('not-a-time-zone'), preferredTimeZone());

const instant = '2026-07-01T20:00:00Z';
const parts = { day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' } as const;
assert.match(regionalDateTime(instant, { timezone: 'Africa/Douala', language_code: 'en' }, parts), /21:00/);
assert.match(regionalDateTime(instant, { timezone: 'America/New_York', language_code: 'en' }, parts), /16:00/);
assert.match(regionalDateTime('2026-01-01T20:00:00Z', { timezone: 'America/New_York', language_code: 'en' }, parts), /15:00/);
assert.match(regionalDateTime(instant, { timezone: 'Asia/Tokyo', language_code: 'fr' }, { dateStyle: 'long' }), /2 juillet/);

const requests: string[] = [];
const request: typeof fetch = async (input) => {
  requests.push(String(input));
  if (String(input).includes('/psalms/')) return Response.json({ data: { version: 'web', verse: 1, verses: ['Different edition'] } });
  return Response.json({
    data: { version: 'lsg', verse: 16, verses: ['First verse', 'Second verse', 'Third verse'] },
    meta: { copyright: 'Edition credit' },
  });
};
const { translations, credit } = await fetchEditionVerses(
  'lsg', ['John 3:16', 'John 3:18', 'Psalms 1:1', 'Invalid reference'], new AbortController().signal, request,
);
assert.deepEqual(requests, [
  'https://api.midvash.com/v1/lsg/john/3/16-18',
  'https://api.midvash.com/v1/lsg/psalms/1/1',
]);
assert.deepEqual([...translations], [['John 3:16', 'First verse'], ['John 3:18', 'Third verse']]);
assert.equal(credit, 'Edition credit');
console.log('Regional preferences, daylight saving, and Scripture edition checks passed.');
