import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchArenaMatchups } from '../lib/queries';
import { type InterTentChampionship } from '../lib/interTentChampionship';
import type { ArenaMatchupPlayer } from '../lib/arenaMatchup';

export function useInterTentChampionships(viewerId?: string) {
  const [snapshot,setSnapshot] = useState<{viewerId:string;events:InterTentChampionship[]} | null>(null);
  const [scores,setScores] = useState<{viewerId:string;rooms:Map<string,ArenaMatchupPlayer[]>} | null>(null);
  const [available,setAvailable] = useState(false);
  const [failed,setFailed] = useState(false);
  const pending = useRef<Promise<void>|null>(null);
  const events = snapshot&&snapshot.viewerId===viewerId ? snapshot.events : [];
  const liveIds = events.flatMap(e=>e.fixtures.filter(f=>f.room_status==='playing'&&f.room_id).map(f=>f.room_id!)).sort().join(',');
  const refresh = useCallback(async()=>{
    if(!viewerId) return;
    const {data,error}=await supabase.rpc('get_intertent_championships');
    if(error){setFailed(true);return;}
    setSnapshot({viewerId,events:Array.isArray(data)?data as InterTentChampionship[]:[]});
    setAvailable(true);setFailed(false);
  },[viewerId]);
  useEffect(()=>{
    if(!viewerId)return;
    const check=()=>{if(document.visibilityState==='hidden'||pending.current)return;const work=refresh().catch(()=>setFailed(true)).finally(()=>{if(pending.current===work)pending.current=null;});pending.current=work;};
    check();const timer=window.setInterval(check,liveIds?5000:15000);
    document.addEventListener('visibilitychange',check);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',check);};
  },[viewerId,refresh,liveIds]);
  useEffect(()=>{
    if(!viewerId||!liveIds)return;
    let active=true,busy=false;
    const load=async()=>{if(busy||document.visibilityState==='hidden')return;busy=true;try{const rooms=await fetchArenaMatchups(liveIds.split(',')) as Map<string,ArenaMatchupPlayer[]>;if(active)setScores({viewerId,rooms});}catch{/* Retain the last real score until refresh succeeds. */}finally{busy=false;}};
    void load();const timer=window.setInterval(()=>void load(),5000);
    document.addEventListener('visibilitychange',load);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[viewerId,liveIds]);
  return {events,refresh,available,failed,scores:scores&&scores.viewerId===viewerId?scores.rooms:new Map<string,ArenaMatchupPlayer[]>()};
}
