import { useEffect, useState } from 'react';
import { Globe2, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { boardCategory } from '../lib/boardCategories';
import type { PanelImageSetting } from '../lib/types';
import { ChallengeBoardPanel } from './ChallengeBoardPanel';
import { BoardList, BoardRow } from './BoardRow';
import { EmptyState } from './AppShell';
import { cn } from '../lib/utils';

type Region = { id: string; country_code: string; city: string };
type Row = { user_id: string; display_name: string; avatar_url: string | null; score: number; rank: number };
const REGION_COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const countryNames = new Intl.DisplayNames(['en'], {type:'region'});
const countries = REGION_COUNTRIES.map(code=>({code,name:countryNames.of(code)||code})).sort((a,b)=>a.name.localeCompare(b.name));

export function RegionalChallengeBoard({ viewerId, image, audience, initialCountry }: { viewerId: string; image: PanelImageSetting | null; audience: 'cadet' | 'sentry'; initialCountry?: string | null }) {
  const [region,setRegion]=useState<Region|null>(null);
  const [loading,setLoading]=useState(true);
  const [country,setCountry]=useState(initialCountry&&REGION_COUNTRIES.includes(initialCountry)?initialCountry:'');
  const [city,setCity]=useState('');
  const [metric,setMetric]=useState('streak');
  const [rows,setRows]=useState<Row[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    let active=true;
    void supabase.rpc('get_my_region').then(({data,error})=>{if(!active)return;if(error)setError(error.message);else {setRegion(data as Region|null);setLoaded(true);}setLoading(false);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!region)return;
    let active=true;
    setRows([]);setLoading(true);setError('');
    const refresh=async()=>{
      const {data,error}=await supabase.rpc('get_regional_challenge_board',{p_metric:metric,p_audience:audience});
      if(!active)return;
      if(error)setError(error.message);else {setError('');setRows((data??[]).map((row:Omit<Row,'rank'>,index:number)=>({...row,rank:index+1})));}setLoading(false);
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),60_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[region,metric,audience]);
  async function confirm() {
    if(busy||!window.confirm(`Confirm ${city.trim()}, ${country} as your community region? Your current tent and camp will not change.`))return;
    setBusy(true);setError('');
    try { const {data,error}=await supabase.rpc('confirm_my_region',{p_country:country,p_city:city});if(error)throw error;setRegion(data as Region); }
    catch(e){setError((e as {message?:string}).message||'Could not confirm region.');} finally{setBusy(false);}
  }
  const tabs=audience==='sentry'?[['streak','Streak'],['figs','Fig'],['rhudes','Valley'],['command','Command'],['rite','Rite']]:[['streak','Streak'],['figs','Fig'],['denarii','Denarii'],['rhudes','Valley']];
  const group=boardCategory(rows,viewerId,r=>r.user_id,r=>Number(r.score));
  return <div className="space-y-4">
    <ChallengeBoardPanel image={image}>
      <div className="flex items-center gap-2 mb-2"><Globe2 size={20} className="text-gold"/><h3 className="font-display font-semibold text-ink">Regional Challenge Boards</h3></div>
      <p className="text-xs text-stone">{region?`${region.city}, ${region.country_code} · Compete with residents in your region, across camps.`:'Confirm your city to discover your regional community.'}</p>
      {region&&<div className="mt-3 flex gap-2 overflow-x-auto">{tabs.map(([key,label])=><button key={key} className={cn('rounded-lg border px-3 py-2 text-xs font-bold whitespace-nowrap',metric===key?'border-brass bg-brass-soft text-brass':'border-border bg-surface/70 text-stone')} onClick={()=>setMetric(key)}>{label}</button>)}</div>}
    </ChallengeBoardPanel>
    <ChallengeBoardPanel image={image}>
      {error&&<p role="alert" className="text-coral text-sm mb-3">{error}</p>}
      {loading?<p className="text-stone text-sm">Loading regional community…</p>:!region&&loaded?<div className="space-y-3">
        <label className="block text-xs font-bold">Country<select className="input-field mt-1 w-full" value={country} onChange={e=>setCountry(e.target.value)}><option value="">Select country</option>{countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label className="block text-xs font-bold">City or metropolitan area<input className="input-field mt-1 w-full" value={city} maxLength={100} onChange={e=>setCity(e.target.value)} placeholder="e.g. Douala"/></label>
        <p className="text-xs text-stone">Use the city where you normally live. Your existing tent, awards and progress stay unchanged.</p>
        <button className="btn-primary" disabled={busy||!country||city.trim().length<2} onClick={()=>void confirm()}>{busy?'Confirming…':'Confirm my region'}</button>
      </div>:region&&!error?(rows.length?<><p className="text-xs text-stone mb-3">{group.observer?'Viewing: ':'Your category: '}{group.label}</p><BoardList>{group.rows.map(row=><BoardRow key={row.user_id} rank={row.rank} name={row.display_name} userId={row.user_id} avatarUrl={row.avatar_url} isCurrentUser={row.user_id===viewerId} currentUserId={viewerId} value={Number(row.score).toLocaleString()}/>)}</BoardList></>:<EmptyState icon={Trophy} title="No rankings yet" message="Regional rankings will appear as your community grows."/>):null}
    </ChallengeBoardPanel>
  </div>;
}
