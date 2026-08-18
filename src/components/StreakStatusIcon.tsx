import { Coins, Flame, Snowflake } from 'lucide-react';
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
      <Flame size={size} className="text-coral" />
      {isActive && (
        <span className={`absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-bg shadow-sm ${isSimonsPurse ? 'bg-gold text-navy' : 'bg-peri text-white'}`}>
          {isSimonsPurse ? <Coins size={8} strokeWidth={2.8} /> : <Snowflake size={8} strokeWidth={2.8} />}
        </span>
      )}
    </span>
  );
}
