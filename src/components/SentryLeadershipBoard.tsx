import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { boardCategory } from '../lib/boardCategories';
import { fetchBoardAvatars, fetchPanelImageSetting } from '../lib/queries';
import type { PanelImageSetting } from '../lib/types';
import { BoardList, BoardRow } from './BoardRow';
import { ChallengeBoardPanel } from './ChallengeBoardPanel';
import { BadgeCheck, Clock, Trophy, Users } from 'lucide-react';
import { EmptyState } from './AppShell';
import { cn, getTodayISODate } from '../lib/utils';
import { updateLeadershipHistory, type LeadershipHistory, type LeadershipMovement } from '../lib/leadershipBoardMovement';
import { ChallengeBoardMovementSummary } from './ChallengeBoardMovementSummary';

type Row = {user_id: string; display_name: string; command_score: number; rite_count: number; rank?: number};
export function SentryLeadershipBoard({ kind, viewerId, boardImage, houseIds }: {kind: 'command' | 'rite'; viewerId?: string; boardImage?: PanelImageSetting | null; houseIds?: Record<string,string | null | undefined>}) {
  const [period,setPeriod] = useState('day');
  const [rows,setRows] = useState<(Row & LeadershipMovement & { rank: number })[]>([]);
  const histories = useRef<Record<string, LeadershipHistory>>({});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [artwork,setArtwork] = useState<PanelImageSetting | null>(null);
  const [avatars,setAvatars] = useState<Record<string,string|null>>({});
  const [lastUpdated,setLastUpdated] = useState<Date | null>(null);
  useEffect(() => {
    if(boardImage !== undefined) return;
    let active=true;
    void fetchPanelImageSetting('leaderboard').then(image=>{if(active)setArtwork(image);}).catch(()=>{});
    return()=>{active=false;};
  },[boardImage]);
  useEffect(() => {
    let active=true;
    setLoading(true); setError(''); setRows([]);
    const storageKey=`full-circle-leadership-history-${viewerId??'observer'}-${kind}-${kind==='rite'?'lifetime':period}`;
    if (!histories.current[storageKey]) {
      try { histories.current[storageKey] = JSON.parse(window.localStorage.getItem(storageKey)||'{}') || {}; } catch { histories.current[storageKey] = {}; }
    }
    const refresh=async()=>{
      const {data,error}=await supabase.rpc('get_sentry_leadership_board',{p_period:kind==='rite'?'day':period});
      if(!active)return;
      if(error){setError('Could not load leadership rankings.');setRows([]);} else {
        const next=(data??[]) as Row[];
        const value=(row:Row)=>Number(kind==='command'?row.command_score:row.rite_count)||0;
        const ranked=[...next].sort((a,b)=>value(b)-value(a)||a.user_id.localeCompare(b.user_id)).map((row,index)=>({...row,rank:index+1}));
        const snapshot=updateLeadershipHistory(ranked,value,histories.current[storageKey],getTodayISODate());
        histories.current[storageKey]=snapshot.history;
        try { window.localStorage.setItem(storageKey,JSON.stringify(snapshot.history)); } catch { /* in-memory fallback */ }
        setRows(snapshot.rows);setError('');setLastUpdated(new Date());
        void fetchBoardAvatars(next.map(row=>row.user_id)).then(result=>{if(active)setAvatars(result);}).catch(()=>{});
      }
      setLoading(false);
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),60_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[kind,period,viewerId]);
  const score=(row:Row)=>Number(kind==='command'?row.command_score:row.rite_count)||0;
  const group=boardCategory(rows,viewerId,r=>r.user_id,score);
  const image=boardImage===undefined?artwork:boardImage;
  const Icon=kind==='command'?Users:BadgeCheck;
  return <div className="space-y-4">
    <ChallengeBoardPanel image={image}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={20} className="text-gold" />
        <h3 className="font-display font-semibold text-ink">{kind==='command'?'Command Board':'Rite Board'}</h3>
        <span className="badge badge-moss text-[10px] inline-flex items-center gap-1"><Clock size={10} /> Live</span>
      </div>
      <p className="text-xs text-stone">{kind==='command'?'Cadets who fulfill daily streak requirements. Longer periods show the average daily active cadets.':'Residents developed into Sentries through your tent. Each qualified Sentry counts once.'}</p>
      {kind==='command'&&<div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{[['day','Daily'],['week','Weekly'],['month','Monthly'],['year','Annual']].map(([key,label])=><button key={key} type="button" className={cn('flex min-w-max items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all whitespace-nowrap sm:px-4 sm:text-sm',period===key?'border-brass bg-brass-soft text-brass shadow-sm':'border-border bg-surface/70 text-stone hover:border-border-bright hover:text-ink')} aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}</div>}
    </ChallengeBoardPanel>
    <ChallengeBoardPanel image={image}>
      {loading?<p className="py-8 text-center text-sm text-stone">Loading leadership rankings…</p>:error?<p role="alert" className="text-coral text-sm">{error}</p>:rows.length?<>
        <ChallengeBoardMovementSummary rising={group.rows.filter(row=>row.movement===1).length} falling={group.rows.filter(row=>row.movement===-1).length} records={group.rows.filter(row=>row.isRecord).length} />
        <p className="mt-4 mb-3 text-xs font-semibold text-stone">{group.observer?'Viewing: ':'Your category: '}{group.label}</p>
        {lastUpdated&&<p className="text-xs text-stone mb-3">Live as of {lastUpdated.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p>}
        <BoardList>{group.rows.map(row=><BoardRow key={row.user_id} rank={row.rank} name={row.display_name} userId={row.user_id} avatarUrl={avatars[row.user_id]} houseId={houseIds?.[row.user_id]||undefined} currentUserId={viewerId} isCurrentUser={row.user_id===viewerId} value={score(row).toLocaleString()} movement={row.movement} isRecord={row.isRecord} valueLabel={kind==='command'?'Active cadets':'Sentries developed'} />)}</BoardList>
      </>:<EmptyState icon={Trophy} title="No data yet" message="Leadership records will appear here as cadets complete their daily requirements and become Sentries." />}
    </ChallengeBoardPanel>
  </div>;
}
