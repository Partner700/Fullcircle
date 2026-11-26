import type { ScriptureDidYouKnow } from '../components/InstructorVerseExtras';

export type ChapterDiscoveryVerse = { number: number; text: string };

// Never manufacture a discovery from verse wording to meet a coverage quota.
// Reviewed database entries are displayed separately by InstructorVerseExtras.
// This supplementary collection is reserved for individually authored discoveries.
const curated: ScriptureDidYouKnow[] = [
 {reference:'Judges 9:2',category:'original_language',fact:'Abimelech’s name contains the Hebrew words av (father) and melech (king), commonly understood as “my father is king.” This is particularly striking because Gideon had refused the offer of hereditary rule in Judges 8:23. The narrator records Abimelech’s name before his bid for power.',source_note:'Judges 8:23, 8:31; 9:2; Brown–Driver–Briggs Hebrew Lexicon, Abimelech (H40).'},
 {reference:'Judges 9:6',category:'scripture_detail',fact:'Shechem already had a long association with public covenant ceremonies before Abimelech was crowned there. Joshua 24 records the assembly of Israel at Shechem and the setting up of a large stone under an oak. Judges 9 describes a coronation near a pillar or standing stone. The passages do not establish that these were the same stone, but they reveal the political and covenant significance of the location.',source_note:'Joshua 24:1, 25–27; Judges 9:6. Biblical geographical and narrative context.'},
];
export function chapterDiscoveryFacts(book:string,chapter:number,verses:ChapterDiscoveryVerse[],researched:Record<string,ScriptureDidYouKnow>={},_required=2):ScriptureDidYouKnow[]{
 const refs=new Set(verses.map(v=>book+' '+chapter+':'+v.number));
 return curated.filter(fact=>refs.has(fact.reference)&&!researched[fact.reference]);
}
export function passageDiscoveryFacts(verses:Array<{reference:string;text:string}>,researched:Record<string,ScriptureDidYouKnow>={}):ScriptureDidYouKnow[]{
 const refs=new Set(verses.map(v=>v.reference));
 return curated.filter(fact=>refs.has(fact.reference)&&!researched[fact.reference]);
}
