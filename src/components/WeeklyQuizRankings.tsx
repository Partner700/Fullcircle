import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchFortuneQuizRankings, fetchLatestWeeklyQuizRankings } from '../lib/queries';
import type { WeeklyQuizRanking } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { CurrentUserAvatarMarker } from './CurrentUserAvatarMarker';
import { UserAvatar } from './UserAvatar';
import { startVisiblePolling } from '../lib/visiblePolling';

type QuizDivision = 'cadet' | 'sentry';

export function WeeklyQuizRankings({
  sessionId,
  quizType = 'saturday',
  availableAt,
}: {
  sessionId: string;
  quizType?: 'saturday' | 'fortune';
  availableAt?: string;
}) {
  const { role, profile } = useAuth();
  const [rankings, setRankings] = useState<Record<QuizDivision, WeeklyQuizRanking[]>>({ cadet: [], sentry: [] });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const divisions: QuizDivision[] = role === 'sentry' || role === 'instructor'
        ? ['cadet', 'sentry']
        : ['cadet'];
      return Promise.all(divisions.map(async (division) => (
        [
          division,
          await (quizType === 'fortune'
            ? fetchFortuneQuizRankings(sessionId, division)
            : fetchLatestWeeklyQuizRankings(sessionId, division)),
        ] as const
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
    const polling = startVisiblePolling(load, 60_000);
    const releaseAtMs = Date.parse(availableAt || '');
    const releaseTimer = Number.isFinite(releaseAtMs) && releaseAtMs > Date.now()
      ? window.setTimeout(() => { void load(); }, Math.min(releaseAtMs - Date.now() + 250, 2_147_000_000))
      : null;
    return () => {
      cancelled = true;
      if (releaseTimer !== null) window.clearTimeout(releaseTimer);
      polling.stop();
    };
  }, [availableAt, quizType, role, sessionId]);

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
              <p className="eyebrow text-gold">{quizType === 'fortune' ? 'Released when time elapsed' : 'Released with quiz results'}</p>
              <h3 className="mt-1 font-display text-base font-semibold text-ink">
                {division === 'cadet' ? 'Cadet' : 'Sentry'} {quizType === 'fortune' ? 'Fortune Quiz' : 'Weekly Quiz'} Top Three
              </h3>
            </div>
            <Trophy size={21} className="text-gold" />
          </div>
          <div className="mt-4 divide-y divide-border/75">
            {rankings[division].slice(0, 3).map((ranking) => (
              <div key={ranking.user_id} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-6 shrink-0 text-center text-xs font-black tabular-nums text-gold">{ranking.placement}</span>
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/45 bg-navy text-[10px] font-black text-gold">
                  <UserAvatar userId={ranking.user_id} name={ranking.display_name} avatarUrl={ranking.avatar_url} className="h-full w-full" />

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
