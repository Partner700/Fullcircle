import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { fetchLatestQuizSession, fetchQuizResponders } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { QuizResponder } from '../lib/types';
import { cn } from '../lib/utils';
import { VallumAvatarBadge } from './VallumAvatarBadge';

export function QuizResponders({
  sessionId,
  variant = 'card',
  active = true,
  className,
}: {
  sessionId?: string | null;
  variant?: 'card' | 'slide';
  active?: boolean;
  className?: string;
}) {
  const [resolvedSessionId, setResolvedSessionId] = useState(sessionId || null);
  const [responders, setResponders] = useState<QuizResponder[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading((current) => current || responders.length === 0);
    try {
      let quizSessionId = sessionId || null;
      if (!sessionId) {
        const session = await fetchLatestQuizSession();
        quizSessionId = session?.id || null;
        if (quizSessionId !== resolvedSessionId) setResolvedSessionId(quizSessionId);
      }
      if (!quizSessionId) {
        setResponders([]);
        return;
      }
      setResponders(await fetchQuizResponders(quizSessionId));
    } catch (error) {
      console.warn('Quiz responder feed could not load:', error);
    } finally {
      setLoading(false);
    }
  }, [active, responders.length, resolvedSessionId, sessionId]);

  useEffect(() => {
    setResolvedSessionId(sessionId || null);
    setResponders([]);
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
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className={cn('flex items-center gap-1.5 font-semibold text-ink', isSlide ? 'text-[10px] uppercase' : 'text-sm')}>
          <CheckCircle2 size={isSlide ? 12 : 16} className="text-moss" />
          Already answered
        </p>
        <span className={cn('font-bold tabular-nums text-moss', isSlide ? 'text-xs' : 'text-sm')}>
          {responders.length}
        </span>
      </div>

      {responders.length > 0 ? (
        <div className={cn(
          'mt-2 flex items-center',
          isSlide ? 'flex-nowrap gap-1.5 overflow-x-auto pb-1' : 'flex-wrap gap-2',
        )}>
          {responders.map((responder) => (
            <div
              key={responder.user_id}
              title={`${responder.display_name} answered the quiz`}
              aria-label={responder.display_name}
              className={cn(
                'relative flex shrink-0 items-center justify-center rounded-full font-bold text-gold',
                isSlide ? 'h-6 w-6 text-[8px]' : 'h-9 w-9 text-[10px]',
              )}
            >
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-moss/55 bg-navy/80 shadow-sm">
                {responder.avatar_url ? (
                  <img
                    src={responder.avatar_url}
                    alt={responder.display_name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span>{responder.display_name.charAt(0).toUpperCase()}</span>
                )}
              </span>
              <VallumAvatarBadge userId={responder.user_id} size={isSlide ? 'xs' : 'sm'} />
            </div>
          ))}
        </div>
      ) : (
        <p className={cn('mt-2 text-stone', isSlide ? 'text-[10px]' : 'text-xs')}>
          {loading ? 'Checking quiz responses…' : 'No completed answers yet.'}
        </p>
      )}
    </>
  );

  if (isSlide) {
    return (
      <div className={cn('mt-3 max-w-sm rounded-lg border border-white/20 bg-surface/55 px-3 py-2 shadow-sm backdrop-blur-md', className)}>
        {content}
      </div>
    );
  }

  return (
    <section className={cn('card p-4 sm:p-5', className)} aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-stone">Quiz Activity</p>
          <h3 className="mt-1 font-display text-base font-semibold text-ink">Who has answered</h3>
        </div>
        {loading && responders.length === 0 && <Loader2 size={16} className="animate-spin text-brass" />}
      </div>
      <div className="mt-3">{content}</div>
    </section>
  );
}
