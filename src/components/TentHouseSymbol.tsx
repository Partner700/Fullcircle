import { cn } from '../lib/utils';
import squaresAsset from '../assets/brand-real/squares-symbol.svg';
import spadesAsset from '../assets/brand-real/spades-symbol.svg';
import daricsAsset from '../assets/brand-real/darics-symbol.svg';
import rudesAsset from '../assets/brand-real/rudes-symbol.svg';
import laureatsAsset from '../assets/brand-real/laureats-symbol.svg';

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

const HOUSE_ASSETS: Record<string, string> = {
  squares: squaresAsset,
  spades: spadesAsset,
  darics: daricsAsset,
  rudes: rudesAsset,
  laureats: laureatsAsset,
};

const HOUSE_SCALE: Record<string, number> = {
  squares: 1.28,
  spades: 1.24,
  darics: 1.24,
  rudes: 1.18,
  laureats: 1.2,
};

export function TentHouseSymbol({ houseId, size = 24, className }: { houseId: string; size?: number; className?: string }) {
  const color = HOUSE_COLORS[houseId] || '#DDE3FF';
  const src = HOUSE_ASSETS[houseId] || squaresAsset;
  return (
    <span
      className={cn('inline-flex items-center justify-center flex-shrink-0 rounded-full bg-surface-2/95 shadow-sm ring-1 ring-border-bright', className)}
      style={{ width: size, height: size, color }}
    >
      <img
        src={src}
        alt={HOUSE_NAMES[houseId] || houseId}
        className="h-[84%] w-[84%] object-contain"
        style={{
          transform: `scale(${HOUSE_SCALE[houseId] || 1.24})`,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.46)) saturate(1.1) contrast(1.18) brightness(1.12)',
        }}
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
