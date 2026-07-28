import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const SECRET_SCRIPTURES = [
  'The secret things belong to the Lord our God. — Deuteronomy 29:29',
  'Set a guard, O Lord, over my mouth. — Psalm 141:3',
  'A trustworthy person keeps a secret. — Proverbs 11:13',
  'Mary treasured up all these things in her heart. — Luke 2:19',
];

type Step = 'verify' | 'new';

export function PasswordUpdateFlow({
  email,
  onDone,
}: {
  email?: string;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [step, setStep] = useState<Step>('verify');
  const [scriptureIdx, setScriptureIdx] = useState(0);
  const [oldPassword, setOldPassword] = useState('');
  const [verifiedOldPassword, setVerifiedOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setScriptureIdx((idx) => (idx + 1) % SECRET_SCRIPTURES.length), 3500);
    return () => window.clearInterval(id);
  }, []);

  const accountEmail = (session?.user.email || email || '').trim().toLowerCase();

  const verifyOldPassword = async () => {
    setError(null);
    setSuccess(null);
    if (!accountEmail) {
      setError('Your signed-in account email could not be read. Please sign out and sign in again.');
      return;
    }
    if (!oldPassword) {
      setError('Enter your current password.');
      return;
    }

    setBusy(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: accountEmail,
      password: oldPassword,
    });
    setBusy(false);

    if (signInError || !data.session) {
      setError(
        /invalid login credentials/i.test(signInError?.message || '')
          ? 'That current password is not correct.'
          : signInError?.message || 'Your current password could not be verified.',
      );
      return;
    }

    setVerifiedOldPassword(oldPassword);
    setOldPassword('');
    setStep('new');
  };

  const updatePassword = async () => {
    setError(null);
    setSuccess(null);
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!verifiedOldPassword) {
      setStep('verify');
      setError('Please verify your current password again.');
      return;
    }

    setBusy(true);
    let updateError: string | null = null;
    const { error: directError } = await supabase.auth.updateUser({ password: newPassword });

    if (directError) {
      const { error: functionError } = await supabase.functions.invoke('update-user-password', {
        body: { oldPassword: verifiedOldPassword, newPassword },
      });
      if (functionError) updateError = await readFunctionError(functionError);
    }

    if (updateError) {
      setBusy(false);
      setError(updateError);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: accountEmail,
      password: newPassword,
    });
    if (signInError) {
      setBusy(false);
      setError(`The password changed, but the session could not be refreshed: ${signInError.message}`);
      return;
    }

    setBusy(false);
    setVerifiedOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSuccess('Password updated. Taking you back to settings...');
    window.setTimeout(onDone, 800);
  };

  return (
    <div className="max-w-lg mx-auto space-y-5 animate-fade-in">
      <div className="card p-6 text-center overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <svg viewBox="0 0 420 180" className="w-full h-full">
            <polygon points="0,120 120,20 210,80 330,10 420,70 420,180 0,180" fill="#3D52C8" />
            <polygon points="20,160 130,55 230,160" fill="#FFCF33" />
            <polygon points="190,170 290,38 398,170" fill="#2EC4B6" />
            <polygon points="70,150 152,86 225,150" fill="#F15A40" />
          </svg>
        </div>
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 bg-surface-2 border border-border flex items-center justify-center">
            {step === 'verify' ? <Lock size={26} className="text-brass" /> : <ShieldCheck size={26} className="text-sage" />}
          </div>
          <p className="eyebrow text-brass mb-2">Password Security</p>
          <h2 className="font-display text-xl font-semibold text-ink">
            {step === 'verify' ? 'Confirm Old Password' : 'Choose New Password'}
          </h2>
          <p key={scriptureIdx} className="text-sm text-stone mt-3 min-h-10 animate-fade-in">
            {SECRET_SCRIPTURES[scriptureIdx]}
          </p>
        </div>
      </div>

      <form
        className="card p-5 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void (step === 'verify' ? verifyOldPassword() : updatePassword());
        }}
      >
        {step === 'verify' ? (
          <>
            <PasswordInput label="Current Password" value={oldPassword} visible={showOld} autoComplete="current-password" onToggle={() => setShowOld((v) => !v)} onChange={setOldPassword} />
            <button type="submit" disabled={busy || !oldPassword} className="btn-primary w-full justify-center">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Continue
            </button>
          </>
        ) : (
          <>
            <PasswordInput label="New Password" value={newPassword} visible={showNew} autoComplete="new-password" onToggle={() => setShowNew((v) => !v)} onChange={setNewPassword} />
            <PasswordInput label="Confirm New Password" value={confirmPassword} visible={showConfirm} autoComplete="new-password" onToggle={() => setShowConfirm((v) => !v)} onChange={setConfirmPassword} />
            <button type="submit" disabled={busy || !newPassword || !confirmPassword} className="btn-primary w-full justify-center">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Save New Password
            </button>
          </>
        )}
        {error && <p className="text-xs text-coral">{error}</p>}
        {success && <p className="text-xs text-sage">{success}</p>}
        <button type="button" onClick={onDone} disabled={busy} className="btn-ghost w-full justify-center text-sm disabled:opacity-50">Back to Settings</button>
      </form>
    </div>
  );
}

function PasswordInput({
  label, value, visible, autoComplete, onToggle, onChange,
}: {
  label: string;
  value: string;
  visible: boolean;
  autoComplete: 'current-password' | 'new-password';
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-stone block mb-1">{label}</label>
      <div className="relative">
        <input
          className="input-field pr-10"
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          minLength={6}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone hover:text-ink">
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

async function readFunctionError(error: any) {
  const response = error?.context;
  if (response instanceof Response) {
    try {
      const body = await response.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // Fall back to the Supabase client message below.
    }
  }
  return error?.message || 'The password could not be updated.';
}
