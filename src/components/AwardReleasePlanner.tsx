import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, Loader2, Send, Trash2, X } from 'lucide-react';
import { awardReleaseItemKey, changeAwardRelease, fetchAwardReleases, scheduleAwardRelease } from '../lib/awardReleases';
import type { AwardRelease, AwardReleaseItem } from '../lib/awardReleases';
import { getAppDateTimeMs, getTodayISODate } from '../lib/utils';
import { APP_TIME_ZONE } from '../lib/constants';
import { VallumText } from './ChiRhoMark';

export function AwardReleasePlanner({ items, onRemove, onPublished }: {
  items: AwardReleaseItem[];
  onRemove: (key: string) => void;
  onPublished: () => void;
}) {
  const [releases, setReleases] = useState<AwardRelease[]>([]);
  const [later, setLater] = useState(true);
  const [date, setDate] = useState(getTodayISODate);
  const [time, setTime] = useState('16:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  // Preserve the request ID after an uncertain network response so retrying is safe.
  const request = useRef<{ key: string; id: string; at: string | null } | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try { setReleases(await fetchAwardReleases()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load scheduled awards.'); }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const releaseTime = () => {
    const [hour, minute] = time.split(':').map(Number);
    const ms = getAppDateTimeMs(date, hour, minute);
    if (!date || !time || !Number.isFinite(ms) || ms <= Date.now()) throw new Error('Choose a future release time.');
    return new Date(ms).toISOString();
  };

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      if (editing) {
        await changeAwardRelease(editing, releaseTime());
        setEditing(null);
        setNotice('Release rescheduled.');
      } else {
        const key = JSON.stringify([items, later, date, time]);
        if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID(), at: later ? releaseTime() : null };
        const at = request.current.at;
        await scheduleAwardRelease(request.current.id, items, at);
        request.current = null;
        setNotice(at ? 'Awards scheduled together.' : 'Awards published together.');
        onPublished();
      }
      await load();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || 'Could not save this release. Your selections are still here.');
    } finally { setBusy(false); inFlight.current = false; }
  };

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this scheduled award release?')) return;
    setBusy(true); setError('');
    try { await changeAwardRelease(id, null); await load(); }
    catch (e: unknown) { setError((e as { message?: string })?.message || 'Could not cancel the release.'); }
    finally { setBusy(false); }
  };

  return (
    <section id="award-release" className="space-y-4 scroll-mt-20 border-y border-border-bright py-5">
      <h4 className="flex items-center gap-2 font-display font-semibold text-ink"><CalendarClock size={18} /> Award Releases</h4>
      {items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={awardReleaseItemKey(item)} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink"><VallumText text={item.title} size={13} /></p>
                <p className="text-xs text-stone">{item.recipient_name} · {item.award_month}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => onRemove(awardReleaseItemKey(item))} className="p-2 text-stone hover:text-coral" aria-label={`Remove ${item.title} for ${item.recipient_name}`} title="Remove from release"><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {(items.length > 0 || editing) && (
        <div className="space-y-3">
          {!editing && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} disabled={busy} /> Schedule for later</label>}
          {(later || editing) && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 text-xs text-stone">Release date<input type="date" value={date} min={getTodayISODate()} onChange={(e) => setDate(e.target.value)} disabled={busy} className="input-field mt-1 w-full" /></label>
              <label className="min-w-0 text-xs text-stone">Time (Cameroon)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} className="input-field mt-1 w-full" /></label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary text-sm">
              {busy ? <Loader2 size={15} className="animate-spin" /> : later || editing ? <CalendarClock size={15} /> : <Send size={15} />}
              {editing ? 'Reschedule release' : later ? `Schedule ${items.length} award${items.length === 1 ? '' : 's'}` : 'Publish together'}
            </button>
            {editing && <button type="button" disabled={busy} onClick={() => setEditing(null)} className="btn-secondary text-sm"><X size={15} /> Cancel editing</button>}
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-coral">{error}</p>}
      {notice && <p role="status" className="flex items-center gap-2 text-sm text-moss"><Check size={16} />{notice}</p>}
      {releases.length === 0 && <p className="text-sm text-stone">No scheduled releases.</p>}
      <div className="space-y-3">
        {releases.map((release) => (
          <div key={release.id} className="border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink">{new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(release.scheduled_at))} <span className="text-xs text-stone">Cameroon</span></p>
              <span className={release.status === 'failed' ? 'text-xs text-coral' : 'text-xs text-stone'}>{release.status}</span>
            </div>
            <ul className="mt-1 space-y-1 text-xs text-stone">{release.items.map((item) => <li key={awardReleaseItemKey(item)}><VallumText text={item.title} size={11} /> · {item.recipient_name}</li>)}</ul>
            {release.last_error && <p className="mt-1 text-xs text-coral">{release.last_error}</p>}
            {['scheduled', 'failed'].includes(release.status) && (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => {
                  setEditing(release.id);
                  const local = new Date(new Date(release.scheduled_at).getTime() + 3_600_000).toISOString();
                  setDate(local.slice(0, 10)); setTime(local.slice(11, 16));
                  document.getElementById('award-release')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }} className="btn-secondary text-xs"><CalendarClock size={13} /> Reschedule</button>
                <button type="button" disabled={busy} onClick={() => void cancel(release.id)} className="btn-secondary text-xs"><X size={13} /> Cancel release</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
