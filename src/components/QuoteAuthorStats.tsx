import { BadgeCheck, Flame, Shield } from 'lucide-react';
import type { DailyQuoteFeedItem } from '../lib/types';

interface QuoteAuthorStatsProps {
  quote: DailyQuoteFeedItem;
  showDate?: boolean;
  compact?: boolean;
}

const statClass = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-2 text-[11px] font-bold text-ink shadow-sm';

export function QuoteAuthorStats({ quote, showDate = true, compact = false }: QuoteAuthorStatsProps) {
  const currentStreak = Number(quote.current_streak || 0);
  const totalFigs = Number(quote.total_figs || 0);
  const rhudes = Number(quote.rhudes || 0);

  return (
    <div className="mt-3 flex min-w-0 items-center gap-2.5 text-xs text-stone">
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-border bg-surface-2 flex items-center justify-center text-sm font-bold text-brass shadow-sm">
        {quote.avatar_url ? (
          <img src={quote.avatar_url} alt={quote.display_name} className="h-full w-full object-cover" />
        ) : (
          quote.display_name.charAt(0)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-stone">
          {quote.display_name}{showDate ? ` · ${quote.record_date}` : ''}
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
