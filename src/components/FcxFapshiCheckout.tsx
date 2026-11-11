import { MobileMoneyFailureMessage } from './MobileMoneyFailureMessage';
import { SavedMobileMoneyNumber, rememberMobileMoneyNumber } from './SavedMobileMoneyNumber';
import { supabase } from '../lib/supabase';
import { MobileMoneyApprovalHelp } from './MobileMoneyApprovalHelp';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { fetchCheckoutProvider, startFcxFapshiCheckout, verifyCampayPayment, type CampayPaymentResult, type CheckoutProvider } from '../lib/queries';
import type { FcxExperience } from '../lib/types';

export function FcxFapshiCheckout({ experience, className, children, onConfirmed }: {
  experience: FcxExperience;
  className: string;
  children: ReactNode;
  onConfirmed: () => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [payment, setPayment] = useState<CampayPaymentResult | null>(null);
  const [provider, setProvider] = useState<CheckoutProvider | null>(null);
  const [method, setMethod] = useState<'mtn_momo' | 'orange_money'>('mtn_momo');
  const [phone, setPhone] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>('');
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const amount = experience.ticket_price_xaf;
  const registered = experience.registrations.some((entry) => entry.user_id === userId);

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
        onConfirmed();
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
    const timer = window.setInterval(() => void checkStatus(reference), provider === 'fapshi_direct' ? 36_000 : 15_000);
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
    setError('');
    setProvider(null);
    try {
      setProvider(await fetchCheckoutProvider(userId));
    } catch {
      setError('Payment options are unavailable. Close and reopen checkout to retry.');
    }
  }

  async function prepare() {
    if (!userId || !amount || busy || (provider !== 'fapshi' && provider !== 'fapshi_direct')) return;
    const direct = provider === 'fapshi_direct';
    if (direct && !/^(?:00)?(?:237)?0?6\d{8}$/.test(phone.replace(/\D/g, ''))) {
      setError('Enter a valid Cameroon mobile money number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await startFcxFapshiCheckout(experience.id, userId, amount, direct ? method : 'fapshi_hosted', direct ? phone : undefined);
      if (direct && result.status === 'pending' && result.approval_started_at) rememberMobileMoneyNumber(userId, method, phone);
      activePayment.current = result;
      if (result.status === 'confirmed') {
        setConfirmed(true);
        onConfirmed();
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

  if ((!userId || registered || !amount || amount < 300) && !open) return null;
  return (
    <>
      <button type="button" className={className} aria-label="Pay for FCX with Fapshi" onClick={() => void openCheckout()}>{children}</button>
      {open && createPortal(
        <div className="fixed inset-0 z-[165] grid place-items-center bg-ink/60 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="fcx-fapshi-title" className="card w-full max-w-sm space-y-4 p-5">
            <h3 id="fcx-fapshi-title" className="font-display text-lg font-bold text-ink">Pay for your FCX ticket</h3>
            {confirmed || registered ? (
              <p role="status" className="text-sm text-sage">Payment confirmed. Your place is on the FCX list.</p>
            ) : payment ? (
              <>
                <p role="status" className="text-sm text-stone">Your place is held while Fapshi verifies the payment.</p>
                {payment.checkout_url ? <a className="btn-primary" href={payment.checkout_url} target="_blank" rel="noopener noreferrer">Open Fapshi checkout</a>
                  : provider === 'fapshi_direct' ? <MobileMoneyApprovalHelp key={payment.reference} method={payment.payment_method ?? method} startedAt={payment.approval_started_at} onTimeout={() => void checkStatus(payment.reference)} />
                    : <p className="text-sm text-stone">Check the status of your existing payment.</p>}
                <button type="button" className="btn-secondary" disabled={checking} onClick={() => void checkManually()}>
                  {checking ? 'Checking…' : 'Check payment status'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-stone">{amount?.toLocaleString()} FCFA via MTN MoMo or Orange Money.</p>
                {provider === 'fapshi_direct' && (
                  <>
                    <label className="block text-sm">Mobile money service
                      <select className="input-field mt-1 w-full" value={method}
                        onChange={event => setMethod(event.target.value === 'orange_money' ? 'orange_money' : 'mtn_momo')}>
                        <option value="mtn_momo">MTN MoMo</option>
                        <option value="orange_money">Orange Money</option>
                      </select>
                    </label>
                    <label className="block text-sm">Mobile money number
                      <input className="input-field mt-1 w-full" type="tel" autoComplete="tel" value={phone}
                        placeholder="6XX XXX XXX" onChange={event => setPhone(event.target.value)} />
                    </label>
                    <SavedMobileMoneyNumber userId={userId} method={method} onSelect={setPhone} />
                  </>
                )}
                {provider === 'fapshi' || provider === 'fapshi_direct' ? (
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void prepare()}>
                    {busy ? 'Preparing checkout…' : provider === 'fapshi_direct' ? 'Send payment prompt' : 'Continue to Fapshi'}
                  </button>
                ) : provider === 'campay' ? (
                  <p className="text-sm text-stone">FCX mobile money checkout is unavailable.</p>
                ) : !error && <p role="status" className="text-sm text-stone">Checking payment options…</p>}
              </>
            )}
            {error && <p role="alert" className="text-sm text-coral">{error}</p>}
            <button type="button" className="btn-secondary ml-2" disabled={busy} onClick={() => setOpen(false)}>Close</button>
          </section>
        </div>, document.body
      )}
    </>
  );
}
