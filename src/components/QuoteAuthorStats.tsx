import { BadgeCheck, Crown, Flame, Shield, ShieldCheck, UserRound } from 'lucide-react';
import type { DailyQuoteFeedItem } from '../lib/types';

interface QuoteAuthorStatsProps {
  quote: DailyQuoteFeedItem;
  showDate?: boolean;
  compact?: boolean;
}

const statClass = 'inline-flex h-5 shrink-0 items-center gap-1 text-[11px] font-extrabold text-ink';

const getRankSymbol = (role?: string | null) => {
  if (role === 'instructor') return { Icon: Crown, label: 'Instructor', color: '#F5B731' };
  if (role === 'sentry') return { Icon: ShieldCheck, label: 'Sentry', color: '#74B67A' };
  return { Icon: UserRound, label: 'Cadet', color: '#6FA8FF' };
};

export function QuoteAuthorStats({ quote, compact = false }: QuoteAuthorStatsProps) {
  const currentStreak = Number(quote.current_streak || 0);
  const totalFigs = Number(quote.total_figs || 0);
  const rhudes = Number(quote.rhudes || 0);
  const rank = getRankSymbol(quote.role);
  const RankIcon = rank.Icon;

  return (
    <div className="mt-3 flex min-w-0 items-center gap-2.5 text-xs text-stone">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-border bg-surface-2 flex items-center justify-center text-base font-bold text-brass shadow-sm">
        {quote.avatar_url ? (
          <img src={quote.avatar_url} alt={quote.display_name} className="h-full w-full object-cover" />
        ) : (
          quote.display_name.charAt(0)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold text-ink">
          <span className="truncate">{quote.display_name}</span>
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-bright bg-surface-2 shadow-sm ring-1 ring-black/10"
            title={rank.label}
            aria-label={rank.label}
          >
            <RankIcon size={13} style={{ color: rank.color }} strokeWidth={3} />
          </span>
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className={statClass} title="Current streak">
            <Flame size={compact ? 11 : 12} className="text-gold" /> {currentStreak}
          </span>
          <span className={statClass} title="Figs">
            <BadgeCheck size={compact ? 11 : 12} className="text-sage" /> {totalFigs}
          </span>
          <span className={statClass} title="Rhudes">
            <Shield size={compact ? 11 : 12} className="text-royal" /> {rhudes}
          </span>
        </div>
      </div>
    </div>
  );
}
