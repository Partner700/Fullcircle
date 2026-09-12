import { dialCodeForCountry, localPhoneNumber, phoneNumberForCountry } from '../lib/profileOptions';
import { cn } from '../lib/utils';

export function CountryPhoneInput({
  countryCode,
  value,
  onChange,
  id,
  placeholder = '6XX XXX XXX',
  className,
  required = false,
}: {
  countryCode?: string | null;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const dialCode = dialCodeForCountry(countryCode);
  return (
    <div className={cn('input-field flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden p-0 focus-within:ring-2 focus-within:ring-peri/25', className)}>
      <span className="flex h-full min-h-10 shrink-0 items-center border-r border-border px-3 text-sm font-semibold text-ink">
        {dialCode}
      </span>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required={required}
        value={localPhoneNumber(value, countryCode)}
        onChange={(event) => onChange(phoneNumberForCountry(event.target.value, countryCode))}
        placeholder={placeholder}
        className="w-0 min-w-0 flex-1 bg-transparent py-2.5 pr-3 text-sm text-ink outline-none"
      />
    </div>
  );
}
