import { ArrowLeft, BookOpen, Flag, Lock, Map, Sparkles } from 'lucide-react';

interface StoryModeShellProps {
  onBackToDailyGames: () => void;
}

export function StoryModeShell({ onBackToDailyGames }: StoryModeShellProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 animate-fade-in">
      <button type="button" onClick={onBackToDailyGames} className="btn-ghost text-sm">
        <ArrowLeft size={15} /> Back to Daily Games
      </button>

      <section className="relative min-h-[32rem] overflow-hidden rounded-xl border border-royal/30 bg-navy-2 p-5 text-white shadow-xl sm:p-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(112,129,211,0.24)_0%,rgba(20,31,70,0.5)_45%,rgba(6,15,35,0.96)_100%)]" />
          <div className="absolute left-[12%] top-[18%] h-1 w-1 rounded-full bg-white/70 shadow-[6rem_2rem_0_rgba(255,255,255,0.45),15rem_-1rem_0_rgba(255,255,255,0.5),27rem_3rem_0_rgba(255,255,255,0.35),38rem_0_0_rgba(255,255,255,0.45)]" />
          <div className="absolute -bottom-24 -left-20 h-64 w-[70%] rotate-[7deg] rounded-[50%] bg-navy-3" />
          <div className="absolute -bottom-16 left-[35%] h-52 w-[75%] -rotate-[8deg] rounded-[50%] bg-[#182858]" />
          <div className="absolute bottom-20 left-1/2 h-28 w-1 bg-gold/70" />
          <div className="absolute bottom-[11.75rem] left-1/2 h-6 w-6 rotate-45 border-l-2 border-t-2 border-gold/80" />
        </div>

        <div className="relative z-10 flex min-h-[28rem] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-peri/30 bg-white/10 text-peri backdrop-blur-sm">
              <Map size={24} />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase text-peri backdrop-blur-sm">
              <Sparkles size={12} /> In development
            </span>
          </div>

          <div className="mt-8 max-w-xl">
            <p className="eyebrow text-peri">A chronological Scripture journey</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-white sm:text-4xl">Story Mode</h2>
            <p className="mt-3 text-base leading-relaxed text-peri-dim">Journey through the Bible, from the beginning to what is to come.</p>
          </div>

          <div className="mt-auto grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
            {[
              { label: 'Book', icon: BookOpen },
              { label: 'Chapter', icon: Map },
              { label: 'Level', icon: Flag },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.08] px-2 py-3 text-center backdrop-blur-sm">
                <Icon size={18} className="text-peri" />
                <span className="text-xs font-bold text-white">{label}</span>
                <Lock size={11} className="text-peri-dim" />
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-peri-dim">The journey is being prepared. Progression and gameplay will arrive in a future phase.</p>
        </div>
      </section>
    </div>
  );
}
