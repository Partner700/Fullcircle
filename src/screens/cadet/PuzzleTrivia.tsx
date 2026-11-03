import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Clock3, Lightbulb, RotateCcw, Shuffle, X } from 'lucide-react';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { useAuth } from '../../context/AuthContext';
import type { PanelImageSetting } from '../../lib/types';
import { recordPuzzleTriviaPlay } from '../../lib/queries';
import { safeJsonStorageGet, safeStorageSet } from '../../lib/safeStorage';
import { PUZZLE_DIFFICULTIES, PUZZLE_PACKS, puzzleForLevel, type PuzzleDifficulty } from '../../lib/puzzleTrivia';

type Round = { level: number; found: string[]; deadline: number | null; clues?: number[] };
const emptyRound = (): Round => ({ level: 0, found: [], deadline: null });
function readRound(key: string): Round {
 const saved = safeJsonStorageGet<Round | null>('local',key,null);
 if(!saved || !Number.isInteger(saved.level) || saved.level<0 || !Array.isArray(saved.found)
  || (saved.deadline!==null && !Number.isFinite(saved.deadline)))return emptyRound();
 return {...saved,found:saved.found.filter(word=>typeof word==='string')};
}
export default function PuzzleTrivia({ arenaImage, onBack }: { arenaImage: PanelImageSetting | null; onBack: () => void }) {
 const {profile}=useAuth();
 const [difficulty,setDifficulty]=useState<PuzzleDifficulty>('easy');
 const storageKey=`full-circle:puzzle-trivia:v1:${profile?.id || 'guest'}:${difficulty}`;
 const [round,setRound]=useState<Round>(()=>readRound(storageKey));
 const [now,setNow]=useState(Date.now());
 const [selection,setSelection]=useState<number[]>([]);
 const selectionRef=useRef<number[]>([]);
 const [letterOrder,setLetterOrder]=useState<number[]|null>(null);
 const [notice,setNotice]=useState('');
 const openClues=round.clues || [];
 const [saved,setSaved]=useState(true);
 const wheel=useRef<HTMLDivElement>(null);
 const pointer=useRef({active:false,dragged:false});
 const {pack,board}=useMemo(()=>puzzleForLevel(round.level,difficulty),[round.level,difficulty]);
 const config=PUZZLE_DIFFICULTIES[difficulty];
 const found=useMemo(()=>new Set(round.found.filter(word=>board.words.some(w=>w.word===word))),[round.found,board]);
 const complete=found.size===board.words.length;
 const remaining=round.deadline===null?config.seconds:Math.max(0,Math.ceil((round.deadline-now)/1000));
 const playing=round.deadline!==null && remaining>0 && !complete;
 const expired=round.deadline!==null && remaining===0 && !complete;
 const order=letterOrder || [...pack.letters].map((_,i)=>i);
 const currentWord=selection.map(index=>pack.letters[index]).join('');
 useEffect(()=>{setSaved(safeStorageSet('local',storageKey,JSON.stringify(round)));},[storageKey,round]);
 useEffect(()=>{
  if(!playing)return;
  const interval=window.setInterval(()=>setNow(Date.now()),500);
  return()=>window.clearInterval(interval);
 },[playing]);
 const setPath=(path:number[])=>{selectionRef.current=path;setSelection(path);};
 const choose=(index:number)=>{
  if(!playing)return;
  const path=selectionRef.current;
  if(path[path.length-1]===index)return;
  if(path.length>1 && path[path.length-2]===index)setPath(path.slice(0,-1));
  else if(!path.includes(index))setPath([...path,index]);
 };
 const submit=()=>{
  const word=selectionRef.current.map(index=>pack.letters[index]).join('');
  setPath([]);
  if(!round.deadline || Date.now()>=round.deadline || complete)return;
  if(!word)return;
  if(found.has(word)){setNotice(`${word} is already on the board.`);return;}
  if(!board.words.some(entry=>entry.word===word)){setNotice('That word is not one of this puzzle’s Bible answers. Try the clues.');return;}
  setRound(previous=>({...previous,found:[...new Set([...previous.found,word])]}));
  setNotice(`${word} — found!`);
  if(profile?.id)void recordPuzzleTriviaPlay(profile.id).catch(error=>console.warn('Puzzle activity could not be recorded:',error));
 };
 const start=()=>{setPath([]);setNotice('');setNow(Date.now());setRound(previous=>({...previous,found:[],clues:[],deadline:Date.now()+config.seconds*1000}));};
 const next=()=>{setPath([]);setNotice('');setLetterOrder(null);setRound(previous=>({level:previous.level+1,found:[],deadline:null}));};
 const changeDifficulty=(value:PuzzleDifficulty)=>{
  if(value===difficulty)return;
  setDifficulty(value);setRound(readRound(`full-circle:puzzle-trivia:v1:${profile?.id || 'guest'}:${value}`));
  setPath([]);setLetterOrder(null);setNotice('');setNow(Date.now());
 };
 const revealClue=(index:number)=>{
  if(openClues.includes(index))return;
  if(difficulty==='hard'){
   if(!playing)return;
   setRound(previous=>({...previous,deadline:previous.deadline===null?null:previous.deadline-15_000}));
   setNow(Date.now());setNotice('Clue revealed. 15 seconds used.');
  }
  setRound(previous=>({...previous,clues:[...new Set([...(previous.clues || []),index])]}));
 };
 const cells=new Map(board.cells.map(cell=>[`${cell.row},${cell.col}`,cell]));
 const starts=new Map(board.words.map((word,index)=>[`${word.row},${word.col}`,index+1]));
 const shuffle=()=>{
  const shuffled=[...order];
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  setLetterOrder(shuffled);setPath([]);
 };
 return <section className="relative isolate mx-auto max-w-3xl overflow-hidden rounded-2xl border border-gold/25 bg-navy p-4 text-white sm:p-6" aria-label="Puzzle Trivia">
  <PanelImageBackdrop image={arenaImage} opacityFallback={40} veilClassName="arena-panel-veil" simple />
  <div className="relative z-10 space-y-4">
   <header className="flex items-center justify-between gap-2">
    <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-xs"><ArrowLeft size={16}/> Back</button>
    <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-gold">Puzzle Trivia</p><h2 className="font-display text-lg font-bold">Level {round.level+1}</h2></div>
    <div className={`flex items-center gap-1 rounded-lg border border-white/25 bg-black/30 px-3 py-2 font-bold tabular-nums ${remaining<=30?'text-coral':'text-white'}`} aria-label={`${remaining} seconds remaining`}><Clock3 size={15}/>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</div>
   </header>
   <div role="group" aria-label="Puzzle difficulty" className="flex justify-center gap-2">
    {(Object.keys(PUZZLE_DIFFICULTIES) as PuzzleDifficulty[]).map(value=><button key={value} type="button" aria-pressed={difficulty===value} disabled={playing} onClick={()=>changeDifficulty(value)} className={`rounded-full border px-4 py-2 text-xs font-bold disabled:opacity-60 ${difficulty===value?'border-gold bg-gold text-navy':'border-white/25 bg-black/30 text-white'}`}>{PUZZLE_DIFFICULTIES[value].label}</button>)}
   </div>
   <div className="text-center"><h3 className="font-display text-base font-bold">{pack.title}</h3><p className="mt-1 text-xs text-white/80">{config.detail}</p><p className="mt-1 text-xs text-gold">{found.size} / {board.words.length} words · People, places and objects</p></div>
   <div className="mx-auto grid w-full max-w-lg gap-1 rounded-xl bg-black/25 p-2" style={{gridTemplateColumns:`repeat(${board.cols},minmax(0,1fr))`}} aria-label="Bible crossword board">
    {Array.from({length:board.rows*board.cols},(_,index)=>{
     const row=Math.floor(index/board.cols),col=index%board.cols,cell=cells.get(`${row},${col}`);
     if(!cell)return <div key={index} aria-hidden="true" className="aspect-square"/>;
     const revealed=cell.wordIndexes.some(i=>found.has(board.words[i].word));
     const number=starts.get(`${row},${col}`);
     return <div key={index} className={`relative flex aspect-square items-center justify-center rounded-md border font-bold shadow-sm ${revealed?'border-blue-300 bg-blue-600 text-white':'border-white/20 bg-black/65 text-white/80'}`} style={{fontSize:'clamp(12px,3.8vw,23px)'}} aria-label={revealed?cell.letter:'Empty letter square'}>
      {number && <span className="absolute left-0.5 top-0 text-[8px] font-normal leading-none text-white/70">{number}</span>}{revealed?cell.letter:''}
     </div>;
    })}
   </div>
   {round.deadline===null && <div className="space-y-2 text-center"><p className="text-xs text-white/80">Connect letters to fill the crossword. Each letter tile can be used once per word.</p><button type="button" className="btn-primary" onClick={start}>Start puzzle</button></div>}
   {complete && <div role="status" className="rounded-xl border border-gold/40 bg-black/45 p-4 text-center"><Check className="mx-auto text-gold"/><h3 className="mt-1 font-display text-xl font-bold text-gold">Puzzle complete!</h3><p className="mt-1 text-xs text-white/80">Every word tells part of the story.</p><button type="button" className="btn-primary mt-3" onClick={next}>{(round.level+1)%PUZZLE_PACKS.length===0?'Play the next cycle':'Next puzzle'}</button></div>}
   {expired && <div role="status" className="rounded-xl border border-coral/40 bg-black/45 p-4 text-center"><h3 className="font-display font-bold text-coral">Time is up</h3><p className="mt-1 text-xs text-white/80">You found {found.size} of {board.words.length}. The Scripture clues are still here to study.</p><button type="button" onClick={start} className="btn-primary mt-3"><RotateCcw size={14}/> Try again</button></div>}
   {!complete && round.deadline!==null && <>
    <div className="mx-auto flex min-h-10 max-w-xs items-center justify-center rounded-full border border-blue-300/40 bg-blue-700/70 px-5 py-2 font-display text-xl font-bold tracking-[.15em]" aria-live="polite">{currentWord || '•••'}</div>
    <div ref={wheel} className="relative mx-auto aspect-square w-full max-w-[290px] touch-none select-none rounded-full border border-white/20 bg-black/55 shadow-xl"
     onPointerDown={event=>{
      if(!playing)return;
      const target=(event.target as Element).closest<HTMLButtonElement>('[data-letter-index]');
      if(!target)return;
      pointer.current={active:true,dragged:false};event.currentTarget.setPointerCapture(event.pointerId);
      choose(Number(target.dataset.letterIndex));
     }}
     onPointerMove={event=>{
      if(!pointer.current.active || !playing)return;
      const buttons=wheel.current?.querySelectorAll<HTMLButtonElement>('[data-letter-index]');
      buttons?.forEach(button=>{const rect=button.getBoundingClientRect();if(Math.hypot(event.clientX-(rect.left+rect.width/2),event.clientY-(rect.top+rect.height/2))<rect.width/2){const index=Number(button.dataset.letterIndex);if(selectionRef.current[selectionRef.current.length-1]!==index){pointer.current.dragged=true;choose(index);}}});
     }}
     onPointerUp={()=>{const dragged=pointer.current.dragged;pointer.current={active:false,dragged:false};if(dragged)submit();}}
     onPointerCancel={()=>{pointer.current={active:false,dragged:false};setPath([]);}}>
     <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 290 290" aria-hidden="true"><polyline fill="none" stroke="#3b82f6" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" points={selection.map(index=>{const position=order.indexOf(index),angle=position/order.length*Math.PI*2-Math.PI/2;return `${145+Math.cos(angle)*106},${145+Math.sin(angle)*106}`;}).join(' ')}/></svg>
     {order.map((index,position)=>{const angle=position/order.length*Math.PI*2-Math.PI/2,selected=selection.includes(index);return <button key={index} type="button" data-letter-index={index} disabled={!playing} aria-pressed={selected} aria-label={`Letter ${pack.letters[index]}, tile ${index+1}`} onClick={event=>{if(event.detail===0)choose(index);}} className={`absolute flex h-11 w-11 items-center justify-center rounded-full font-display text-2xl font-black transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${selected?'bg-blue-600 text-white':'bg-white/10 text-white hover:bg-white/20'}`} style={{left:`${50+Math.cos(angle)*36.55}%`,top:`${50+Math.sin(angle)*36.55}%`,transform:'translate(-50%,-50%)'}}>{pack.letters[index]}</button>;})}
     <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest text-white/40">Connect</span>
    </div>
    <div className="flex flex-wrap justify-center gap-2"><button type="button" disabled={!playing} onClick={shuffle} className="btn-secondary text-xs"><Shuffle size={14}/> Shuffle</button><button type="button" disabled={!playing || !selection.length} onClick={()=>setPath([])} className="btn-secondary text-xs"><X size={14}/> Clear</button><button type="button" disabled={!playing || !selection.length} onClick={submit} className="btn-primary text-xs">Submit word</button></div>
    <p className="text-center text-[11px] text-white/70">Drag through letters, or tap tiles and press Submit word.</p>
   </>}
   {notice && <p role="status" className="text-center text-sm text-gold">{notice}</p>}
   <div className="space-y-2 rounded-xl border border-white/15 bg-black/45 p-3"><h3 className="text-xs font-bold uppercase tracking-wider text-gold">Scripture clues</h3>
    {board.words.map((entry,index)=>{const solved=found.has(entry.word),visible=difficulty!=='hard'||openClues.includes(index)||solved;return <div key={entry.word} className="border-t border-white/10 pt-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-bold">{index+1}. {entry.category} · {entry.word.length} letters {solved && <span className="text-gold">· {entry.word}</span>}</span>{!visible && <button type="button" disabled={!playing} onClick={()=>revealClue(index)} className="flex items-center gap-1 rounded border border-gold/35 px-2 py-1 text-gold disabled:opacity-50"><Lightbulb size={12}/> Clue −15s</button>}</div>{visible && <p className="mt-1 leading-relaxed text-white/85">{entry.clue} <span className="text-gold/90">{entry.reference}</span></p>}</div>;})}
   </div>
   <p className="text-center text-[10px] text-white/65">Solo Scripture practice · {saved?'Progress saved on this device':'Progress cannot be saved in this browser'} · Timer continues if you leave an active round.</p>
  </div>
 </section>;
}
