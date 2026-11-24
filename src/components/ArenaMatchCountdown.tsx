import { useEffect, useState } from 'react';
import { Clock3, Dices } from 'lucide-react';
import { ArenaDieButton } from './ArenaDieButton';

export function ArenaMatchCountdown({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = Math.max(0, Math.ceil((Date.parse(startsAt) - now) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  return (
    <div className="flex flex-col items-center gap-3 py-5 text-center" aria-live="polite">
      {remaining > 0 ? (
        <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-gold/50 bg-navy/80 text-gold shadow-lg">
          <Dices size={50} className="animate-spin" aria-hidden="true" />
        </div>
      ) : <ArenaDieButton value={1} rolling={false} onRoll={() => undefined} disabled />}
      <p className="flex items-center gap-1.5 text-xs font-bold text-brass"><Clock3 size={14} /> {remaining ? 'Match begins in' : 'Match time'}</p>
      {remaining > 0 && <p className="font-display text-3xl font-black tabular-nums text-ink">
        {hours > 0 ? `${hours}:` : ''}{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </p>}
    </div>
  );
}
