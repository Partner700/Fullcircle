import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { TentHouseSymbol } from './TentHouseSymbol';

interface BoardRowProps {
  rank: number;
  name: string;
  value: string;
  houseId?: string;
  isCurrentUser?: boolean;
  subtext?: string;
}

export function BoardRow({ rank, name, value, houseId, isCurrentUser, subtext }: BoardRowProps) {
  const medal = rank <= 3;

  return (
    <div
      className={cn(
        'grid grid-cols-[48px_minmax(0,1fr)_122px] items-center gap-3 px-4 py-3 rounded-lg border transition-all',
        isCurrentUser
          ? 'border-brass bg-brass-soft shadow-sm'
          : 'border-border bg-surface hover:border-border-bright',
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
          <p className={cn('text-sm font-medium truncate', isCurrentUser ? 'text-brass' : 'text-ink')}>
            {name}
          </p>
          {houseId && <TentHouseSymbol houseId={houseId} size={18} className="flex-shrink-0" />}
        </div>
        {subtext && <p className="text-[11px] text-stone truncate mt-0.5">{subtext}</p>}
      </div>
      <div className="text-right">
        <span className="text-sm font-semibold text-ink">{value}</span>
        {subtext && <p className="text-[10px] text-stone mt-1">Score</p>}
      </div>
    </div>
  );
}

export function BoardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
