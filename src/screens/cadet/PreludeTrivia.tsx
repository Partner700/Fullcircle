import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Loader2, RefreshCw, Trophy, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { forfeitPrelude, preludeCommand, type PreludeState } from '../../lib/scriptureGames';
import { userFacingError } from '../../lib/connectionErrors';
import { safeStorageGet, safeStorageSet, safeStorageRemove } from '../../lib/safeStorage';
import { PreludeTable, PreludePlayerStacks, PreludeCardFace } from '../../components/PreludeTable';
import type { PanelImageSetting } from '../../lib/types';

type Room = Pick<PreludeState,'id'|'name'|'phase'|'difficulty'|'players'|'creatorId'>;
export default function PreludeTrivia({arenaImage,onBack,initialRoomId,onBalanceChanged}:{arenaImage:PanelImageSetting|null;onBack:()=>void;initialRoomId?:string;onBalanceChanged?:()=>void}) {
 const {profile}=useAuth();
 const savedKey=`full-circle:prelude:${profile?.id || ''}`;
 const [roomId,setRoomId]=useState<string|null>(()=>initialRoomId || safeStorageGet('local',savedKey));
 const [game,setGame]=useState<PreludeState|null>(null);
 const [rooms,setRooms]=useState<Room[]>([]);
 const [difficulty,setDifficulty]=useState<'easy'|'hard'>('easy');
 const [name,setName]=useState('The Prelude');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [confirmForfeit,setConfirmForfeit]=useState(false);
 const viewGeneration=useRef(0);
 const [answers,setAnswers]=useState<number[]>([]);
 const [now,setNow]=useState(Date.now());
 const inFlight=useRef(false);
 const seenVersion=useRef(-1);
 const version=game?.version;
 const refreshList=useCallback(async()=>{try{setRooms(await preludeCommand('list') as Room[]);}catch(failure){setError(userFacingError(failure,'Rooms could not load.'));}},[]);
 const accept=useCallback((next:PreludeState)=>{
  if(next.version<seenVersion.current)return;
  seenVersion.current=next.version;setGame({...next,players:next.players.map(player=>player.id==='machine'?{...player,name:'The Scribe'}:player)});setError('');setRoomId(next.id);safeStorageSet('local',savedKey,next.id);
 },[savedKey]);
 const command=async(action:string,args:Record<string,unknown>={})=>{
  if(inFlight.current)return;
  inFlight.current=true;setBusy(true);setError('');
  try{
   const next=await preludeCommand(action,{...(roomId?{p_room_id:roomId}:{}),p_version:game?.version,...args}) as PreludeState;
   accept(next);setAnswers([]);
   if(next.phase==='completed')onBalanceChanged?.();
  }catch(failure){setError(userFacingError(failure,'The game could not update. Please refresh.'));}
  finally{inFlight.current=false;setBusy(false);}
 };
 useEffect(()=>{
  let active=true;
  const generation=viewGeneration.current;
  const refresh=async()=>{
   if(document.visibilityState!=='visible' || inFlight.current)return;
   if(!roomId){void refreshList();return;}
   try{const next=await preludeCommand('state',{p_room_id:roomId}) as PreludeState;if(active && generation===viewGeneration.current)accept(next);}
   catch(failure){if(active)setError(userFacingError(failure,'The room could not refresh.'));}
  };
  void refresh();const interval=window.setInterval(()=>void refresh(),roomId?1250:15000);
  return()=>{active=false;window.clearInterval(interval);};
 },[roomId,accept,refreshList]);
 useEffect(()=>{setAnswers([]);},[version]);
 useEffect(()=>{const interval=window.setInterval(()=>setNow(Date.now()),500);return()=>window.clearInterval(interval);},[]);
 const leaveView=()=>{viewGeneration.current+=1;setConfirmForfeit(false);setRoomId(null);setGame(null);seenVersion.current=-1;safeStorageRemove('local',savedKey);setError('');void refreshList();};
 const forfeit=async()=>{
  if(!roomId || inFlight.current)return;
  inFlight.current=true;setBusy(true);setError('');
  try{
   await forfeitPrelude(roomId);
   leaveView();onBalanceChanged?.();onBack();
  }catch(failure){setError(userFacingError(failure,'The round could not be forfeited. Please try again.'));}
  finally{inFlight.current=false;setBusy(false);}
 };
 const current=game?.players[game.turn];
 const myTurn=current?.id===profile?.id;
 const scribeTurn=current?.id==='machine';
 const scribeSelection=scribeTurn?game?.pending?.scribeSelection:null;
 const displayedAnswers=scribeTurn?scribeSelection||[]:answers;
 const seconds=game?.deadline?Math.max(0,Math.ceil((new Date(game.deadline).getTime()-now)/1000)):0;
 const winner=game?.players.find(player=>player.id===game.winnerId);
 const waitingTime=game?.startsAt?Math.max(0,Math.ceil((new Date(game.startsAt).getTime()-now)/1000)):0;
 return <section className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-2xl border border-gold/25 bg-navy p-4 text-white sm:p-6" aria-label="The Prelude">
  <PanelImageBackdrop image={arenaImage} opacityFallback={38} veilClassName="arena-panel-veil" simple/>
  <div className="relative z-10 space-y-4">
   <header className="flex items-center justify-between gap-3"><button type="button" onClick={game?leaveView:onBack} className="flex items-center gap-1 rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-xs"><ArrowLeft size={15}/>{game?'Rooms':'Back'}</button><div className="text-center"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-gold">Numbers of Scripture</p><h2 className="font-display text-2xl font-bold">The Prelude</h2></div>{busy?<Loader2 className="animate-spin" size={18}/>:<Users size={20} className="text-gold"/>}</header>
   {error && <div role="alert" className="rounded-lg border border-coral/40 bg-black/60 p-3 text-sm text-coral">{error}<div className="mt-2 flex gap-2"><button type="button" className="btn-secondary text-xs" onClick={()=>roomId?void command('state'):void refreshList()}><RefreshCw size={12}/> Refresh</button>{roomId && <button type="button" className="btn-secondary text-xs" onClick={leaveView}>Back to rooms</button>}</div></div>}
   {!roomId && <>
    <p className="text-sm leading-relaxed text-white/85">Flip a card. Match the number or tent symbol, then answer correctly to collect the whole open board. A joker collects it immediately.</p>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-3 rounded-xl border border-white/20 bg-black/45 p-4"><h3 className="font-display text-lg font-bold text-gold">Open a table</h3><label className="block text-xs">Room name<input className="mt-1 w-full rounded-lg border border-white/25 bg-navy px-3 py-2 text-white" maxLength={50} value={name} onChange={event=>setName(event.target.value)}/></label><label className="block text-xs">Difficulty<select className="mt-1 w-full rounded-lg border border-white/25 bg-navy px-3 py-2 text-white" value={difficulty} onChange={event=>setDifficulty(event.target.value as 'easy'|'hard')}><option value="easy">Easy · choose one answer</option><option value="hard">Hard · select all correct answers</option></select></label><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn-primary text-xs" onClick={()=>void command('create',{p_difficulty:difficulty,p_machine:false,p_name:name})}>Multiplayer · up to 10</button><button type="button" disabled={busy} className="btn-secondary text-xs" onClick={()=>void command('create',{p_difficulty:difficulty,p_machine:true,p_name:name})}>Play the Scribe</button></div></div>
    <div className="rounded-xl border border-white/20 bg-black/45 p-4"><h3 className="font-display text-lg font-bold text-gold">Open tables</h3><div className="mt-3 space-y-2">{rooms.length?rooms.map(room=><div key={room.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/15 p-3"><div><p className="text-sm font-bold">{room.name.replace(/\s*\[arena:prelude\]/gi,'')}</p><p className="mt-1 text-xs text-white/70">{room.players.length} players · {room.difficulty} · {room.phase}</p></div><button type="button" disabled={busy} className="btn-secondary text-xs" onClick={()=>{seenVersion.current=-1;void command('join',{p_room_id:room.id});}}>{room.phase==='playing'?'Resume':'Join'}</button></div>):<p className="text-xs text-white/70">No open tables yet. Create one or play the Machine.</p>}</div></div></div>
   </>}
   {roomId && !game && !error && <p role="status" className="text-center text-sm"><Loader2 className="mx-auto mb-2 animate-spin"/>Opening your table...</p>}
   {game && <>
    {(game.phase==='playing'||game.phase==='question') && game.players.some(player=>player.id===profile?.id) && <div className="rounded-xl border border-white/20 bg-black/50 p-3">
     {confirmForfeit?<div role="alert" className="space-y-3"><p className="text-sm">Forfeit this round? You will leave the match and cannot rejoin it.</p><div className="flex gap-2"><button type="button" disabled={busy} className="btn-secondary text-xs" onClick={()=>setConfirmForfeit(false)}>Keep playing</button><button type="button" disabled={busy} className="btn-secondary text-xs" onClick={()=>void forfeit()}>{busy?'Forfeiting…':'Confirm forfeit'}</button></div></div>:<button type="button" disabled={busy} className="btn-secondary text-xs" onClick={()=>setConfirmForfeit(true)}>Forfeit round</button>}
    </div>}
    <PreludePlayerStacks players={game.players} currentPlayerId={game.phase==='playing'||game.phase==='question'?current?.id:undefined} userId={profile?.id}/>
    {game.phase==='waiting' && <div className="rounded-xl border border-gold/30 bg-black/45 p-5 text-center"><h3 className="font-display text-xl text-gold">Waiting at the table</h3><p className="mt-2 text-sm">{game.players.length}/{game.maxPlayers} players · {game.difficulty==='hard'?'Select all correct answers':'Multiple choice'}</p>{waitingTime>0 && <p className="mt-2 text-xs">Scheduled start in {Math.floor(waitingTime/60)}m {waitingTime%60}s</p>}{(game.creatorId===profile?.id||(game.startsAt&&game.players.some(player=>player.id===profile?.id))) && <button type="button" disabled={busy||game.players.length<2||waitingTime>0} onClick={()=>void command('start')} className="btn-primary mt-4">Start round</button>}<p className="mt-3 text-xs text-white/65">104 cards · 100 numbered cards + four jokers · No entry fee</p></div>}
    {(game.phase==='playing'||game.phase==='question') && <>
     <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/20 bg-black/50 p-3"><p className="text-sm font-bold text-gold">{myTurn?'Your turn':`${current?.name}’s turn`}</p><p className="flex items-center gap-1 text-xs"><Clock3 size={14}/>{seconds}s · {game.cards.length} unused cards</p></div>
     {game.phase==='question' && game.pending && <div className="rounded-xl border border-gold/40 bg-black/75 p-4"><p className="text-xs font-bold uppercase text-gold">{scribeTurn?'The Scribe’s question':game.pending.multiple?'Select all correct answers':'Choose one answer'}</p><div className="mt-2 flex items-center gap-3">{game.board.length>0&&<div key={game.moves?.[game.moves.length-1]?.id || game.version} className="prelude-question-card h-16 w-11 shrink-0"><PreludeCardFace card={game.board[game.board.length-1]}/></div>}<h3 className="font-display text-lg font-bold">What does {game.pending.number} represent in Scripture?</h3></div><div role="group" aria-label="Scripture answers" className="mt-3 space-y-2">{game.pending.options.map(option=><label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${displayedAnswers.includes(option.id)?'border-gold bg-gold/15':'border-white/25 bg-white/5'}`}><input type={game.pending?.multiple?'checkbox':'radio'} name="prelude-answer" disabled={!myTurn||busy} checked={displayedAnswers.includes(option.id)} onChange={()=>setAnswers(previous=>game.pending?.multiple?previous.includes(option.id)?previous.filter(id=>id!==option.id):[...previous,option.id]:[option.id])} className="mt-1 accent-yellow-400"/><span>{option.text}</span></label>)}</div>{scribeTurn && <p role="status" className="mt-3 text-sm font-semibold text-gold">
       {scribeSelection?(game.pending.scribeCorrect?'The Scribe answered correctly.':'The Scribe answered incorrectly.'):'The Scribe is thinking…'}
      </p>}{myTurn && <button type="button" disabled={busy||!answers.length||!seconds} onClick={()=>void command('answer',{p_answers:answers})} className="btn-primary mt-4">Submit answer</button>}</div>}
     <PreludeTable game={game} canFlip={myTurn&&game.phase==='playing'&&seconds>0} busy={busy} onFlip={slot=>command('flip',{p_slot:slot})}/>

    </>}
    {game.notice && <p role="status" className="rounded-lg bg-black/60 p-3 text-center text-sm text-gold">{game.notice}</p>}
    {game.phase==='completed' && <div className="rounded-xl border border-gold/40 bg-black/60 p-5 text-center"><Trophy className="mx-auto text-gold" size={36}/><h3 className="mt-2 font-display text-2xl font-bold">{winner?`${winner.name} wins!`:'Round closed'}</h3><p className="mt-2 text-sm text-gold">{winner?.cards} cards collected{game.reward?' · 1,000 Denarii awarded':''}</p><button type="button" className="btn-primary mt-4" onClick={leaveView}>Back to tables</button></div>}
   </>}
   <p className="text-center text-[10px] leading-relaxed text-white/65">10 seconds per question. The round ends only when all closed stacks are empty. Most collected cards wins 1,000 Denarii. Ties: more correct answers, then earliest capture. A missed match or wrong answer becomes the next target. Leaving this view does not pause a round.</p>
  </div>
 </section>;
}
