import { useEffect, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import {
  getAlarmVolume,
  MAX_ALARM_VOLUME,
  setAlarmVolume,
  subscribeToAlarmVolume,
} from '../lib/alarmPreferences';
import { cn } from '../lib/utils';

type Props = {
  compact?: boolean;
  className?: string;
  onVolumeChange?: (volume: number) => void;
};

export function AlarmVolumeControl({ compact = false, className, onVolumeChange }: Props) {
  const [volume, setVolumeState] = useState(getAlarmVolume);

  useEffect(() => subscribeToAlarmVolume((next) => {
    setVolumeState(next);
    onVolumeChange?.(next);
  }), [onVolumeChange]);

  const change = (next: number) => {
    const saved = setAlarmVolume(next);
    setVolumeState(saved);
    onVolumeChange?.(saved);
  };

  const Icon = volume === 0 ? VolumeX : volume < 100 ? Volume1 : Volume2;
  return (
    <div className={cn(compact ? 'mt-3' : 'mt-4 border-t border-border pt-4', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={compact ? 'active-alarm-volume' : 'alarm-volume'} className="inline-flex items-center gap-2 text-xs font-bold text-ink">
          <Icon size={15} className="text-peri" /> Alarm volume
        </label>
        <output className="rounded-full border border-border-bright bg-surface-2 px-2 py-0.5 text-[10px] font-black text-peri">
          {volume} / {MAX_ALARM_VOLUME}
        </output>
      </div>
      <input
        id={compact ? 'active-alarm-volume' : 'alarm-volume'}
        type="range"
        min="0"
        max={MAX_ALARM_VOLUME}
        step="10"
        value={volume}
        onChange={(event) => change(Number(event.target.value))}
        className="alarm-volume-slider w-full accent-coral"
        aria-label="Scripture alarm volume"
      />
      {!compact && <p className="mt-2 text-[11px] leading-relaxed text-stone">The siren volume is adjustable. Phone vibration remains on even when sound is lowered.</p>}
    </div>
  );
}
