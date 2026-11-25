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
type Navigate = (location: BibleReadingLocation) => void;
function PassageLink({ reference, end, onNavigate }: { reference: string; end?: string; onNavigate?: Navigate }) {
  const location = parseBibleReadingReference(reference);
  if (!location) return null;
  const text = end ? reference + ' – ' + end : reference;
  return <button type="button" disabled={!onNavigate} onClick={() => onNavigate?.(location)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm font-semibold text-ink hover:border-brass/60">
    <span>{text}</span><ArrowUpRight size={14} className="shrink-0 text-brass"/>
  </button>;
}
export function VerseThreads({reference, links, onNavigate}: {reference:string; links:LinkRow[]|undefined; onNavigate?:Navigate}) {
  const [limit,setLimit]=useState(20);
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
  const rows=links ?? (local?.ref===reference?local.rows:undefined);
  return <details onToggle={event=>setOpen(event.currentTarget.open)} className="group my-1 rounded-xl border border-border bg-surface/80">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-bold text-brass [&::-webkit-details-marker]:hidden"><GitBranch size={16}/> Threads
      {rows!==undefined && <span className="rounded-full bg-brass/10 px-2 py-0.5 tabular-nums">{rows.length}</span>}
      <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180"/>
    </summary>
    <div className="space-y-2 border-t border-border p-3">
      <p className="text-xs text-stone">Passages connected to {reference}. Connections may reflect quotations, parallel accounts, prophecy or shared themes.</p>
      {rows===undefined ? <p className="text-xs text-stone" role="status">{failed?'Threads could not load.':'Loading threads…'} {failed&&<button className="underline" onClick={()=>setRetry(n=>n+1)}>Retry</button>}</p> : rows.length===0 ? <p className="text-xs text-stone">No indexed connections for this verse.</p> : <>
        <div className="grid max-h-80 gap-1.5 overflow-y-auto">{rows.slice(0,limit).map(([ref,end])=><PassageLink key={ref+'|'+end} reference={ref} end={end} onNavigate={onNavigate}/>)}</div>
        {limit<rows.length&&<button type="button" className="btn-ghost w-full text-xs" onClick={()=>setLimit(n=>n+30)}>Show more · {rows.length-limit} remaining</button>}
      </>}
      <p className="text-[10px] text-stone">Cross-reference data: <a className="underline" href="https://www.openbible.info/labs/cross-references/" target="_blank" rel="noreferrer">OpenBible.info</a> · CC BY 4.0 · links are study aids, not claims that every connection is a direct prophecy.</p>
    </div>
  </details>;
}
type ContextEntry={summary:string; links:string[]};
const curated:Record<string,ContextEntry>={
  'Judges 8':{summary:'God called Gideon to deliver Israel from Midian. He reduced the army to 300 men, then gave Israel victory. During the pursuit Gideon summoned Ephraim to seize the waters and the Ephraimites captured Oreb and Zeeb. Chapter 8 opens with their complaint that Gideon had not summoned them at the outset of battle.',links:['Judges 6:14','Judges 7:7','Judges 7:22','Judges 7:24','Judges 7:25']},
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
