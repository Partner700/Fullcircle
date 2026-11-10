import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { startFcxFapshiCheckout, verifyCampayPayment, type CampayPaymentResult } from '../lib/queries';
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const amount = experience.ticket_price_xaf;
  const registered = experience.registrations.some((entry) => entry.user_id === userId);

  useEffect(() => {
    if (!payment || confirmed || !open) return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await verifyCampayPayment(payment.reference);
        if (cancelled) return;
        if (result.status === 'confirmed') {
          setConfirmed(true);
          onConfirmed();
        } else if (result.status === 'rejected') {
          setPayment(null);
          setError('This checkout expired or was rejected. You can start a new one.');
        }
      } catch { /* Verification can be retried while the payment is pending. */ }
    };
    const timer = window.setInterval(() => void check(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [confirmed, onConfirmed, open, payment]);

  async function prepare() {
    if (!userId || !amount || busy) return;
    setBusy(true);
    setError('');
    try {
      setPayment(await startFcxFapshiCheckout(experience.id, userId, amount));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout could not start.');
    } finally {
      setBusy(false);
    }
  }

  if ((!userId || registered || !amount || amount < 300) && !open) return null;
  return (
    <>
      <button type="button" className={className} aria-label="Pay for FCX with Fapshi" onClick={() => setOpen(true)}>{children}</button>
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
                  : <p className="text-sm text-stone">The link is being checked. Leave this open or reopen checkout later.</p>}
              </>
            ) : (
              <>
                <p className="text-sm text-stone">{amount?.toLocaleString()} FCFA via MTN MoMo or Orange Money.</p>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void prepare()}>
                  {busy ? 'Preparing checkout…' : 'Continue to Fapshi'}
                </button>
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
