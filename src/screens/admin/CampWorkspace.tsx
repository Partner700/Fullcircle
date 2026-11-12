import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type Instructor = { id: string; name: string; legacy: boolean };
type Camp = { id: number; code: string; instructors: Instructor[] };
export type CampAccess =
  | { role: 'admin'; camps: Camp[] }
  | { role: 'instructor'; campCode: string }
  | { role: 'none' };

export async function loadCampAccess(): Promise<CampAccess> {
  const { data, error } = await supabase.rpc('get_camp_workspace');
  if (error) throw error;
  return data as CampAccess;
}

export function CampWorkspace({ initial }: { initial: Exclude<CampAccess, { role: 'none' }> }) {
  const { signOut } = useAuth();
  const [access, setAccess] = useState<CampAccess>(initial);
  const [series, setSeries] = useState('A');
  const [email, setEmail] = useState('');
  const [campId, setCampId] = useState(initial.role === 'admin' ? initial.camps[0].id : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function save(action: () => PromiseLike<{ error: { message: string } | null }>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error } = await action();
      if (error) {
        setError(error.message);
        return;
      }
      setNotice(message);
      setAccess(await loadCampAccess());
    } catch {
      setError('Could not refresh camp access. Reload the page before retrying.');
    } finally {
      setBusy(false);
    }
  }

  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(() => supabase.rpc('set_managed_camp_instructor', { p_camp_id: campId, p_email: email }), 'Instructor assignment saved.');
  }

  return (
    <main className="min-h-screen bg-navy px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="card flex flex-wrap items-center justify-between gap-3 p-5 text-ink">
          <h1 className="font-display text-2xl font-bold">{access.role === 'admin' ? 'Camp Administration' : 'Instructor Workspace'}</h1>
          <button className="btn-secondary" onClick={() => void signOut()}>Sign out</button>
        </header>
        {error && <p className="card p-4 text-ink" role="alert">{error}</p>}
        {notice && <p className="card p-4 text-ink" role="status">{notice}</p>}
        {access.role === 'none' && <p className="card p-4 text-ink">This account has no camp assignment.</p>}
        {access.role === 'instructor' && <section className="card p-5 text-ink"><h2 className="text-lg font-semibold">Camp {access.campCode}</h2><p className="mt-1 text-stone">You are assigned as an Instructor for this camp.</p></section>}
        {access.role === 'admin' && (
          <>
            <section className="card p-5 text-ink">
              <h2 className="text-lg font-semibold">Camps</h2>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="block">Camp series
                  <select className="input-field ml-2" value={series} disabled={busy} onChange={event => setSeries(event.target.value)}>
                    {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => <option key={letter}>{letter}</option>)}
                  </select>
                </label>
                <button className="btn-primary" disabled={busy} onClick={() => void save(() => supabase.rpc('create_managed_camp', { p_series: series }), 'Camp created.')}>Create next camp</button>
              </div>
              <ul className="mt-4 space-y-3">
                {access.camps.map(camp => (
                  <li key={camp.id} className="rounded-lg border border-peri-dim/30 p-3">
                    <h3 className="font-semibold">Camp {camp.code}</h3>
                    {camp.instructors.length === 0 && <p className="text-sm text-stone">No Instructors assigned.</p>}
                    <ul>
                      {camp.instructors.map(instructor => (
                        <li key={instructor.id} className="mt-2 flex items-center justify-between gap-3">
                          <span>{instructor.name}</span>
                          {!instructor.legacy && <button className="btn-secondary" disabled={busy} aria-label={`Remove ${instructor.name} from Camp ${camp.code}`} onClick={() => {
                            if (window.confirm(`Remove ${instructor.name} from Camp ${camp.code}?`)) {
                              void save(() => supabase.rpc('set_managed_camp_instructor', { p_camp_id: camp.id, p_remove_id: instructor.id }), 'Instructor removed.');
                            }
                          }}>Remove</button>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
            <form className="card space-y-3 p-5 text-ink" onSubmit={assign}>
              <h2 className="text-lg font-semibold">Assign or transfer an Instructor</h2>
              <label className="block">Camp
                <select className="input-field mt-1 w-full" disabled={busy} value={campId} onChange={event => setCampId(Number(event.target.value))}>
                  {access.camps.map(camp => <option key={camp.id} value={camp.id}>Camp {camp.code}</option>)}
                </select>
              </label>
              <label className="block">Full Circle account email
                <input className="input-field mt-1 w-full" type="email" required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} />
              </label>
              <button className="btn-primary" disabled={busy}>Save assignment</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
