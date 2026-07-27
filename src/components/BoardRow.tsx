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
        'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
        isCurrentUser
          ? 'border-brass bg-brass-soft'
          : 'border-border bg-surface hover:border-border-bright',
      )}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center font-display font-semibold text-sm flex-shrink-0',
          medal ? 'text-brass' : 'text-stone',
          medal ? 'bg-brass-soft' : 'bg-surface-2',
        )}
      >
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn('text-sm font-medium truncate', isCurrentUser ? 'text-brass' : 'text-ink')}>
            {name}
          </p>
          {houseId && <TentHouseSymbol houseId={houseId} size={26} className="flex-shrink-0" />}
        </div>
        {subtext && <p className="mt-0.5 break-words text-[11px] leading-relaxed text-stone sm:truncate">{subtext}</p>}
      </div>
      <span className="text-sm font-medium text-stone flex-shrink-0">{value}</span>
    </div>
  );
}

export function BoardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
