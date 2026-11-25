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
  const failures = useRef(0);
  const cooldownUntil = useRef(0);
  const scoreFailures = useRef(0);
  const scoreCooldownUntil = useRef(0);
  // Spread simultaneous viewers across several seconds instead of hitting
  // Supabase with synchronized polls whenever a match opens.
  const pollJitterMs = viewerId
    ? Array.from(viewerId).reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 0) % 3_000
    : 0;
  const events = snapshot&&snapshot.viewerId===viewerId ? snapshot.events : [];
  const liveIds = events.flatMap(e=>e.fixtures.filter(f=>f.room_status==='playing'&&f.room_id).map(f=>f.room_id!)).sort().join(',');
  const refresh = useCallback(async()=>{
    if(!viewerId) return;
    const {data,error}=await supabase.rpc('get_intertent_championships');
    if(error){
      failures.current = Math.min(failures.current + 1, 5);
      cooldownUntil.current = Date.now() + Math.min(120_000, 15_000 * (2 ** (failures.current - 1)));
      setFailed(true);
      return;
    }
    failures.current = 0;
    cooldownUntil.current = 0;
    setSnapshot({viewerId,events:Array.isArray(data)?data as InterTentChampionship[]:[]});
    setAvailable(true);setFailed(false);
  },[viewerId]);
  useEffect(()=>{
    if(!viewerId)return;
    const check=()=>{if(document.visibilityState==='hidden'||pending.current||Date.now()<cooldownUntil.current)return;const work=refresh().catch(()=>setFailed(true)).finally(()=>{if(pending.current===work)pending.current=null;});pending.current=work;};
    check();const timer=window.setInterval(check,(liveIds?15_000:45_000)+pollJitterMs);
    document.addEventListener('visibilitychange',check);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',check);};
  },[viewerId,refresh,liveIds,pollJitterMs]);
  useEffect(()=>{
    if(!viewerId||!liveIds)return;
    let active=true,busy=false;
    const load=async()=>{if(busy||document.visibilityState==='hidden'||Date.now()<scoreCooldownUntil.current)return;busy=true;try{const rooms=await fetchArenaMatchups(liveIds.split(',')) as Map<string,ArenaMatchupPlayer[]>;scoreFailures.current=0;scoreCooldownUntil.current=0;if(active)setScores({viewerId,rooms});}catch{scoreFailures.current=Math.min(scoreFailures.current+1,5);scoreCooldownUntil.current=Date.now()+Math.min(120_000,15_000*(2**(scoreFailures.current-1)));/* Retain the last real score until refresh succeeds. */}finally{busy=false;}};
    void load();const timer=window.setInterval(()=>void load(),15_000+pollJitterMs);
    document.addEventListener('visibilitychange',load);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[viewerId,liveIds,pollJitterMs]);
  return {events,refresh,available,failed,scores:scores&&scores.viewerId===viewerId?scores.rooms:new Map<string,ArenaMatchupPlayer[]>()};
}
