import assert from 'node:assert/strict';
import { BIBLE_BOOKS } from '../src/lib/bibleBooks.ts';
import { chapterDiscoveryFacts, passageDiscoveryFacts } from '../src/lib/chapterDiscoveryFacts.ts';

let checked = 0;
for (const book of BIBLE_BOOKS) {
  for (let chapter = 1; chapter <= book.chapters; chapter++) {
    const verses = [
      { number: 1, text: 'In the morning the people asked, What shall we do? This is the opening of the account.' },
      { number: 2, text: 'Then they gave an answer, but the people remembered their covenant with the Lord.' },
    ];
    const facts = chapterDiscoveryFacts(book.name, chapter, verses);
    assert.equal(facts.length, 2, `${book.name} ${chapter} must have two discoveries`);
    assert.equal(new Set(facts.map(fact => fact.reference)).size, 2, 'Prefer two separate verses');
    assert.ok(facts.every(fact => fact.fact.length > 30 && fact.source_note.includes(book.name)));
    checked++;
  }
}
assert.equal(checked, 1189, 'Test every chapter of the 66-book canon');
const oneVerse = chapterDiscoveryFacts('Psalms', 117, [{ number: 1, text: 'Praise the Lord, all nations!' }]);
assert.equal(oneVerse.length, 2, 'Even a short passage needs two distinct chapter observations');
assert.notEqual(oneVerse[0].fact, oneVerse[1].fact);
const gloss = chapterDiscoveryFacts('Judges', 7, [
  { number: 19, text: 'Then Gideon came to the middle watch at the guard change.' },
  { number: 20, text: 'They broke the pitchers and lifted torches.' },
]);
assert.ok(gloss.some(fact => fact.fact.includes('overnight guard shift')));
const researched = { 'Judges 7:19': { reference: 'Judges 7:19', fact: 'Research', source_note: 'Citation' } };
assert.equal(chapterDiscoveryFacts('Judges', 7, gloss.map((_, i) =>
  ({ number: 19 + i, text: i ? 'They broke their jars.' : 'Then Gideon came to the middle watch.' })), researched).length, 1);
assert.equal(chapterDiscoveryFacts('Judges', 7, [
  { number: 19, text: 'Then Gideon came to the middle watch.' },
  { number: 20, text: 'They broke their jars.' },
], {
  ...researched, 'Judges 7:20': { reference: 'Judges 7:20', fact: 'Research', source_note: 'Citation' },
}).length, 0);
const multiple = passageDiscoveryFacts([
  { reference: 'Ruth 1:1', text: 'Now it came to pass in the days when the judges ruled.' },
  { reference: 'Ruth 1:2', text: 'A man came from Bethlehem to Moab.' },
  { reference: 'Ruth 2:1', text: 'Naomi had a relative from her husband’s family.' },
  { reference: 'Ruth 2:2', text: 'Ruth said, let me go to the field.' },
]);
assert.equal(multiple.length, 4);
assert.ok(multiple.some(fact => fact.reference.startsWith('Ruth 1:')));
assert.ok(multiple.some(fact => fact.reference.startsWith('Ruth 2:')));
console.log('Chapter discovery coverage tested for all 1,189 Bible chapters, short chapters, existing facts, and multi-chapter readings.');
