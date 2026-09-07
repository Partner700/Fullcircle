import { Dices } from 'lucide-react';
import { cn } from '../lib/utils';

export function ArenaDieButton({
  value,
  rolling,
  revealing = false,
  onRoll,
  disabled = false,
  className,
}: {
  value: number;
  rolling: boolean;
  revealing?: boolean;
  onRoll: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRoll}
      disabled={disabled || rolling || revealing}
      className={cn(
        'group flex h-24 w-24 flex-col items-center justify-center rounded-2xl border-2 border-gold/70 bg-gold/10 text-gold shadow-[0_0_30px_rgba(232,185,88,0.18)] transition-transform hover:scale-105 disabled:cursor-wait sm:h-32 sm:w-32',
        className,
      )}
      aria-label={revealing ? `You played ${value}` : 'Roll the Arena die'}
    >
      <Dices size={rolling ? 38 : 46} className={cn(rolling && 'animate-spin')} />
      <span className="mt-1 font-display text-2xl font-black">{value}</span>
      <span className="text-[9px] font-black uppercase text-white/70 sm:text-[10px]">
        {rolling ? 'Rolling' : revealing ? 'You played' : 'Roll'}
      </span>
    </button>
  );
}
