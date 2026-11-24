import { useId } from 'react';
import { Clock } from 'lucide-react';
import { preferredTimeZone } from '../lib/regionalPreferences';

const zoneList = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
  .supportedValuesOf?.('timeZone') ?? [];

export function ProfileTimeZoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const deviceZone = preferredTimeZone();
  return (
    <div className="block min-w-0 text-xs text-stone">
      <label htmlFor={id} className="mb-1 flex items-center gap-1"><Clock size={13} /> Time zone</label>
      <input
        id={id}
        className="input-field w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={`${id}-zones`}
        spellCheck={false}
        required
      />
      <datalist id={`${id}-zones`}>
        {Array.from(new Set([deviceZone, 'Africa/Douala', 'UTC', ...zoneList])).map((zone) => <option key={zone} value={zone} />)}
      </datalist>
      <button className="mt-1 text-xs font-medium text-peri" type="button" onClick={() => onChange(deviceZone)}>
        Use device time zone
      </button>
      <p className="mt-1 text-xs text-stone">Shared deadlines and events show in this time zone.</p>
    </div>
  );
}
