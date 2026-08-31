import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Dove, FullCircleWordmark } from '../components/Dove';
import { Loader2, Mail, Lock, User as UserIcon, Info, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

const VERSE_FRAGMENTS = [
  { text: 'In the beginning…', top: '8%', left: '12%', delay: '0s' },
  { text: 'The Lord is my shepherd', top: '22%', left: '72%', delay: '1.2s' },
  { text: 'Your word is a lamp', top: '45%', left: '6%', delay: '2.4s' },
  { text: 'Come, follow me', top: '68%', left: '78%', delay: '0.6s' },
  { text: 'The grass withers', top: '82%', left: '18%', delay: '1.8s' },
  { text: 'In the beginning was the Word', top: '35%', left: '55%', delay: '3s' },
];

export function AuthScreen({
  initialMode = 'signin',
  initialNotice,
}: {
  initialMode?: 'signin' | 'signup';
  initialNotice?: string;
}) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice || null);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setNotice(initialNotice || null);
  }, [initialMode, initialNotice]);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setError('The portal took too long to open. Please check your internet connection and try again.');
    }, 30_000);
    return () => window.clearTimeout(timeout);
  }, [loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    if (password.length < 6) {
      setError('Your password must contain at least 6 characters.');
      return;
    }

    if (mode === 'signup') {
      if (!displayName.trim()) {
        setError('Please enter your display name.');
        return;
      }
      if (displayName.trim().length < 2) {
        setError('Your display name must contain at least 2 characters.');
        return;
      }
      if (!confirmPassword) {
        setError('Please enter your password again.');
        return;
      }
      if (password !== confirmPassword) {
        setError('The passwords do not match. Please enter them again.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(normalizedEmail, password);
        if (error) setError(error);
      } else {
        // New accounts are always created as cadet. Instructors promote cadets to sentry,
        // and the current instructor can hand over to a sentry.
        const { error, notice: signupNotice } = await signUp(normalizedEmail, password, displayName, 'cadet');
        if (error) setError(error);
        else if (signupNotice) setNotice(signupNotice);
      }
    } catch (submitError) {
      console.warn('Authentication request failed:', submitError);
      setError('The connection was interrupted. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setError(null);
    setNotice(null);
    if (!normalizedEmail) {
      setError('Enter your email first, then press Reset Password.');
      return;
    }
    setResetLoading(true);
    const recoveryUrl = new URL(window.location.href);
    recoveryUrl.search = '?reset-password=1';
    recoveryUrl.hash = '';
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      // The recovery session returns to the dedicated Full Circle password form.
      redirectTo: recoveryUrl.toString(),
    });
    setResetLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNotice('Password reset sent. Open the email link to choose a new password in Full Circle.');
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-8 bg-navy">
      {/* Floating verse fragments */}
      <div className="absolute inset-0 pointer-events-none">
        {VERSE_FRAGMENTS.map((v, i) => (
          <div key={i} className="absolute animate-drift" style={{ top: v.top, left: v.left, animationDelay: v.delay }}>
            <span className="text-peri text-sm font-display whitespace-nowrap opacity-15">{v.text}</span>
          </div>
        ))}
      </div>

      {/* Ambient radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(43, 62, 230, 0.12) 0%, transparent 60%)' }}
      />

      <div className="relative w-full max-w-md animate-slide-up">
        {/* Hero header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Dove size={72} className="animate-float" />
          </div>
          <FullCircleWordmark size="md" />
        </div>

        {/* Auth card */}
        <div className="card p-6">
          <div className="flex gap-1 mb-6 p-1 bg-navy-3 rounded-xl">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'signin' ? 'bg-peri text-navy' : 'text-peri-dim'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'signup' ? 'bg-peri text-navy' : 'text-peri-dim'}`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-bold text-peri mb-1.5">Display Name</label>
                <div className="relative">
                  <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input-field pl-10" placeholder="Your name" autoComplete="name" required />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-peri mb-1.5">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field pl-10" placeholder="you@example.com" autoComplete="email" required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-peri mb-1.5">{mode === 'signup' ? 'Create Password' : 'Password'}</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-10 pr-10"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-peri-dim hover:text-peri transition-colors flex items-center justify-center w-9 h-9"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-bold text-peri mb-1.5">Confirm Password</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field pl-10 pr-10"
                    placeholder="Enter your new password again"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((visible) => !visible)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-peri-dim hover:text-peri transition-colors flex items-center justify-center w-9 h-9"
                    aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'signup' && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-peri-soft border border-border">
                <Info size={16} className="flex-shrink-0 text-peri mt-0.5" />
                <p className="text-xs text-peri-dim">
                  New accounts are created as <span className="font-bold text-peri">Cadets</span>. An instructor can promote you to Sentry or Instructor later.
                </p>
              </div>
            )}

            {mode === 'signin' && (
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={resetLoading || loading}
                className="text-xs font-bold text-peri-dim hover:text-peri transition-colors disabled:opacity-60"
              >
                {resetLoading ? 'Sending reset link...' : 'Reset Password'}
              </button>
            )}

            {error && <div role="alert" aria-live="assertive" className="text-sm text-coral bg-coral-soft rounded-lg p-3">{error}</div>}
            {notice && <div role="status" aria-live="polite" className="text-sm text-sage bg-sage/10 rounded-lg p-3">{notice}</div>}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {mode === 'signin' ? 'Enter the Portal' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
