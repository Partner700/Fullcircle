import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/connectionErrors';

const RELICS = [
 { slug: 'sword-goliath', name: 'Sword of Goliath', detail: 'Complete this puzzle. Assisted words earn no FIGS.' },
 { slug: 'talking-donkey', name: 'Talking Donkey', detail: 'Check your connected letters against the selected word before submitting.' },
 { slug: 'witch-ball-endor', name: 'Crystal Ball of Endor', detail: 'Reveal the selected word.' },
 { slug: 'hint', name: 'Hint', detail: 'Reveal a clue and the first letter.' },
 { slug: 'eliminate', name: 'Eliminate', detail: 'Dim letters outside the selected word.' },
 { slug: 'freeze-timer', name: 'Freeze Timer', detail: 'Add 60 seconds once per round.' },
 { slug: 'skip', name: 'Skip', detail: 'Complete the selected word without FIGS.' },
 { slug: 'reveal-reference', name: 'Reveal Reference', detail: 'Unlock the selected word’s Scripture reference.' },
] as const;
export type PuzzleRelicSlug = typeof RELICS[number]['slug'];

export function PuzzleRelics({ userId, playing, busy, used, roundUsed, hasSelection, onUse }: {
 userId: string; playing: boolean; busy: boolean; used: string[]; roundUsed: string[]; hasSelection: boolean;
 onUse: (slug: PuzzleRelicSlug) => Promise<boolean>;
}) {
 const [inventory,setInventory]=useState<Record<string,number>>({});
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 const [using,setUsing]=useState<PuzzleRelicSlug|null>(null);
 const inFlight=useRef(false);
 useEffect(()=>{
  let active=true;setLoading(true);
  void supabase.from('relic_inventory').select('quantity,relic_types!inner(slug)').eq('user_id',userId)
   .gt('quantity',0).in('relic_types.slug',RELICS.map(relic=>relic.slug)).then(({data,error:failure})=>{
    if(!active)return;
    if(failure)setError(userFacingError(failure,'Your relics could not load.'));
    else{
     const owned:Record<string,number>={};
     for(const row of data||[]){const type=Array.isArray(row.relic_types)?row.relic_types[0]:row.relic_types;if(type?.slug)owned[type.slug]=(owned[type.slug]||0)+row.quantity;}
     setInventory(owned);setError('');
    }
    setLoading(false);
   });
  return()=>{active=false;};
 },[userId,retry]);
 const use=async(slug:PuzzleRelicSlug)=>{
  if(inFlight.current||busy)return;
  inFlight.current=true;setUsing(slug);
  try{if(await onUse(slug))setRetry(value=>value+1);}
  catch(failure){setError(userFacingError(failure,'The relic could not be used.'));}
  finally{inFlight.current=false;setUsing(null);}
 };
 const owned=RELICS.filter(relic=>inventory[relic.slug]>0);
 return <div className="mt-3 border-t border-border pt-3" aria-label="Owned Puzzle Trivia relics">
  <h4 className="text-xs font-bold">Your puzzle relics</h4>
  {loading&&<p role="status" className="mt-2 text-xs text-stone">Loading relics…</p>}
  <div className="mt-2 flex flex-wrap gap-2">{owned.map(relic=>{
   const alreadyUsed=['sword-goliath','freeze-timer'].includes(relic.slug)?roundUsed.includes(relic.slug):used.includes(relic.slug);
   const needsLetters=relic.slug==='talking-donkey'&&!hasSelection;
   return <button key={relic.slug} type="button" title={relic.detail} disabled={busy||!!using||loading||alreadyUsed||!playing&&relic.slug!=='reveal-reference'||needsLetters}
    onClick={()=>void use(relic.slug)} className="btn-secondary text-xs disabled:opacity-40">{using===relic.slug?'Using…':relic.name} · {inventory[relic.slug]}{alreadyUsed?' · used':''}{needsLetters?' · connect letters first':''}</button>;
  })}</div>
  {!loading&&!error&&!owned.length&&<p className="mt-2 text-xs text-stone">You do not own a relic that can be used in this puzzle. Quiz, streak and wallet relics stay in their own sections.</p>}
  {error&&<div role="alert" className="mt-2 text-xs text-coral">{error}<button type="button" className="btn-secondary ml-2 text-xs" onClick={()=>setRetry(value=>value+1)}>Retry relics</button></div>}
 </div>;
}
