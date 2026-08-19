import { cn } from '../lib/utils';
import { TentHouseSymbol } from './TentHouseSymbol';
import { ArrowDown, ArrowUp, Minus, Sparkles } from 'lucide-react';
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
          {isRecord && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-gold/35 bg-gold-soft px-1.5 text-[9px] font-black uppercase tracking-wide text-gold" title="New record">
              <Sparkles size={10} /> <span className="hidden sm:inline">Record</span>
            </span>
          )}
        </div>
        {showSubtext && subtext && <p className="mt-1 truncate text-[11px] font-medium text-stone">{subtext}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 text-right">
        <MovementBadge movement={movement} />
        <div>
          <span className="text-[13px] font-bold text-ink">{value}</span>
          {valueLabel && <p className="text-[10px] text-stone mt-1">{valueLabel}</p>}
        </div>
      </div>
    </div>
  );
}

export function BoardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

function MovementBadge({ movement }: { movement?: number | null }) {
  if (typeof movement !== 'number') {
    return (
      <span className="hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-2 text-stone sm:inline-flex" title="No movement yet">
        <Minus size={10} />
      </span>
    );
  }
  if (movement > 0) {
    return (
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-sage/35 bg-sage/15 px-1 text-[9px] font-black text-sage" title={`Up ${movement}`}>
        <ArrowUp size={10} />{movement > 1 ? movement : ''}
      </span>
    );
  }
  if (movement < 0) {
    return (
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-coral/35 bg-coral/15 px-1 text-[9px] font-black text-coral" title={`Down ${Math.abs(movement)}`}>
        <ArrowDown size={10} />{Math.abs(movement) > 1 ? Math.abs(movement) : ''}
      </span>
    );
  }
  return (
    <span className="hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-2 text-stone sm:inline-flex" title="No change">
      <Minus size={10} />
    </span>
  );
}
