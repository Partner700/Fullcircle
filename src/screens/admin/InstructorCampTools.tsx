import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { TENT_HOUSES } from '../../lib/constants';

type Cadet = { id: string; name: string; status: 'present' | 'absent' | 'unmarked' };
type Tent = { id: string; name: string; houseId: string; sentryName: string | null; cadets: Cadet[] };
type CampTents = { date: string; weekday: boolean; tents: Tent[] };

export function InstructorCampTools({ campCode }: { campCode: string }) {
  const [data, setData] = useState<CampTents | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [house, setHouse] = useState<string>(TENT_HOUSES[0].id);
  const [sentryTentId, setSentryTentId] = useState('');
  const [email, setEmail] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_instructor_camp_tents');
    if (error) {
      setData(null);
      setError(error.message);
      return;
    }
    setData(data as CampTents);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(action: () => PromiseLike<{ error: { message: string } | null }>, onSaved: () => void) {
    setBusy(true);
    setError('');
    try {
      const { error } = await action();
      if (error) {
        setError(error.message);
        return;
      }
      onSaved();
      await load();
    } catch {
      setError('The change could not be confirmed. Refresh the camp before retrying.');
    } finally {
      setBusy(false);
    }
  }

  function saveTent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(() => supabase.rpc('save_instructor_camp_tent', {
      p_name: name, p_house_id: house, p_tent_id: editId,
    }), () => { setEditId(null); setName(''); });
  }

  function assignSentry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(() => supabase.rpc('set_instructor_camp_tent_sentry', {
      p_tent_id: sentryTentId, p_email: email,
    }), () => { setEmail(''); });
  }

  return (
    <>
      <section className="card p-5 text-ink">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Camp {campCode} · Tents and attendance</h2>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setError(''); void load(); }}>Refresh</button>
        </div>
        {error && <p className="mt-3 text-coral" role="alert">{error}</p>}
        {!data && !error && <p className="mt-3 text-stone" role="status">Loading camp tents…</p>}
        {data && <>
          <p className="mt-1 text-sm text-stone">{data.date} · Douala time. {data.weekday ? 'Sentries mark weekday Morning Call attendance.' : 'No Morning Call roll call today.'}</p>
          {data.tents.length === 0 && <p className="mt-3 text-stone">This camp has no tents yet.</p>}
          <ul className="mt-4 space-y-3">
            {data.tents.map(tent => {
              const present = tent.cadets.filter(cadet => cadet.status === 'present').length;
              const absent = tent.cadets.filter(cadet => cadet.status === 'absent').length;
              return (
                <li key={tent.id} className="rounded-lg border border-peri-dim/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{tent.name}</h3>
                      <p className="text-sm text-stone">{tent.sentryName ?? 'No Sentry assigned'} · {tent.cadets.length} Cadets</p>
                    </div>
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
                      setEditId(tent.id);
                      setName(tent.name);
                      setHouse(tent.houseId);
                    }}>Edit tent</button>
                  </div>
                  {data.weekday && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer">{present} present · {absent} absent · {tent.cadets.length - present - absent} unmarked</summary>
                      <ul className="mt-2 space-y-1">
                        {tent.cadets.map(cadet => <li key={cadet.id} className="flex justify-between gap-2"><span>{cadet.name}</span><span className="capitalize text-stone">{cadet.status}</span></li>)}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </>}
      </section>
      {data && (
        <form className="card space-y-3 p-5 text-ink" onSubmit={saveTent}>
          <h2 className="text-lg font-semibold">{editId ? 'Edit tent' : 'Create a tent'}</h2>
          <label className="block">Tent name
            <input className="input-field mt-1 w-full" required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} />
          </label>
          <label className="block">Tent house
            <select className="input-field mt-1 w-full" value={house} onChange={event => setHouse(event.target.value)} disabled={busy}>
              {TENT_HOUSES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button className="btn-primary" disabled={busy}>{editId ? 'Save tent' : 'Create tent'}</button>
          {editId && <button type="button" className="btn-secondary ml-2" disabled={busy} onClick={() => { setEditId(null); setName(''); }}>Cancel</button>}
        </form>
      )}
      {data && data.tents.length > 0 && (
        <form className="card space-y-3 p-5 text-ink" onSubmit={assignSentry}>
          <h2 className="text-lg font-semibold">Assign or replace a Sentry</h2>
          <label className="block">Tent
            <select className="input-field mt-1 w-full" required value={sentryTentId} onChange={event => setSentryTentId(event.target.value)} disabled={busy}>
              <option value="">Choose a tent</option>
              {data.tents.map(tent => <option key={tent.id} value={tent.id}>{tent.name}</option>)}
            </select>
          </label>
          <label className="block">Sentry’s Full Circle email
            <input className="input-field mt-1 w-full" type="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
          </label>
          <button className="btn-primary" disabled={busy}>Save Sentry assignment</button>
        </form>
      )}
    </>
  );
}
