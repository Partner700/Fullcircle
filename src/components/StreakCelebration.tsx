import { useEffect } from 'react';
import { Flame, Sparkles, X } from 'lucide-react';

const MILESTONES = new Set([10, 20, 30, 50, 60, 90, 100, 111, 150, 183, 200, 250, 300, 365]);

export function StreakCelebration({ streak, onDone }: { streak: number | null; onDone: () => void }) {
  useEffect(() => {
    if (streak === null) return;
    const timer = window.setTimeout(onDone, 3200);
    return () => window.clearTimeout(timer);
  }, [streak, onDone]);
  if (streak === null) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-ink/35 p-5" role="dialog" aria-live="polite">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-brass/50 bg-surface/95 px-7 py-8 text-center shadow-2xl backdrop-blur-md">
        {Array.from({ length: 18 }, (_, index) => <span key={index} className="animate-confetti-fall absolute top-0 h-2 w-1.5 rounded-full" style={{ left: `${7 + ((index * 37) % 86)}%`, animationDelay: `${(index % 6) * 70}ms`, backgroundColor: ['#d9ad54', '#e66b5d', '#74b9d8', '#9acb8b'][index % 4] }} />)}
        <button type="button" onClick={onDone} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1 text-stone hover:bg-surface-2"><X size={16} /></button>
        <Flame size={52} className="mx-auto animate-streak-flame text-coral" fill="currentColor" />
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-brass">Streak renewed</p>
        <h2 className="mt-1 font-display text-3xl font-bold text-ink">{streak} days</h2>
        {MILESTONES.has(streak) && <p className="mt-2 flex items-center justify-center gap-1.5 text-sm font-semibold text-brass"><Sparkles size={15} /> Milestone reached</p>}
      </div>
    </div>
  );
}
