import type { DailyQuoteFeedItem } from '../lib/types';
import { cn } from '../lib/utils';

function quoteReleaseLabel(quote: DailyQuoteFeedItem) {
  if (!quote.released_at) {
    const [year, month, day] = quote.record_date.split('-');
    return year && month && day ? `${day}/${month}/${year.slice(-2)}` : quote.record_date;
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Douala',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(quote.released_at));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('day')}/${value('month')}/${value('year')} · ${value('hour')}:${value('minute')}`;
}

export function QuoteReleaseTime({ quote, className }: { quote: DailyQuoteFeedItem; className?: string }) {
  return (
    <time
      dateTime={quote.released_at || quote.record_date}
      className={cn('ml-2 inline whitespace-nowrap align-baseline font-sans text-[8px] font-medium not-italic text-stone/45', className)}
      title="Quote released"
    >
      {quoteReleaseLabel(quote)}
    </time>
  );
}
