import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthScreen } from './screens/AuthScreen';
import { Dove } from './components/Dove';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { PWAUpdateNotification } from './components/PWAUpdateNotification';
import { PasswordUpdateFlow } from './components/PasswordUpdateFlow';
import { ProfileOnboarding } from './components/ProfileOnboarding';
import { CadetApp } from './screens/cadet/CadetApp';
import { useFrenchUiTranslation } from './lib/frenchUi';

// Role applications are large, independent experiences. Load only the one the
// signed-in person needs instead of making every user download all three.
const SentryApp = lazy(() => import('./screens/sentry/SentryApp').then((module) => ({ default: module.SentryApp })));
const InstructorApp = lazy(() => import('./screens/instructor/InstructorApp').then((module) => ({ default: module.InstructorApp })));

const SCRIPTURE_FACTS = [
  'The word "disciple" comes from the Latin discere — to learn.',
  'The Psalms were sung in the Temple long before they were read in print.',
  'A denarius was a day\'s wage for a laborer in first-century Judea.',
  'The Septuagint translated Hebrew scripture into Greek in Alexandria.',
  'Cuneiform is the oldest known system of writing — over 5,000 years old.',
  'The laurel wreath crowned victors in the ancient Greek and Roman world.',
  'The book of Isaiah spans over 700 years of prophetic tradition.',
];

function isPasswordRecoveryUrl() {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return search.get('reset-password') === '1'
    || search.get('type') === 'recovery'
    || hash.get('type') === 'recovery';
}

export default function App() {
  const { session, profile, role, configError, loading } = useAuth();
  const [factIndex, setFactIndex] = useState(0);
  useFrenchUiTranslation(profile?.language_code);
  const passwordRecovery = useMemo(() => {
    return isPasswordRecoveryUrl();
  }, []);

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

  // Installation remains user-directed, while service-worker updates are
  // applied automatically by registerServiceWorker.
  const overlays = <><PWAInstallPrompt /><PWAUpdateNotification /></>;

  if (loading) {
    return (
      <>
        {overlays}
        <div className="min-h-screen flex flex-col items-center justify-center bg-navy gap-6">
          <Dove size={80} className="animate-float" />
          <div className="text-center max-w-sm px-4">
            <p className="text-peri-dim text-sm font-medium animate-fade-in" key={factIndex}>
              {SCRIPTURE_FACTS[factIndex]}
            </p>
          </div>
          <div className="w-48 h-1 bg-navy-3 rounded-full overflow-hidden">
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

  if (!session || !profile) {
    return (
      <>
        {overlays}
        <AuthScreen
          initialMode={passwordRecovery ? 'signin' : 'signup'}
          initialNotice={passwordRecovery ? 'Open the reset link from your email. If it has already opened, sign in here with your new password.' : undefined}
        />
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

  return <>{overlays}<Suspense fallback={<RoleLoading />}>{app}</Suspense></>;
}

function RoleLoading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-navy gap-4">
      <Dove size={64} className="animate-float" />
      <p className="text-peri-dim text-sm">Preparing your Full Circle...</p>
    </div>
  );
}
