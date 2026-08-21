import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, UserRoundCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Role } from '../lib/types';

type HeirCandidate = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
};

export function DeleteAccountSection({ dark = false }: { dark?: boolean }) {
  const { profile, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<HeirCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [heirId, setHeirId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !profile) return;
    let cancelled = false;
    setLoadingCandidates(true);

    (async () => {
      const [{ data: profiles, error: profilesError }, { data: assignments, error: rolesError }] = await Promise.all([
        supabase.from('profiles').select('id, display_name, avatar_url').neq('id', profile.id),
        supabase
          .from('role_assignments')
          .select('user_id, role, status, created_at')
          .in('status', ['active', 'approved'])
          .neq('user_id', profile.id)
          .order('created_at', { ascending: false }),
      ]);

      if (profilesError || rolesError) {
        if (!cancelled) setError(profilesError?.message || rolesError?.message || 'Could not load possible heirs.');
        if (!cancelled) setLoadingCandidates(false);
        return;
      }

      const activeRoleByUser = new Map<string, Role>();
      (assignments || []).forEach((assignment: any) => {
        if (!activeRoleByUser.has(assignment.user_id)) {
          activeRoleByUser.set(assignment.user_id, assignment.role as Role);
        }
      });

      const nextCandidates = (profiles || [])
        .map((candidate: any) => ({
          id: candidate.id,
          displayName: candidate.display_name,
          avatarUrl: candidate.avatar_url,
          role: activeRoleByUser.get(candidate.id),
        }))
        .filter((candidate): candidate is HeirCandidate => (
          Boolean(candidate.role)
          && (role !== 'instructor' || candidate.role === 'sentry')
        ))
        .sort((a, b) => {
          if (a.role === role && b.role !== role) return -1;
          if (a.role !== role && b.role === role) return 1;
          return a.displayName.localeCompare(b.displayName);
        });

      if (!cancelled) {
        setCandidates(nextCandidates);
        setLoadingCandidates(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, profile, role]);

  const selectedHeir = useMemo(
    () => candidates.find((candidate) => candidate.id === heirId) || null,
    [candidates, heirId],
  );

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setHeirId('');
    setConfirmed(false);
    setError('');
  };

  const deleteAccount = async () => {
    if (!heirId || !confirmed || deleting) return;
    setDeleting(true);
    setError('');

    const { data, error: invokeError } = await supabase.functions.invoke('delete-account', {
      body: { heirId },
    });

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'Account deletion failed.');
      setDeleting(false);
      return;
    }

    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    window.location.assign('/');
  };

  const titleClass = dark ? 'text-peri' : 'text-ink';
  const mutedClass = dark ? 'text-peri-dim' : 'text-stone';
  const surfaceClass = dark ? 'bg-navy-3 border-border-bright' : 'bg-surface-2 border-border';

  return (
    <>
      <div className={`card p-5 border-coral/30 ${dark ? 'animate-slide-up' : ''}`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-coral-soft flex items-center justify-center flex-shrink-0">
            <Trash2 size={19} className="text-coral" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className={`font-display font-semibold ${titleClass}`}>Delete account</h4>
            <p className={`text-xs mt-1 ${mutedClass}`}>
              Nominate an heir first. Your Denarii, relics, awards, figs, streak history, and game progress will be transferred before deletion.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="btn-danger text-sm mt-3"
            >
              <Trash2 size={14} /> Delete account
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/65 p-4 animate-fade-in"
          onClick={close}
        >
          <div
            className="card w-full max-w-lg p-5 sm:p-6 animate-scale-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-lg bg-coral-soft flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={21} className="text-coral" />
                </div>
                <div>
                  <h3 id="delete-account-title" className="font-display text-xl font-semibold text-ink">
                    Are you sure?
                  </h3>
                  <p className="text-sm text-stone mt-1">Account deletion cannot be undone.</p>
                </div>
              </div>
              <button type="button" onClick={close} className="btn-ghost p-2" title="Cancel">
                <X size={18} />
              </button>
            </div>

            <div className="mt-5">
              <label className="text-xs font-bold text-stone block mb-2">
                Nominate an heir
              </label>
              {loadingCandidates ? (
                <div className={`rounded-lg border p-4 flex items-center gap-2 text-sm text-stone ${surfaceClass}`}>
                  <Loader2 size={16} className="animate-spin" /> Loading active users…
                </div>
              ) : candidates.length === 0 ? (
                <div className="rounded-lg border border-coral/30 bg-coral-soft p-3 text-sm text-coral">
                  {role === 'instructor'
                    ? 'An active sentry is required before the instructor account can be deleted.'
                    : 'There is no other active user available to inherit this account.'}
                </div>
              ) : (
                <select
                  className="input-field"
                  value={heirId}
                  onChange={(event) => {
                    setHeirId(event.target.value);
                    setConfirmed(false);
                    setError('');
                  }}
                >
                  <option value="">Choose a person…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.displayName} · {candidate.role}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedHeir && (
              <div className={`mt-3 rounded-lg border p-3 flex items-center gap-3 ${surfaceClass}`}>
                <div className="w-10 h-10 rounded-full overflow-hidden bg-peri-soft flex items-center justify-center flex-shrink-0">
                  {selectedHeir.avatarUrl ? (
                    <img src={selectedHeir.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <UserRoundCheck size={19} className="text-peri" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${titleClass}`}>{selectedHeir.displayName}</p>
                  <p className={`text-xs capitalize ${mutedClass}`}>
                    {selectedHeir.role} · nominated heir
                  </p>
                </div>
              </div>
            )}

            <label className={`mt-4 flex items-start gap-2.5 text-sm ${mutedClass}`}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!selectedHeir}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 accent-coral"
              />
              <span>
                I understand that my account will be permanently deleted and {selectedHeir?.displayName || 'my heir'} will receive my game resources.
              </span>
            </label>

            {error && (
              <p className="mt-3 rounded-lg border border-coral/30 bg-coral-soft p-3 text-sm text-coral">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 min-[460px]:flex-row min-[460px]:justify-end">
              <button type="button" onClick={close} disabled={deleting} className="btn-secondary justify-center">
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteAccount}
                disabled={!selectedHeir || !confirmed || deleting}
                className="btn-danger justify-center"
              >
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {deleting ? 'Securing resources…' : 'Yes, delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


