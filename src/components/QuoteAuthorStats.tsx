import { BadgeCheck, Flame, Shield } from 'lucide-react';
import type { DailyQuoteFeedItem } from '../lib/types';

interface QuoteAuthorStatsProps {
  quote: DailyQuoteFeedItem;
  showDate?: boolean;
  compact?: boolean;
}

const statClass = 'inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface/75 px-2 py-0.5 font-semibold text-ink shadow-sm backdrop-blur-md';

export function QuoteAuthorStats({ quote, showDate = true, compact = false }: QuoteAuthorStatsProps) {
  const currentStreak = Number(quote.current_streak || 0);
  const totalFigs = Number(quote.total_figs || 0);
  const rhudes = Number(quote.rhudes || 0);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone">
      <div className="h-7 w-7 overflow-hidden rounded-full border border-border bg-surface-2 flex items-center justify-center text-[10px] font-bold text-brass">
        {quote.avatar_url ? (
          <img src={quote.avatar_url} alt={quote.display_name} className="h-full w-full object-cover" />
        ) : (
          quote.display_name.charAt(0)
        )}
      </div>
      <span className="min-w-0 truncate">
        {quote.display_name}{showDate ? ` · ${quote.record_date}` : ''}
      </span>
      <span className={statClass} title="Current streak">
        <Flame size={compact ? 12 : 14} className="text-gold" /> {currentStreak}
      </span>
      <span className={statClass} title="Figs">
        <BadgeCheck size={compact ? 12 : 14} className="text-sage" /> {totalFigs}
      </span>
      <span className={statClass} title="Rhudes">
        <Shield size={compact ? 12 : 14} className="text-powder" /> {rhudes}
      </span>
    </div>
  );
}
