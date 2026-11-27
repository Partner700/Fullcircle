import assert from 'node:assert/strict';
import { BIBLE_BOOKS } from '../src/lib/bibleBooks.ts';
import { chapterDiscoveryFacts, passageDiscoveryFacts } from '../src/lib/chapterDiscoveryFacts.ts';

// Local supplements are curated, not a source of fabricated quota-filling facts.
// Whole-Bible database coverage is audited separately by scripture-did-you-know-coverage.sql.
let checked = 0;
for (const book of BIBLE_BOOKS) {
  for (let chapter = 1; chapter <= book.chapters; chapter++) {
    const verses = [{ number: 9999, text: 'Synthetic test verse: no discovery should be invented.' }];
    assert.deepEqual(chapterDiscoveryFacts(book.name, chapter, verses), []);
    checked++;
  }
}
assert.equal(checked, 1189, 'Exercise every chapter of the 66-book canon');
assert.deepEqual(chapterDiscoveryFacts('Psalms', 117, [{ number: 1, text: 'Praise the Lord, all nations!' }]), []);
const verses = [
  { number: 2, text: 'Abimelech addresses the people.' },
  { number: 6, text: 'They make Abimelech king.' },
];
const facts = chapterDiscoveryFacts('Judges', 9, verses);
assert.equal(facts.length, 2);
assert.equal(new Set(facts.map(fact => fact.reference)).size, 2);
assert.ok(facts.every(fact => fact.fact.length > 30 && fact.source_note.includes('Judges')));
const researched = { 'Judges 9:2': { reference: 'Judges 9:2', fact: 'Reviewed database fact', source_note: 'Citation' } };
assert.deepEqual(chapterDiscoveryFacts('Judges', 9, verses, researched).map(f => f.reference), ['Judges 9:6']);
assert.deepEqual(chapterDiscoveryFacts('Judges', 9, verses, {...researched, 'Judges 9:6': {reference:'Judges 9:6',fact:'Reviewed database fact',source_note:'Citation'}}), []);
const passage = [
  { reference: 'Judges 9:2', text: 'Abimelech addresses the people.' },
  { reference: 'Numbers 22:22', text: 'The angel stands against Balaam.' },
  { reference: 'Ruth 1:1', text: 'A synthetic passage without a curated entry.' },
];
const multi = passageDiscoveryFacts(passage);
assert.equal(multi.length, 2);
assert.deepEqual(new Set(multi.map(f => f.reference)), new Set(['Judges 9:2', 'Numbers 22:22']));
assert.deepEqual(passageDiscoveryFacts(passage, researched).map(f=>f.reference), ['Numbers 22:22']);
console.log('All 1,189 canonical chapters checked for non-fabrication; curated selection, precedence and passage filtering verified.');
