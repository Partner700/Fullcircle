import { Flame, Snowflake, Wallet } from 'lucide-react';
import type { StreakProtectionState } from '../lib/types';

export function StreakStatusIcon({
  protection,
  size = 15,
}: {
  protection: StreakProtectionState | null;
  size?: number;
}) {
  const isActive = protection?.active === true;
  const isSimonsPurse = isActive && protection.protection_kind === 'simons_purse';
  const label = isSimonsPurse
    ? "Simon's Purse is protecting this streak"
    : isActive
      ? `${protection.freezer_type === 'weekly' ? 'Weekly' : 'Daily'} freezer is protecting this streak`
      : 'Streak';

  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-label={label} title={label}>
      {isSimonsPurse ? (
        <Wallet size={size + 1} className="text-gold" strokeWidth={2.5} />
      ) : isActive ? (
        <Snowflake size={size + 1} className="text-peri" strokeWidth={2.5} />
      ) : (
        <Flame size={size} className="text-coral" />
      )}
    </span>
  );
}
