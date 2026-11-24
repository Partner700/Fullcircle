import { useEffect, useState } from 'react';
import { ChevronDown, CalendarClock, Trophy, RotateCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchArenaInvitees } from '../lib/queries';
import { DAVID_GROUPS, type InterTentChampionship, type InterTentGroup } from '../lib/interTentChampionship';
import type { PanelImageSetting } from '../lib/types';
import { InterTentMatchCard } from './InterTentMatchCard';
import { AppSelect } from './AppSelect';
import { useInterTentChampionships } from '../hooks/useInterTentChampionships';

const groupKeys: InterTentGroup[] = ['A','B','C','D'];
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', {timeZone:'Africa/Douala',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value));
type Candidate = { id: string; name: string };

export function InterTentChampionshipPanel({ instructor, viewerId, arenaImage, witnessOnly, onScheduled, onOpenRoom, onShareRoom }: { instructor: boolean; viewerId: string; arenaImage?: PanelImageSetting | null; witnessOnly?: boolean; onScheduled: () => void | Promise<void>; onOpenRoom: (id:string,participant:boolean,status:'waiting'|'playing') => Promise<void>; onShareRoom?: (id:string) => void | Promise<void> }) {
  const {events,refresh,available:enabled,failed,scores}=useInterTentChampionships(viewerId);
  const [players,setPlayers] = useState<Candidate[]>([]);
  const [avatars,setAvatars] = useState<Record<string,string|null>>({});
  const [groups,setGroups] = useState<Record<string,string[]>>({});
  const [firstTuesday,setFirstTuesday] = useState('2026-11-24');
  const [editing,setEditing] = useState<string|null>(null);
  const [rescheduleTimes,setRescheduleTimes] = useState<Record<string,string>>({});
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  useEffect(()=>{if(failed&&instructor&&!enabled)setMessage('The Inter-Tent Championship service is not available yet.');},[failed,instructor,enabled]);
  // Group positions belong to tents, not individual residents. Weigh each
  // resident's points by their actual played matches before ranking tents.
  const tentStandings = (standings: InterTentChampionship['standings']) => {
    const byTent = new Map<string, { tent_id: string; name: string; points: number; matches: number }>();
    for (const person of standings) {
      const prior = byTent.get(person.tent_id) || { tent_id: person.tent_id, name: person.tent_name, points: 0, matches: 0 };
      prior.points += Number(person.points) || 0;
      prior.matches += Number(person.matches) || 0;
      byTent.set(person.tent_id, prior);
    }
    return [...byTent.values()].map(row => ({ ...row, average: row.matches ? row.points / row.matches : 0 }))
      .sort((a, b) => b.average - a.average || b.points - a.points || a.name.localeCompare(b.name));
  };
  const fixturePlayerIds = [...new Set(events.flatMap(e=>e.fixtures.flatMap(f=>f.sides.flatMap(s=>s.players.map(p=>p.id)))))].sort().join(',');
  useEffect(() => {
    if (!fixturePlayerIds) return;
    let alive=true;
    void supabase.from('profiles').select('id,avatar_url').in('id',fixturePlayerIds.split(',')).then(({data,error})=>{
      if (alive && !error) setAvatars(Object.fromEntries((data||[]).map(p=>[p.id,p.avatar_url])));
    });
    return ()=>{alive=false;};
  },[fixturePlayerIds]);
  useEffect(() => {
    if (!instructor || !enabled) return;
    let alive=true;
    void fetchArenaInvitees().then(rows => {
      if(!alive) return;
      const options=rows.filter(p=>p.role==='cadet').map(p=>({id:p.user_id,name:p.profiles.display_name || 'Cadet'}));
      setPlayers(options);
      setGroups(Object.fromEntries(groupKeys.map(g=>[g,DAVID_GROUPS[g].map(name=>{
        const matches=options.filter(p=>p.name===name);return matches.length===1?matches[0].id:'';
      })])));
    }).catch(()=>setMessage('The cadet roster could not load.'));
    return ()=>{alive=false;};
  },[instructor,enabled]);

  const create = async () => {
    setBusy(true);setMessage('');
    try {
      if(groupKeys.some(g=>!groups[g] || groups[g].length!==4 || groups[g].some(id=>!id) || new Set(groups[g]).size!==4)) throw new Error('Select four different cadets for each group.');
      const {error}=await supabase.rpc('create_intertent_david_championship',{p_groups:groups,p_first_tuesday:firstTuesday,p_existing:editing});
      if(error) throw new Error(error.message);
      setEditing(null);await refresh();setMessage('The fixture list is published as a qualification-pending draft.');
    }catch(e){setMessage(e instanceof Error?e.message:'The championship could not be created.');}finally{setBusy(false);}
  };
  const activate = async (id:string) => {
    setBusy(true);setMessage('');
    try {
      const {error}=await supabase.rpc('activate_intertent_championship',{p_championship:id});
      if(error) throw new Error(error.message);
      await Promise.all([refresh(),onScheduled()]);setMessage('Championship activated. Qualified players have been notified.');
    }catch(e){setMessage(e instanceof Error?e.message:'The championship could not be activated.');}finally{setBusy(false);}
  };
  const editDraft = (event:InterTentChampionship) => {
    setGroups(Object.fromEntries(groupKeys.map(g=>[g,event.fixtures.find(f=>f.group_key===g&&f.leg===1)?.sides.flatMap(side=>side.players.map(p=>p.id))||[]])));
    const first=event.fixtures.find(f=>f.sequence===2);
    if(first) setFirstTuesday(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Douala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(first.planned_at)));
    setEditing(event.id);
  };
  const reschedule=async(id:string)=>{
    setBusy(true);setMessage('');
    try {
      const value=rescheduleTimes[id];
      if(!value) throw new Error('Select the new Cameroon date and time.');
      const {error}=await supabase.rpc('reschedule_intertent_fixture',{p_fixture:id,p_planned_at:`${value}:00+01:00`});
      if(error) throw new Error(error.message);
      await Promise.all([refresh(),onScheduled()]);setMessage('Fixture rescheduled.');
    }catch(e){setMessage(e instanceof Error?e.message:'The fixture could not be rescheduled.');}finally{setBusy(false);}
  };
  if(!enabled && !instructor) return null;
  if(!events.length && !instructor) return null;
  return <section className="card p-4 space-y-4">
    <div className="flex items-center justify-between gap-2">
      <div><p className="eyebrow text-brass">Journey Trivia</p><h3 className="mt-1 font-display font-bold text-ink text-lg">Inter-Tent Championship</h3></div>
      <button type="button" onClick={()=>void refresh()} className="btn-ghost" aria-label="Refresh championship"><RotateCw size={16}/></button>
    </div>
    <p className="text-xs text-stone">Four weeks · 16 group fixtures · Same-tent sides · Highest average points per tent qualifies · Two-leg semifinal · One-leg final.</p>
    {instructor && enabled && (editing || !events.some(e=>e.status!=='completed')) && <div className="space-y-3 border-b border-border pb-4">
      <label className="block text-xs font-semibold text-stone">First Tuesday (Cameroon)<input type="date" className="input-field mt-1" value={firstTuesday} onChange={e=>setFirstTuesday(e.target.value)}/></label>
      {groupKeys.map(g=><div key={g}><p className="font-display font-bold text-ink text-sm mb-1">Group {g}</p><div className="grid grid-cols-2 gap-2">{[0,1,2,3].map(i=><AppSelect key={i} ariaLabel={`Group ${g} player ${i+1}`} searchable value={groups[g]?.[i]||''} placeholder="Choose cadet" options={[{value:'',label:'Choose cadet'},...players.map(p=>({value:p.id,label:p.name}))]} onChange={id=>setGroups(prev=>({...prev,[g]:Array.from({length:4},(_,j)=>j===i?id:prev[g]?.[j]||'')}))}/>)}</div></div>)}
      <button type="button" className="btn-primary" disabled={busy || !players.length} onClick={()=>void create()}><CalendarClock size={15}/> {editing?'Save draft changes':'Publish draft fixtures'}</button>
      {editing&&<button type="button" className="btn-secondary" onClick={()=>setEditing(null)}>Cancel editing</button>}
    </div>}
    {events.map(event=><div key={event.id} className="space-y-3 border-b border-border pb-4">
      <h4 className="font-display font-bold text-ink">{event.title}</h4>
      <p className="text-xs text-stone">Opening: {dateLabel(event.opening_at)} · Cameroon time · {event.status==='draft'?'Qualification pending':event.status}</p>
      {event.champion && <p className="text-gold font-bold"><Trophy size={16} className="inline mr-1"/> Champion: {event.champion}</p>}
      {event.can_manage && event.status==='draft' && <div className="rounded-md border border-border p-3 text-xs space-y-2">
        <p className="font-bold text-ink">Qualification · 500 Figs and 3 Rhudes required</p>
        {event.eligibility.map(p=><p key={p.user_id} className={p.qualified?'text-sage':'text-coral'}>{p.name} · {p.qualified?'Qualified':'Pending qualification'}</p>)}
        <button type="button" className="btn-primary text-xs" disabled={busy||Boolean(editing)||!event.eligibility.length||event.eligibility.some(p=>!p.qualified)} onClick={()=>void activate(event.id)}>Activate and notify players</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={()=>editDraft(event)}>Edit draft players and dates</button>
      </div>}
      {event.fixtures.filter(f => f.room_status === 'playing').map(f => {
        const participant = !witnessOnly && f.sides.some(side => side.players.some(player => player.id === viewerId));
        return <InterTentMatchCard key={f.id} fixture={f} avatars={avatars} arenaImage={arenaImage}
          participant={participant} draft={false} livePlayers={f.room_id ? scores.get(f.room_id) : undefined}
          onOpen={() => void onOpenRoom(f.room_id!, participant, 'playing')}
          onShare={onShareRoom && f.room_id ? () => void onShareRoom(f.room_id!) : undefined} />;
      })}
      <details className="group rounded-xl border border-border bg-surface/30" aria-label={`${event.title} scheduled matches`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <h5 className="font-display text-sm font-semibold text-ink">Scheduled matches · {event.fixtures.filter(f => f.room_status !== 'playing').length}</h5>
            <p className="mt-0.5 text-xs text-stone">{event.fixtures.filter(f => f.room_status === 'playing').length} live · {event.fixtures.filter(f => Boolean(f.result)).length} completed · Tap to view matches</p>
          </div>
          <ChevronDown size={18} className="shrink-0 text-gold transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 border-t border-border p-3">
        {event.fixtures.filter(f => f.room_status !== 'playing').map(f=>{const participant=!witnessOnly&&f.sides.some(s=>s.players.some(p=>p.id===viewerId));return <InterTentMatchCard key={f.id} fixture={f} avatars={avatars} arenaImage={arenaImage} participant={participant} draft={event.status==='draft'} livePlayers={f.room_id?scores.get(f.room_id):undefined} onOpen={()=>void onOpenRoom(f.room_id!,participant,f.room_status as 'waiting'|'playing')} onShare={onShareRoom&&f.room_id?()=>void onShareRoom(f.room_id!):undefined}>
          {event.can_manage && ['scheduled','playing'].includes(event.status) && !f.result && f.sides.length>0 && !['playing'].includes(f.room_status || '') && <div className="flex flex-wrap gap-2 items-end w-full text-xs">
            <label className="text-stone flex-1 min-w-0">New time (Cameroon)<input type="datetime-local" className="input-field mt-1" value={rescheduleTimes[f.id]||''} onChange={e=>setRescheduleTimes(prev=>({...prev,[f.id]:e.target.value}))}/></label>
            <button type="button" className="btn-secondary text-xs" disabled={busy||!rescheduleTimes[f.id]} onClick={()=>void reschedule(f.id)}>Reschedule</button>
          </div>}
        </InterTentMatchCard>})}
        </div>
      </details>
      {event.standings.length>0 && <><h4 className="font-display font-bold text-ink">Group standings</h4><p className="text-xs text-stone">Average points per played match; ties use average correct answers, then average game score.</p><div className="divide-y divide-border">{tentStandings(event.standings).map((tent, index)=><div key={tent.tent_id} className="py-2 flex justify-between gap-2 text-xs"><div><p className="font-semibold text-ink">{index + 1}. {tent.name}</p><p className="text-stone">{tent.matches} resident match appearances · {tent.points} total points</p></div><p className="text-gold font-bold">{tent.average.toFixed(2)}</p></div>)}</div></>}
      {event.semifinal_standings?.length>0&&<><h4 className="font-display font-bold text-ink">Semifinal standings</h4><p className="text-xs text-stone">Two-leg combined points. The two highest advance.</p><div className="divide-y divide-border">{event.semifinal_standings.map(p=><div key={p.user_id} className="py-2 flex justify-between gap-2 text-xs"><div><p className="font-semibold text-ink">{p.name}</p><p className="text-stone">{p.tent_name} · {p.matches}/2 legs played</p></div><p className="text-gold font-bold">{p.points} pts</p></div>)}</div></>}
    </div>)}
    {message&&<p role="status" className="text-xs text-stone">{message}</p>}
  </section>;
}
