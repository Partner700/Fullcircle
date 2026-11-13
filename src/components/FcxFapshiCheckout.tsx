import { MobileMoneyFailureMessage } from './MobileMoneyFailureMessage';
import { X } from 'lucide-react';
import { DirectMobileMoneyFields, type DirectMobileMoneyMethod } from './DirectMobileMoneyFields';
import { rememberMobileMoneyNumber } from './SavedMobileMoneyNumber';
import { supabase } from '../lib/supabase';
import { MobileMoneyApprovalHelp } from './MobileMoneyApprovalHelp';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { fetchCheckoutProvider, startMarketCartCheckout, startFcxFapshiCheckout, verifyCampayPayment, uploadFcxGuestAvatar, type CampayPaymentResult, type CheckoutProvider } from '../lib/queries';
import type { FcxExperience } from '../lib/types';

export type MarketCartLine = {
  key: string;
  name: string;
  unitPrice: number;
  quantity: number;
  relicSlug?: string;
  packSize?: number;
  eventId?: string;
};

export function FcxFapshiCheckout({ experience, className, children, onConfirmed, onOpenChange }: {
  experience: FcxExperience;
  className: string;
  children: ReactNode;
  onConfirmed: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const price = experience.ticket_price_xaf;
  const available = Math.max(0, experience.capacity - experience.registrations.length);
  if (!price || price < 300) return null;
  const line = { key: experience.id, name: 'FCX ticket', unitPrice: price, quantity: 1, eventId: experience.id };
  return <MarketCartCheckout lines={[line]} className={className} onConfirmed={onConfirmed}
    quantityLimit={available} attendeeEventId={experience.id} onOpenChange={onOpenChange}>{children}</MarketCartCheckout>;
}

export function MarketCartCheckout({ lines, className, children, onConfirmed, quantityLimit, onQuantity, onPendingChange, aboveOverlay, onOpenChange, attendeeEventId }: {
  lines: MarketCartLine[];
  className: string;
  children: ReactNode;
  onConfirmed: (purchased: MarketCartLine[]) => void;
  onPendingChange?: (pending: boolean) => void;
  aboveOverlay?: boolean;
  attendeeEventId?: string;
  onOpenChange?: (open: boolean) => void;
  quantityLimit?: number;
  onQuantity?: (quantity: number) => void;
}) {
  const { session } = useAuth();
  const dialogTitleId = useId();
  const userId = session?.user.id;
  const [payment, setPayment] = useState<CampayPaymentResult | null>(null);
  const [provider, setProvider] = useState<CheckoutProvider | null>(null);
  const [method, setMethod] = useState<DirectMobileMoneyMethod>('mtn_momo');
  const [phone, setPhone] = useState('');
  const [open, setOpen] = useState(false);
  function setCheckoutOpen(value: boolean) {
    setOpen(value);
    onOpenChange?.(value);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>('');
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [attendeeKind, setAttendeeKind] = useState<'' | 'self' | 'member' | 'guest'>('');
  const [attendeeId, setAttendeeId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState<Array<{ id: string; display_name: string }>>([]);
  const [guestPaymentId, setGuestPaymentId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhoto, setGuestPhoto] = useState<File | null>(null);
  const attendeeReady = !attendeeEventId || Boolean(attendeeKind && (attendeeKind !== 'member' || attendeeId));

  const refreshGuestDetails = useCallback(async () => {
    if (!attendeeEventId) return;
    const { data, error } = await supabase.rpc('get_fcx_guest_details_pending', { p_event_id: attendeeEventId });
    if (error) throw error;
    setGuestPaymentId(data?.[0]?.payment_id ?? null);
  }, [attendeeEventId]);

  useEffect(() => {
    if (!open || attendeeKind !== 'member') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const query = supabase.from('profiles').select('id,display_name').neq('id', userId ?? '')
        .order('display_name').order('id').limit(100);
      const name = memberSearch.trim().replace(/[%_]/g, '');
      void (name ? query.ilike('display_name', `%${name}%`) : query).then(({ data, error }) => {
        if (cancelled) return;
        setMembers(data ?? []);
        if (error) setError('Could not load app users. Try searching again.');
      });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [attendeeKind, memberSearch, open, userId]);

  async function saveGuest() {
    if (!attendeeEventId || !guestPaymentId || !guestName.trim() || !guestPhoto || busy) return;
    setBusy(true);
    setError('');
    try {
      const photo = await uploadFcxGuestAvatar(attendeeEventId, guestPhoto);
      const { error } = await supabase.rpc('complete_fcx_guest_details', {
        p_payment_id: guestPaymentId, p_name: guestName.trim(), p_photo: photo,
      });
      if (error) throw new Error(error.message);
      setGuestName('');
      setGuestPhoto(null);
      setGuestPaymentId(null);
      setConfirmed(true);
      onConfirmed(purchasedLines.current);
      await refreshGuestDetails();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save participant details.');
    } finally {
      setBusy(false);
    }
  }

  const amount = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  const purchasedLines = useRef<MarketCartLine[]>([]);
  const pendingAttempts = useRef(new Map<string, { payment: CampayPaymentResult; lines: MarketCartLine[] }>());
  const submitting = useRef(false);
  const displayedLines = payment || confirmed ? purchasedLines.current : lines;
  const displayedAmount = payment?.amount_local ?? displayedLines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  const withinCapacity = quantityLimit === undefined || (lines[0]?.quantity ?? 0) <= quantityLimit;

  useEffect(() => {
    onPendingChange?.(Boolean(payment && !confirmed));
  }, [payment, confirmed, onPendingChange]);

  const reference = payment?.reference;
  const activePayment = useRef<CampayPaymentResult | null>(null);
  const checkStatus = useCallback(async (reference: string, showError = false, storedOnly = false) => {
    try {
      const result = storedOnly
        ? await supabase.from('mobile_money_payments').select('status,rejection_reason')
          .eq('reference', reference).maybeSingle().then(({ data, error }) => {
            if (error) throw error;
            return data;
          })
        : await verifyCampayPayment(reference);
      if (!result) return;
      const attempt = pendingAttempts.current.get(reference);
      if (!attempt || (result.status !== 'confirmed' && result.status !== 'rejected')) return;
      pendingAttempts.current.delete(reference);
      if (activePayment.current?.reference === reference) {
        activePayment.current = null;
        if (result.status === 'confirmed') {
          setConfirmed(true);
          await refreshGuestDetails().catch(() => setError('Reopen checkout to add any participant details.'));
        } else {
          setPayment(null);
          setError(<><strong>Payment unsuccessful.</strong>{' '}<MobileMoneyFailureMessage reason={result.rejection_reason} approvalStartedAt={attempt.payment.approval_started_at} /></>);
        }
      }
      if (result.status === 'confirmed') onConfirmed(attempt.lines);
    } catch {
      if (showError && activePayment.current?.reference === reference) setError('Could not check payment status. Try checking again.');
    }
  }, [onConfirmed, refreshGuestDetails]);

  useEffect(() => {
    if (!reference || confirmed || !open) return;
    if (provider !== 'fapshi_direct') void checkStatus(reference);
    const timer = window.setInterval(() => void checkStatus(reference), provider === 'fapshi_direct' ? 16_000 : 15_000);
    // Read verified webhook outcomes without consuming Fapshi's polling allowance.
    void checkStatus(reference, false, true);
    const fastTimer = window.setInterval(() => void checkStatus(reference, false, true), 1_500);
    const stopFast = window.setTimeout(() => window.clearInterval(fastTimer), 30_000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 300_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(fastTimer);
      window.clearTimeout(stopFast);
      window.clearTimeout(stop);
    };
  }, [checkStatus, confirmed, open, provider, reference]);

  useEffect(() => {
    if (!userId || !reference) return;
    const channel = supabase.channel(`fcx-payment-${reference}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'mobile_money_payments', filter: `user_id=eq.${userId}`,
      }, ({ new: row }) => {
        if (pendingAttempts.current.has(row.reference) && (row.status === 'confirmed' || row.status === 'rejected')) {
          void checkStatus(row.reference, false, true);
        }
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [checkStatus, reference, userId]);

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
    setCheckoutOpen(true);
    if (activePayment.current) return;
    setConfirmed(false);
    setPayment(null);
    setError('');
    setProvider(null);
    setAttendeeKind('');
    setAttendeeId('');
    setMemberSearch('');
    try {
      await Promise.all([
        fetchCheckoutProvider(userId).then(setProvider),
        refreshGuestDetails(),
      ]);
    } catch {
      setError('Payment options are unavailable. Close and reopen checkout to retry.');
    }
  }

  async function prepare(retry = false) {
    const order = retry ? purchasedLines.current : lines;
    const orderAmount = retry ? displayedAmount : amount;
    if (!userId || !attendeeReady || guestPaymentId || (attendeeEventId && activePayment.current) || orderAmount < 100 || (!retry && !withinCapacity) || submitting.current ||
        (provider !== 'fapshi_direct' && !(provider === 'fapshi' && onQuantity && order[0]?.quantity === 1))) return;
    if (provider === 'fapshi_direct' && !/^(?:00)?(?:237)?0?6\d{8}$/.test(phone.replace(/\D/g, ''))) {
      setError('Enter a valid Cameroon mobile money number.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const ticket = order.find(line => line.eventId);
      const relics = order.flatMap(line => line.relicSlug ? [{ slug: line.relicSlug, quantity: line.quantity, pack_size: line.packSize }] : []);
      const result = provider === 'fapshi' && ticket?.eventId
        ? await startFcxFapshiCheckout(ticket.eventId, userId, orderAmount, 'fapshi_hosted')
        : await startMarketCartCheckout(userId, orderAmount, method, phone, relics, ticket?.eventId, ticket?.quantity,
          attendeeKind ? { kind: attendeeKind, id: attendeeId || undefined } : undefined);
      purchasedLines.current = order;
      setConfirmed(false);
      pendingAttempts.current.set(result.reference, { payment: result, lines: order });
      if (result.status === 'pending' && result.approval_started_at) rememberMobileMoneyNumber(userId, method, phone);
      activePayment.current = result;
      if (result.status === 'confirmed') {
        pendingAttempts.current.delete(result.reference);
        activePayment.current = null;
        setConfirmed(true);
        onConfirmed(purchasedLines.current);
        await refreshGuestDetails().catch(() => setError('Reopen checkout to add any participant details.'));
      } else if (result.status === 'rejected') {
        await checkStatus(result.reference, true);
      } else {
        setPayment(result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout could not start.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!userId || (!lines.length && !open && !activePayment.current)) return null;
  return (
    <>
      <button type="button" className={className} aria-label={attendeeEventId || onQuantity ? `Buy FCX ticket for ${lines[0]?.unitPrice.toLocaleString('en-US')} francs` : "Open market cart"} onClick={() => void openCheckout()}>{children}</button>
      {open && createPortal(
        <div onTouchStart={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}
          className={`fixed inset-0 ${aboveOverlay ? 'z-[2147483641]' : 'z-[165]'} flex items-center justify-center bg-ink/50 p-4 animate-fade-in`}>
          <section role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} className="card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto p-6 animate-scale-in">
            <div className="flex items-center justify-between">
              <h3 id={dialogTitleId} className="font-display text-lg font-semibold text-ink">Complete Purchase</h3>
              <button type="button" aria-label="Close checkout" className="text-stone hover:text-ink" disabled={busy} onClick={() => setCheckoutOpen(false)}><X size={20} /></button>
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
            {guestPaymentId ? (
              <form className="space-y-3" onSubmit={event => { event.preventDefault(); void saveGuest(); }}>
                <p role="status" className="text-sm text-sage">Payment confirmed. Add the participant to the FCX slide.</p>
                <label className="block text-sm">Participant name
                  <input className="input-field mt-1 w-full" value={guestName} maxLength={100}
                    onChange={event => setGuestName(event.target.value)} required />
                </label>
                <label className="block text-sm">Participant photo
                  <input type="file" accept="image/*" className="input-field mt-1 w-full"
                    onChange={event => setGuestPhoto(event.target.files?.[0] ?? null)} required />
                </label>
                <button className="btn-primary w-full" disabled={busy || !guestName.trim() || !guestPhoto}>
                  {busy ? 'Saving…' : 'Add participant'}
                </button>
              </form>
            ) : confirmed ? (
              <p role="status" className="text-sm text-sage">Payment confirmed. Your order is complete.</p>
            ) : payment ? (
              <>
                <p role="status" className="text-sm text-stone">Mobile money approval pending</p>
                {payment.checkout_url ? (
                  <a className="btn-primary" href={payment.checkout_url} target="_blank" rel="noopener noreferrer">Continue to payment</a>
                ) : <MobileMoneyApprovalHelp key={payment.reference} method={payment.payment_method ?? method} startedAt={payment.approval_started_at} allowAnotherPurchase={provider === 'fapshi_direct' && !attendeeEventId} onTimeout={() => void checkStatus(payment.reference)} />}
                {provider === 'fapshi_direct' && !attendeeEventId && (
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void prepare(true)}>
                    {busy ? 'Requesting payment…' : 'Request another prompt'}
                  </button>
                )}
              </>
            ) : (
              <>
                {attendeeEventId && (
                  <fieldset className="space-y-2" disabled={busy}>
                    <legend className="mb-2 text-sm font-semibold">Who is this ticket for?</legend>
                    <select className="input-field w-full" aria-label="Who is this ticket for?" value={attendeeKind}
                      onChange={event => { setAttendeeKind(event.target.value as typeof attendeeKind); setAttendeeId(''); }}>
                      <option value="">Choose an attendee</option>
                      <option value="self">Myself</option>
                      <option value="member">An app user</option>
                      <option value="guest">An external participant</option>
                    </select>
                    {attendeeKind === 'member' && <>
                      <input className="input-field w-full" placeholder="Search by name" aria-label="Search app users"
                        value={memberSearch} onChange={event => setMemberSearch(event.target.value)} />
                      <select className="input-field w-full" aria-label="Select an app user" size={5} value={attendeeId}
                        onChange={event => setAttendeeId(event.target.value)}>
                        {members.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}
                      </select>
                    </>}
                    {attendeeKind === 'guest' && <p className="text-xs text-stone">Add their name and photo after payment.</p>}
                  </fieldset>
                )}
                {!attendeeReady ? null : provider === 'fapshi_direct' ? (
                  <DirectMobileMoneyFields userId={userId} countryCode="CM" method={method} phone={phone}
                    busy={busy} disabled={amount < 100 || !withinCapacity || !/^(?:00)?(?:237)?0?6\d{8}$/.test(phone.replace(/\D/g, ''))}
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
            {!guestPaymentId && (confirmed || payment) && (
              <div className={confirmed ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3'}>
                {!confirmed && (
                  <button type="button" className="btn-secondary min-h-11 w-full justify-center text-sm" disabled={checking} onClick={() => void checkManually()}>
                    {checking ? 'Checking…' : 'Check Status'}
                  </button>
                )}
                <button type="button" className="btn-primary min-h-11 w-full justify-center text-sm" onClick={() => setCheckoutOpen(false)}>Done</button>
              </div>
            )}
          </section>
        </div>, document.body
      )}
    </>
  );
}
