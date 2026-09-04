import { useEffect, useState } from 'react';
import { BadgeCheck, Crown, Flame, Shield, ShieldCheck, UserRound, PenLine, X } from 'lucide-react';
import type { DailyQuoteFeedItem } from '../lib/types';
import { fetchPublicMeditation, fetchPublicQuoteStreak } from '../lib/queries';
import { MessageAvatar } from './TentMessenger';

interface QuoteAuthorStatsProps {
  quote: DailyQuoteFeedItem;
  showDate?: boolean;
  compact?: boolean;
  currentUserId?: string | null;
  onMessageOpenChange?: (open: boolean) => void;
}

const statClass = 'inline-flex h-5 shrink-0 items-center gap-1 text-[11px] font-extrabold text-ink';

const getRankSymbol = (role?: string | null) => {
  if (role === 'instructor') return { Icon: Crown, label: 'Instructor', color: '#F5B731' };
  if (role === 'sentry') return { Icon: ShieldCheck, label: 'Sentry', color: '#74B67A' };
  return { Icon: UserRound, label: 'Cadet', color: '#6FA8FF' };
};

export function QuoteAuthorStats({ quote, compact = false, currentUserId, onMessageOpenChange }: QuoteAuthorStatsProps) {
  const [resolvedStreak, setResolvedStreak] = useState(Number(quote.current_streak || 0));
  const [meditation, setMeditation] = useState<string | null>(null);
  const [showMeditation, setShowMeditation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const feedStreak = Number(quote.current_streak || 0);
    setResolvedStreak(feedStreak);
    fetchPublicQuoteStreak(quote.user_id)
      .then((streak) => {
        if (!cancelled) setResolvedStreak(Number(streak.current_streak) || 0);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [quote.user_id, quote.current_streak]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicMeditation(quote.user_id, quote.record_date).then((value) => {
      if (!cancelled) setMeditation(value);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [quote.user_id, quote.record_date]);

  const currentStreak = resolvedStreak;
  const totalFigs = Number(quote.total_figs || 0);
  const rhudes = Number(quote.rhudes || 0);
  const rank = getRankSymbol(quote.role);
  const RankIcon = rank.Icon;

  return (
    <>
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
        onOpenChange={onMessageOpenChange}
      />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold text-ink">
          <span className="truncate">{quote.display_name}</span>
          {meditation && <button type="button" className="text-peri" title="Read public meditation" aria-label="Read public meditation" onClick={() => setShowMeditation(true)}><PenLine size={13} /></button>}
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
            <Shield size={compact ? 11 : 12} className="quote-rhude-icon" /> {rhudes}
          </span>
        </div>
      </div>
    </div>
    {showMeditation && meditation && (
      <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Public meditation">
        <div className="card max-w-lg p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3"><p className="eyebrow text-brass">{quote.display_name}&apos;s meditation</p><button type="button" className="btn-icon" onClick={() => setShowMeditation(false)} aria-label="Close meditation"><X size={16} /></button></div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{meditation}</p>
        </div>
      </div>
    )}
  </>
  );
}
