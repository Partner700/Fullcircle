import { BadgeCheck, Crown, Flame, Shield, ShieldCheck, UserRound } from 'lucide-react';
import type { DailyQuoteFeedItem } from '../lib/types';
import { MessageAvatar } from './TentMessenger';

interface QuoteAuthorStatsProps {
  quote: DailyQuoteFeedItem;
  showDate?: boolean;
  compact?: boolean;
  currentUserId?: string | null;
}

const statClass = 'inline-flex h-5 shrink-0 items-center gap-1 text-[11px] font-extrabold text-ink';

const getRankSymbol = (role?: string | null) => {
  if (role === 'instructor') return { Icon: Crown, label: 'Instructor', color: '#F5B731' };
  if (role === 'sentry') return { Icon: ShieldCheck, label: 'Sentry', color: '#74B67A' };
  return { Icon: UserRound, label: 'Cadet', color: '#6FA8FF' };
};

export function QuoteAuthorStats({ quote, compact = false, currentUserId }: QuoteAuthorStatsProps) {
  const currentStreak = Number(quote.current_streak || 0);
  const totalFigs = Number(quote.total_figs || 0);
  const rhudes = Number(quote.rhudes || 0);
  const rank = getRankSymbol(quote.role);
  const RankIcon = rank.Icon;

  return (
    <div className="mt-3 flex min-w-0 items-center gap-2.5 text-xs text-stone">
      <MessageAvatar
        profile={{
          id: quote.user_id,
          display_name: quote.display_name || 'User',
          email: null,
          avatar_url: quote.avatar_url,
          whatsapp_number: null,
          country_code: null,
          language_code: null,
          created_at: quote.record_date,
        }}
        currentUserId={currentUserId}
        size={compact ? 'md' : 'lg'}
        className="shrink-0"
      />
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
        <div className="mt-1 inline-flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full border border-white/25 bg-surface/55 px-2.5 py-1 shadow-sm backdrop-blur-xl ring-1 ring-black/5">
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
