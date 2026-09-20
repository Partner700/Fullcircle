import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  fetchLatestQuizSession,
  fetchLatestWeeklyQuizRankings,
  fetchQuizResponders,
  fetchQuizResponseBoard,
} from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { QuizResponder, QuizResponseBoardMember, WeeklyQuizRanking } from '../lib/types';
import { cn } from '../lib/utils';
import { TENT_HOUSES } from '../lib/constants';
import { publicAsset } from '../lib/publicAsset';
import { CurrentUserAvatarMarker } from './CurrentUserAvatarMarker';
import { TentHouseSymbol } from './TentHouseSymbol';
import { useAuth } from '../context/AuthContext';
import { UserAvatar } from './UserAvatar';

export function QuizResponders({
  sessionId,
  variant = 'card',
  competitorRole,
  active = true,
  className,
}: {
  sessionId?: string | null;
  variant?: 'card' | 'slide' | 'podium';
  competitorRole?: 'cadet' | 'sentry';
  active?: boolean;
  className?: string;
}) {
  const { profile } = useAuth();
  const [resolvedSessionId, setResolvedSessionId] = useState(sessionId || null);
  const [board, setBoard] = useState<QuizResponseBoardMember[]>([]);
  const [rankings, setRankings] = useState<WeeklyQuizRanking[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading((current) => current || board.length === 0);
    try {
      let quizSessionId = sessionId || null;
      if (!sessionId) {
        const session = await fetchLatestQuizSession();
        quizSessionId = session?.id || null;
        if (quizSessionId !== resolvedSessionId) setResolvedSessionId(quizSessionId);
      }
      if (!quizSessionId) {
        setBoard([]);
        setRankings([]);
        return;
      }

      const [boardResult, rankingResult] = await Promise.allSettled([
        fetchQuizResponseBoard(quizSessionId),
        fetchLatestWeeklyQuizRankings(quizSessionId, competitorRole),
      ]);
      if (boardResult.status === 'fulfilled') {
        setBoard(boardResult.value);
      } else {
        const responders = await fetchQuizResponders(quizSessionId);
        setBoard(responders.map((responder: QuizResponder) => ({
          ...responder,
          competitor_role: 'cadet' as const,
          tent_house_id: null,
        })));
      }
      setRankings(rankingResult.status === 'fulfilled' ? rankingResult.value : []);
    } catch (error) {
      console.warn('Quiz responder feed could not load:', error);
    } finally {
      setLoading(false);
    }
  }, [active, board.length, competitorRole, resolvedSessionId, sessionId]);

  useEffect(() => {
    setResolvedSessionId(sessionId || null);
    setBoard([]);
    setRankings([]);
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [active, load]);

  useEffect(() => {
    const quizSessionId = sessionId || resolvedSessionId;
    if (!active || !quizSessionId) return;
    const channel = supabase
      .channel(`quiz-responders-${quizSessionId}-${variant}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'quiz_attempts',
        filter: `quiz_session_id=eq.${quizSessionId}`,
      }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active, load, resolvedSessionId, sessionId, variant]);

  const isSlide = variant === 'slide';
  const visibleBoard = useMemo(
    () => competitorRole ? board.filter((member) => member.competitor_role === competitorRole) : board,
    [board, competitorRole],
  );
  const responders = useMemo(() => visibleBoard.filter((member) => Boolean(member.answered_at)), [visibleBoard]);
  const placementByUserId = new Map(rankings.map((ranking) => [ranking.user_id, ranking.placement]));
  const answeredByTent = useMemo(() => {
    const totals = new Map<string, number>();
    responders.forEach((member) => {
      if (member.tent_house_id) totals.set(member.tent_house_id, (totals.get(member.tent_house_id) || 0) + 1);
    });
    return totals;
  }, [responders]);

  if (variant === 'podium') {
    return (
      <div className={cn('mt-3', className)} aria-live="polite">
        {visibleBoard.length > 0 ? (
          <>
            <p className="text-[9px] font-bold uppercase text-stone">
              {responders.length}/{visibleBoard.length} answered
            </p>
            <div className="mt-1.5 grid max-w-[19rem] grid-cols-10 gap-1.5" aria-label={`${responders.length} of ${visibleBoard.length} participants answered`}>
              {visibleBoard.map((member) => {
                const answered = Boolean(member.answered_at);
                return (
                  <span
                    key={member.user_id}
                    title={`${member.display_name} ${answered ? 'answered' : 'did not answer'}`}
                    className={cn(
                      'relative flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition',
                      answered
                        ? 'border-moss/60 bg-navy/78'
                        : 'border-white/25 bg-surface/35 opacity-40 grayscale',
                    )}
                  >
                    <UserAvatar
                      userId={member.user_id}
                      name={member.display_name}
                      avatarUrl={member.avatar_url}
                      className="h-full w-full"
                    />
                    <CurrentUserAvatarMarker isCurrentUser={member.user_id === profile?.id} compact />
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-[10px] text-stone">{loading ? 'Loading participants...' : 'No participants are available.'}</p>
        )}
      </div>
    );
  }

  if (isSlide) {
    return (
      <div className={cn('mt-3 grid max-w-xl grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-white/20 bg-surface/55 px-3 py-2.5 shadow-sm backdrop-blur-md', className)} aria-live="polite">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-ink">
            <CheckCircle2 size={12} className="text-moss" /> Quiz response board
          </p>
          {visibleBoard.length > 0 ? (
            <div className="mt-2 grid max-w-[20rem] grid-cols-10 gap-1.5" aria-label={`${responders.length} of ${visibleBoard.length} camp members answered`}>
              {visibleBoard.map((member) => {
                const answered = Boolean(member.answered_at);
                return (
                  <span
                    key={member.user_id}
                    title={answered ? `${member.display_name} answered the quiz` : 'Waiting for an answer'}
                    className={cn('relative flex h-6 w-6 items-center justify-center rounded-full border shadow-sm', answered ? 'border-moss/60 bg-navy/78' : 'border-white/30 bg-surface/35')}
                  >
                    {answered ? (
                      <UserAvatar userId={member.user_id} name={member.display_name} avatarUrl={member.avatar_url} className="h-full w-full" />
                    ) : (
                      <img src={publicAsset('icons/fullcircle-dove-clean.png')} alt="" className="h-3.5 w-3.5 object-contain opacity-45" />
                    )}
                    {answered && <CurrentUserAvatarMarker isCurrentUser={member.user_id === profile?.id} compact />}
                    {answered && placementByUserId.get(member.user_id) ? (
                      <span
                        className="absolute right-0 top-0 z-20 flex h-3 min-w-3 -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full border border-white/80 bg-navy px-0.5 text-[6px] font-black tabular-nums text-white shadow-sm"
                        title={`Position ${placementByUserId.get(member.user_id)}`}
                      >
                        {placementByUserId.get(member.user_id)}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-stone">{loading ? 'Checking quiz responses...' : 'No camp roster is available yet.'}</p>
          )}
        </div>

        <div className="min-w-[3.25rem] border-l border-white/20 pl-2 text-right">
          <p className="font-display text-base font-black tabular-nums text-ink">{responders.length}/{visibleBoard.length || responders.length}</p>
          <p className="text-[8px] font-bold uppercase text-stone">answered</p>
          <div className="mt-1.5 space-y-1">
            {TENT_HOUSES.map((house) => (
              <div key={house.id} className="flex items-center justify-end gap-1" title={`${house.name}: ${answeredByTent.get(house.id) || 0} answered`}>
                <TentHouseSymbol houseId={house.id} size={15} />
                <span className="min-w-3 text-right text-[9px] font-black tabular-nums text-ink">{answeredByTent.get(house.id) || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className={cn('card p-4 sm:p-5', className)} aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-stone">Quiz Activity</p>
          <h3 className="mt-1 font-display text-base font-semibold text-ink">Already answered</h3>
        </div>
        {loading && responders.length === 0 ? <Loader2 size={16} className="animate-spin text-brass" /> : <span className="text-sm font-bold tabular-nums text-moss">{responders.length}</span>}
      </div>
      {responders.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {responders.map((responder) => (
            <span key={responder.user_id} title={`${responder.display_name} answered the quiz`} className="relative flex h-9 w-9 items-center justify-center rounded-full">
              <UserAvatar userId={responder.user_id} name={responder.display_name} avatarUrl={responder.avatar_url} className="h-full w-full border border-moss/55 shadow-sm" />
              <CurrentUserAvatarMarker isCurrentUser={responder.user_id === profile?.id} />
              {placementByUserId.get(responder.user_id) ? (
                <span
                  className="absolute right-0 top-0 z-20 flex h-4 min-w-4 -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full border border-white/80 bg-navy px-1 text-[8px] font-black text-white shadow-sm"
                  title={`Position ${placementByUserId.get(responder.user_id)}`}
                >
                  {placementByUserId.get(responder.user_id)}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : <p className="mt-3 text-xs text-stone">{loading ? 'Checking quiz responses...' : 'No completed answers yet.'}</p>}
    </section>
  );
}
