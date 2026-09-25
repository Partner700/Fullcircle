import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useScrollBoundaryFades } from './lib/useScrollBoundaryFades';
import { AuthScreen } from './screens/AuthScreen';
import { Dove } from './components/Dove';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { PWAUpdateNotification } from './components/PWAUpdateNotification';
import { PasswordUpdateFlow } from './components/PasswordUpdateFlow';
import { ProfileOnboarding } from './components/ProfileOnboarding';
import { useFrenchUiTranslation } from './lib/frenchUi';
import { importWithRetry } from './lib/importWithRetry';
import { LogOut, RefreshCw } from 'lucide-react';
import { NonBlockingErrorBoundary } from './components/NonBlockingErrorBoundary';

const CadetApp = lazy(() => importWithRetry(() => import('./screens/cadet/CadetApp').then((module) => ({ default: module.CadetApp }))));
const SentryApp = lazy(() => importWithRetry(() => import('./screens/sentry/SentryApp').then((module) => ({ default: module.SentryApp }))));
const InstructorApp = lazy(() => importWithRetry(() => import('./screens/instructor/InstructorApp').then((module) => ({ default: module.InstructorApp }))));
const PublicShareScreen = lazy(() => importWithRetry(() => import('./screens/PublicShareScreen').then((module) => ({ default: module.PublicShareScreen }))));
const AuthenticatedOverlays = lazy(() => importWithRetry(() => import('./components/AuthenticatedOverlays').then((module) => ({ default: module.AuthenticatedOverlays }))));

const SCRIPTURE_FACTS = [
  'The word "disciple" comes from the Latin discere — to learn.',
  'The Psalms were sung in the Temple long before they were read in print.',
  'A denarius was a day\'s wage for a laborer in first-century Judea.',
  'The Septuagint translated Hebrew scripture into Greek in Alexandria.',
  'Cuneiform is the oldest known system of writing — over 5,000 years old.',
  'The laurel wreath crowned victors in the ancient Greek and Roman world.',
  'The book of Isaiah spans over 700 years of prophetic tradition.',
];

function ScreenLoader({ label = 'Opening Full Circle' }: { label?: string }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 overflow-hidden bg-navy px-4">
      <Dove size={88} className="animate-float" />
      <p className="text-sm font-semibold text-peri-dim">{label}</p>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-navy-3"><div className="h-full w-2/5 animate-pulse rounded-full bg-peri" /></div>
    </div>
  );
}

function isPasswordRecoveryUrl() {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return search.get('reset-password') === '1'
    || search.get('type') === 'recovery'
    || hash.get('type') === 'recovery';
}

export default function App() {
  useScrollBoundaryFades();
  const { session, profile, role, configError, loading, refreshProfile, signOut } = useAuth();
  const [factIndex, setFactIndex] = useState(0);
  const [profileRecoveryBusy, setProfileRecoveryBusy] = useState(false);
  useFrenchUiTranslation(profile?.language_code);
  const passwordRecovery = useMemo(() => {
    return isPasswordRecoveryUrl();
  }, []);
  const publicShare = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const kind = search.get('share');
    if (kind === 'reading' && search.get('date')) return { kind: 'reading' as const, value: search.get('date')! };
    if (kind === 'quiz' && search.get('id')) return { kind: 'quiz' as const, value: search.get('id')! };
    if (kind === 'game' && search.get('date')) return { kind: 'game' as const, value: search.get('date')! };
    if (kind === 'birthday' && search.get('id') && search.get('date')) return { kind: 'birthday' as const, value: search.get('id')!, date: search.get('date')! };
    return null;
  }, []);
  const signupRequested = useMemo(() => new URLSearchParams(window.location.search).get('signup') === '1', []);

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % SCRIPTURE_FACTS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    document.documentElement.lang = profile?.language_code || 'en';
  }, [profile?.language_code]);

  useEffect(() => {
    if (!session || profile || loading) return;
    let active = true;

    const recover = async () => {
      if (!active) return;
      setProfileRecoveryBusy(true);
      try {
        await refreshProfile();
      } catch (error) {
        console.warn('Account profile recovery is still pending:', error);
      } finally {
        if (active) setProfileRecoveryBusy(false);
      }
    };

    void recover();
    const interval = window.setInterval(() => { void recover(); }, 6_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loading, profile, refreshProfile, session]);

  // Installation remains user-directed, while service-worker updates are
  // applied automatically by registerServiceWorker.
  const overlays = <>
    <NonBlockingErrorBoundary name="install prompt"><PWAInstallPrompt /></NonBlockingErrorBoundary>
    <NonBlockingErrorBoundary name="update notice"><PWAUpdateNotification /></NonBlockingErrorBoundary>
    {session && profile && (
      <NonBlockingErrorBoundary name="authenticated overlays">
        <Suspense fallback={null}><AuthenticatedOverlays /></Suspense>
      </NonBlockingErrorBoundary>
    )}
  </>;

  if (publicShare && !configError) {
    return <>{overlays}<Suspense fallback={<ScreenLoader label="Opening shared Full Circle page" />}><PublicShareScreen kind={publicShare.kind} value={publicShare.value} date={'date' in publicShare ? publicShare.date : undefined} /></Suspense></>;
  }

  if (loading) {
    return (
      <>
        {overlays}
        <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-navy gap-6">
          <div className="relative z-10 flex h-24 w-24 items-center justify-center" aria-label="Full Circle is loading">
            <Dove size={96} className="animate-float" />
          </div>
          <div className="relative z-10 text-center max-w-sm px-4">
            <p className="text-peri-dim text-sm font-medium animate-fade-in" key={factIndex}>
              {SCRIPTURE_FACTS[factIndex]}
            </p>
          </div>
          <div className="relative z-10 w-48 h-1 bg-navy-3 rounded-full overflow-hidden">
            <div className="h-full bg-peri rounded-full animate-pulse" style={{ width: '40%' }} />
          </div>
        </div>
      </>
    );
  }

  if (configError) {
    return (
      <>
        {overlays}
        <div className="min-h-screen flex items-center justify-center bg-navy px-4">
          <div className="card max-w-lg p-6 text-center space-y-3">
            <Dove size={64} className="mx-auto" />
            <h1 className="font-display text-2xl font-bold text-peri">Full Circle needs Supabase config</h1>
            <p className="text-sm text-peri-dim">
              Set <span className="font-bold text-peri">VITE_SUPABASE_URL</span> and{' '}
              <span className="font-bold text-peri">VITE_SUPABASE_ANON_KEY</span>, then rebuild and redeploy the contents of the{' '}
              <span className="font-bold text-peri">dist</span> folder.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (passwordRecovery && session) {
    return (
      <>
        {overlays}
        <main className="min-h-screen bg-navy px-4 py-10 flex items-center justify-center">
          <PasswordUpdateFlow
            email={profile?.email || session.user.email || ''}
            recoveryMode
            onDone={() => {
              window.history.replaceState({}, '', window.location.pathname);
              window.location.reload();
            }}
          />
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        {overlays}
        {signupRequested ? (
          <AuthScreen
            initialMode="signup"
            initialNotice={passwordRecovery ? 'Open the reset link from your email. If it has already opened, sign in here with your new password.' : undefined}
          />
        ) : (
          <AuthScreen
            initialMode="signin"
            initialNotice={passwordRecovery ? 'Open the reset link from your email. If it has already opened, sign in here with your new password.' : undefined}
          />
        )}
      </>
    );
  }

  if (!profile) {
    return (
      <>
        {overlays}
        <main className="min-h-screen bg-navy px-4 py-10 flex items-center justify-center">
          <section className="card w-full max-w-md p-6 text-center" aria-live="polite">
            <Dove size={72} className="mx-auto" />
            <h1 className="mt-4 font-display text-2xl font-bold text-ink">Restoring your account</h1>
            <p className="mt-2 text-sm leading-relaxed text-stone">
              You are signed in. Full Circle is reconnecting your camp profile, so you will not be sent back through signup.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" disabled={profileRecoveryBusy} onClick={() => void refreshProfile()}>
                <RefreshCw size={16} className={profileRecoveryBusy ? 'animate-spin' : ''} />
                {profileRecoveryBusy ? 'Restoring...' : 'Retry now'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void signOut()}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </section>
        </main>
      </>
    );
  }

  const profileSetupComplete = profile.onboarding_completed === true
    && Boolean(profile.country_code?.trim())
    && Boolean(profile.whatsapp_number?.trim())
    && Boolean(profile.language_code?.trim())
    && Boolean(profile.timezone?.trim());

  if (!profileSetupComplete) {
    return <>{overlays}<ProfileOnboarding /></>;
  }

  const app = role === 'instructor'
    ? <InstructorApp />
    : role === 'sentry'
      ? <SentryApp />
      : <CadetApp />;

  return <>{overlays}<Suspense fallback={<ScreenLoader />}>{app}</Suspense></>;
}
