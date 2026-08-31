import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Flag, Lock, Map, Play, RotateCcw, Sparkles } from 'lucide-react';
import { ABEL_OFFERING_LEVEL, STORY_BOOKS } from './content';
import type { StoryProgress } from './types';

interface StoryModeHomeProps {
  progress: StoryProgress;
  browsing: boolean;
  starting: boolean;
  error: string | null;
  onBackToDailyGames: () => void;
  onBrowse: () => void;
  onCloseBrowse: () => void;
  onStart: () => void;
}

export function StoryModeHome({ progress, browsing, starting, error, onBackToDailyGames, onBrowse, onCloseBrowse, onStart }: StoryModeHomeProps) {
  const book = STORY_BOOKS[0];
  const chapter = book.chapters[0];
  const levelProgress = progress.levels.find((level) => level.levelSlug === ABEL_OFFERING_LEVEL.slug);
  const completed = Boolean(levelProgress?.completed);
  const percent = progress.totalLevelCount > 0 ? Math.round((progress.completedLevelCount / progress.totalLevelCount) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 animate-fade-in">
      <button type="button" onClick={onBackToDailyGames} className="btn-ghost text-sm">
        <ArrowLeft size={15} /> Back to Daily Games
      </button>

      <section className="story-home-banner">
        <div className="story-home-scenery" aria-hidden="true"><span /><span /><span /></div>
        <div className="relative z-10 flex min-h-[20rem] flex-col justify-between p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow text-gold">A chronological Scripture journey</p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-white sm:text-4xl">Story Mode</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-peri">Walk through Scripture. Your answers cause the story to unfold.</p>
            </div>
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-gold/35 bg-gold/10 text-gold backdrop-blur-sm"><Map size={23} /></span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="text-xs font-bold text-peri-dim">Current journey</p>
              <p className="mt-1 font-display text-xl font-semibold text-white">{book.numeral}: {book.title}</p>
              <p className="text-sm text-peri">Chapter {chapter.order}: {chapter.title} · {ABEL_OFFERING_LEVEL.title}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onBrowse} className="btn-secondary border-white/20 bg-white/10 text-white"><Map size={15} /> Browse Journey</button>
              <button type="button" onClick={onStart} disabled={starting || !levelProgress?.unlocked} className="btn-primary disabled:opacity-60">
                {completed ? <RotateCcw size={15} /> : <Play size={15} fill="currentColor" />}
                {progress.activeAttemptId ? 'Continue Journey' : completed ? 'Replay Level' : 'Continue Journey'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-coral/35 bg-coral-soft px-4 py-3 text-sm text-coral">{error}</div>}

      <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-xs text-stone"><span>Book I progress</span><strong className="text-ink">{percent}%</strong></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${percent}%` }} /></div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
          <Sparkles size={18} className="text-gold" />
          <div><p className="text-xs font-bold text-ink">{progress.completedLevelCount}/{progress.totalLevelCount} levels complete</p><p className="text-[11px] text-stone">Progress is saved across devices</p></div>
        </div>
      </section>

      {browsing && (
        <section className="animate-fade-in border-t border-border pt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><p className="eyebrow text-brass">Journey Browser</p><h3 className="mt-1 font-display text-xl font-semibold text-ink">{book.numeral}: {book.title}</h3></div>
            <button type="button" onClick={onCloseBrowse} className="btn-ghost text-sm"><ArrowLeft size={14} /> Story Home</button>
          </div>
          <div className="relative pl-7">
            <div className="absolute bottom-5 left-[0.85rem] top-5 w-px bg-border-bright" aria-hidden="true" />
            <div className="relative">
              <span className="absolute -left-7 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-gold/40 bg-bg text-gold"><BookOpen size={14} /></span>
              <p className="text-xs font-bold text-stone">Chapter {chapter.order}</p>
              <h4 className="font-display text-lg font-semibold text-ink">{chapter.title}</h4>
              <button
                type="button"
                onClick={onStart}
                disabled={starting || !levelProgress?.unlocked}
                className="mt-3 flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-gold/35 disabled:opacity-55"
              >
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${completed ? 'bg-sage-soft text-sage' : levelProgress?.unlocked ? 'bg-gold-soft text-gold' : 'bg-surface-2 text-stone'}`}>
                  {completed ? <CheckCircle2 size={19} /> : levelProgress?.unlocked ? <Flag size={18} /> : <Lock size={17} />}
                </span>
                <span className="min-w-0 flex-1"><strong className="block text-sm text-ink">Level 1 · {ABEL_OFFERING_LEVEL.title}</strong><span className="block truncate text-xs text-stone">{completed ? `Completed ${levelProgress?.timesCompleted || 1} time${levelProgress?.timesCompleted === 1 ? '' : 's'} · replay available` : ABEL_OFFERING_LEVEL.subtitle}</span></span>
                <ArrowRight size={16} className="flex-shrink-0 text-stone" />
              </button>
              <p className="mt-3 text-xs text-stone">Chapter continues in a future update.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
