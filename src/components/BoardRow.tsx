import { cn } from '../lib/utils';
import { TentHouseSymbol } from './TentHouseSymbol';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import { MessageAvatar } from './TentMessenger';

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
        'grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all sm:grid-cols-[46px_minmax(0,1fr)_120px] sm:px-4',
        isCurrentUser
          ? 'border-brass bg-brass-soft shadow-sm'
          : 'border-border bg-surface-2 hover:border-border-bright',
      )}
    >
      <div className={cn(
        'flex h-10 w-10 items-center justify-center rounded-2xl font-display font-semibold text-sm',
        medal ? 'bg-brass-soft text-brass border border-brass/30' : 'bg-surface-2 text-stone border border-border',
      )}>
        {rank}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {userId && (
            <MessageAvatar
              profile={{ id: userId, display_name: name, email: null, avatar_url: avatarUrl || null, whatsapp_number: null, country_code: null, language_code: null, created_at: new Date().toISOString() }}
              currentUserId={currentUserId}
              size="sm"
            />
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
      <div className="flex items-center justify-end text-right">
        <div className={cn(
          'relative inline-flex min-h-8 min-w-[58px] items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[13px] font-bold transition-colors',
          movement && movement > 0 ? 'border-sage/45 bg-sage/15 text-sage' :
          movement && movement < 0 ? 'border-coral/45 bg-coral/15 text-coral' :
          'border-border bg-surface text-ink',
        )}>
          {isRecord && (
            <span className="absolute -left-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gold/45 bg-gold-soft text-gold shadow-sm" title="New record">
              <Sparkles size={9} />
            </span>
          )}
          {movement && movement > 0 && <ArrowUp size={11} aria-label="Increased" />}
          {movement && movement < 0 && <ArrowDown size={11} aria-label="Decreased" />}
          <span>{value}</span>
        </div>
        {valueLabel && <p className="ml-2 text-[10px] text-stone">{valueLabel}</p>}
      </div>
    </div>
  );
}

export function BoardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
