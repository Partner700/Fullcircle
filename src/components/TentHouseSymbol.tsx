import { cn } from '../lib/utils';
import squaresAsset from '../assets/brand-real/squares.png';
import spadesAsset from '../assets/brand-real/spades.png';
import daricsAsset from '../assets/brand-real/darics.png';
import rudesAsset from '../assets/brand-real/sword.png';
import laureatsAsset from '../assets/brand-real/laureats.png';

const HOUSE_ASSETS: Record<string, string> = {
  squares: squaresAsset,
  spades: spadesAsset,
  darics: daricsAsset,
  rudes: rudesAsset,
  laureats: laureatsAsset,
};

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
  const src = HOUSE_ASSETS[houseId] || squaresAsset;
  return (
    <span
      className={cn('inline-flex items-center justify-center flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <img src={src} alt="" className="h-full w-full object-contain" />
    </span>
  );
}

export function TentHouseBadge({ houseId, size = 'md' }: { houseId: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const color = HOUSE_COLORS[houseId] || '#DDE3FF';
  const src = HOUSE_ASSETS[houseId] || squaresAsset;
  const iconSize = size === 'xs' ? 12 : size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
  const padX = size === 'xs' ? 'px-2' : 'px-3';
  const padY = size === 'xs' ? 'py-0.5' : 'py-1.5';
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-sm';

  return (
    <div
      className={cn('inline-flex items-center gap-1.5 rounded-full font-bold', padX, padY, textSize)}
      style={{ background: `${color}1A`, border: `1px solid ${color}30`, color }}
    >
      <img src={src} alt="" className="object-contain" style={{ width: iconSize, height: iconSize }} />
      {size !== 'xs' && <span>{HOUSE_NAMES[houseId] || houseId}</span>}
    </div>
  );
}

export { HOUSE_COLORS, HOUSE_NAMES };
