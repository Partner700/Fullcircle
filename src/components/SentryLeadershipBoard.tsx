import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { boardCategory } from '../lib/boardCategories';

type Row = {user_id: string; display_name: string; command_score: number; rite_count: number; rank?: number};
export function SentryLeadershipBoard({ kind, viewerId }: {kind: 'command' | 'rite'; viewerId?: string}) {
  const [period,setPeriod] = useState('day');
  const [rows,setRows] = useState<Row[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  useEffect(() => {
    let active=true;
    setLoading(true); setError('');
    const refresh=async()=>{
      const {data,error}=await supabase.rpc('get_sentry_leadership_board',{p_period:kind==='rite'?'day':period});
      if(!active)return;
      if(error){setError('Could not load leadership rankings.');setRows([]);} else {setRows(data??[]);setError('');}
      setLoading(false);
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),60_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[kind,period]);
  const score=(row:Row)=>Number(kind==='command'?row.command_score:row.rite_count)||0;
  const ranked=[...rows].sort((a,b)=>score(b)-score(a)||a.user_id.localeCompare(b.user_id)).map((row,index)=>({...row,rank:index+1}));
  const group=boardCategory(ranked,viewerId,r=>r.user_id,score);
  return <section className="card p-4 space-y-3">
    <h3 className="font-display font-semibold text-ink">{kind==='command'?'Command Board':'Rite Board'}</h3>
    <p className="text-xs text-stone">{kind==='command'?'Cadets who fulfill daily streak requirements. Longer periods show the average daily active cadets.':'Residents developed into Sentries through your tent. Each qualified Sentry counts once.'}</p>
    {kind==='command'&&<div className="flex flex-wrap gap-2">{[['day','Daily'],['week','Weekly'],['month','Monthly'],['year','Annual']].map(([key,label])=><button key={key} className={period===key?'btn-primary text-xs':'btn-secondary text-xs'} onClick={()=>setPeriod(key)}>{label}</button>)}</div>}
    {loading?<p className="text-sm text-stone">Loading leadership rankings…</p>:error?<p role="alert" className="text-coral text-sm">{error}</p>:<><p className="text-xs text-stone">{group.label}</p>{group.rows.map(row=><div key={row.user_id} className="flex items-center justify-between gap-3 border-t border-border py-3"><span className="text-sm font-semibold">{row.rank}. {row.display_name}</span><span className="text-gold font-display font-bold">{score(row).toLocaleString()} {kind==='command'?'active':'developed'}</span></div>)}{!rows.length&&<p className="text-stone text-sm">No leadership records yet.</p>}</>}
  </section>;
}
