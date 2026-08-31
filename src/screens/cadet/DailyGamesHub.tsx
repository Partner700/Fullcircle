import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { DAILY_GAME_CAP, DAILY_GAME_LEVELS } from '../../lib/constants';
import { activeArenaRoomStorageKey } from '../../lib/dailyGames';
import { fetchGameAttempts, fetchNarrative, fetchPanelImageSetting } from '../../lib/queries';
import type { DailyNarrative, GameAttempt, PanelImageSetting } from '../../lib/types';
import { cn, formatDenarii, getDayType, getTodayISODate, isGamePausedNow } from '../../lib/utils';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Loader2,
  Map,
  Play,
  Shield,
  Sparkles,
  Swords,
} from 'lucide-react';

interface DailyGamesHubProps {
  onOpenTrivia: () => void;
  onOpenArena: () => void;
  onOpenStory: () => void;
}

type HubState = {
  narrative: DailyNarrative | null;
  attempts: GameAttempt[];
  gameImage: PanelImageSetting | null;
  arenaImage: PanelImageSetting | null;
};

const EMPTY_STATE: HubState = {
  narrative: null,
  attempts: [],
  gameImage: null,
  arenaImage: null,
};

export function DailyGamesHub({ onOpenTrivia, onOpenArena, onOpenStory }: DailyGamesHubProps) {
  const { profile } = useAuth();
  const [state, setState] = useState<HubState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const today = getTodayISODate();
  const sunday = getDayType(today) === 'sunday';
  const paused = isGamePausedNow();

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [narrativeResult, attemptsResult, gameImageResult, arenaImageResult] = await Promise.allSettled([
        fetchNarrative(today),
        fetchGameAttempts(profile.id, today),
        fetchPanelImageSetting('game'),
        fetchPanelImageSetting('arena'),
      ]);
      if (cancelled) return;
      setState({
        narrative: narrativeResult.status === 'fulfilled' ? narrativeResult.value : null,
        attempts: attemptsResult.status === 'fulfilled' ? attemptsResult.value : [],
        gameImage: gameImageResult.status === 'fulfilled' ? gameImageResult.value : null,
        arenaImage: arenaImageResult.status === 'fulfilled' ? arenaImageResult.value : null,
      });
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [profile, today]);

  const passedLevels = useMemo(() => new Set(
    state.attempts.filter((attempt) => attempt.status === 'passed').map((attempt) => attempt.level),
  ), [state.attempts]);
  const levelsCompleted = passedLevels.size;
  const completion = Math.round((levelsCompleted / DAILY_GAME_LEVELS) * 100);
  const nextLevel = Math.min(levelsCompleted + 1, DAILY_GAME_LEVELS);
  const totalEarned = state.attempts.reduce((sum, attempt) => sum + Number(attempt.reward || 0), 0);
  const practice = levelsCompleted === DAILY_GAME_LEVELS || totalEarned >= DAILY_GAME_CAP;
  const activeArenaRoom = profile && typeof window !== 'undefined'
    ? window.localStorage.getItem(activeArenaRoomStorageKey(profile.id))
    : null;

  const triviaAvailability = paused
    ? 'Paused after the weekly quiz'
    : sunday
      ? 'Weekly archive open'
      : state.narrative
        ? 'Available today'
        : 'Awaiting today\'s narrative';
  const triviaAction = levelsCompleted > 0 && levelsCompleted < DAILY_GAME_LEVELS
    ? 'Continue Daily Trivia'
    : practice
      ? 'Practice Daily Trivia'
      : 'Play Daily Trivia';

  return (
    <div className="mx-auto max-w-6xl space-y-5 animate-fade-in">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-brass">Daily Games</p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-ink">Choose today&apos;s challenge</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone">Train in Scripture, enter the Arena, or continue your journey through the Bible.</p>
        </div>
        {loading && (
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-stone">
            <Loader2 size={14} className="animate-spin" /> Updating today&apos;s status
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="card relative flex min-h-[23rem] flex-col overflow-hidden p-5">
          <PanelImageBackdrop image={state.gameImage} opacityFallback={26} veilClassName="bg-navy-2/78" />
          <div className="relative z-10 flex h-full flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-gold/30 bg-gold-soft text-gold">
                <BookOpenCheck size={22} />
              </span>
              <span className={cn('badge text-[10px]', paused ? 'badge-neutral' : state.narrative || sunday ? 'badge-sage' : 'badge-brass')}>
                {paused ? <Clock3 size={11} /> : <CheckCircle2 size={11} />} {triviaAvailability}
              </span>
            </div>
            <div className="mt-5">
              <p className="eyebrow text-gold">Knowledge</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Daily Trivia</h3>
              <p className="mt-1 text-sm font-medium text-stone">Master today&apos;s narrative.</p>
            </div>
            <div className="mt-5 min-h-[4.5rem]">
              <p className="line-clamp-2 text-sm font-semibold text-ink">
                {sunday ? 'Choose a published narrative from this week.' : state.narrative?.title || 'Today\'s Daily Trivia will open after the narrative is published.'}
              </p>
              <p className="mt-1 text-xs text-stone">
                {practice ? 'Practice mode' : `Level ${nextLevel}`} · {levelsCompleted} of {DAILY_GAME_LEVELS} cleared · {formatDenarii(totalEarned)} Ð
              </p>
            </div>
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-stone">
                <span>Today&apos;s progress</span>
                <span>{completion}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${completion}%` }} />
              </div>
            </div>
            <button type="button" onClick={onOpenTrivia} className="btn-primary mt-auto w-full justify-between">
              <span className="inline-flex items-center gap-2"><Play size={15} /> {triviaAction}</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </article>

        <article className="card relative flex min-h-[23rem] flex-col overflow-hidden p-5">
          <PanelImageBackdrop image={state.arenaImage} opacityFallback={28} veilClassName="bg-navy-2/80" />
          <div className="relative z-10 flex h-full flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-coral/35 bg-coral-soft text-coral">
                <Swords size={22} />
              </span>
              <span className={cn('badge text-[10px]', activeArenaRoom ? 'badge-roman' : 'badge-neutral')}>
                {activeArenaRoom ? <><Clock3 size={11} /> Match in progress</> : <><Shield size={11} /> Ready</>}
              </span>
            </div>
            <div className="mt-5">
              <p className="eyebrow text-coral">Competition</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Arena</h3>
              <p className="mt-1 text-sm font-medium text-stone">Compete. Risk. Win.</p>
            </div>
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between border-b border-border/70 py-2 text-sm">
                <span className="font-semibold text-ink">Standard Trivia</span>
                <span className="text-xs text-stone">Fast battles</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/70 py-2 text-sm">
                <span className="font-semibold text-ink">The Road Home</span>
                <span className="text-xs text-stone">Board strategy</span>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-stone">
              {activeArenaRoom ? 'Your saved Arena room will resume through the existing match flow.' : 'Challenge people or play the machine using the existing Arena modes.'}
            </p>
            <button type="button" onClick={onOpenArena} className="btn-primary mt-auto w-full justify-between">
              <span className="inline-flex items-center gap-2"><Swords size={15} /> {activeArenaRoom ? 'Resume Match' : 'Enter Arena'}</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </article>

        <article className="card relative flex min-h-[23rem] flex-col overflow-hidden border-royal/30 bg-navy-2 p-5 text-white">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(112,129,211,0.2),rgba(6,15,35,0.92))]" />
            <div className="absolute -bottom-20 -left-16 h-48 w-[75%] rotate-[8deg] rounded-[50%] bg-navy-3" />
            <div className="absolute -bottom-16 -right-20 h-44 w-[70%] -rotate-[9deg] rounded-[50%] bg-royal/30" />
            <div className="absolute bottom-16 left-[46%] h-20 w-1 bg-gold/60" />
            <div className="absolute bottom-[8.25rem] left-[46%] h-5 w-5 rotate-45 border-l-2 border-t-2 border-gold/70" />
          </div>
          <div className="relative z-10 flex h-full flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-peri/35 bg-white/10 text-peri backdrop-blur-sm">
                <Map size={22} />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase text-peri backdrop-blur-sm">
                <Sparkles size={11} /> Book I open
              </span>
            </div>
            <div className="mt-5">
              <p className="eyebrow text-peri">Journey</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-white">Story Mode</h3>
              <p className="mt-1 text-sm font-medium text-peri-dim">Journey through the Bible.</p>
            </div>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-peri-dim">Begin in Genesis with Chapter 1: Brothers and the Abel Offering level.</p>
            <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-peri-dim">
              <span>Book</span><ArrowRight size={12} /><span>Chapter</span><ArrowRight size={12} /><span>Level</span>
            </div>
            <button type="button" onClick={onOpenStory} className="btn-primary mt-auto w-full justify-between">
              <span className="inline-flex items-center gap-2"><Map size={15} /> Begin the Journey</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
