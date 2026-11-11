import { MobileMoneyFailureMessage } from './MobileMoneyFailureMessage';
import { X } from 'lucide-react';
import { DirectMobileMoneyFields, type DirectMobileMoneyMethod } from './DirectMobileMoneyFields';
import { rememberMobileMoneyNumber } from './SavedMobileMoneyNumber';
import { supabase } from '../lib/supabase';
import { MobileMoneyApprovalHelp } from './MobileMoneyApprovalHelp';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { fetchCheckoutProvider, startMarketCartCheckout, startFcxFapshiCheckout, verifyCampayPayment, type CampayPaymentResult, type CheckoutProvider } from '../lib/queries';
import type { FcxExperience } from '../lib/types';

export type MarketCartLine = {
  key: string;
  name: string;
  unitPrice: number;
  quantity: number;
  relicSlug?: string;
  eventId?: string;
};

export function FcxFapshiCheckout({ experience, className, children, onConfirmed }: {
  experience: FcxExperience;
  className: string;
  children: ReactNode;
  onConfirmed: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const price = experience.ticket_price_xaf;
  const available = Math.max(0, experience.capacity - experience.registrations.length);
  if (!price || price < 300) return null;
  const line = { key: experience.id, name: 'FCX ticket', unitPrice: price, quantity, eventId: experience.id };
  return <MarketCartCheckout lines={[line]} className={className} onConfirmed={onConfirmed}
    quantityLimit={available} onQuantity={setQuantity}>{children}</MarketCartCheckout>;
}

export function MarketCartCheckout({ lines, className, children, onConfirmed, quantityLimit, onQuantity }: {
  lines: MarketCartLine[];
  className: string;
  children: ReactNode;
  onConfirmed: (purchased: MarketCartLine[]) => void;
  quantityLimit?: number;
  onQuantity?: (quantity: number) => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [payment, setPayment] = useState<CampayPaymentResult | null>(null);
  const [provider, setProvider] = useState<CheckoutProvider | null>(null);
  const [method, setMethod] = useState<DirectMobileMoneyMethod>('mtn_momo');
  const [phone, setPhone] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>('');
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const amount = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  const purchasedLines = useRef<MarketCartLine[]>([]);
  const displayedLines = payment || confirmed ? purchasedLines.current : lines;
  const displayedAmount = payment?.amount_local ?? displayedLines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  const withinCapacity = quantityLimit === undefined || (lines[0]?.quantity ?? 0) <= quantityLimit;

  const reference = payment?.reference;
  const activePayment = useRef<CampayPaymentResult | null>(null);
  const checkStatus = useCallback(async (reference: string, showError = false) => {
    try {
      const result = await verifyCampayPayment(reference);
      const attempt = activePayment.current;
      if (attempt?.reference !== reference) return;
      if (result.status === 'confirmed') {
        activePayment.current = null;
        setConfirmed(true);
        onConfirmed(purchasedLines.current);
      } else if (result.status === 'rejected') {
        activePayment.current = null;
        setPayment(null);
        setError(<MobileMoneyFailureMessage reason={result.rejection_reason} approvalStartedAt={attempt.approval_started_at} />);
      }
    } catch {
      if (showError && activePayment.current?.reference === reference) setError('Could not check payment status. Try checking again.');
    }
  }, [onConfirmed]);

  useEffect(() => {
    if (!reference || confirmed || !open) return;
    if (provider !== 'fapshi_direct') void checkStatus(reference);
    const timer = window.setInterval(() => void checkStatus(reference), provider === 'fapshi_direct' ? 16_000 : 15_000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 300_000);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); };
  }, [checkStatus, confirmed, open, provider, reference]);

  useEffect(() => {
    if (!userId || !reference || !open || confirmed) return;
    const channel = supabase.channel(`fcx-payment-${reference}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'mobile_money_payments', filter: `user_id=eq.${userId}`,
      }, ({ new: row }) => {
        if (row.reference === reference && (row.status === 'confirmed' || row.status === 'rejected')) {
          void checkStatus(reference);
        }
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [checkStatus, confirmed, open, reference, userId]);

  async function checkManually() {
    if (!reference || checking) return;
    setError('');
    setChecking(true);
    try {
      await checkStatus(reference, true);
    } finally {
      setChecking(false);
    }
  }

  async function openCheckout() {
    if (!userId) return;
    setOpen(true);
    if (activePayment.current) return;
    setConfirmed(false);
    setPayment(null);
    setError('');
    setProvider(null);
    try {
      setProvider(await fetchCheckoutProvider(userId));
    } catch {
      setError('Payment options are unavailable. Close and reopen checkout to retry.');
    }
  }

  async function prepare() {
    if (!userId || amount < 300 || !withinCapacity || busy || (provider !== 'fapshi_direct' && !(provider === 'fapshi' && onQuantity && lines[0]?.quantity === 1))) return;
    if (provider === 'fapshi_direct' && !/^(?:00)?(?:237)?0?6\d{8}$/.test(phone.replace(/\D/g, ''))) {
      setError('Enter a valid Cameroon mobile money number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ticket = lines.find(line => line.eventId);
      const relics = lines.flatMap(line => line.relicSlug ? [{ slug: line.relicSlug, quantity: line.quantity }] : []);
      const result = provider === 'fapshi' && ticket?.eventId
        ? await startFcxFapshiCheckout(ticket.eventId, userId, amount, 'fapshi_hosted')
        : await startMarketCartCheckout(userId, amount, method, phone, relics, ticket?.eventId, ticket?.quantity);
      purchasedLines.current = lines;
      if (result.status === 'pending' && result.approval_started_at) rememberMobileMoneyNumber(userId, method, phone);
      activePayment.current = result;
      if (result.status === 'confirmed') {
        activePayment.current = null;
        setConfirmed(true);
        onConfirmed(purchasedLines.current);
      } else if (result.status === 'rejected') {
        await checkStatus(result.reference, true);
      } else {
        setPayment(result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout could not start.');
    } finally {
      setBusy(false);
    }
  }

  if (!userId || (!lines.length && !open && !activePayment.current)) return null;
  return (
    <>
      <button type="button" className={className} aria-label={onQuantity ? `Buy FCX ticket for ${lines[0]?.unitPrice.toLocaleString('en-US')} francs` : "Open market cart"} onClick={() => void openCheckout()}>{children}</button>
      {open && createPortal(
        <div className="fixed inset-0 z-[165] flex items-center justify-center bg-ink/50 p-4 animate-fade-in">
          <section role="dialog" aria-modal="true" aria-labelledby="fcx-fapshi-title" className="card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto p-6 animate-scale-in">
            <div className="flex items-center justify-between">
              <h3 id="fcx-fapshi-title" className="font-display text-lg font-semibold text-ink">Complete Purchase</h3>
              <button type="button" aria-label="Close checkout" className="text-stone hover:text-ink" disabled={busy} onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <div className="rounded-lg bg-surface-2 p-4 space-y-2">
              {displayedLines.map(line => (
                <div key={line.key} className="flex items-center justify-between gap-2 text-sm">
                  <span>{line.name} × {line.quantity}</span>
                  <span>{(line.unitPrice * line.quantity).toLocaleString('en-US')} FCFA</span>
                </div>
              ))}
              {onQuantity && !payment && !confirmed && (
                <label className="flex items-center justify-between gap-2 text-sm">
                  FCX spots
                  <input type="number" min={1} max={quantityLimit} value={lines[0]?.quantity ?? 1}
                    className="input-field w-20" disabled={busy || !quantityLimit}
                    onChange={event => {
                      const value = event.target.valueAsNumber;
                      if (Number.isInteger(value)) onQuantity(Math.max(1, Math.min(quantityLimit ?? 2147483647, value)));
                    }} />
                </label>
              )}
              {!withinCapacity && !payment && !confirmed && <p className="text-xs text-stone">
                {quantityLimit ? `Only ${quantityLimit} FCX spots are available.` : 'No FCX spots are available.'}
              </p>}
              <p className="text-sm font-semibold text-gold">Total {displayedAmount.toLocaleString('en-US')} FCFA</p>
            </div>
            {confirmed ? (
              <p role="status" className="text-sm text-sage">Payment confirmed. Your order is complete.</p>
            ) : payment ? (
              <>
                <p role="status" className="text-sm text-stone">Mobile money approval pending</p>
                {payment.checkout_url ? (
                  <a className="btn-primary" href={payment.checkout_url} target="_blank" rel="noopener noreferrer">Continue to payment</a>
                ) : <MobileMoneyApprovalHelp key={payment.reference} method={payment.payment_method ?? method} startedAt={payment.approval_started_at} onTimeout={() => void checkStatus(payment.reference)} />}
                <button type="button" className="btn-secondary" disabled={checking} onClick={() => void checkManually()}>
                  {checking ? 'Checking…' : 'Check Status'}
                </button>
              </>
            ) : (
              <>
                {provider === 'fapshi_direct' ? (
                  <DirectMobileMoneyFields userId={userId} countryCode="CM" method={method} phone={phone}
                    busy={busy} disabled={amount < 300 || !withinCapacity || !/^(?:00)?(?:237)?0?6\d{8}$/.test(phone.replace(/\D/g, ''))}
                    onMethod={setMethod} onPhone={setPhone} onSubmit={() => void prepare()} />
                ) : provider === 'fapshi' && onQuantity && lines[0]?.quantity === 1 ? (
                  <button type="button" className="btn-primary w-full" disabled={busy || !withinCapacity} onClick={() => void prepare()}>
                    {busy ? 'Preparing checkout…' : 'Continue to payment'}
                  </button>
                ) : provider ? (
                  <p className="text-sm text-stone">Mobile money cart checkout is unavailable.</p>
                ) : !error && <p role="status" className="text-sm text-stone">Checking payment options…</p>}
              </>
            )}
            {error && <p role="alert" className="text-sm text-coral">{error}</p>}
            {(confirmed || payment) && <button type="button" className="btn-primary text-sm" onClick={() => setOpen(false)}>Done</button>}
          </section>
        </div>, document.body
      )}
    </>
  );
}
