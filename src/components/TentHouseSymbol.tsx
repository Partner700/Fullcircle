import { cn } from '../lib/utils';
import { Crown, Landmark, Spade, Square, Sword } from 'lucide-react';

const HOUSE_COLORS: Record<string, string> = {
  squares: '#5B9BE8',
  spades: '#5BAD7F',
  darics: '#F5B731',
  rudes: '#E05252',
  laureats: '#A88BE8',
};

const HOUSE_NAMES: Record<string, string> = {
  squares: 'The Squares',
  spades: 'The Spades',
  darics: 'The Darics',
  rudes: 'The Rudes',
  laureats: 'The Laureats',
};

export function TentHouseSymbol({ houseId, size = 24, className }: { houseId: string; size?: number; className?: string }) {
  const Icon = houseId === 'spades'
    ? Spade
    : houseId === 'darics'
      ? Landmark
      : houseId === 'rudes'
        ? Sword
        : houseId === 'laureats'
          ? Crown
          : Square;
  const color = HOUSE_COLORS[houseId] || '#DDE3FF';
  return (
    <span
      className={cn('inline-flex items-center justify-center flex-shrink-0 rounded-full bg-surface-2/95 shadow-sm ring-1 ring-border-bright', className)}
      style={{ width: size, height: size, color }}
    >
      <Icon
        size={Math.max(16, Math.round(size * 0.62))}
        strokeWidth={houseId === 'squares' ? 3.1 : 2.8}
        className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
      />
    </span>
  );
}

export function TentHouseBadge({ houseId, size = 'md' }: { houseId: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const color = HOUSE_COLORS[houseId] || '#DDE3FF';
  const iconSize = size === 'xs' ? 14 : size === 'sm' ? 16 : size === 'lg' ? 24 : 18;
  const padX = size === 'xs' ? 'px-2' : 'px-3';
  const padY = size === 'xs' ? 'py-0.5' : 'py-1.5';
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-sm';

  return (
    <div
      className={cn('inline-flex items-center gap-1.5 rounded-full font-bold', padX, padY, textSize)}
      style={{ background: `${color}1A`, border: `1px solid ${color}30`, color }}
    >
      <TentHouseSymbol houseId={houseId} size={iconSize + 6} />
      {size !== 'xs' && <span>{HOUSE_NAMES[houseId] || houseId}</span>}
    </div>
  );
}

export { HOUSE_COLORS, HOUSE_NAMES };
