import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Loader2, Search, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Person = { id: string; display_name: string; avatar_url: string | null };
type MeditationRow = {
  user_id: string;
  record_date: string;
  best_verse: string | null;
  meditation_text: string | null;
  daily_quote: string | null;
  meditation_submitted_at: string | null;
};

export function MeditationHistoryPanel({ userIds, title = 'Meditation History', showWeeklyVerse = false }: {
  userIds?: string[];
  title?: string;
  showWeeklyVerse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MeditationRow[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('daily_records')
      .select('user_id,record_date,best_verse,meditation_text,daily_quote,meditation_submitted_at')
      .eq('meditation_submitted', true)
      .order('record_date', { ascending: false })
      .limit(250);
    if (userIds?.length) query = query.in('user_id', userIds);
    const { data, error } = await query;
    if (error) { setLoading(false); return; }
    const records = (data || []) as MeditationRow[];
    setRows(records);
    const ids = Array.from(new Set(records.map((row) => row.user_id)));
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id,display_name,avatar_url').in('id', ids);
      setPeople(Object.fromEntries(((profiles || []) as Person[]).map((person) => [person.id, person])));
    }
    setLoading(false);
  }, [userIds?.join(',')]);

  useEffect(() => { if (open || showWeeklyVerse) void load(); }, [load, open, showWeeklyVerse]);

  const weeklyBestVerse = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    const date = since.toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    rows.filter((row) => row.record_date >= date && row.best_verse?.trim()).forEach((row) => {
      const verse = row.best_verse!.trim();
      counts.set(verse, (counts.get(verse) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  }, [rows]);

  const visible = rows.filter((row) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const person = people[row.user_id];
    return person?.display_name.toLowerCase().includes(term)
      || row.record_date.includes(term)
      || row.best_verse?.toLowerCase().includes(term)
      || row.meditation_text?.toLowerCase().includes(term);
  });

  return <div className="card p-4">
    {showWeeklyVerse && <div className="mb-4 rounded-lg border border-gold/35 bg-gold/10 p-4">
      <div className="flex items-start gap-3"><Sparkles size={20} className="mt-0.5 flex-shrink-0 text-gold" /><div><p className="eyebrow">Most Chosen Best Verse This Week</p>{weeklyBestVerse ? <><p className="mt-1 text-lg font-bold text-ink">{weeklyBestVerse[0]}</p><p className="mt-1 text-xs text-stone">Selected by {weeklyBestVerse[1]} participant{weeklyBestVerse[1] === 1 ? '' : 's'} · available for Sunday’s Verse of the Day</p></> : <p className="mt-1 text-sm text-stone">No best verse selections have been recorded this week.</p>}</div></div>
    </div>}
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-ink">{title}</p><p className="mt-0.5 text-xs text-stone">Submitted meditations, best verses, and quotes</p></div><button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => setOpen((value) => !value)}><BookOpen size={14} /> {open ? 'Close' : 'Open'} <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button></div>
    {open && <div className="mt-4 space-y-3 animate-fade-in">
      <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" /><input className="input-field pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by person, date, verse, or words" /></div>
      {loading ? <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-gold" /></div> : visible.length === 0 ? <p className="py-4 text-center text-xs text-stone">No submitted meditations found.</p> : <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">{visible.map((row) => {
        const person = people[row.user_id];
        return <details key={`${row.user_id}-${row.record_date}`} className="rounded-lg border border-border bg-surface-2 p-3"><summary className="cursor-pointer list-none"><div className="flex items-center gap-3"><div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface text-xs font-bold">{person?.avatar_url ? <img src={person.avatar_url} alt={person.display_name} className="h-full w-full object-cover" /> : person?.display_name?.charAt(0) || '?'}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{person?.display_name || 'Participant'}</p><p className="text-[11px] text-stone">{row.record_date}{row.best_verse ? ` · ${row.best_verse}` : ''}</p></div><ChevronDown size={14} className="text-stone" /></div></summary><div className="mt-3 space-y-3 border-t border-border pt-3">{row.meditation_text && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{row.meditation_text}</p>}{row.daily_quote && <p className="rounded-md bg-surface px-3 py-2 text-xs italic text-stone">“{row.daily_quote}”</p>}</div></details>;
      })}</div>}
    </div>}
  </div>;
}
