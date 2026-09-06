import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchLatestWeeklyQuizRankings } from '../lib/queries';
import type { WeeklyQuizRanking } from '../lib/types';
import { VallumAvatarBadge } from './VallumAvatarBadge';
import { useAuth } from '../context/AuthContext';
import { CurrentUserAvatarMarker } from './CurrentUserAvatarMarker';

type QuizDivision = 'cadet' | 'sentry';

export function WeeklyQuizRankings({ sessionId }: { sessionId: string }) {
  const { role, profile } = useAuth();
  const [rankings, setRankings] = useState<Record<QuizDivision, WeeklyQuizRanking[]>>({ cadet: [], sentry: [] });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const divisions: QuizDivision[] = role === 'sentry' || role === 'instructor'
        ? ['cadet', 'sentry']
        : ['cadet'];
      void Promise.all(divisions.map(async (division) => (
        [division, await fetchLatestWeeklyQuizRankings(sessionId, division)] as const
      )))
        .then((results) => {
          if (cancelled) return;
          setRankings({
            cadet: results.find(([division]) => division === 'cadet')?.[1] || [],
            sentry: results.find(([division]) => division === 'sentry')?.[1] || [],
          });
        })
        .catch(() => undefined);
    };
    load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [role, sessionId]);

  const divisions: QuizDivision[] = role === 'sentry' || role === 'instructor'
    ? ['cadet', 'sentry']
    : ['cadet'];
  if (divisions.every((division) => rankings[division].length === 0)) return null;

  return (
    <div className="space-y-3" aria-live="polite">
      {divisions.map((division) => rankings[division].length > 0 && (
        <section key={division} className="card overflow-hidden p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow text-gold">Released with quiz results</p>
              <h3 className="mt-1 font-display text-base font-semibold text-ink">
                {division === 'cadet' ? 'Cadet' : 'Sentry'} Weekly Quiz Top Three
              </h3>
            </div>
            <Trophy size={21} className="text-gold" />
          </div>
          <div className="mt-4 divide-y divide-border/75">
            {rankings[division].slice(0, 3).map((ranking) => (
              <div key={ranking.user_id} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-6 shrink-0 text-center text-xs font-black tabular-nums text-gold">{ranking.placement}</span>
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/45 bg-navy text-[10px] font-black text-gold">
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                    {ranking.avatar_url ? (
                      <img src={ranking.avatar_url} alt={ranking.display_name} className="h-full w-full object-cover" loading="lazy" />
                    ) : ranking.display_name.charAt(0).toUpperCase()}
                  </span>
                  <VallumAvatarBadge userId={ranking.user_id} size="xs" />
                  <CurrentUserAvatarMarker isCurrentUser={ranking.user_id === profile?.id} compact />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{ranking.display_name}</p>
                <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-black tabular-nums text-ink">
                  {ranking.correct_count}/{ranking.question_count}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
