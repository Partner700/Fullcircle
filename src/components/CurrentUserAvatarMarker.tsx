import { cn } from '../lib/utils';

export function CurrentUserAvatarMarker({ isCurrentUser, compact = false, className }: {
  isCurrentUser: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!isCurrentUser) return null;
  return (
    <span
      className={cn(
        'pointer-events-none absolute -bottom-1 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/80 bg-peri px-1 font-black uppercase leading-none text-white shadow-sm',
        compact ? 'py-0.5 text-[5px]' : 'py-0.5 text-[7px]',
        className,
      )}
      aria-label="Your avatar"
    >
      You
    </span>
  );
}
