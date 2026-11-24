import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Dove } from './Dove';
import { TentHouseSymbol } from './TentHouseSymbol';
import { UserAvatar } from './UserAvatar';
import { PRELUDE_RING, preludeStacks } from '../lib/preludeTable';
import type { PreludeCard, PreludeMove, PreludePlayer, PreludeState } from '../lib/scriptureGames';

export function PreludeCardFace({card}:{card:PreludeCard}) {
 return <div className="prelude-card-face">
  <span className="prelude-card-corner">{card.joker?'★':card.number}</span>
  {card.joker?<span className="text-3xl text-brass" aria-label="Joker">★</span>:card.symbol?<TentHouseSymbol houseId={card.symbol} size={36}/>:null}
  <span className="prelude-card-corner prelude-card-corner-bottom">{card.joker?'★':card.number}</span>
 </div>;
}
function CardBack(){return <div className="prelude-card-back"><Dove size={48} className="h-auto w-4/5 max-w-12"/></div>;}
export function PreludePlayerStacks({players,currentPlayerId,userId}:{players:PreludePlayer[];currentPlayerId?:string;userId?:string}) {
 const [selected,setSelected]=useState<string|null>(null);
 const player=players.find(item=>item.id===selected);
 return <section aria-label="Players and collected card stacks" className="space-y-3">
  <div className="flex gap-2 overflow-x-auto pb-2">{players.map(item=><button key={item.id} type="button" aria-expanded={selected===item.id} onClick={()=>setSelected(previous=>previous===item.id?null:item.id)} className={`flex w-40 shrink-0 items-center gap-3 rounded-xl border p-3 text-left ${currentPlayerId===item.id?'border-gold bg-gold/20':'border-white/20 bg-black/50'}`} aria-label={`${item.name}${item.id===userId?', you':''}, collected stack: ${item.cards} cards`}>
   <span className="prelude-player-pile" aria-hidden="true">{item.cards>0?<>{item.cards>2&&<span className="prelude-pile-sheet prelude-pile-sheet-third"/>}{item.cards>1&&<span className="prelude-pile-sheet prelude-pile-sheet-second"/>}<span className="prelude-player-pile-top">{item.collected?.length?<PreludeCardFace card={item.collected[item.collected.length-1]}/>:<CardBack/>}</span><strong className="prelude-pile-count">{item.cards}</strong></>:<span className="flex h-full items-center justify-center rounded border border-dashed border-white/25 text-xs text-white/55">0</span>}</span>
   <span className="min-w-0 flex-1"><span className="flex items-center gap-1">{item.id==='machine'?<span aria-hidden="true">⚙</span>:<UserAvatar userId={item.id} name={item.name} avatarUrl={item.avatar} className="h-5 w-5 shrink-0"/>}<span className="truncate text-xs font-bold">{item.name}</span></span><span className="mt-1 block text-[10px] text-gold">{item.id===userId?'Your stack':'Collected stack'} · {item.cards}</span><span className="block text-[10px] text-white/70">{item.correct} correct · View cards</span></span>
  </button>)}</div>
  {player&&<div className="rounded-xl border border-gold/30 bg-black/70 p-3"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-gold">{player.id===userId?'Your':`${player.name}’s`} stack · {player.cards} cards</h3><button type="button" onClick={()=>setSelected(null)} className="rounded border border-white/25 px-2 py-1 text-xs">Close</button></div>{player.cards===0?<p className="text-xs text-white/65">No cards collected yet.</p>:<div className="grid grid-cols-5 gap-2 sm:grid-cols-8">{(player.collected||[]).map(card=><div key={card.slot} className="aspect-[2/3]" aria-label={card.joker?'Collected joker':`Collected ${card.number}, ${card.symbol}`}><PreludeCardFace card={card}/></div>)}{player.cards>(player.collected?.length||0)&&<div className="relative aspect-[2/3]"><CardBack/><span className="prelude-pile-count">+{player.cards-(player.collected?.length||0)}</span></div>}</div>}</div>}
 </section>;
}
export function PreludeTable({game,canFlip,busy,onFlip}:{game:PreludeState;canFlip:boolean;busy:boolean;onFlip:(slot:number)=>Promise<void>}) {
 const [queue,setQueue]=useState<PreludeMove[]>([]);
 const [pending,setPending]=useState<number|null>(null);
 const seen=useRef({room:'',serial:0});
 useEffect(()=>{
  const moves=game.moves || [];
  if(seen.current.room!==game.id){seen.current={room:game.id,serial:Math.max(0,...moves.map(move=>move.id))};setQueue([]);return;}
  const fresh=moves.filter(move=>move.id>seen.current.serial);
  if(fresh.length){seen.current.serial=Math.max(...fresh.map(move=>move.id));setQueue(previous=>[...previous,...fresh]);}
 },[game.id,game.moves]);
 const move=queue[0];
 useEffect(()=>{if(!move)return;const timer=window.setTimeout(()=>setQueue(previous=>previous.slice(1)),650);return()=>window.clearTimeout(timer);},[move]);
 const stacks=preludeStacks(game.cards);
 const target=game.board[game.board.length-1];
 const origin=move?PRELUDE_RING[move.card.slot%8]:null;
 const actor=game.players.find(player=>player.id===move?.playerId);
 const flip=async(slot:number)=>{if(!canFlip||busy||pending!==null||move)return;setPending(slot);try{await onFlip(slot);}finally{setPending(null);}};
 return <div className="space-y-2">
  <div className="prelude-table" aria-label={`Prelude card table, ${game.cards.length} unused cards in eight surrounding stacks`}>
   {PRELUDE_RING.map((position,index)=>{const pile=stacks[index];return <div key={index} className="prelude-ring-slot" style={{gridRow:position.row+1,gridColumn:position.col+1}}>{pile.length>0&&<button type="button" disabled={!canFlip||busy||pending!==null||Boolean(move)} onClick={()=>void flip(pile[0].slot)} aria-label={`Draw from stack ${index+1}, ${pile.length} unused cards`} className={`prelude-draw-pile ${pending===pile[0].slot?'prelude-pile-selected':''}`}>
    {pile.length>2&&<span className="prelude-pile-sheet prelude-pile-sheet-third"/>}{pile.length>1&&<span className="prelude-pile-sheet prelude-pile-sheet-second"/>}<span className="prelude-pile-top"><CardBack/></span><span className="prelude-pile-count">{pile.length}</span>
   </button>}</div>;})}
   <div className="prelude-center" style={{gridRow:2,gridColumn:2}}><p className="text-[9px] font-black uppercase tracking-wider text-gold">Match this card</p><div className="prelude-center-card">{target?<PreludeCardFace card={target}/>:<span className="flex h-full items-center justify-center text-xs text-white/65">Board cleared</span>}</div><p className="text-center text-[10px] text-white/75">Open pile: {game.board.length}</p></div>
   {move&&origin&&<div key={`${game.id}:${move.id}`} className="prelude-moving-card" aria-hidden="true" style={{'--prelude-left':`${(origin.col+0.5)*100/3}%`,'--prelude-top':`${(origin.row+0.5)*100/3}%`} as CSSProperties}><div className="prelude-flipping-card"><div className="prelude-flip-front"><PreludeCardFace card={move.card}/></div><div className="prelude-flip-back"><CardBack/></div></div></div>}
  </div>
  <p role="status" className="min-h-5 text-center text-xs text-gold">{move?`${actor?.name || 'A player'} flipped ${move.card.joker?'a joker':move.card.number}.`:`${game.cards.length} unused cards left · Draw from a surrounding stack`}</p>
  <p className="text-center text-[10px] text-white/65">Flipped cards are used once and leave these stacks. The newest open card is the target; a correct answer or joker captures the open pile.</p>
 </div>;
}
