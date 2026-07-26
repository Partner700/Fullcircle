import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
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
  email: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>('verify');
  const [scriptureIdx, setScriptureIdx] = useState(0);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setScriptureIdx((idx) => (idx + 1) % SECRET_SCRIPTURES.length), 3500);
    return () => window.clearInterval(id);
  }, []);

  const verifyOldPassword = async () => {
    setError(null);
    if (!oldPassword) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: oldPassword });
    setBusy(false);
    if (error) {
      setError('That old password was not correct.');
      return;
    }
    setStep('new');
  };

  const updatePassword = async () => {
    setError(null);
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
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

      <div className="card p-5 space-y-3">
        {step === 'verify' ? (
          <>
            <PasswordInput label="Old Password" value={oldPassword} visible={showOld} onToggle={() => setShowOld((v) => !v)} onChange={setOldPassword} />
            <button onClick={verifyOldPassword} disabled={busy || !oldPassword} className="btn-primary w-full justify-center">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Continue
            </button>
          </>
        ) : (
          <>
            <PasswordInput label="New Password" value={newPassword} visible={showNew} onToggle={() => setShowNew((v) => !v)} onChange={setNewPassword} />
            <PasswordInput label="Confirm New Password" value={confirmPassword} visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} onChange={setConfirmPassword} />
            <button onClick={updatePassword} disabled={busy} className="btn-primary w-full justify-center">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Save New Password
            </button>
          </>
        )}
        {error && <p className="text-xs text-coral">{error}</p>}
        <button onClick={onDone} className="btn-ghost w-full justify-center text-sm">Back to Settings</button>
      </div>
    </div>
  );
}

function PasswordInput({
  label, value, visible, onToggle, onChange,
}: {
  label: string;
  value: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-stone block mb-1">{label}</label>
      <div className="relative">
        <input className="input-field pr-10" type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone hover:text-ink">
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
