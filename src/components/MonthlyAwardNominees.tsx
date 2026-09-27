import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserAvatar } from './UserAvatar';
import { VallumText } from './ChiRhoMark';

const MONTHLY_AWARDS = ['Vallum', 'Messenger Award (Nuncio)', 'Monthly Scribe', 'Monthly Valley Champion', 'Muralis', 'Centurion', 'Bethel Stone'];
type Nominee = {
  award_title: string;
  target_type: 'cadet' | 'sentry' | 'tent';
  target_id: string;
  display_name: string;
  avatar_url: string | null;
  metric_value: number;
  detail: string;
  rank: number;
  is_leader: boolean;
  needs_selection: boolean;
};

export function MonthlyAwardNominees({ month, onMonthChange, onSelect }: {
  month: string;
  onMonthChange: (month: string) => void;
  onSelect: (title: string, id: string) => void;
}) {
  const [result, setResult] = useState<{ month: string; rows: Nominee[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = result?.month === month ? result.rows : null;
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const { data, error: queryError } = await supabase.rpc('get_monthly_award_nominees', { p_month: `${month}-01` });
        if (queryError) throw queryError;
        if (!cancelled) { setResult({ month, rows: data || [] }); setError(''); }
      } catch (e) {
        if (!cancelled) setError((e as { message?: string })?.message || 'Monthly nominees could not be loaded.');
      } finally { inFlight = false; if (!cancelled) setLoading(false); }
    };
    setError('');
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [month, retry]);

  return (
    <section className="space-y-4" aria-label="Monthly award nominees">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-display font-semibold text-ink">Monthly Nominees &amp; Potential Winners</h4>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin text-brass" aria-label="Loading nominees" />}
          <label className="sr-only" htmlFor="monthly-award-watch">Award watch month</label>
          <input id="monthly-award-watch" type="month" className="input-field w-auto min-w-36 py-1.5 text-xs" value={month}
            onChange={(e) => { if (e.target.value) onMonthChange(e.target.value); }} />
        </div>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-coral">
        <span>{rows ? 'Could not refresh nominees. Showing the last loaded figures.' : error}</span>
        <button type="button" disabled={loading} onClick={() => setRetry((n) => n + 1)} className="btn-secondary text-xs"><RefreshCw size={13} /> Retry</button>
      </div>}
      <div className="grid gap-4 md:grid-cols-2">
        {MONTHLY_AWARDS.map((title) => {
          const candidates = rows?.filter((row) => row.award_title === title) || [];
          const open = expanded.has(title);
          return <section key={title} className="border-t border-border-bright pt-3" aria-label={title}>
            <h5 className="text-sm font-semibold text-brass"><VallumText text={title} size={13} /></h5>
            {rows === null ? <p className="mt-3 text-xs text-stone">{loading ? 'Loading nominees...' : 'Nominees unavailable.'}</p>
              : candidates.length === 0 ? <p className="mt-3 text-xs text-stone">{title === 'Muralis' ? 'No eligible registered cadets found for the latest completed FCX.' : 'No qualifying activity recorded for this month.'}</p>
              : <ul className="mt-3 space-y-3">{(open ? candidates : candidates.slice(0, 4)).map((candidate) => <li key={candidate.target_id} className="flex items-start gap-2.5">
                <UserAvatar userId={candidate.target_type === 'tent' ? null : candidate.target_id} name={candidate.display_name} avatarUrl={candidate.avatar_url} className="h-8 w-8 shrink-0" showAwardBadge={candidate.target_type !== 'tent'} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold text-gold">{candidate.is_leader ? candidate.needs_selection ? 'Recorded FCX winner' : 'Potential winner' : 'Nominee'}</p>
                  <p className="break-words text-sm font-semibold text-ink">{candidate.display_name}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-stone">{candidate.detail}</p>
                  <button type="button" onClick={() => onSelect(title, candidate.target_id)} className="mt-1 text-xs font-semibold text-brass hover:text-gold">{candidate.is_leader ? 'Select winner' : 'Select nominee'}</button>
                </div>
              </li>)}</ul>}
            {candidates.length > 4 && <button type="button" onClick={() => setExpanded((current) => {
              const next = new Set(current); if (next.has(title)) next.delete(title); else next.add(title); return next;
            })} className="mt-3 flex items-center gap-1 text-xs font-semibold text-stone">
              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{open ? 'Show fewer' : `All ${candidates.length} nominees`}
            </button>}
          </section>;
        })}
      </div>
    </section>
  );
}
