import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Dove, FullCircleWordmark } from '../components/Dove';
import { Loader2, Mail, Lock, User as UserIcon, Info, Eye, EyeOff } from 'lucide-react';

const VERSE_FRAGMENTS = [
  { text: 'In the beginning…', top: '8%', left: '12%', delay: '0s' },
  { text: 'The Lord is my shepherd', top: '22%', left: '72%', delay: '1.2s' },
  { text: 'Your word is a lamp', top: '45%', left: '6%', delay: '2.4s' },
  { text: 'Come, follow me', top: '68%', left: '78%', delay: '0.6s' },
  { text: 'The grass withers', top: '82%', left: '18%', delay: '1.8s' },
  { text: 'In the beginning was the Word', top: '35%', left: '55%', delay: '3s' },
];

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else {
      if (!displayName.trim()) {
        setError('Please enter your display name.');
        setLoading(false);
        return;
      }
      // New accounts are always created as cadet. Instructors promote cadets to sentry,
      // and the current instructor can hand over to a sentry.
      const { error } = await signUp(email, password, displayName, 'cadet');
      if (error) setError(error);
    }
    setLoading(false);
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
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'signin' ? 'bg-peri text-navy' : 'text-peri-dim'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'signup' ? 'bg-peri text-navy' : 'text-peri-dim'}`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-bold text-peri mb-1.5">Display Name</label>
                <div className="relative">
                  <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input-field pl-10" placeholder="Your name" required />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-peri mb-1.5">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-peri-dim" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field pl-10" placeholder="you@example.com" required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-peri mb-1.5">Password</label>
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
              <div className="flex items-start gap-2 p-3 rounded-lg bg-peri-soft border border-border">
                <Info size={16} className="flex-shrink-0 text-peri mt-0.5" />
                <p className="text-xs text-peri-dim">
                  New accounts are created as <span className="font-bold text-peri">Cadets</span>. An instructor can promote you to Sentry or Instructor later.
                </p>
              </div>
            )}

            {error && <div className="text-sm text-coral bg-coral-soft rounded-lg p-3">{error}</div>}

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
