import {
  HouseSquareIcon, HouseSpadeIcon, HouseCoinIcon, HouseSwordIcon, HouseLaurelIcon,
} from './BrandIcons';
import { cn } from '../lib/utils';

const HOUSE_ICONS: Record<string, typeof HouseSquareIcon> = {
  squares: HouseSquareIcon,
  spades: HouseSpadeIcon,
  darics: HouseCoinIcon,
  rudes: HouseSwordIcon,
  laureats: HouseLaurelIcon,
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
  const Icon = HOUSE_ICONS[houseId] || HouseSquareIcon;
  const color = HOUSE_COLORS[houseId] || '#DDE3FF';
  return (
    <span
      className={cn('inline-flex items-center justify-center flex-shrink-0', className)}
      style={{ width: size, height: size, color }}
    >
      <Icon size={size} />
    </span>
  );
}

export function TentHouseBadge({ houseId, size = 'md' }: { houseId: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const color = HOUSE_COLORS[houseId] || '#DDE3FF';
  const Icon = HOUSE_ICONS[houseId] || HouseSquareIcon;
  const iconSize = size === 'xs' ? 12 : size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
  const padX = size === 'xs' ? 'px-2' : 'px-3';
  const padY = size === 'xs' ? 'py-0.5' : 'py-1.5';
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-sm';

  return (
    <div
      className={cn('inline-flex items-center gap-1.5 rounded-full font-bold', padX, padY, textSize)}
      style={{ background: `${color}1A`, border: `1px solid ${color}30`, color }}
    >
      <Icon size={iconSize} />
      {size !== 'xs' && <span>{HOUSE_NAMES[houseId] || houseId}</span>}
    </div>
  );
}

export { HOUSE_COLORS, HOUSE_NAMES };
