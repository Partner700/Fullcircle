import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ArenaMarketRelics } from './ArenaMarketRelics';
import { sendJourneyCommand } from '../lib/journeyClient';
import type { JourneyPublicState } from '../../supabase/functions/_shared/biblicalJourneyRuntime';

type Roles={stage:'group'|'semi'|'final';homePlayerId:string;awayPlayerId:string;spiritUserId:string|null;remaining:number;requestQuestionId:string|null;candidates:Array<{id:string;name:string}>};
export function InterTentSpiritControls({roomId,userId,state,onChanged}:{roomId:string;userId:string;state:JourneyPublicState;onChanged:()=>void}) {
  const [roles,setRoles]=useState<Roles|null>(null);
  const [candidate,setCandidate]=useState('');
  const [answer,setAnswer]=useState('');
  const [order,setOrder]=useState<number[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const refresh=async()=>{const r=await supabase.rpc('get_intertent_duel_roles',{p_room_id:roomId});if(!r.error)setRoles(r.data as Roles|null);};
  useEffect(()=>{let active=true;let pending=false;const poll=async()=>{if(pending||document.visibilityState!=='visible')return;pending=true;try{const r=await supabase.rpc('get_intertent_duel_roles',{p_room_id:roomId});if(active&&!r.error){const roles=r.data as Roles|null;setRoles(roles);if(roles?.spiritUserId===userId)onChanged();}}finally{pending=false;}};void poll();const timer=window.setInterval(()=>void poll(),5000);return()=>{active=false;window.clearInterval(timer);};},[roomId,userId]);
  const question=state.currentQuestion;
  useEffect(()=>{setAnswer('');setOrder([]);},[question?.id]);
  if(!roles||roles.stage==='final'||(roles.homePlayerId!==userId&&roles.spiritUserId!==userId))return null;
  const open=Boolean(question&&state.currentQuestionPlayerId===roles.homePlayerId&&!state.awaitingRoll&&state.game.status==='playing'&&Date.now()<Date.parse(state.questionDeadline||'')&&!(Date.now()<Date.parse(state.pausedUntil||''))&&!state.game.shieldOffer);
  const boardOpen=state.game.status==='playing'&&!(Date.now()<Date.parse(state.pausedUntil||''))&&roles.remaining>0&&!busy;
  const shield=state.game.shieldOffer?.playerId===roles.homePlayerId&&Date.now()<Date.parse(state.game.shieldOffer.deadline);
  const withAction=async(action:()=>Promise<void>)=>{if(busy)return false;setBusy(true);setError('');try{await action();await refresh();onChanged();return true;}catch(e){setError(e instanceof Error?e.message:'Unable to complete assistance.');return false;}finally{setBusy(false);}};
  const send=(action:'SPIRIT_ANSWER'|'SPIRIT_RELIC',payload:Record<string,unknown>)=>withAction(async()=>{await sendJourneyCommand(roomId,action,state.game.version,crypto.randomUUID(),payload);});
  return <section className="card p-3 space-y-2 border border-gold/40" aria-label="Spirit Player">
    <div className="flex items-center justify-between"><h3 className="font-bold text-ink">🙏 Spirit Player</h3><span className="text-gold font-bold">{roles.remaining}/3 help remaining</span></div>
    {roles.homePlayerId===userId&&!roles.spiritUserId&&<><select className="input-field" value={candidate} onChange={e=>setCandidate(e.target.value)} aria-label="Select a Spirit Player"><option value="">Choose a same-tent witness</option>{roles.candidates.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="btn-primary" disabled={!candidate||busy} onClick={()=>void withAction(async()=>{const r=await supabase.rpc('choose_intertent_spirit',{p_room_id:roomId,p_witness:candidate});if(r.error)throw new Error(r.error.message);})}>Select Spirit Player</button></>}
    {roles.homePlayerId===userId&&roles.spiritUserId&&<button className="btn-primary" disabled={!open||busy||roles.remaining===0||roles.requestQuestionId===question?.id} onClick={()=>void withAction(async()=>{const r=await supabase.rpc('request_intertent_spirit_help',{p_room_id:roomId,p_question_id:question!.id});if(r.error)throw new Error(r.error.message);})}>🙏 {roles.requestQuestionId===question?.id?'Help requested':'Cry for help'}</button>}
    {roles.spiritUserId===userId&&<><p className="text-xs text-stone">You are assisting the home representative. Your relics and requested answers count toward the shared limit.</p>
      <ArenaMarketRelics userId={userId} questionType={question?.type||''} aid={state.questionAid} disabled={!open||busy||roles.remaining===0} onUse={slug=>send('SPIRIT_RELIC',{slug})} boardRelics={[
        {slug:'undo',usable:boardOpen&&!state.game.shieldOffer&&state.undoOffer?.playerId===roles.homePlayerId,use:()=>send('SPIRIT_RELIC',{slug:'undo'})},
        {slug:'standstill',usable:boardOpen&&!state.game.shieldOffer&&state.game.players[state.game.turnIndex]?.id===roles.homePlayerId,use:()=>send('SPIRIT_RELIC',{slug:'standstill'})},
        {slug:'the-ninety-nine',usable:boardOpen&&!state.game.shieldOffer&&(state.game.players.find(p=>p.id===roles.homePlayerId)?.recoverableBoardPoints??0)>0,use:()=>send('SPIRIT_RELIC',{slug:'the-ninety-nine'})},
        {slug:'shield-of-faith',usable:boardOpen&&Boolean(shield),use:()=>send('SPIRIT_RELIC',{slug:'shield-of-faith'})},
        {slug:'boomerang',usable:boardOpen&&Boolean(shield&&state.game.shieldOffer?.attackerId),use:()=>send('SPIRIT_RELIC',{slug:'boomerang'})},
      ]}/>
      {open&&roles.requestQuestionId===question?.id&&roles.remaining>0&&<div className="space-y-2"><p className="font-bold text-ink">{question.question}</p>{question.type==='true_false'||question.type==='multiple_choice'||question.type==='odd_one'?(question.type==='true_false'?['true','false']:question.options).filter(option=>!state.questionAid?.hiddenOptions.includes(option)).map(option=><button key={option} className="btn-secondary w-full" disabled={busy} onClick={()=>void send('SPIRIT_ANSWER',{answer:option})}>{option}</button>):question.type==='order_sequence'?<><p className="text-xs text-stone">Tap the events in order.</p><div className="flex flex-wrap gap-1">{order.map((index,position)=><button key={index} className="btn-secondary text-xs" onClick={()=>setOrder(prev=>prev.filter(v=>v!==index))}>{position+1}. {question.options[index]}</button>)}</div>{question.options.map((option,index)=><button key={index} className="btn-secondary w-full" disabled={order.includes(index)} onClick={()=>setOrder(prev=>[...prev,index])}>{option}</button>)}<button className="btn-primary" disabled={busy||order.length!==question.options.length} onClick={()=>void send('SPIRIT_ANSWER',{answer:order.map(index=>(question.options[index]?.match(/^([A-Z])\s*[.)]/i)?.[1]||String.fromCharCode(65+index)).toUpperCase()).join(' ')})}>Submit order</button></>:<><input className="input-field" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Answer for your teammate"/><button className="btn-primary" disabled={busy||!answer.trim()} onClick={()=>void send('SPIRIT_ANSWER',{answer})}>Submit answer</button></>}</div>}
    </>}
    {error&&<p role="alert" className="text-coral text-xs">{error}</p>}
  </section>;
}
