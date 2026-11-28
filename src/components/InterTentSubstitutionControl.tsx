import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { sendJourneyCommand } from '../lib/journeyClient';

type Options={sentrySeat:number|null;substitutionRemaining:number;substitutes:Array<{id:string;name:string}>};
export function InterTentSubstitutionControl({roomId,onChanged}:{roomId:string;onChanged:()=>void}){
  const [options,setOptions]=useState<Options|null>(null);const [loaded,setLoaded]=useState(false);const [replacement,setReplacement]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const load=async()=>{const r=await supabase.rpc('get_intertent_duel_roles',{p_room_id:roomId});setLoaded(true);setOptions(r.error?null:r.data as Options|null);};
  const substitute=async()=>{if(!replacement||busy)return;setBusy(true);setMessage('');try{await sendJourneyCommand(roomId,'DUEL_SUBSTITUTE',0,crypto.randomUUID(),{replacementId:replacement});setReplacement('');await load();onChanged();setMessage('Representative substituted.');}catch(e){setMessage(e instanceof Error?e.message:'Substitution failed.');}finally{setBusy(false);}};
  return <details className="rounded-lg border border-gold/25 p-2 text-xs" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary className="cursor-pointer font-semibold text-ink">Sentry · Substitute representative</summary>{loaded&&!options?.sentrySeat?<p className="mt-2 text-stone">No substitution controls for this fixture.</p>:options?.sentrySeat?<div className="mt-2 space-y-2"><p className="text-stone">{options.substitutionRemaining} substitution remaining</p>{options.substitutionRemaining>0&&<><select className="input-field" value={replacement} onChange={e=>setReplacement(e.target.value)} aria-label="Replacement representative"><option value="">Choose a resident</option>{options.substitutes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button className="btn-primary" disabled={!replacement||busy} onClick={()=>void substitute()}>Substitute</button></>}{message&&<p role="status">{message}</p>}</div>:<p className="mt-2 text-stone">Loading…</p>}</details>;
}
