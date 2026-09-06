import { cn } from '../lib/utils';
import { TentHouseSymbol } from './TentHouseSymbol';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import { MessageAvatar } from './TentMessenger';
import { CurrentUserAvatarMarker } from './CurrentUserAvatarMarker';

interface BoardRowProps {
  rank: number;
  name: string;
  value: string;
  houseId?: string;
  isCurrentUser?: boolean;
  subtext?: string;
  movement?: number | null;
  isRecord?: boolean;
  valueLabel?: string;
  userId?: string;
  avatarUrl?: string | null;
  currentUserId?: string | null;
  showSubtext?: boolean;
}

export function BoardRow({ rank, name, value, houseId, isCurrentUser, subtext, movement, isRecord, valueLabel, userId, avatarUrl, currentUserId, showSubtext }: BoardRowProps) {
  const medal = rank <= 3;

  return (
    <div
      className={cn(
        'grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:px-3',
        isCurrentUser
          ? 'border-brass bg-brass-soft shadow-sm'
          : 'border-border bg-surface-2 hover:border-border-bright',
      )}
    >
      <div className={cn(
        'flex h-7 w-7 items-center justify-center rounded-lg font-display font-semibold text-xs',
        medal ? 'bg-brass-soft text-brass border border-brass/30' : 'bg-surface-2 text-stone border border-border',
      )}>
        {rank}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {userId && (
            <span className="relative shrink-0">
              <MessageAvatar
                profile={{ id: userId, display_name: name, email: null, avatar_url: avatarUrl || null, whatsapp_number: null, country_code: null, language_code: null, created_at: new Date().toISOString() }}
                currentUserId={currentUserId}
                size="sm"
              />
              <CurrentUserAvatarMarker isCurrentUser={Boolean(isCurrentUser || userId === currentUserId)} />
            </span>
          )}
          {!userId && avatarUrl && (
            <span className="h-8 w-8 overflow-hidden rounded-full border border-white/35 bg-surface-2 shadow-sm">
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            </span>
          )}
          <p className={cn('rounded-md bg-surface px-2 py-1 text-[13px] font-bold truncate', isCurrentUser ? 'text-brass' : 'text-ink')}>
            {name}
          </p>
          {houseId && <TentHouseSymbol houseId={houseId} size={18} className="flex-shrink-0" />}
        </div>
        {showSubtext && subtext && <p className="mt-1 truncate text-[11px] font-medium text-stone">{subtext}</p>}
      </div>
      <div className="flex flex-col items-end justify-center text-right leading-none">
        <div className={cn(
          'relative inline-flex min-h-6 min-w-[42px] items-center justify-center gap-1 rounded-md border px-1 py-0.5 text-[11px] font-bold transition-colors',
          movement !== null && movement !== undefined && movement > 0 ? 'border-[#259c62]/60 bg-[#259c62]/15 text-[#16834d] dark:border-[#69e5a0]/65 dark:bg-[#69e5a0]/15 dark:text-[#82f0b3]' :
          movement !== null && movement !== undefined && movement < 0 ? 'border-[#d95357]/60 bg-[#d95357]/15 text-[#c43c42] dark:border-[#ff8885]/65 dark:bg-[#ff8885]/15 dark:text-[#ff9d99]' :
          'border-border bg-surface text-ink',
        )}>
          {isRecord && (
            <span className="absolute -left-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gold/45 bg-gold-soft text-gold shadow-sm" title="New record">
              <Sparkles size={9} />
            </span>
          )}
          <span>{value}</span>
          {movement !== null && movement !== undefined && movement > 0 && (
            <span data-board-movement="up" className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center" title="Increased">
              <ArrowUp size={15} strokeWidth={3.4} aria-label="Increased" />
            </span>
          )}
          {movement !== null && movement !== undefined && movement < 0 && (
            <span data-board-movement="down" className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center" title="Decreased">
              <ArrowDown size={15} strokeWidth={3.4} aria-label="Decreased" />
            </span>
          )}
        </div>
        {valueLabel && <p className="mt-0.5 text-[9px] text-stone">{valueLabel}</p>}
      </div>
    </div>
  );
}

export function BoardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
