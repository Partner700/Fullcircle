import { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthScreen } from './screens/AuthScreen';
import { CadetApp } from './screens/cadet/CadetApp';
import { SentryApp } from './screens/sentry/SentryApp';
import { InstructorApp } from './screens/instructor/InstructorApp';
import { Dove } from './components/Dove';

const SCRIPTURE_FACTS = [
  'The word "disciple" comes from the Latin discere — to learn.',
  'The Psalms were sung in the Temple long before they were read in print.',
  'A denarius was a day\'s wage for a laborer in first-century Judea.',
  'The Septuagint translated Hebrew scripture into Greek in Alexandria.',
  'Cuneiform is the oldest known system of writing — over 5,000 years old.',
  'The laurel wreath crowned victors in the ancient Greek and Roman world.',
  'The book of Isaiah spans over 700 years of prophetic tradition.',
];

export default function App() {
  const { session, profile, role, loading } = useAuth();
  const [factIndex, setFactIndex] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % SCRIPTURE_FACTS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [loading]);

  if (loading) {
    return (
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
    );
  }

  if (!session || !profile) {
    return <AuthScreen />;
  }

  if (role === 'instructor') return <InstructorApp />;
  if (role === 'sentry') return <SentryApp />;
  // Default: cadet (includes unassigned users with limited access)
  return <CadetApp />;
}
