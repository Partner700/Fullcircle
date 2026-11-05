import { useCallback, useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { purchaseRelic } from '../lib/queries';
import { userFacingError } from '../lib/connectionErrors';

type Status={server_now:string;record_date:string;expires_at:string|null;owned:number;cost:number};
export function MeditationExtension({userId,date,onWindowChange}:{userId:string;date:string;onWindowChange:(active:boolean)=>void}){
 const [status,setStatus]=useState<Status|null>(null);
 const [offset,setOffset]=useState(0);
 const [now,setNow]=useState(Date.now());
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const accept=useCallback((data:Status)=>{setStatus(data);setOffset(new Date(data.server_now).getTime()-Date.now());setNow(Date.now());},[]);
 const refresh=useCallback(async()=>{
  const {data,error:failure}=await supabase.rpc('get_meditation_extension_status');
  if(failure)throw failure;accept(data as Status);
 },[accept]);
 useEffect(()=>{
  let active=true;
  const load=()=>{if(document.visibilityState==='visible')void refresh().catch(failure=>{if(active)setError(userFacingError(failure,'The meditation window could not load.'));});};
  load();const poll=window.setInterval(load,30000);const clock=window.setInterval(()=>setNow(Date.now()),1000);
  document.addEventListener('visibilitychange',load);
  return()=>{active=false;window.clearInterval(poll);window.clearInterval(clock);document.removeEventListener('visibilitychange',load);};
 },[refresh,date]);
 const remaining=status?.record_date===date&&status.expires_at?Math.max(0,Math.ceil((new Date(status.expires_at).getTime()-now-offset)/1000)):0;
 const active=remaining>0;
 useEffect(()=>{onWindowChange(active);return()=>onWindowChange(false);},[active,onWindowChange]);
 const use=async(buy:boolean)=>{
  if(busy||active)return;setBusy(true);setError('');
  try{
   if(buy)await purchaseRelic(userId,'hezekiahs-sundial');
   const {data,error:failure}=await supabase.rpc('use_meditation_extension');
   if(failure)throw failure;accept(data as Status);
  }catch(failure){setError(userFacingError(failure,'The relic could not be activated.'));void refresh().catch(()=>undefined);}
  finally{setBusy(false);}
 };
 return <section className="my-3 rounded-lg border border-brass/30 bg-gold-soft p-3 text-xs text-ink" aria-label="Meditation extension">
  <h4 className="flex items-center gap-2 font-bold"><Clock3 size={16}/> Hezekiah&apos;s Sundial</h4>
  {active?<p role="status" className="mt-2 font-bold text-moss">Submission window open · {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')} remaining</p>:<p className="mt-2">The 9 PM deadline has passed. Activate one relic for a fresh 15-minute meditation window. Every window closes at midnight Cameroon time.</p>}
  <p className="mt-1 text-stone">{Number(status?.owned||0)} owned · {status?.cost||6000} Denarii per use</p>
  {!active&&status?.record_date===date&&<button type="button" disabled={busy} className="btn-secondary mt-2 text-xs" onClick={()=>void use(Number(status.owned)<1)}>{busy?'Opening window…':Number(status.owned)>0?'Use relic · open 15 minutes':`Buy & use · ${status.cost} Denarii`}</button>}
  {error&&<p role="alert" className="mt-2 text-coral">{error}</p>}
 </section>;
}
