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
        'current-user-avatar-marker pointer-events-none absolute -bottom-1 left-1/2 z-[2] -translate-x-1/2 rounded-full border px-1 font-black uppercase leading-none shadow-sm',
        compact ? 'py-0.5 text-[5px]' : 'py-0.5 text-[7px]',
        className,
      )}
      aria-label="Your avatar"
    >
      You
    </span>
  );
}
