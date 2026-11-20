import { useEffect,useState } from 'react';
import { supabase } from '../lib/supabase';
import { currentInterTentFixture } from '../lib/interTentChampionship';
import { useInterTentChampionships } from '../hooks/useInterTentChampionships';
import { InterTentMatchCard } from './InterTentMatchCard';

export function useInterTentWelcomeSlide(viewerId: string|undefined, openArena:()=>void) {
  const {events,scores}=useInterTentChampionships(viewerId);
  const current=currentInterTentFixture(events);
  const fixture=current?.fixture;
  const [avatars,setAvatars]=useState<Record<string,string|null>>({});
  const ids=[...new Set(fixture?.sides.flatMap(s=>s.players.map(p=>p.id))||[])].sort().join(',');
  useEffect(()=>{if(!ids)return;let active=true;void supabase.from('profiles').select('id,avatar_url').in('id',ids.split(',')).then(({data,error})=>{if(active&&!error)setAvatars(Object.fromEntries((data||[]).map(p=>[p.id,p.avatar_url])));});return()=>{active=false;};},[ids]);
  if(!current||!fixture)return null;
  return <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="eyebrow text-gold">{fixture.room_status==='playing'?'Live championship':'Next championship match'}</p><button type="button" onClick={openArena} className="btn-ghost text-[11px] font-semibold text-ink">View Arena fixtures</button></div><InterTentMatchCard compact fixture={fixture} avatars={avatars} participant={fixture.sides.some(s=>s.players.some(p=>p.id===viewerId))} draft={current.event.status==='draft'} livePlayers={fixture.room_id?scores.get(fixture.room_id):undefined} onOpen={openArena}/></div>;
}
