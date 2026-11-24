import assert from 'node:assert/strict';
import { BIBLE_BOOKS, parseBibleReadingReference, validBibleReadingLocation } from '../src/lib/bibleBooks.ts';
import { readBibleReadingLocation, saveBibleReadingLocation } from '../src/lib/bibleReadingLocation.ts';

const book = (name: string) => BIBLE_BOOKS.findIndex(item => item.name === name);
assert.deepEqual(parseBibleReadingReference('2 Samuel 7:8–16'), {bookIndex:book('2 Samuel'),chapter:7,verse:8});
assert.deepEqual(parseBibleReadingReference('Judges 3:23-30'), {bookIndex:book('Judges'),chapter:3,verse:23});
assert.deepEqual(parseBibleReadingReference('1Samuel 16–17'), {bookIndex:book('1 Samuel'),chapter:16});
assert.deepEqual(parseBibleReadingReference('Psalm 23'), {bookIndex:book('Psalms'),chapter:23});
assert.deepEqual(parseBibleReadingReference('Jude 5–7'), {bookIndex:book('Jude'),chapter:1,verse:5});
assert.equal(parseBibleReadingReference('John 99:1'), null);
assert.equal(parseBibleReadingReference('Unknown'), null);
assert.equal(validBibleReadingLocation({bookIndex:-1,chapter:1}),null);
assert.equal(validBibleReadingLocation({bookIndex:book('Genesis'),chapter:51}),null);

const storage = new Map<string,string>();
Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}}});
const first={bookIndex:book('John'),chapter:8};
const second={bookIndex:book('Romans'),chapter:5};
saveBibleReadingLocation('one',first);saveBibleReadingLocation('two',second);
assert.deepEqual(readBibleReadingLocation('one'),first);
assert.deepEqual(readBibleReadingLocation('two'),second);
assert.deepEqual(readBibleReadingLocation('other'),{bookIndex:0,chapter:1});
saveBibleReadingLocation('one',{bookIndex:book('John'),chapter:999});
assert.deepEqual(readBibleReadingLocation('one'),first);
Object.defineProperty(globalThis,'window',{configurable:true,value:{get localStorage(){throw Error('Storage denied');}}});
assert.deepEqual(readBibleReadingLocation('one'),{bookIndex:0,chapter:1});
saveBibleReadingLocation('one',first);
console.log('Bible reference parsing, saved location, account isolation and storage resilience passed.');
