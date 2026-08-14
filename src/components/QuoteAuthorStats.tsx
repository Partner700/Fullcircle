import { BadgeCheck, Flame, Shield } from 'lucide-react';
import type { DailyQuoteFeedItem } from '../lib/types';

interface QuoteAuthorStatsProps {
  quote: DailyQuoteFeedItem;
  showDate?: boolean;
  compact?: boolean;
}

const statClass = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-2 text-[11px] font-bold text-ink shadow-sm';

const formatRank = (role?: string | null) => {
  if (!role) return 'Cadet';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

export function QuoteAuthorStats({ quote, compact = false }: QuoteAuthorStatsProps) {
  const currentStreak = Number(quote.current_streak || 0);
  const totalFigs = Number(quote.total_figs || 0);
  const rhudes = Number(quote.rhudes || 0);

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
        <p className="truncate text-sm font-extrabold text-ink">
          {quote.display_name}
          <span className="ml-2 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-stone">
            {formatRank(quote.role)}
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
