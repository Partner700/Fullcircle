import { useEffect, useState } from 'react';
import { AlarmClock, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { deletePersonalAlarm, fetchPersonalAlarms, savePersonalAlarm, type PersonalAlarm } from '../lib/scriptureAlarms';
import { AppSelect } from './AppSelect';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Douala';
const dateInTimezone = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
};
const supportedTimezones = () => {
  const list = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return list ? list('timeZone') : ['Africa/Douala', 'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Toronto', 'Asia/Dubai'];
};
const emptyAlarm = (): Omit<PersonalAlarm, 'id'> & { id?: string } => ({
  title: '', alarm_time: '07:00', timezone: defaultTimezone(), repeat_days: [1,2,3,4,5,6,7], once_date: null, enabled: true,
});
const failure = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The alarm could not be saved. Please try again.';

export function PersonalAlarmSettings() {
  const [alarms, setAlarms] = useState<PersonalAlarm[]>([]);
  const [draft, setDraft] = useState<ReturnType<typeof emptyAlarm> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => setAlarms(await fetchPersonalAlarms());
  useEffect(() => { let active = true; void fetchPersonalAlarms().then(rows => { if (active) setAlarms(rows); }).catch(e => { if (active) setError(failure(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const mutate = async (action: () => Promise<void>, close = false) => {
    setBusy(true); setError('');
    try { await action(); if (close) setDraft(null); await load(); } catch(e) { setError(failure(e)); } finally { setBusy(false); }
  };
  const timezones = Array.from(new Set([defaultTimezone(), draft?.timezone || '', ...supportedTimezones()].filter(Boolean)));
  return (
    <section className="mt-5 border-t border-border pt-4" aria-labelledby="personal-alarms-title">
      <div className="flex items-center justify-between gap-2">
        <h4 id="personal-alarms-title" className="flex items-center gap-2 text-sm font-semibold text-ink"><AlarmClock size={17} /> My Alarms</h4>
        <button type="button" className="icon-btn" disabled={busy} onClick={() => setDraft(emptyAlarm())} aria-label="Add alarm" title="Add alarm"><Plus size={18} /></button>
      </div>
      {loading ? <Loader2 size={18} className="my-3 animate-spin" /> : (
        <ul className="divide-y divide-border">
          {alarms.map(alarm => <li key={alarm.id} className="flex items-center gap-2 py-3">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-ink">{alarm.alarm_time.slice(0,5)} <span className="font-normal">{alarm.title}</span></p><p className="text-[10px] text-stone">{alarm.repeat_days.length ? alarm.repeat_days.map(day=>DAYS[day-1]).join(', ') : alarm.once_date} · {alarm.timezone}</p></div>
            <input type="checkbox" checked={alarm.enabled} disabled={busy} aria-label={`Enable ${alarm.title}`} onChange={() => void mutate(() => savePersonalAlarm({...alarm, enabled:!alarm.enabled}))} className="h-4 w-4 shrink-0 accent-peri" />
            <button type="button" disabled={busy} className="icon-btn shrink-0" aria-label={`Edit ${alarm.title}`} title="Edit alarm" onClick={() => setDraft(alarm)}><Pencil size={15} /></button>
            <button type="button" disabled={busy} className="icon-btn shrink-0 text-coral" aria-label={`Delete ${alarm.title}`} title="Delete alarm" onClick={() => { if (window.confirm(`Delete "${alarm.title}"?`)) void mutate(() => deletePersonalAlarm(alarm.id)); }}><Trash2 size={15} /></button>
          </li>)}
          {!alarms.length && <li className="py-3 text-xs text-stone">No personal alarms</li>}
        </ul>
      )}
      {draft && <form className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); void mutate(() => savePersonalAlarm(draft), true); }}>
        <label className="block text-xs text-stone">Alarm name<input className="input-field mt-1 w-full" maxLength={80} required value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} /></label>
        <div className="grid grid-cols-2 items-end gap-3">
          <label className="min-w-0 text-xs text-stone">Time<input type="time" required className="input-field mt-1 w-full min-w-0" value={draft.alarm_time.slice(0,5)} onChange={e=>setDraft({...draft,alarm_time:e.target.value})} /></label>
          <label className="min-w-0 text-xs text-stone">Schedule<AppSelect value={draft.once_date === null ? 'repeat' : 'once'} onChange={value=>setDraft({...draft,repeat_days:value==='repeat'?[1,2,3,4,5,6,7]:[],once_date:value==='once'?dateInTimezone(draft.timezone):null})} options={[{value:'repeat',label:'Repeat'},{value:'once',label:'Once'}]} /></label>
        </div>
        <label className="block text-xs text-stone">Timezone<AppSelect value={draft.timezone} onChange={value=>setDraft({...draft,timezone:value})} options={timezones.map(value=>({value,label:value.replace(/_/g,' ')}))} /></label>
        {draft.once_date !== null ? <label className="block text-xs text-stone">Date<input required type="date" className="input-field mt-1 w-full" value={draft.once_date} onChange={e=>setDraft({...draft,once_date:e.target.value})} /></label> : <div className="flex flex-wrap gap-3">{DAYS.map((label,index)=><label key={label} className="flex items-center gap-1 text-xs text-ink"><input type="checkbox" className="accent-peri" checked={draft.repeat_days.includes(index+1)} onChange={e=>setDraft({...draft,repeat_days:e.target.checked?[...draft.repeat_days,index+1].sort():draft.repeat_days.filter(day=>day!==index+1)})} />{label}</label>)}</div>}
        <div className="flex items-center justify-end gap-2"><button type="button" disabled={busy} className="icon-btn" aria-label="Cancel alarm edit" title="Cancel" onClick={()=>setDraft(null)}><X size={18} /></button><button type="submit" disabled={busy || (!draft.once_date && !draft.repeat_days.length)} className="btn-primary"><Check size={16} />{busy?'Saving...':'Save alarm'}</button></div>
      </form>}
      {error && <p role="alert" className="mt-2 text-xs text-coral">{error}</p>}
    </section>
  );
}
