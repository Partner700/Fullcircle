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
  'Judges 8':{summary:'God called Gideon to deliver Israel from Midian. He reduced the army to 300 men, then gave Israel victory. During the pursuit Gideon summoned Ephraim to seize the waters and the Ephraimites captured Oreb and Zeeb. Chapter 8 opens with their complaint about not being summoned at the beginning, even though they had joined the later pursuit. See Judges 8:1 Threads for the explanation.',links:['Judges 6:14','Judges 7:7','Judges 7:22','Judges 7:24','Judges 7:25']},
  'Judges 7':{summary:'Midian had oppressed Israel. God called Gideon while he was threshing wheat, instructed him to tear down Baal’s altar and reassured him with the signs involving the fleece. Gideon now gathers the people for the battle.',links:['Judges 6:11','Judges 6:14','Judges 6:25','Judges 6:36']},
  'Judges 6':{summary:'After Deborah and Barak’s victory, the land had rest for forty years. Israel again did evil, and the Lord delivered them into Midian’s hand for seven years. Gideon’s calling answers Israel’s cry.',links:['Judges 4:14','Judges 5:31']},
  'Genesis 3':{summary:'God created humanity in His image, placed Adam in Eden and commanded him not to eat from the tree of the knowledge of good and evil. God also formed Eve. Chapter 3 introduces the serpent’s temptation against that command.',links:['Genesis 1:27','Genesis 2:16','Genesis 2:22']},
  'Genesis 12':{summary:'Genesis traces the descendants of Shem to Terah and Abram. Terah’s family left Ur for Canaan but settled in Haran. God now calls Abram to leave his country and promises blessing to the families of the earth.',links:['Genesis 11:10','Genesis 11:27','Genesis 11:31']},
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
