import { useAuth } from '../context/AuthContext';
import { regionalDateTime } from '../lib/regionalPreferences';
import type { DailyQuoteFeedItem } from '../lib/types';
import { cn, formatNumericDate } from '../lib/utils';

export function QuoteReleaseTime({ quote, className }: { quote: DailyQuoteFeedItem; className?: string }) {
  const { profile } = useAuth();
  return (
    <time
      dateTime={quote.released_at || quote.record_date}
      className={cn('ml-2 inline whitespace-nowrap align-baseline font-sans text-[8px] font-medium not-italic text-stone/45', className)}
      title="Quote released"
    >
      {quote.released_at ? regionalDateTime(quote.released_at, profile) : formatNumericDate(quote.record_date)}
    </time>
  );
}
