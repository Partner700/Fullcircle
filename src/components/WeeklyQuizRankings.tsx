import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchLatestWeeklyQuizRankings } from '../lib/queries';
import type { WeeklyQuizRanking } from '../lib/types';
import { VallumAvatarBadge } from './VallumAvatarBadge';

export function WeeklyQuizRankings({ sessionId }: { sessionId: string }) {
  const [rankings, setRankings] = useState<WeeklyQuizRanking[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchLatestWeeklyQuizRankings(sessionId)
        .then((rows) => { if (!cancelled) setRankings(rows); })
        .catch(() => undefined);
    };
    load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId]);

  if (rankings.length === 0) return null;

  return (
    <section className="card overflow-hidden p-4 sm:p-5" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-gold">Released at 10:00 PM</p>
          <h3 className="mt-1 font-display text-base font-semibold text-ink">Weekly Quiz Ranking</h3>
        </div>
        <Trophy size={21} className="text-gold" />
      </div>
      <div className="mt-4 divide-y divide-border/75">
        {rankings.map((ranking) => (
          <div key={ranking.user_id} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="w-6 shrink-0 text-center text-xs font-black tabular-nums text-gold">{ranking.placement}</span>
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/45 bg-navy text-[10px] font-black text-gold">
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                {ranking.avatar_url ? (
                  <img src={ranking.avatar_url} alt={ranking.display_name} className="h-full w-full object-cover" loading="lazy" />
                ) : ranking.display_name.charAt(0).toUpperCase()}
              </span>
              <VallumAvatarBadge userId={ranking.user_id} size="xs" />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{ranking.display_name}</p>
            <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-black tabular-nums text-ink">
              {ranking.correct_count}/{ranking.question_count}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
