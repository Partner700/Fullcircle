import type { ScriptureDidYouKnow } from '../components/InstructorVerseExtras';

/**
 * Scripture-grounded chapter coverage.
 *
 * These are reading observations, NOT claims of external archaeological evidence,
 * Hebrew/Greek etymology or scholarly consensus. Every statement is derived from
 * the actual verses in the reader's chosen translation.
 */
export type ChapterDiscoveryVerse = { number: number; text: string };
type Candidate = ScriptureDidYouKnow & { score: number; anchor: number };

const removeMarkup = (text: string) => text
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const shortQuote = (text: string, limit = 100) => {
  const clean = removeMarkup(text).replace(/^[0-9]+[.:]\s*/, '');
  return clean.length <= limit ? clean : clean.slice(0, limit).replace(/\s+\S*$/, '') + '…';
};
const COMMON = new Set([
  'about','after','again','against','among','another','because','before','being','between',
  'came','come','could','each','every','from','gave','give','going','good','great','have',
  'having','into','just','know','land','like','made','make','many','more','most','much',
  'must','neither','never','only','other','over','said','same','shall','should','some',
  'such','take','than','that','their','them','there','these','they','thing','those',
  'through','thus','time','unto','upon','very','were','what','when','where','which',
  'while','will','with','would','your','yours','then','this','therefore','himself',
  'herself','ourselves','themself','him','her','his','she','thee','thou','thy','ye',
  'the','and','for','are','but','not','has','had','who','all','you','our','was',
  'one','two','three','four','five','six','seven','eight','nine','ten','god',
  'lord','jesus','christ','son','man','men','people','children','israel','king',
  'day','days','word','words','name','names','house','hand','hands','eyes',
]);
const GLOSSARY: ReadonlyArray<[RegExp, string, string]> = [
  [/\bmiddle watch\b/i, 'middle watch', 'the middle overnight guard shift. In an ancient three-watch night, it was approximately 10 PM–2 AM, although the hours varied by season'],
  [/\bfourth watch\b/i, 'fourth watch', 'the last watch before sunrise in a four-watch night, roughly 3 AM–6 AM'],
  [/\bmorning watch\b/i, 'morning watch', 'the final overnight guard shift before daybreak'],
  [/\bfirst watch\b/i, 'first watch', 'the first portion of the night assigned to watchmen'],
  [/\bcubit(s)?\b/i, 'cubit', 'a length based on the forearm, commonly around 45 cm or 18 inches, though ancient cubit standards differed'],
  [/\bshekel(s)?\b/i, 'shekel', 'originally a measure of weight used for silver and other goods, not necessarily a stamped coin'],
  [/\bephah(s)?\b/i, 'ephah', 'an ancient measure for dry goods such as grain; estimates of its exact volume vary'],
  [/\bhomer(s)?\b/i, 'homer', 'a large ancient dry-volume measure, related to grain and other provisions'],
  [/\bdenari(us|i)\b/i, 'denarius', 'a Roman silver coin; in one parable it is the wage paid for a day of labor'],
  [/\btalent(s)?\b/i, 'talent', 'a very large ancient unit of weight, often used to measure precious metals and enormous sums'],
  [/\bmite(s)?\b/i, 'mite', 'an extremely small coin, used in older English translations to describe a tiny offering'],
  [/\bsabbath\b/i, 'Sabbath', 'the designated day of rest in Israel\'s weekly rhythm, beginning at sunset'],
  [/\btabernacle\b/i, 'tabernacle', 'a movable sacred tent associated with worship and the presence of God among Israel'],
  [/\bcovenant\b/i, 'covenant', 'a binding relationship or agreement carrying promises and responsibilities, much stronger than a casual promise'],
  [/\bsynagogue\b/i, 'synagogue', 'a local Jewish meeting place for prayer, reading Scripture, and teaching'],
  [/\bcenturion\b/i, 'centurion', 'a Roman officer whose title was connected to a unit traditionally associated with about one hundred soldiers'],
  [/\bpublican(s)?\b/i, 'publican', 'an older English term for a tax collector, someone working in the tax system'],
  [/\bscribe(s)?\b/i, 'scribe', 'someone trained to write, copy, read, or interpret important texts and records'],
  [/\bpharisee(s)?\b/i, 'Pharisee', 'a member of an influential Jewish religious movement in the Second Temple period'],
  [/\bsackcloth\b/i, 'sackcloth', 'coarse cloth worn in public mourning, grief, or repentance'],
  [/\bthreshing floor\b/i, 'threshing floor', 'a flat place where harvested grain was separated from its stalks'],
  [/\bwinepress\b/i, 'winepress', 'a place or installation where grapes were crushed to collect their juice'],
  [/\byoke\b/i, 'yoke', 'a wooden fitting joining work animals; the word could also picture burden, obedience, or shared work'],
  [/\bsepulch(re|er)\b/i, 'sepulchre', 'an older English word for a tomb or burial place'],
  [/\blampstand\b/i, 'lampstand', 'a stand holding lamps or lights; it was not a modern electric light fixture'],
  [/\btimbrel\b/i, 'timbrel', 'a small frame drum or tambourine-like instrument used in music and celebration'],
  [/\bfrankincense\b/i, 'frankincense', 'an aromatic tree resin that was burned for its fragrance, including in worship'],
  [/\bmyrrh\b/i, 'myrrh', 'a fragrant tree resin used in perfumes, anointing, and burial preparations'],
  [/\bhyssop\b/i, 'hyssop', 'a plant name connected with sprinkling and purification practices in the Bible; its precise botanical identification is debated'],
  [/\binn\b/i, 'inn', 'a lodging place in modern English; the original biblical terms may also refer to a guest room depending on the passage'],
  [/\bprison\b/i, 'prison', 'confinement in the ancient world, often under conditions very different from modern correctional institutions'],
];
const VERBS = ['asked', 'answered', 'said', 'spoke', 'called', 'cried', 'prayed', 'replied', 'told'];
const BOOK_FAMILIES = {
  poetry: /^(Psalms|Proverbs|Job|Ecclesiastes|Song of Solomon)$/,
  prophetic: /^(Isaiah|Jeremiah|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi)$/,
  epistle: /^(Romans|[12] Corinthians|Galatians|Ephesians|Philippians|Colossians|[12] Thessalonians|[12] Timothy|Titus|Philemon|Hebrews|James|[123] John|[12] Peter|Jude)$/,
};

/** Returns only the missing discoveries; established, researched entries always win. */
export function chapterDiscoveryFacts(
  book: string, chapter: number, verses: ChapterDiscoveryVerse[],
  researched: Record<string, ScriptureDidYouKnow> = {},
  required = 2,
): ScriptureDidYouKnow[] {
  const chapterRef = `${book} ${chapter}`;
  const cleaned = verses.filter(v => Number.isInteger(v.number) && v.number > 0 && removeMarkup(v.text));
  if (!cleaned.length) return [];
  const existing = new Set(cleaned.map(v => `${chapterRef}:${v.number}`).filter(ref => researched[ref]));
  const needed = Math.max(0, required - existing.size);
  if (!needed) return [];
  const candidates: Candidate[] = [];
  const add = (anchor: number, score: number, fact: string, category: ScriptureDidYouKnow['category'] = 'scripture_detail') => {
    const reference = `${chapterRef}:${anchor}`;
    if (existing.has(reference)) return;
    if (candidates.some(item => item.reference === reference && item.fact === fact)) return;
    candidates.push({ reference, anchor, score, fact, category,
      source_note: `${reference}, based on the Scripture wording shown in your selected edition. This is a direct reading observation, not an archaeological or scholarly-consensus claim.` });
  };
  // First preference: explain language actually present in THIS chapter.
  for (const verse of cleaned) {
    for (const [pattern, term, meaning] of GLOSSARY) {
      if (!pattern.test(verse.text)) continue;
      add(verse.number, 100, `In today's words, “${term}” means ${meaning}. Look at how the expression is used in verse ${verse.number}.`, 'plain_language');
      break;
    }
  }
  // A question in the passage is evidence, not an invented interpretation.
  for (const verse of cleaned) {
    if (!/[?？]/.test(verse.text)) continue;
    const question = removeMarkup(verse.text).split(/[?？]/)[0].split(/[.!]/).pop()?.trim() || '';
    if (question.length > 12) add(verse.number, 80,
      `This chapter includes a real question in verse ${verse.number}: “${shortQuote(question, 105)}?” Watch how the surrounding verses address it; the question itself is part of what the author chose to record.`, 'scripture_detail');
  }
  // An explicit time or number can help modern readers picture the scene.
  for (const verse of cleaned) {
    const matching = verse.text.match(/\b(?:first|second|third|fourth|seventh|tenth|twelfth|forty|fifty|hundred|thousand|night|morning|evening|midnight|hour|years?|months?|weeks?)\b/i);
    if (!matching) continue;
    add(verse.number, 55,
      `A small time or number clue appears in verse ${verse.number}: “${shortQuote(verse.text, 95)}” These details help place the action or instruction in its own setting; don't skip them when reading.`, 'scripture_detail');
  }
  // Distinctive repeated words: a precise, checkable observation in the selected translation.
  const wordVerses = new Map<string, Set<number>>();
  for (const verse of cleaned) {
    for (const word of new Set((removeMarkup(verse.text).toLowerCase().match(/[a-z]{4,}/g) || []))) {
      if (COMMON.has(word) || word.endsWith('eth')) continue;
      const hits = wordVerses.get(word) || new Set<number>();
      hits.add(verse.number);
      wordVerses.set(word, hits);
    }
  }
  const repeated = [...wordVerses].filter(([, refs]) => refs.size >= 2)
    .sort((a,b) => b[1].size - a[1].size || b[0].length - a[0].length).slice(0, 3);
  for (const [word, refs] of repeated) {
    const first = [...refs][0];
    add(first, 60,
      `Did you notice the repeated word “${word}”? It appears in ${refs.size} different verses of ${chapterRef} in this Bible edition. Read each occurrence to see how the chapter develops the idea.`, 'scripture_detail');
  }
  // Literary markers in biblical poetry, prophecy and letters differ in purpose.
  for (const verse of cleaned) {
    const line = removeMarkup(verse.text);
    if (/\b(?:but|yet|however|nevertheless)\b/i.test(line)) {
      add(verse.number, 45, `Verse ${verse.number} turns on a contrast: “${shortQuote(line, 115)}” The small word marking the contrast can change how the sentence is understood.`, 'scripture_detail');
    } else if (BOOK_FAMILIES.poetry.test(book) && /\b(?:like|as)\b/i.test(line)) {
      add(verse.number, 45, `This poetic chapter uses a comparison in verse ${verse.number}: “${shortQuote(line, 115)}” Biblical poetry often teaches by inviting the reader to picture something concrete.`, 'scripture_detail');
    } else if (BOOK_FAMILIES.epistle.test(book) && /\b(?:therefore|because|so that|for this reason)\b/i.test(line)) {
      add(verse.number, 44, `Verse ${verse.number} connects a reason with a response: “${shortQuote(line, 115)}” Notice how the writer builds an argument rather than giving disconnected sayings.`, 'scripture_detail');
    } else if (BOOK_FAMILIES.prophetic.test(book) && /\b(?:hear|behold|listen|thus says|the word of the lord)\b/i.test(line)) {
      add(verse.number, 44, `Verse ${verse.number} introduces or emphasizes a message: “${shortQuote(line, 115)}” This kind of announcement helps identify who is speaking and whom the warning or promise addresses.`, 'scripture_detail');
    }
  }
  for (const verse of cleaned) {
    if (VERBS.some(verb => new RegExp(`\\b${verb}\\b`, 'i').test(verse.text))) {
      add(verse.number, 30, `A conversation or announcement is recorded in verse ${verse.number}: “${shortQuote(verse.text, 110)}” Pay attention to the speaker before applying the words to yourself.`, 'scripture_detail');
    }
  }
  // A factual structure observation guaranteed even in a very short chapter.
  for (const verse of cleaned) {
    add(verse.number, 15, `An easy-to-miss detail in ${chapterRef} is the wording of verse ${verse.number}: “${shortQuote(verse.text, 105)}” What is stated here, rather than assumed, is the starting point for understanding the passage.`, 'scripture_detail');
  }
  const selected: Candidate[] = [];
  const taken = new Set(existing);
  for (const candidate of candidates.sort((a,b) => b.score - a.score || a.anchor - b.anchor)) {
    if (selected.length >= needed) break;
    if (taken.has(candidate.reference)) continue;
    selected.push(candidate);
    taken.add(candidate.reference);
  }
  // One-verse chapters can contain multiple discoveries without claiming a second verse.
  if (selected.length < needed) {
    const last = cleaned[cleaned.length - 1];
    const first = cleaned[0];
    selected.push({
      reference: `${chapterRef}:${last.number}`, anchor: last.number, score: 5, category: 'scripture_detail',
      fact: `How this chapter is shaped: it opens in verse ${first.number} with “${shortQuote(first.text, 72)}” and closes in verse ${last.number} with “${shortQuote(last.text, 72)}”. Compare the beginning and ending when you reread it.`,
      source_note: `${chapterRef}, based on the opening and closing verses in the selected Bible edition. Text-based observation.`,
    });
  }
  return selected.slice(0, needed).map(({ score: _score, anchor: _anchor, ...item }) => item);
}

/** Daily Reading can span several chapters; give each represented chapter coverage. */
export function passageDiscoveryFacts(
  verses: Array<{ reference: string; text: string }>,
  researched: Record<string, ScriptureDidYouKnow> = {},
): ScriptureDidYouKnow[] {
  const grouped = new Map<string, { book: string; chapter: number; verses: ChapterDiscoveryVerse[] }>();
  for (const verse of verses) {
    const match = verse.reference.match(/^(.+?) (\\d+):(\\d+)$/);
    if (!match || !removeMarkup(verse.text)) continue;
    const book = match[1];
    const chapter = Number(match[2]);
    const verseNumber = Number(match[3]);
    const groupKey = `${book} ${chapter}`;
    const group = grouped.get(groupKey) ?? { book, chapter, verses: [] };
    group.verses.push({ number: verseNumber, text: verse.text });
    grouped.set(groupKey, group);
  }
  return [...grouped.values()].flatMap(group =>
    chapterDiscoveryFacts(group.book, group.chapter, group.verses, researched));
}
