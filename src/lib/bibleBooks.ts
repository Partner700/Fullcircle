export const BIBLE_BOOKS = [
  ['Genesis', 50], ['Exodus', 40], ['Leviticus', 27], ['Numbers', 36], ['Deuteronomy', 34],
  ['Joshua', 24], ['Judges', 21], ['Ruth', 4], ['1 Samuel', 31], ['2 Samuel', 24],
  ['1 Kings', 22], ['2 Kings', 25], ['1 Chronicles', 29], ['2 Chronicles', 36],
  ['Ezra', 10], ['Nehemiah', 13], ['Esther', 10], ['Job', 42], ['Psalms', 150],
  ['Proverbs', 31], ['Ecclesiastes', 12], ['Song of Solomon', 8], ['Isaiah', 66],
  ['Jeremiah', 52], ['Lamentations', 5], ['Ezekiel', 48], ['Daniel', 12], ['Hosea', 14],
  ['Joel', 3], ['Amos', 9], ['Obadiah', 1], ['Jonah', 4], ['Micah', 7], ['Nahum', 3],
  ['Habakkuk', 3], ['Zephaniah', 3], ['Haggai', 2], ['Zechariah', 14], ['Malachi', 4],
  ['Matthew', 28], ['Mark', 16], ['Luke', 24], ['John', 21], ['Acts', 28], ['Romans', 16],
  ['1 Corinthians', 16], ['2 Corinthians', 13], ['Galatians', 6], ['Ephesians', 6],
  ['Philippians', 4], ['Colossians', 4], ['1 Thessalonians', 5], ['2 Thessalonians', 3],
  ['1 Timothy', 6], ['2 Timothy', 4], ['Titus', 3], ['Philemon', 1], ['Hebrews', 13],
  ['James', 5], ['1 Peter', 5], ['2 Peter', 3], ['1 John', 5], ['2 John', 1],
  ['3 John', 1], ['Jude', 1], ['Revelation', 22],
].map(([name, chapters]) => ({
  name: name as string,
  chapters: chapters as number,
  slug: String(name).toLowerCase().replace(/ /g, '-'),
}));

export function canonicalBibleVerseReference(reference: string): string | null {
  const match = reference.trim().match(/^(.+?)\s+(\d+)\s*:\s*(\d+)$/);
  if (!match) return null;
  const name = match[1].toLowerCase().replace(/\s+/g, ' ').replace(/^([1-3])(?=\S)/, '$1 ');
  const bookName = name === 'psalm' ? 'psalms' : name === 'song of songs' ? 'song of solomon' : name;
  const book = BIBLE_BOOKS.find((entry) => entry.name.toLowerCase() === bookName);
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  if (!book || chapter < 1 || chapter > book.chapters || verse < 1) return null;
  return `${book.name} ${chapter}:${verse}`;
}
