import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, GitBranch, ArrowUpRight } from 'lucide-react';
import { BIBLE_BOOKS, parseBibleReadingReference, type BibleReadingLocation } from '../lib/bibleBooks';
import { fetchEditionChapter } from '../lib/scriptureEditions';

type LinkRow = [string, string, number];
type ChapterLinks = Record<string, LinkRow[]>;
const cache = new Map<string, Promise<ChapterLinks>>();
const chapterKey = (ref: string) => {
  const target = parseBibleReadingReference(ref);
  return target ? BIBLE_BOOKS[target.bookIndex].slug + '/' + target.chapter : '';
};
function loadChapter(key: string) {
  let request = cache.get(key);
  if (!request) {
    request = fetch(import.meta.env.BASE_URL + 'scripture-threads/' + key + '.json').then(async response => {
      if (!response.ok) throw new Error('Threads unavailable');
      return await response.json() as ChapterLinks;
    }).catch(error => { cache.delete(key); throw error; });
    cache.set(key, request);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return request;
}
export function useScriptureThreads(references: string[]) {
  const key = [...new Set(references.map(chapterKey).filter(Boolean))].sort().join('|');
  const [state, setState] = useState<{ key: string; data: Record<string, ChapterLinks> }>({key:'',data:{}});
  useEffect(() => {
    let active = true;
    if (!key) return;
    void Promise.allSettled(key.split('|').map(async chapter => [chapter, await loadChapter(chapter)] as const)).then(results => {
      if (!active) return;
      const data: Record<string, ChapterLinks> = {};
      for (const result of results) if (result.status === 'fulfilled') data[result.value[0]] = result.value[1];
      setState({key,data});
    });
    return () => { active = false; };
  }, [key]);
  return (reference: string) => {
    const target = parseBibleReadingReference(reference);
    if (!target?.verse || state.key !== key) return undefined;
    return state.data[chapterKey(reference)]?.[String(target.verse)] ?? (state.data[chapterKey(reference)] ? [] : undefined);
  };
}
export const THREAD_TYPES = {
 prophecy: ['Prophecy','#A855F7'], fulfillment: ['Prophetic fulfilment','#22C55E'],
 history: ['Historical continuity','#3B82F6'], kingdom: ['Kingdom principle','#EAB308'],
 strategy: ['Conflict and strategy','#EF4444'], symbol: ['Types and symbols','#F97316'],
 parallel: ['Parallel accounts','#14B8A6'], covenant: ['Covenant and promise','#EC4899'],
 law: ['Law and instruction','#6366F1'], quotation: ['Quotation','#06B6D4'],
 related: ['Related passage','#9CA3AF'],
} as const;
type ThreadType=keyof typeof THREAD_TYPES;
const reviewedConnections: Array<[string,string,ThreadType,ThreadType]> = [
 ['Isaiah 7:14','Matthew 1:23','fulfillment','prophecy'],
 ['Micah 5:2','Matthew 2:6','fulfillment','prophecy'],
 ['Isaiah 40:3','Matthew 3:3','fulfillment','prophecy'],
 ['Zechariah 9:9','Matthew 21:5','fulfillment','prophecy'],
 ['Joel 2:28','Acts 2:17','fulfillment','prophecy'],
 ['Isaiah 53:7','Acts 8:32','quotation','quotation'],
 ['Deuteronomy 8:3','Matthew 4:4','quotation','quotation'],
 ['Genesis 2:24','Matthew 19:5','quotation','quotation'],
 ['Judges 7:24','Judges 8:1','history','history'],
 ['Judges 7:25','Judges 8:3','history','history'],
 ['Judges 8:1','Judges 12:1','strategy','strategy'],
 ['Judges 8:3','Proverbs 15:1','kingdom','kingdom'],
 ['Judges 8:23','1 Samuel 8:7','kingdom','kingdom'],
 ['Judges 8:27','Exodus 28:6','symbol','symbol'],
 ['Genesis 12:3','Genesis 22:18','covenant','covenant'],
 ['Genesis 22:18','Galatians 3:16','covenant','covenant'],
 ['Exodus 20:12','Ephesians 6:2','law','law'],
 ['Matthew 14:19','Mark 6:41','parallel','parallel'],
 ['Matthew 14:19','John 6:11','parallel','parallel'],
 ['Numbers 21:9','John 3:14','symbol','symbol'],
 ['Genesis 1:1','John 1:1','kingdom','kingdom'],
 ['Genesis 2:9','Revelation 22:2','symbol','symbol'],
 ['Luke 24:49','Acts 1:4','history','history'],
 ['Acts 1:8','Acts 2:4','fulfillment','prophecy'],
 ['Romans 12:4','1 Corinthians 12:12','kingdom','kingdom'],
 ['Matthew 25:21','Luke 16:10','kingdom','kingdom'],
];
function threadType(from:string,to:string):ThreadType {
 for(const [a,b,forward,reverse] of reviewedConnections){
  if(from===a&&to===b)return forward;
  if(from===b&&to===a)return reverse;
 }
 return 'related';
}

type Navigate = (location: BibleReadingLocation) => void;
function PassageLink({ reference, end, onNavigate, kind }: { reference: string; end?: string; onNavigate?: Navigate; kind?: ThreadType }) {
  const location = parseBibleReadingReference(reference);
  if (!location) return null;
  const text = end ? reference + ' – ' + end : reference;
  return <button type="button" disabled={!onNavigate} onClick={() => onNavigate?.(location)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm font-semibold text-ink hover:border-brass/60">
    <span className="min-w-0">{kind&&<span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{color:THREAD_TYPES[kind][1]}}><span className="h-2 w-2 rounded-full" style={{backgroundColor:THREAD_TYPES[kind][1]}}/>{THREAD_TYPES[kind][0]}</span>}{text}</span><ArrowUpRight size={14} className="shrink-0 text-brass"/>
  </button>;
}
type Exploration = { question: string; answer?: string; references: string[]; source?: string };
const explorations: Record<string, Exploration[]> = {
 "Genesis 21:30":[{question:"Why are seven ewe lambs set apart as evidence of the well agreement?",references:["Genesis 20:17","Genesis 21:27","Genesis 21:30"]}],
 "Genesis 22:12":[{question:"How does God's intervention distinguish this test from human sacrifice?",references:["Genesis 21:33","Genesis 22:12"]}],
 "Genesis 23:18":[{question:"Why are the price, boundaries and witnesses recorded?",references:["Genesis 22:19","Genesis 23:16","Genesis 23:18"]}],
 "Genesis 24:8":[{question:"What limits did Abraham place on the servant's authority?",references:["Genesis 23:20","Genesis 24:58","Genesis 24:8"]}],
 "Genesis 25:32":[{question:"What did Esau surrender in exchange for immediate relief?",references:["Genesis 24:67","Genesis 25:34","Genesis 25:32"]}],
 "Genesis 26:28":[{question:"Why does Abimelech seek a treaty after previously asking Isaac to leave?",references:["Genesis 25:11","Genesis 26:22","Genesis 26:28"]}],
 "Genesis 27:13":[{question:"How does the earlier declaration relate to the conduct of Jacob and Rebekah?",references:["Genesis 26:35","Genesis 27:35","Genesis 27:13"]}],
 "Genesis 28:20":[{question:"What does God promise before Jacob makes his vow?",references:["Genesis 27:43","Genesis 28:15","Genesis 28:20"]}],
 "Genesis 29:26":[{question:"How does Laban's appeal to local custom interact with the original agreement?",references:["Genesis 28:15","Genesis 29:25","Genesis 29:26"]}],
 "Genesis 30:30":[{question:"What reason does Jacob give for providing for his own household?",references:["Genesis 29:30","Genesis 30:32","Genesis 30:30"]}],
 "Genesis 31:52":[{question:"Why is the heap of stones called a witness?",references:["Genesis 30:43","Genesis 31:44","Genesis 31:52"]}],
 "Genesis 32:28":[{question:"What changes in Jacob's identity at Peniel?",references:["Genesis 31:55","Genesis 32:10","Genesis 32:28"]}],
 "Genesis 33:13":[{question:"Why does Jacob emphasize the needs of the children and flocks?",references:["Genesis 32:30","Genesis 33:14","Genesis 33:13"]}],
 "Genesis 34:30":[{question:"How does Jacob's immediate objection compare with his later judgment in Genesis 49?",references:["Genesis 33:19","Genesis 34:30"]}],
 "Genesis 35:3":[{question:"Why does Jacob require the removal of foreign gods before the journey?",references:["Genesis 34:30","Genesis 35:2","Genesis 35:3"]}],
 "Genesis 36:31":[{question:"Why does the narrator specify that Edom had kings before Israel?",references:["Genesis 35:29","Genesis 36:31"]}],
 "Genesis 37:11":[{question:"How do the father's favoritism and the brothers' decisions contribute differently to the crisis?",references:["Genesis 36:43","Genesis 37:4","Genesis 37:11"]}],
 "Genesis 38:26":[{question:"What specific obligation does Judah acknowledge failing to fulfil?",references:["Genesis 37:36","Genesis 38:26"]}],
 "Genesis 39:9":[{question:"What limits does Joseph identify within his extensive authority?",references:["Genesis 37:36","Genesis 39:9"]}],
 "Genesis 40:14":[{question:"Why does Joseph ask the cupbearer to remember him?",references:["Genesis 39:22","Genesis 40:8","Genesis 40:14"]}],
 "Genesis 41:33":[{question:"What distinguishes Joseph's interpretation from his administrative recommendation?",references:["Genesis 40:23","Genesis 41:34","Genesis 41:33"]}],
 "Genesis 42:21":[{question:"Why do the brothers interpret their distress through their treatment of Joseph?",references:["Genesis 41:57","Genesis 42:21"]}],
 "Genesis 43:9":[{question:"How does Judah's guarantee differ from Reuben's proposal in Genesis 42:37?",references:["Genesis 42:38","Genesis 43:9"]}],
 "Genesis 44:33":[{question:"How does Judah's offer contrast with Genesis 37:26–27?",references:["Genesis 43:34","Genesis 44:33"]}],
 "Genesis 45:4":[{question:"How does Joseph distinguish God's purpose from his brothers' actions?",references:["Genesis 44:33","Genesis 45:5","Genesis 45:4"]}],
 "Genesis 46:4":[{question:"Why is reassurance given before Jacob enters Egypt?",references:["Genesis 45:19","Genesis 46:3","Genesis 46:4"]}],
 "Genesis 47:20":[{question:"What long-term economic arrangement follows the emergency transactions?",references:["Genesis 46:34","Genesis 47:26","Genesis 47:20"]}],
 "Genesis 48:19":[{question:"Why does Jacob resist Joseph's attempt to rearrange his hands?",references:["Genesis 47:29","Genesis 48:19"]}],
 "Genesis 49:5":[{question:"How do the words about Simeon and Levi relate to Genesis 34?",references:["Genesis 48:20","Genesis 49:7","Genesis 49:5"]}],
 "Genesis 50:20":[{question:"What distinction does Joseph make between human intention and God's purpose?",references:["Genesis 49:33","Genesis 50:20"]}],
 "Genesis 1:28":[{question:"Why is the blessing and commission given before humanity has performed any work?",references:["Genesis 1:1","Genesis 1:26","Genesis 1:28"]}],
 "Genesis 2:15":[{question:"Why does the garden assignment include both cultivating and keeping it?",references:["Genesis 1:28","Genesis 2:15"]}],
 "Genesis 3:1":[{question:"How does the serpent's wording differ from God's command in 2:16–17?",references:["Genesis 2:16","Genesis 3:12","Genesis 3:1"]}],
 "Genesis 4:6":[{question:"Why does God address Cain's anger before the murder?",references:["Genesis 3:23","Genesis 4:7","Genesis 4:6"]}],
 "Genesis 5:24":[{question:"What distinguishes Enoch's record from the repeated pattern in the genealogy?",references:["Genesis 4:25","Genesis 5:24"]}],
 "Genesis 6:9":[{question:"What does the text identify as Noah's distinguishing qualities before the ark is completed?",references:["Genesis 5:32","Genesis 6:22","Genesis 6:9"]}],
 "Genesis 7:5":[{question:"Why does the account repeatedly record Noah's compliance with God's commands?",references:["Genesis 6:22","Genesis 7:5"]}],
 "Genesis 8:13":[{question:"What is the distinction between Noah seeing dry ground and receiving the command to leave?",references:["Genesis 7:23","Genesis 8:15","Genesis 8:13"]}],
 "Genesis 9:16":[{question:"Why is the covenant sign described as a reminder rather than an achievement of humanity?",references:["Genesis 8:22","Genesis 9:6","Genesis 9:16"]}],
 "Genesis 10:5":[{question:"Why does the chapter organize peoples by families, languages, lands and nations?",references:["Genesis 9:18","Genesis 10:32","Genesis 10:5"]}],
 "Genesis 11:4":[{question:"How does the desire to avoid scattering compare with the commission in Genesis 9:1?",references:["Genesis 10:32","Genesis 11:4"]}],
 "Genesis 12:3":[{question:"How does the promise to bless other families shape the purpose of Abram's calling?",references:["Genesis 11:31","Genesis 12:2","Genesis 12:3"]}],
 "Genesis 13:8":[{question:"Why does Abram prioritize kinship when discussing the dispute between herdsmen?",references:["Genesis 12:20","Genesis 13:8"]}],
 "Genesis 14:24":[{question:"Why does Abram refuse the king's goods while allowing the men their shares?",references:["Genesis 13:12","Genesis 14:23","Genesis 14:24"]}],
 "Genesis 15:13":[{question:"Why does the promise include a period of affliction before inheritance?",references:["Genesis 14:23","Genesis 15:6","Genesis 15:13"]}],
 "Genesis 16:13":[{question:"How does God's encounter with Hagar change the perspective of the household conflict?",references:["Genesis 15:4","Genesis 16:6","Genesis 16:13"]}],
 "Genesis 17:15":[{question:"Why are both Abraham and Sarah renamed in the covenant narrative?",references:["Genesis 16:16","Genesis 17:1","Genesis 17:15"]}],
 "Genesis 18:19":[{question:"What reason does God give for disclosing the matter to Abraham in 18:19?",references:["Genesis 17:19","Genesis 18:25","Genesis 18:19"]}],
 "Genesis 19:16":[{question:"Why does the narrative emphasize mercy when Lot hesitates?",references:["Genesis 18:33","Genesis 19:16"]}],
 "Genesis 20:9":[{question:"Why does Abimelech challenge Abraham despite having received a divine warning himself?",references:["Genesis 19:29","Genesis 20:9"]}],
  'Judges 8:1': [{
    question: 'Why did Ephraim complain that Gideon did not call them, when Judges 7:24 says he sent messengers to them?',
    answer: 'The sequence explains the complaint. God reduced Gideon’s army to 300 before the initial attack (7:2–7). The Midianites were already fleeing when Gideon summoned Ephraim to intercept them (7:22–25). Ephraim therefore participated in the pursuit, but not the opening battle. Gideon acknowledged their capture of Oreb and Zeeb, and their anger subsided (8:2–3). The text does not explicitly state every motive behind their anger. A similar complaint later arises against Jephthah.',
    references: ['Judges 7:2','Judges 7:7','Judges 7:22','Judges 7:24','Judges 7:25','Judges 8:2','Judges 8:3','Judges 12:1'],
    source: 'https://enduringword.com/bible-commentary/judges-8/',
  }],
  'Judges 8:2': [{question:'Why does Gideon compare Ephraim’s gleaning to Abiezer’s grape harvest?',answer:'Gleaning refers to the fruit left after the main harvest. Gideon uses that comparison to acknowledge that Ephraim’s later contribution exceeded the achievement of his own clan; the next verse identifies the capture of Oreb and Zeeb as the reason.',references:['Judges 7:25','Judges 8:3','Judges 6:34']}],
  'Judges 8:27': [{question:'Why did Gideon make an ephod after refusing Israel’s offer of kingship?',references:['Judges 8:22','Judges 8:23','Judges 8:24','Judges 8:27','Exodus 28:6']}],
  'Judges 8:35': [{question:'What caused Israel to forget the kindness shown through Gideon so soon after his death?',references:['Judges 8:28','Judges 8:33','Judges 8:34','Judges 2:19']}],
};
function ExplorationCards({reference,onNavigate}:{reference:string;onNavigate?:Navigate}) {
  const items=explorations[reference]||[];
  return <>{items.map(item=><details key={item.question} className="rounded-xl border border-brass/35 bg-surface">
    <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink">{item.question}</summary>
    <div className="space-y-2 border-t border-border p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-brass">{item.answer?'Researched explanation':'Question to explore'}</p>
      <p className="text-sm leading-relaxed text-ink">{item.answer||'Explore the connected passages. Scripture does not explicitly settle every part of this question; no definitive explanation is asserted here.'}</p>
      <div className="grid gap-1">{item.references.map(ref=><PassageLink key={ref} reference={ref} onNavigate={onNavigate}/>)}</div>
      {item.source&&<a href={item.source} target="_blank" rel="noreferrer" className="text-xs text-brass underline">Read supporting commentary</a>}
    </div>
  </details>)}</>;
}

export function VerseThreads({reference, links, onNavigate}: {reference:string; links:LinkRow[]|undefined; onNavigate?:Navigate}) {
  const [limit,setLimit]=useState(20);
  const [filter,setFilter]=useState<ThreadType|'all'>('all');
  const [open,setOpen]=useState(false);
  const [retry,setRetry]=useState(0);
  const [local,setLocal]=useState<{ref:string; rows:LinkRow[]}|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if (!open || links !== undefined) return;
    let active=true; setFailed(false);
    const verse=parseBibleReadingReference(reference)?.verse;
    void loadChapter(chapterKey(reference)).then(data=>{if(active)setLocal({ref:reference,rows:data[String(verse)]||[]});}).catch(()=>{if(active)setFailed(true);});
    return()=>{active=false;};
  },[open,links,reference,retry]);
  const imported=links ?? (local?.ref===reference?local.rows:undefined);
  const reviewed:LinkRow[]=reviewedConnections.flatMap(([a,b])=>a===reference?[[b,'',0] as LinkRow]:b===reference?[[a,'',0] as LinkRow]:[]);
  const rows=imported===undefined?undefined:[...reviewed,...imported.filter(([ref,end])=>!reviewed.some(([r,e])=>r===ref&&e===end))];
  const visibleRows=rows?.filter(([ref])=>filter==='all'||threadType(reference,ref)===filter);
  return <details onToggle={event=>setOpen(event.currentTarget.open)} className="group my-1 rounded-xl border border-border bg-surface/80">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-bold text-brass [&::-webkit-details-marker]:hidden"><GitBranch size={16}/> Threads
      {rows!==undefined && <span className="rounded-full bg-brass/10 px-2 py-0.5 tabular-nums">{rows.length}</span>}
      <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180"/>
    </summary>
    <div className="space-y-2 border-t border-border p-3">
      <ExplorationCards reference={reference} onNavigate={onNavigate}/>
      <p className="text-xs text-stone">Passages connected to {reference}. Connections may reflect quotations, parallel accounts, prophecy or shared themes.</p>
      {rows===undefined ? <p className="text-xs text-stone" role="status">{failed?'Threads could not load.':'Loading threads…'} {failed&&<button className="underline" onClick={()=>setRetry(n=>n+1)}>Retry</button>}</p> : rows.length===0 ? <p className="text-xs text-stone">No indexed connections for this verse.</p> : <>
        <div className="flex flex-wrap gap-1.5">{(['all',...Object.keys(THREAD_TYPES)] as Array<ThreadType|'all'>).filter(kind=>kind==='all'||rows.some(([ref])=>threadType(reference,ref)===kind)).map(kind=><button key={kind} type="button" aria-pressed={filter===kind} onClick={()=>{setFilter(kind);setLimit(20);}} className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${filter===kind?'bg-surface-2 border-brass':'border-border'}`} style={kind==='all'?undefined:{color:THREAD_TYPES[kind][1]}}>{kind==='all'?'All':THREAD_TYPES[kind][0]}</button>)}</div>
        <div className="grid max-h-80 gap-1.5 overflow-y-auto">{visibleRows?.slice(0,limit).map(([ref,end])=><PassageLink key={ref+'|'+end} reference={ref} end={end} kind={threadType(reference,ref)} onNavigate={onNavigate}/>)}</div>
        {visibleRows&&limit<visibleRows.length&&<button type="button" className="btn-ghost w-full text-xs" onClick={()=>setLimit(n=>n+30)}>Show more · {visibleRows.length-limit} remaining</button>}
      </>}
      <p className="text-[10px] text-stone">Cross-reference data: <a className="underline" href="https://www.openbible.info/labs/cross-references/" target="_blank" rel="noreferrer">OpenBible.info</a> · CC BY 4.0 · links are study aids, not claims that every connection is a direct prophecy.</p>
    </div>
  </details>;
}
type ContextEntry={summary:string; links:string[]};
const curated:Record<string,ContextEntry>={
  'Genesis 21':{summary:"Isaac's promised birth follows the restoration of Abimelech's household.",links:["Genesis 20:17"]},
  'Genesis 22':{summary:"Isaac has been born and Abraham has established a treaty at Beersheba.",links:["Genesis 21:33"]},
  'Genesis 23':{summary:"Sarah dies after accompanying Abraham through the journey of promise.",links:["Genesis 22:19"]},
  'Genesis 24':{summary:"Abraham has secured a burial property and turns to Isaac's household.",links:["Genesis 23:20"]},
  'Genesis 25':{summary:"Isaac and Rebekah have married, establishing the next household in Abraham's line.",links:["Genesis 24:67"]},
  'Genesis 26':{summary:"Isaac has inherited Abraham's household; famine affects the land.",links:["Genesis 25:11"]},
  'Genesis 27':{summary:"Esau has sold his birthright and his marriages have grieved his parents.",links:["Genesis 26:35"]},
  'Genesis 28':{summary:"Jacob leaves amid Esau's hostility and Isaac's marriage instructions.",links:["Genesis 27:43"]},
  'Genesis 29':{summary:"Jacob has received reassurance at Bethel and journeys toward his relatives.",links:["Genesis 28:15"]},
  'Genesis 30':{summary:"Jacob's marriages have established tension within his household.",links:["Genesis 29:30"]},
  'Genesis 31':{summary:"Jacob's household and flocks have grown under his arrangement with Laban.",links:["Genesis 30:43"]},
  'Genesis 32':{summary:"Jacob has separated from Laban and approaches Esau.",links:["Genesis 31:55"]},
  'Genesis 33':{summary:"Jacob has prayed and encountered God before meeting Esau.",links:["Genesis 32:30"]},
  'Genesis 34':{summary:"Jacob has settled near Shechem.",links:["Genesis 33:19"]},
  'Genesis 35':{summary:"After the crisis at Shechem, God directs Jacob to return to Bethel.",links:["Genesis 34:30"]},
  'Genesis 36':{summary:"Isaac has died and both sons participate in his burial.",links:["Genesis 35:29"]},
  'Genesis 37':{summary:"The account returns from Esau's genealogy to Jacob's household.",links:["Genesis 36:43"]},
  'Genesis 38':{summary:"Joseph has been taken to Egypt; the narrative turns to Judah's household.",links:["Genesis 37:36"]},
  'Genesis 39':{summary:"Joseph enters Potiphar's household after being sold into Egypt.",links:["Genesis 37:36"]},
  'Genesis 40':{summary:"Joseph has received responsibility in prison.",links:["Genesis 39:22"]},
  'Genesis 41':{summary:"Joseph remains imprisoned after the cupbearer's restoration.",links:["Genesis 40:23"]},
  'Genesis 42':{summary:"Famine has spread and Jacob's household needs food.",links:["Genesis 41:57"]},
  'Genesis 43':{summary:"The brothers returned without Simeon; Jacob refuses initially to send Benjamin.",links:["Genesis 42:38"]},
  'Genesis 44':{summary:"Joseph has hosted his brothers without revealing his identity.",links:["Genesis 43:34"]},
  'Genesis 45':{summary:"Judah has offered himself in Benjamin's place.",links:["Genesis 44:33"]},
  'Genesis 46':{summary:"Joseph has invited Jacob's household to Egypt with Pharaoh's support.",links:["Genesis 45:19"]},
  'Genesis 47':{summary:"Jacob's household has arrived in Egypt.",links:["Genesis 46:34"]},
  'Genesis 48':{summary:"Jacob has requested burial in Canaan and is now ill.",links:["Genesis 47:29"]},
  'Genesis 49':{summary:"Jacob has blessed Joseph's sons and gathers his own sons.",links:["Genesis 48:20"]},
  'Genesis 50':{summary:"Jacob has died after giving burial instructions.",links:["Genesis 49:33"]},
  'Genesis 1':{summary:"Genesis opens with God as creator and sovereign, before any human institution exists.",links:["Genesis 1:1"]},
  'Genesis 2':{summary:"Genesis 1 establishes humanity's commission. Genesis 2 focuses on the garden, human work, the command and companionship.",links:["Genesis 1:28"]},
  'Genesis 3':{summary:"God provided the garden, gave a command and formed the human partnership in Genesis 2.",links:["Genesis 2:16"]},
  'Genesis 4':{summary:"The first couple has left Eden; the next generation lives outside the garden.",links:["Genesis 3:23"]},
  'Genesis 5':{summary:"Genesis 4 introduces Seth after Abel's death; chapter 5 traces Adam's line through Seth to Noah.",links:["Genesis 4:25"]},
  'Genesis 6':{summary:"Noah appears at the close of Genesis 5; chapter 6 describes widespread corruption and God's commission to Noah.",links:["Genesis 5:32"]},
  'Genesis 7':{summary:"Noah has received instructions for the ark and provision and has obeyed them.",links:["Genesis 6:22"]},
  'Genesis 8':{summary:"The flood has prevailed and those inside the ark have survived.",links:["Genesis 7:23"]},
  'Genesis 9':{summary:"Noah has left the ark and offered worship; God has promised the continuation of seasons.",links:["Genesis 8:22"]},
  'Genesis 10':{summary:"The sons of Noah are introduced after the flood; their descendants form the subject of this chapter.",links:["Genesis 9:18"]},
  'Genesis 11':{summary:"Genesis 10 describes the distribution of peoples; Genesis 11 recounts Babel and traces Shem's line to Abram.",links:["Genesis 10:32"]},
  'Genesis 12':{summary:"Terah's household has moved from Ur to Haran, and Abram is introduced in the genealogy.",links:["Genesis 11:31"]},
  'Genesis 13':{summary:"Abram and Lot have returned from Egypt with possessions; both households have grown.",links:["Genesis 12:20"]},
  'Genesis 14':{summary:"Lot has settled near Sodom after separating from Abram; the chapter opens with regional conflict.",links:["Genesis 13:12"]},
  'Genesis 15':{summary:"Abram has returned from rescuing Lot and has refused the king of Sodom's goods.",links:["Genesis 14:23"]},
  'Genesis 16':{summary:"Abram has received a promise of descendants, but Sarai remains childless.",links:["Genesis 15:4"]},
  'Genesis 17':{summary:"Ishmael has been born; God now renews the covenant with Abram at age ninety-nine.",links:["Genesis 16:16"]},
  'Genesis 18':{summary:"God has promised Isaac through Sarah and established the covenant sign.",links:["Genesis 17:19"]},
  'Genesis 19':{summary:"Abraham has interceded concerning Sodom; the messengers arrive in the city.",links:["Genesis 18:33"]},
  'Genesis 20':{summary:"Abraham has witnessed God's judgment on Sodom and journeys to Gerar.",links:["Genesis 19:29"]},
  'Judges 8':{summary:'God called Gideon to deliver Israel from Midian. He reduced the army to 300 men, then gave Israel victory. During the pursuit Gideon summoned Ephraim to seize the waters and the Ephraimites captured Oreb and Zeeb. Chapter 8 opens with their complaint about not being summoned at the beginning, even though they had joined the later pursuit. See Judges 8:1 Threads for the explanation.',links:['Judges 6:14','Judges 7:7','Judges 7:22','Judges 7:24','Judges 7:25']},
  'Judges 7':{summary:'Midian had oppressed Israel. God called Gideon while he was threshing wheat, instructed him to tear down Baal’s altar and reassured him with the signs involving the fleece. Gideon now gathers the people for the battle.',links:['Judges 6:11','Judges 6:14','Judges 6:25','Judges 6:36']},
  'Judges 6':{summary:'After Deborah and Barak’s victory, the land had rest for forty years. Israel again did evil, and the Lord delivered them into Midian’s hand for seven years. Gideon’s calling answers Israel’s cry.',links:['Judges 4:14','Judges 5:31']},
  'Exodus 1':{summary:'Joseph brought his family into Egypt during the famine. Genesis ends with Joseph’s death and his assurance that God would bring Israel back to the promised land. Exodus begins with the growth of that family into a numerous people.',links:['Genesis 46:3','Genesis 47:11','Genesis 50:24']},
  'Joshua 1':{summary:'Moses led Israel out of Egypt and through the wilderness. Before his death, Joshua was commissioned to lead the people into Canaan. The Lord now charges Joshua to be strong and courageous.',links:['Numbers 27:18','Deuteronomy 31:7','Deuteronomy 34:9']},
  'Ruth 1':{summary:'Ruth’s account is set during the period of the judges. A famine leads a family from Bethlehem to Moab, establishing the setting for Naomi and Ruth’s journey.',links:['Judges 2:16','Ruth 1:1']},
  'Matthew 1':{summary:'God promised Abraham blessing through his offspring and promised David an enduring royal house. Matthew opens with Jesus Christ’s genealogy, connecting Him with Abraham, David and Israel’s history.',links:['Genesis 22:18','2 Samuel 7:12','Isaiah 9:6']},
  'John 1':{summary:'Genesis opens with God creating the heavens and the earth. John opens with the Word who was with God and was God, connecting creation with the revelation of Jesus Christ.',links:['Genesis 1:1','Genesis 1:3']},
  'Acts 1':{summary:'Luke’s Gospel closes with the risen Jesus instructing the disciples to wait in Jerusalem for power from on high. Acts resumes the account with Jesus teaching the apostles about the Kingdom and the promise of the Holy Spirit.',links:['Luke 24:44','Luke 24:49','Luke 24:51']},
  'Acts 2':{summary:'Jesus promised the apostles the Holy Spirit and instructed them to wait in Jerusalem. After His ascension the disciples gathered in prayer and Matthias was chosen. Pentecost fulfills the promised outpouring.',links:['Acts 1:4','Acts 1:8','Acts 1:14','Acts 1:26']},
  'Revelation 22':{summary:'John has seen the new heaven and new earth, the holy city and the dwelling of God with His people. The final chapter continues that vision with the river and tree of life, recalling Eden.',links:['Revelation 21:1','Revelation 21:3','Genesis 2:9','Genesis 2:10']}
};
export function ReadingContext({reference,edition,onNavigate}:{reference:string;edition:string;onNavigate?:Navigate}){
  const target=parseBibleReadingReference(reference);
  const [open,setOpen]=useState(false);
  const [previous,setPrevious]=useState<{key:string; text:Array<{number:number;text:string}>}|null>(null);
  const [failed,setFailed]=useState(false);
  const book=target?BIBLE_BOOKS[target.bookIndex]:undefined;
  const name=book&&target?book.name+' '+target.chapter:'';
  const entry=curated[name];
  const prior=target && book && (target.verse||1)>1 ? {bookIndex:target.bookIndex,chapter:target.chapter,verse:target.verse!} : target && target.chapter>1 ? {bookIndex:target.bookIndex,chapter:target.chapter-1,verse:undefined} : null;
  const priorKey=prior?BIBLE_BOOKS[prior.bookIndex].slug+'/'+prior.chapter+'/'+(prior.verse||0):'';
  useEffect(()=>{
    if (!open||!priorKey||entry) return;
    const controller=new AbortController();setFailed(false);
    const [slug,chapter,verse]=priorKey.split('/');
    void fetchEditionChapter(edition==='published'?'web':edition,slug,Number(chapter),controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      const selected=Number(verse)>0?result.verses.filter(v=>v.number<Number(verse)).slice(-5):result.verses.slice(-5);
      setPrevious({key:priorKey,text:selected});
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return()=>controller.abort();
  },[open,priorKey,edition,entry]);
  if(!target||!book||(!entry&&!prior))return null;
  const priorRef=prior?BIBLE_BOOKS[prior.bookIndex].name+' '+prior.chapter: '';
  return <details key={reference} onToggle={event=>setOpen(event.currentTarget.open)} className="group mb-4 rounded-2xl border border-brass/40 bg-surface/90">
    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-bold text-ink [&::-webkit-details-marker]:hidden"><BookOpen size={18} className="text-brass"/> Context<ChevronDown size={16} className="ml-auto text-brass transition-transform group-open:rotate-180"/></summary>
    <div className="space-y-3 border-t border-border px-4 py-3">
      {entry?<><p className="text-[10px] font-bold uppercase tracking-widest text-brass">Previously in Scripture</p><p className="text-sm leading-relaxed text-ink">{entry.summary}</p><div className="grid gap-1.5">{entry.links.map(ref=><PassageLink key={ref} reference={ref} onNavigate={onNavigate}/>)}</div></>:<>
        <p className="text-[10px] font-bold uppercase tracking-widest text-brass">Read the lead-in · {priorRef}</p>
        <p className="text-xs text-stone">The preceding Scripture is shown here to restore the immediate reading context. A written story summary has not yet been prepared for this passage.</p>
        {previous?.key===priorKey?previous.text.map(v=><p key={v.number} className="text-sm leading-relaxed text-ink"><span className="mr-2 font-semibold text-brass">{v.number}.</span>{v.text}</p>):<p className="text-xs text-stone">{failed?'Previous passage unavailable. Open it directly below.':'Loading previous passage…'}</p>}
        <PassageLink reference={priorRef} onNavigate={onNavigate}/>
      </>}
    </div>
  </details>;
}

type SummaryEntry={sections:Array<{heading:string; body:string; reference:string}>; takeaway:string};
const summaries:Record<string,SummaryEntry>={
 'Genesis 21':{sections:[{heading:"Covenant fulfilment and property rights",body:"Isaac is born (1–7); God provides for Hagar and Ishmael (8–21); Abraham settles a dispute with Abimelech over a well (22–34).",reference:"Genesis 21:27"}],takeaway:"Separate the fulfilment of promises from the administration of their consequences. Abraham establishes a witnessed agreement over a disputed resource; divine provision for Ishmael also prevents the reader from confusing covenant designation with neglect of human needs."},
 'Genesis 22':{sections:[{heading:"Entrusted gifts and obedience",body:"God tests Abraham (1–10), stops the sacrifice and provides a ram (11–14), renews the promise (15–19), and introduces Nahor's descendants (20–24).",reference:"Genesis 22:12"}],takeaway:"The text identifies a divine test and expressly records its termination. The lesson is stewardship rather than ownership of entrusted gifts, never permission to harm children."},
 'Genesis 23':{sections:[{heading:"Transparent property acquisition",body:"Abraham negotiates for a burial site (3–16); the field and cave are transferred before witnesses (17–20).",reference:"Genesis 23:16"}],takeaway:"Formalize significant asset transfers with clear boundaries, consideration and witnesses. The public record protects continuity beyond the parties' lifetimes."},
 'Genesis 24':{sections:[{heading:"Delegation and mandate",body:"The servant receives a commission and constraints (1–9), encounters Rebekah (10–27), reports his purpose (28–49), and obtains her consent to travel (50–67).",reference:"Genesis 24:58"}],takeaway:"A sound delegation specifies authority, limits, selection criteria and reporting. Rebekah's willingness is an important distinction from treating people as institutional assets."},
 'Genesis 25':{sections:[{heading:"Inheritance and valuation",body:"Abraham's inheritance arrangements and death are recorded (1–11), followed by Ishmael's descendants (12–18), and the birth of Jacob and Esau and sale of the birthright (19–34).",reference:"Genesis 25:34"}],takeaway:"Evaluate immediate consumption against enduring responsibilities. Esau's exchange illustrates a mismatch between short-term benefit and long-term value."},
 'Genesis 26':{sections:[{heading:"Resource disputes and reputation",body:"God renews the promise (1–5); Isaac's deception is exposed (6–11); prosperity and well disputes follow (12–22); Abimelech seeks peace (23–35).",reference:"Genesis 26:22"}],takeaway:"Resolve competing claims without treating every dispute as a contest for prestige. Prosperity does not excuse dishonesty; Isaac's eventual agreement demonstrates the value of durable relationships."},
 'Genesis 27':{sections:[{heading:"Succession and deception",body:"Isaac plans to bless Esau (1–4); Rebekah and Jacob deceive him (5–29); Esau discovers the loss (30–40); Jacob prepares to leave (41–46).",reference:"Genesis 27:35"}],takeaway:"A desired succession outcome does not legitimize deception. Distinguish the promise of Genesis 25:23 from the methods individuals use to pursue it."},
 'Genesis 28':{sections:[{heading:"Commission beyond familiar territory",body:"Isaac blesses and sends Jacob (1–5); Esau responds (6–9); Jacob encounters God at Bethel and makes a vow (10–22).",reference:"Genesis 28:15"}],takeaway:"Distinguish inherited identity, personal encounter and undertaken obligations. A commission can endure displacement without depending on familiar surroundings."},
 'Genesis 29':{sections:[{heading:"Contracts and unequal treatment",body:"Jacob meets Rachel and Laban (1–14); marriage and service negotiations lead to deception (15–30); Leah bears children amid unequal affection (31–35).",reference:"Genesis 29:25"}],takeaway:"Do not exploit information asymmetry or introduce undisclosed terms after service is rendered. The account demonstrates the human cost of unfair arrangements."},
 'Genesis 30':{sections:[{heading:"Compensation and household rivalry",body:"Rivalry over children unfolds (1–24); Jacob negotiates compensation and manages flocks (25–43).",reference:"Genesis 30:32"}],takeaway:"Separate compensation from personal rivalry. The narrative records competition and bargaining without prescribing the treatment of people as production assets."},
 'Genesis 31':{sections:[{heading:"Exit governance and dispute resolution",body:"Jacob receives direction to return (1–16); the household departs (17–21); Laban confronts him (22–42); a covenant and boundary marker settle the dispute (43–55).",reference:"Genesis 31:44"}],takeaway:"Accountable transitions distinguish documented service, allegations, property and mutual boundaries. The covenant marker makes the settlement visible to future parties."},
 'Genesis 32':{sections:[{heading:"Conflict preparation and identity",body:"Jacob sends messengers, prepares gifts and prays (1–21); he wrestles and receives the name Israel (22–32).",reference:"Genesis 32:10"}],takeaway:"A leader confronting unresolved conflict must acknowledge vulnerability and seek reconciliation. Material preparation does not replace personal accountability or dependence on God."},
 'Genesis 33':{sections:[{heading:"Reconciliation and boundaries",body:"The brothers embrace (1–11); Jacob declines to travel at Esau's pace (12–17); he settles near Shechem (18–20).",reference:"Genesis 33:14"}],takeaway:"Reconciliation need not mean merging responsibilities. Jacob retains accountability for the pace and welfare of his household while acknowledging his brother."},
 'Genesis 34':{sections:[{heading:"Justice and indiscriminate retaliation",body:"Dinah is violated (1–4); negotiations follow (5–24); Simeon and Levi retaliate (25–29); Jacob confronts his sons (30–31).",reference:"Genesis 34:30"}],takeaway:"Distinguish justice for a victim from collective punishment. The recorded deception and violence are not a prescription; Jacob's later judgment in 49:5–7 reinforces the distinction."},
 'Genesis 35':{sections:[{heading:"Renewal and continuity through loss",body:"Jacob removes foreign gods and travels (1–8); God renews his name and promise (9–15); family losses and misconduct are recorded (16–29).",reference:"Genesis 35:2"}],takeaway:"Renewing allegiance requires concrete action. Leadership continuity must also address bereavement and misconduct instead of pretending that renewal removes every difficulty."},
 'Genesis 36':{sections:[{heading:"Genealogy and political organization",body:"Esau's family and relocation are recorded (1–8); descendants and chiefs follow (9–30); kings and chiefs of Edom are listed (31–43).",reference:"Genesis 36:31"}],takeaway:"Genealogies preserve relationships, territories and institutional development. The existence of offices does not itself establish moral legitimacy or individual competence."},
 'Genesis 37':{sections:[{heading:"Favoritism and institutional fracture",body:"Joseph's favored status and dreams intensify rivalry (1–11); his brothers sell him and deceive Jacob (12–35); Joseph is taken to Egypt (36).",reference:"Genesis 37:4"}],takeaway:"Favoritism and resentment are distinct failures that can reinforce one another. Develop fair recognition and channels for grievances before they escalate into abuse."},
 'Genesis 38':{sections:[{heading:"Responsibility and accountability",body:"Judah's family losses are recorded (1–11); Tamar acts after Judah fails to provide Shelah (12–23); Judah acknowledges responsibility and twins are born (24–30).",reference:"Genesis 38:26"}],takeaway:"Authority entails obligations to vulnerable dependants. Judah reverses his premature judgment when confronted with evidence of his own failure."},
 'Genesis 39':{sections:[{heading:"Integrity under delegated authority",body:"Joseph administers the household (1–6), refuses sexual pressure (7–12), is falsely accused and imprisoned (13–20), and receives responsibility in prison (21–23).",reference:"Genesis 39:9"}],takeaway:"Competence must survive changes in status. Joseph identifies the boundaries of delegated authority and refuses to misuse trust despite personal cost."},
 'Genesis 40':{sections:[{heading:"Service without recognition",body:"Two royal officers are imprisoned (1–4); Joseph interprets their dreams, attributing interpretation to God (5–19); the outcomes follow and the cupbearer forgets him (20–23).",reference:"Genesis 40:8"}],takeaway:"Distinguish competence, attribution and advocacy. Joseph serves others while legitimately requesting that his own case be remembered."},
 'Genesis 41':{sections:[{heading:"Forecasting and administration",body:"Joseph interprets Pharaoh's dreams (1–32), proposes famine preparation (33–36), receives appointment (37–45), and administers grain collection and distribution (46–57).",reference:"Genesis 41:34"}],takeaway:"Convert credible forecasts into accountable preparation. Distinguish the prediction, policy proposal, appointment and implementation; modern application requires transparent reserves and equitable access."},
 'Genesis 42':{sections:[{heading:"Trust and unresolved wrongdoing",body:"Jacob sends his sons to Egypt (1–5); Joseph recognizes and questions them (6–24); they return with grain and discover returned money (25–38).",reference:"Genesis 42:21"}],takeaway:"Past wrongdoing affects present trust. Distinguish verifying information from exploiting power over vulnerable people; the historical narrative is not a blanket authorization of Joseph's methods."},
 'Genesis 43':{sections:[{heading:"Guarantees and responsibility",body:"Famine forces renewed travel (1–10); Jacob sends gifts and money (11–15); Joseph receives the brothers (16–34).",reference:"Genesis 43:9"}],takeaway:"A credible guarantee specifies who accepts responsibility. Judah personally undertakes accountability for Benjamin, unlike Reuben's earlier proposal involving his sons."},
 'Genesis 44':{sections:[{heading:"Substitution and changed character",body:"The cup is placed in Benjamin's sack (1–13); the brothers return (14–17); Judah offers himself in Benjamin's place (18–34).",reference:"Genesis 44:33"}],takeaway:"Evaluate transformation through changed conduct rather than declarations. Judah's willingness to bear responsibility contrasts with his proposal to sell Joseph."},
 'Genesis 45':{sections:[{heading:"Reconciliation and providence",body:"Joseph reveals himself and speaks of God's preservation of life (1–15); Pharaoh supports relocation (16–24); Jacob receives the news (25–28).",reference:"Genesis 45:5"}],takeaway:"Reconciliation acknowledges wrongdoing while directing resources toward restoration. Providence does not erase human responsibility or make betrayal acceptable."},
 'Genesis 46':{sections:[{heading:"Migration and continuity",body:"God reassures Jacob (1–4); the household migrates and is listed (5–27); Joseph meets Jacob and prepares for Pharaoh (28–34).",reference:"Genesis 46:3"}],takeaway:"Relocation requires clarity about dependants, identity, destination and livelihood. The genealogy preserves the people involved, rather than merely recording movement."},
 'Genesis 47':{sections:[{heading:"Crisis economics and concentration of power",body:"The family receives land in Goshen (1–12); famine transactions consolidate assets under Pharaoh (13–26); Jacob requests burial in Canaan (27–31).",reference:"Genesis 47:26"}],takeaway:"Study survival alongside distribution of power. The account records lasting concentration of assets; it does not establish that every concentration of property is ethically desirable."},
 'Genesis 48':{sections:[{heading:"Inheritance and designation",body:"Jacob recalls the promise and adopts Joseph's sons into his inheritance (1–7); he blesses Ephraim and Manasseh (8–20); he speaks of return (21–22).",reference:"Genesis 48:19"}],takeaway:"Succession requires clarity about designation. Jacob deliberately crosses his hands and explains the unexpected decision instead of leaving its meaning ambiguous."},
 'Genesis 49':{sections:[{heading:"Differentiated assessment and legacy",body:"Jacob addresses his sons individually (1–28), gives burial instructions and dies (29–33).",reference:"Genesis 49:7"}],takeaway:"Evaluate legacy through differentiated assessments of conduct and responsibility. The words include commendation and consequences; family status does not eliminate accountability."},
 'Genesis 50':{sections:[{heading:"Forgiveness and future continuity",body:"Jacob is buried in Canaan (1–14); Joseph reassures his fearful brothers (15–21); Joseph dies after expressing confidence in God's future visitation (22–26).",reference:"Genesis 50:20"}],takeaway:"The test of authority includes refusing personal vengeance when power is available. Communicate commitments that extend beyond one's lifetime."},
 'Genesis 1':{sections:[{heading:"Creation and delegated responsibility",body:"1:1–25 establishes ordered creation; 1:26–28 commissions humanity as God's image-bearers; 1:29–31 records provision and evaluation.",reference:"Genesis 1:26"}],takeaway:"Distinguish ownership from delegated stewardship. Design responsibilities around the welfare of what is entrusted, and evaluate outcomes rather than activity."},
 'Genesis 2':{sections:[{heading:"Work, boundaries and partnership",body:"2:7–15 describes human formation, provision and garden stewardship; 2:16–17 sets a boundary; 2:18–25 establishes companionship and marriage.",reference:"Genesis 2:15"}],takeaway:"An assignment includes both permission and limits. Define the resources entrusted to a role, prohibited actions and the relationships necessary to sustain it."},
 'Genesis 3':{sections:[{heading:"Integrity under pressure",body:"3:1–7 records the temptation and disobedience; 3:8–19 records confrontation and consequences; 3:20–24 records clothing and exclusion from the garden.",reference:"Genesis 3:12"}],takeaway:"Study the difference between receiving authority and remaining accountable to its source. Build practices that expose mistakes early rather than allowing concealment and blame."},
 'Genesis 4':{sections:[{heading:"Accountability and cultural development",body:"4:1–16 traces Cain's offering, warning, murder and consequences; 4:17–24 records descendants and cultural occupations; 4:25–26 introduces Seth and Enosh.",reference:"Genesis 4:7"}],takeaway:"Technical and cultural development is not equivalent to moral development. Evaluate the character of people and institutions independently of their productivity."},
 'Genesis 5':{sections:[{heading:"Generational continuity",body:"5:1–20 records the genealogy and repeated deaths; 5:21–24 distinguishes Enoch's walk with God; 5:28–32 records Lamech's hope and Noah's sons.",reference:"Genesis 5:24"}],takeaway:"An institution needs records and transmission across generations. The genealogy preserves continuity while Enoch's distinctive account shows that longevity alone is not the measure of a life."},
 'Genesis 6':{sections:[{heading:"Integrity and commissioned preparation",body:"6:5–12 describes corruption and Noah's distinct conduct; 6:13–21 records the ark commission, covenant and provision; 6:22 records obedience.",reference:"Genesis 6:22"}],takeaway:"Preparation begins with receiving a clear mandate, understanding constraints and executing faithfully. Do not confuse public conformity with integrity."},
 'Genesis 7':{sections:[{heading:"Execution and preservation",body:"7:1–10 records entry and preparation; 7:11–16 records the flood's onset and God's closing of the ark; 7:17–24 records the prevailing waters and preservation of those inside.",reference:"Genesis 7:5"}],takeaway:"Translate preparation into timely execution; plans do not protect anyone if the agreed responsibilities are not carried out. Study the narrative's emphasis on obedience rather than self-sufficiency."},
 'Genesis 8':{sections:[{heading:"Transition and recovery",body:"8:1–14 records receding waters and Noah's observations; 8:15–19 records the command to leave; 8:20–22 records worship and God's promise concerning the earth's seasons.",reference:"Genesis 8:15"}],takeaway:"Recovery requires distinguishing signs of improvement from authorization to resume normal operations. Noah observes changing conditions but leaves in response to God's command."},
 'Genesis 9':{sections:[{heading:"Covenant, restraint and signs",body:"9:1–7 renews the commission and establishes limits concerning blood and human life; 9:8–17 records the covenant and rainbow; 9:18–29 records the family episode and Noah's words.",reference:"Genesis 9:6"}],takeaway:"Renewal requires explicit commitments and safeguards. A covenant sign preserves institutional memory; the protection of human life constrains the exercise of authority."},
 'Genesis 10':{sections:[{heading:"Peoples and institutional memory",body:"10:1–5 traces Japheth's descendants; 10:6–20 traces Ham's descendants; 10:21–32 traces Shem's descendants and the distribution of families and nations.",reference:"Genesis 10:32"}],takeaway:"Distinguish genealogy, geography and political identity. Good institutional records preserve relationships without implying that ancestry determines moral worth or competence."},
 'Genesis 11':{sections:[{heading:"Collective ambition and the limits of unity",body:"11:1–9 records the city's collective ambition and dispersion; 11:10–26 traces Shem's descendants; 11:27–32 records Terah's household and migration.",reference:"Genesis 11:4"}],takeaway:"Coordination is a capability, not proof of a legitimate purpose. Evaluate a collective project's stated motive, its accountability and its alignment with the entrusted mandate."},
 'Genesis 12':{sections:[{heading:"Commission, promise and integrity",body:"12:1–9 records Abram's call, promise and journey; 12:10–20 records famine, the Egypt episode and Pharaoh's response.",reference:"Genesis 12:2"}],takeaway:"A calling does not exempt its recipient from ethical accountability under pressure. Compare Abram's obedience to the commission with the consequences of his conduct in Egypt."},
 'Genesis 13':{sections:[{heading:"Resource pressure and conflict prevention",body:"13:1–7 records the resource conflict; 13:8–13 records Abram's offer and Lot's choice; 13:14–18 records God's renewed promise.",reference:"Genesis 13:8"}],takeaway:"Resolve resource disputes before they damage relationships. Abram separates competing household operations and offers Lot a choice; evaluate the distinction between visible opportunity and long-term responsibility."},
 'Genesis 14':{sections:[{heading:"Loyalty, restitution and independence",body:"14:1–12 records the regional conflict and Lot's capture; 14:13–16 records his rescue; 14:17–24 records Melchizedek's blessing and Abram's refusal of the king of Sodom's goods.",reference:"Genesis 14:23"}],takeaway:"Study the distinction between recovering what is owed and accepting benefits that could compromise independence. Abram protects his household relationships and recognizes legitimate shares for others."},
 'Genesis 15':{sections:[{heading:"Promise and uncertainty",body:"15:1–6 records God's promise and Abram's trust; 15:7–16 records the question about inheritance and future affliction; 15:17–21 records the covenant.",reference:"Genesis 15:6"}],takeaway:"A long-term commission can outlast the recipient's lifetime. Distinguish a promised outcome from the timeline and intermediate hardships; maintain faithfulness without inventing certainty about dates."},
 'Genesis 16':{sections:[{heading:"Premature solutions and human cost",body:"16:1–6 records Sarai's proposal, Hagar's pregnancy and conflict; 16:7–14 records God's encounter with Hagar; 16:15–16 records Ishmael's birth.",reference:"Genesis 16:6"}],takeaway:"A decision aimed at solving a leadership problem can transfer its cost to vulnerable people. Examine consent, responsibility and the consequences of treating people as instruments of a plan."},
 'Genesis 17':{sections:[{heading:"Covenant identity and obligations",body:"17:1–8 records the covenant and Abraham's new name; 17:9–14 sets the covenant sign; 17:15–22 identifies Sarah and Isaac in the promise; 17:23–27 records compliance.",reference:"Genesis 17:1"}],takeaway:"Identity and obligation belong together. A sign of membership is not a substitute for faithful conduct; distinguish institutional inclusion from the specific responsibilities assigned by the covenant."},
 'Genesis 18':{sections:[{heading:"Hospitality, disclosure and intercession",body:"18:1–15 records hospitality and the promise of a son; 18:16–21 records disclosure concerning Sodom; 18:22–33 records Abraham's intercession.",reference:"Genesis 18:25"}],takeaway:"Leadership includes hospitality, moral responsibility and advocacy. Abraham's concern for justice shows the value of asking whether a decision distinguishes the innocent from the guilty."},
 'Genesis 19':{sections:[{heading:"Urgency, judgment and consequences",body:"19:1–11 records Lot's hospitality and the city's violence; 19:12–29 records the warning, escape and destruction; 19:30–38 records the later family episode.",reference:"Genesis 19:16"}],takeaway:"Study how warning, hesitation and compromised environments affect decision-making. The narrative does not justify violence against outsiders or mistreatment of vulnerable people; it records judgment and its consequences."},
 'Genesis 20':{sections:[{heading:"Disclosure and responsibility",body:"20:1–7 records Abraham's description of Sarah and God's warning to Abimelech; 20:8–13 records the confrontation; 20:14–18 records restitution and restoration.",reference:"Genesis 20:9"}],takeaway:"A leader's partial disclosure can expose others to consequences they did not knowingly accept. Accountability includes correcting misinformation and restoring what was affected."},
 'Judges 8':{sections:[
  {heading:'A dispute resolved',body:'Ephraim challenges Gideon over its late summons. He honors their contribution and their anger subsides.',reference:'Judges 8:1'},
  {heading:'The pursuit completed',body:'Gideon and his weary men continue after Zebah and Zalmunna. Succoth and Penuel refuse assistance; Gideon captures the kings and returns.',reference:'Judges 8:4'},
  {heading:'A kingdom refused, an ephod made',body:'Gideon refuses hereditary rule, saying the Lord shall rule over Israel. He then makes a golden ephod that becomes a snare to him and his household.',reference:'Judges 8:22'},
  {heading:'Rest and renewed unfaithfulness',body:'The land rests forty years. After Gideon dies, Israel returns to the Baals and forgets the Lord and Gideon’s kindness.',reference:'Judges 8:28'}
 ],takeaway:'Leadership competence: distinguish operational success from institutional durability. Gideon resolves a dispute by publicly recognizing another group’s contribution (8:1–3), rejects hereditary office (8:22–23), yet creates an object that becomes a snare (8:27). The organization fails to preserve allegiance after his death (8:33–35). Audit recognition, stewardship of symbols, accountability and succession separately; success in one does not guarantee success in another.'},
 'Judges 7':{sections:[{heading:'God reduces the army',body:'God chooses 300 men so Israel cannot boast that its own strength saved it.',reference:'Judges 7:2'},{heading:'Reassurance and victory',body:'Gideon hears a dream in the enemy camp and worships. God turns the Midianites against one another.',reference:'Judges 7:9'},{heading:'Ephraim joins the pursuit',body:'Gideon calls Ephraim to intercept the fleeing enemy; they capture Oreb and Zeeb.',reference:'Judges 7:24'}],takeaway:'Leadership competence: distinguish the source of authority from numerical strength. The text explicitly gives the reason for reducing the army in 7:2: Israel must not claim credit for deliverance. Compare the allocation of responsibility in 7:24 with the recognition dispute in 8:1–3. Assess whether your organization measures faithful execution rather than headcount or personal prestige.'},
 'Judges 6':{sections:[{heading:'Israel cries out',body:'Midian oppresses Israel; God sends a prophet reminding Israel of His deliverance and their disobedience.',reference:'Judges 6:1'},{heading:'Gideon is called',body:'The Lord commissions Gideon to deliver Israel and reassures him of His presence.',reference:'Judges 6:11'},{heading:'Obedience and assurance',body:'Gideon destroys Baal’s altar and later seeks reassurance through the fleece.',reference:'Judges 6:25'}],takeaway:'Leadership competence: diagnose the underlying failure before assuming responsibility. The prophetic message in 6:8–10 precedes Gideon’s commission. Gideon must address his own household’s allegiance before leading others (6:25–32). Distinguish appointment, personal credibility and demonstrated obedience.'}
};
export function ChapterSummary({reference,onNavigate}:{reference:string;onNavigate?:Navigate}){
 const target=parseBibleReadingReference(reference);
 if(!target)return null;
 const name=BIBLE_BOOKS[target.bookIndex].name+' '+target.chapter;
 const entry=summaries[name];
 return <details key={name} className="group mt-5 rounded-2xl border border-brass/40 bg-surface/90">
  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-bold text-ink [&::-webkit-details-marker]:hidden"><BookOpen size={18} className="text-brass"/> Chapter Summary <ChevronDown size={16} className="ml-auto text-brass transition-transform group-open:rotate-180"/></summary>
  <div className="space-y-3 border-t border-border p-4">
   {entry?<>{entry.sections.map(section=><div key={section.reference} className="border-l-2 border-brass/40 pl-3 space-y-1"><p className="font-semibold text-sm text-ink">{section.heading}</p><p className="text-sm leading-relaxed text-ink">{section.body}</p><PassageLink reference={section.reference} onNavigate={onNavigate}/></div>)}<div className="rounded-xl bg-brass/10 p-3"><p className="text-xs font-bold text-brass">Key takeaway</p><p className="mt-1 text-sm text-ink">{entry.takeaway}</p></div></>:<p className="text-sm text-stone">A reviewed written summary for {name} has not yet been added.</p>}
  </div>
 </details>;
}
