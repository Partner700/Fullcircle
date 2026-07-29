import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { fetchPanelImageSetting } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { PanelImageSetting } from '../lib/types';

const SECRET_SCRIPTURES = [
  'The secret things belong to the Lord our God. — Deuteronomy 29:29',
  'Set a guard, O Lord, over my mouth. — Psalm 141:3',
  'A trustworthy person keeps a secret. — Proverbs 11:13',
  'Mary treasured up all these things in her heart. — Luke 2:19',
];

type Step = 'verify' | 'new';
const PASSWORD_VERIFY_KEY = 'full-circle-password-verified-at';
const PASSWORD_VERIFY_WINDOW_MS = 10 * 60 * 1000;

function hasRecentPasswordVerification() {
  if (typeof window === 'undefined') return false;
  const verifiedAt = Number(sessionStorage.getItem(PASSWORD_VERIFY_KEY));
  return Number.isFinite(verifiedAt) && Date.now() - verifiedAt < PASSWORD_VERIFY_WINDOW_MS;
}

export function PasswordUpdateFlow({
  email,
  onDone,
}: {
  email: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>(() => hasRecentPasswordVerification() ? 'new' : 'verify');
  const [scriptureIdx, setScriptureIdx] = useState(0);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [accountEmail, setAccountEmail] = useState(email);
  const [passwordImage, setPasswordImage] = useState<PanelImageSetting | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setScriptureIdx((idx) => (idx + 1) % SECRET_SCRIPTURES.length), 3500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setAccountEmail(data.user.email);
    });
    fetchPanelImageSetting('password_update').then(setPasswordImage).catch(() => setPasswordImage(null));
  }, []);

  const verifyOldPassword = async () => {
    setError(null);
    setSuccess(null);
    const normalizedEmail = accountEmail.trim().toLowerCase();
    if (!oldPassword) return;
    if (!normalizedEmail) {
      setError('We could not find the email for this signed-in account. Please sign out and sign in again.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: oldPassword });
    setBusy(false);
    if (error) {
      setError('That old password was not correct.');
      return;
    }
    sessionStorage.setItem(PASSWORD_VERIFY_KEY, String(Date.now()));
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
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    sessionStorage.removeItem(PASSWORD_VERIFY_KEY);
    setBusy(false);
    setNewPassword('');
    setConfirmPassword('');
    setSuccess('Password updated. Taking you back to settings...');
    window.setTimeout(onDone, 800);
  };

  const returnToSettings = () => {
    sessionStorage.removeItem(PASSWORD_VERIFY_KEY);
    onDone();
  };

  return (
    <div className="max-w-lg mx-auto space-y-5 animate-fade-in">
      <div className="card p-6 text-center overflow-hidden relative">
        <PanelImageBackdrop image={passwordImage} opacityFallback={35} veilClassName="bg-navy-2/54" />
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
            <button onClick={updatePassword} disabled={busy || !newPassword || !confirmPassword} className="btn-primary w-full justify-center">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Save New Password
            </button>
          </>
        )}
        {error && <p className="text-xs text-coral">{error}</p>}
        {success && <p className="text-xs text-sage">{success}</p>}
        <button onClick={returnToSettings} disabled={busy} className="btn-ghost w-full justify-center text-sm disabled:opacity-50">Back to Settings</button>
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
        <input
          className="input-field pr-10"
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete="current-password"
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone hover:text-ink">
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
