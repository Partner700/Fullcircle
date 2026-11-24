import { useId } from 'react';
import { Loader2, Send, Smartphone } from 'lucide-react';
import { cn } from '../lib/utils';
import { CountryPhoneInput } from './CountryPhoneInput';
import { SavedMobileMoneyNumber } from './SavedMobileMoneyNumber';

const methods = [
  { id: 'mtn_momo', label: 'MTN MoMo' },
  { id: 'orange_money', label: 'Orange Money' },
] as const;

export type DirectMobileMoneyMethod = typeof methods[number]['id'];

export function DirectMobileMoneyFields({ userId, countryCode, method, phone, busy, disabled, onMethod, onPhone, onSubmit }: {
  userId?: string;
  countryCode?: string | null;
  method: DirectMobileMoneyMethod;
  phone: string;
  busy: boolean;
  disabled: boolean;
  onMethod: (method: DirectMobileMoneyMethod) => void;
  onPhone: (phone: string) => void;
  onSubmit: () => void;
}) {
  const phoneId = useId();
  const label = methods.find(option => option.id === method)?.label;
  return (
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <fieldset disabled={busy}>
        <legend className="text-xs text-stone mb-2">Payment method</legend>
        <div className="grid grid-cols-2 gap-2">
          {methods.map(option => (
            <button key={option.id} type="button" aria-pressed={method === option.id}
              onClick={() => onMethod(option.id)}
              className={cn('p-3 rounded-lg border text-center transition-all text-xs font-medium min-h-[74px]',
                method === option.id ? 'border-brass bg-brass/10 text-ink' : 'border-border bg-surface-2 text-stone hover:border-border-bright')}>
              <Smartphone size={18} className="mx-auto mb-1" />
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={phoneId} className="text-xs text-stone block mb-1">{label} phone number</label>
        <CountryPhoneInput id={phoneId} countryCode={countryCode} value={phone} onChange={onPhone} />
        <SavedMobileMoneyNumber userId={userId} method={method} onSelect={onPhone} />
      </div>
      <button type="submit" disabled={busy || disabled} className="btn-primary w-full text-sm disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        Request {label} Payment
      </button>
    </form>
  );
}
