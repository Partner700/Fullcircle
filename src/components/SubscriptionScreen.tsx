import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  fetchActiveSubscriptionPlan,
  fetchPanelImageSetting,
  fetchUserMobileMoneyPayments,
  getSubscriptionStatus,
  startSubscriptionCheckout,
  verifyCampayPayment,
  type CampayPaymentResult,
  type SubscriptionPlan,
} from '../lib/queries';
import type { PanelImageSetting } from '../lib/types';
import { formatXaf } from '../lib/utils';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

export type SubscriptionStatusView = {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  is_paid: boolean;
};

type PaymentMethod = 'mtn_momo' | 'orange_money';

interface SubscriptionScreenProps {
  subStatus: SubscriptionStatusView | null;
  onActivated?: (status: SubscriptionStatusView) => Promise<void> | void;
}

const CONFIRMED_STATUSES = new Set(['confirmed', 'successful', 'success', 'completed', 'granted']);

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function SubscriptionGate({ onSubscribe }: { onSubscribe: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-coral-soft">
        <Lock size={32} className="text-coral" />
      </div>
      <h2 className="mb-2 font-display text-xl font-semibold text-ink">Subscription required</h2>
      <p className="mb-6 max-w-md text-sm text-stone">
        Reading and community duties remain available. Subscribe to open games, the Arena, quizzes, boards, awards, and the Market.
      </p>
      <button onClick={onSubscribe} className="btn-primary">
        <CreditCard size={16} /> Open Subscription
      </button>
    </div>
  );
}

export function SubscriptionScreen({ subStatus, onActivated }: SubscriptionScreenProps) {
  const { profile } = useAuth();
  const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
  const [panelImage, setPanelImage] = useState<PanelImageSetting | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('mtn_momo');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState<CampayPaymentResult | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentRef = useRef<CampayPaymentResult | null>(null);
  const pollingStartedAtRef = useRef(0);

  useEffect(() => {
    paymentRef.current = payment;
  }, [payment]);

  useEffect(() => {
    let cancelled = false;
    setLoadingPlan(true);
    Promise.all([
      fetchActiveSubscriptionPlan(),
      fetchPanelImageSetting('subscription', ['all', 'cadets', 'sentries']).catch(() => null),
    ]).then(([activePlan, image]) => {
      if (cancelled) return;
      setPlan(activePlan);
      setPanelImage(image);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(errorMessage(reason, 'Subscription checkout is unavailable right now.'));
    }).finally(() => {
      if (!cancelled) setLoadingPlan(false);
    });
    return () => { cancelled = true; };
  }, []);

  const finishActivation = useCallback(async () => {
    if (!profile) return;
    const status = await getSubscriptionStatus(profile.id);
    if (status.status === 'active') {
      setPayment((current) => current ? {
        ...current,
        status: 'confirmed',
        message: 'Payment confirmed. Your Full Circle subscription is active.',
      } : current);
      await onActivated?.(status);
    }
  }, [onActivated, profile]);

  const checkPayment = useCallback(async (showErrors = true) => {
    const activePayment = paymentRef.current;
    if (!profile || !activePayment) return false;
    setChecking(true);
    try {
      const references = Array.from(new Set([
        activePayment.provider_reference,
        activePayment.reference,
      ].filter(Boolean))) as string[];
      for (const reference of references) {
        await verifyCampayPayment(reference).catch(() => null);
      }
      const payments = await fetchUserMobileMoneyPayments(profile.id);
      const stored = payments.find((item) =>
        item.reference === activePayment.reference
        || item.external_reference === activePayment.reference
        || item.provider_reference === activePayment.provider_reference,
      );
      if (!stored) return false;

      setPayment((current) => current ? {
        ...current,
        status: stored.status,
        provider_reference: stored.provider_reference,
        message: stored.status === 'confirmed'
          ? 'Payment confirmed. Your Full Circle subscription is active.'
          : stored.status === 'rejected'
            ? stored.rejection_reason || 'The payment was not confirmed.'
            : 'Approve the mobile money request on your phone.',
      } : current);
      if (stored.status === 'confirmed') {
        await finishActivation();
        return true;
      }
      return false;
    } catch (reason: unknown) {
      if (showErrors) setError(errorMessage(reason, 'Could not check the payment yet.'));
      return false;
    } finally {
      setChecking(false);
    }
  }, [finishActivation, profile]);

  useEffect(() => {
    if (!profile || !payment || CONFIRMED_STATUSES.has(String(payment.status).toLowerCase())) return;
    if (!pollingStartedAtRef.current) pollingStartedAtRef.current = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - pollingStartedAtRef.current > 180_000) {
        window.clearInterval(interval);
        return;
      }
      void checkPayment(false);
    }, 4500);
    return () => window.clearInterval(interval);
  }, [checkPayment, payment?.reference, payment?.status, profile]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`subscription_checkout_${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mobile_money_payments', filter: `user_id=eq.${profile.id}` },
        () => void checkPayment(false),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [checkPayment, profile]);

  const startCheckout = async () => {
    if (!profile || !plan) return;
    const normalizedPhone = phone.replace(/[\s()-]/g, '');
    if (normalizedPhone.replace(/\D/g, '').length < 9) {
      setError('Enter the mobile money phone number that will approve the payment.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setPayment(null);
    paymentRef.current = null;
    pollingStartedAtRef.current = 0;
    try {
      const result = await startSubscriptionCheckout(
        plan.id,
        profile.id,
        method,
        normalizedPhone,
        plan.amount_xaf,
        profile.email || undefined,
        profile.display_name || undefined,
      );
      paymentRef.current = result;
      pollingStartedAtRef.current = Date.now();
      setPayment(result);
      if (CONFIRMED_STATUSES.has(String(result.status).toLowerCase())) {
        await finishActivation();
      }
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'Could not start the subscription payment.'));
    } finally {
      setSubmitting(false);
    }
  };

  const isActive = subStatus?.status === 'active';
  const confirmed = payment && CONFIRMED_STATUSES.has(String(payment.status).toLowerCase());
  const trialEnd = subStatus?.trial_ends_at ? new Date(subStatus.trial_ends_at) : null;
  const periodEnd = subStatus?.current_period_end ? new Date(subStatus.current_period_end) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-fade-in">
      <section className="card relative overflow-hidden p-6 text-center">
        <PanelImageBackdrop image={panelImage} veilClassName="welcome-slide-veil" opacityFallback={35} />
        <div className="relative z-10">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold-soft">
            {isActive ? <ShieldCheck size={28} className="text-moss" /> : <CreditCard size={28} className="text-gold" />}
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink">Full Circle Subscription</h2>
          <p className="mt-2 text-sm text-stone">
            {isActive && periodEnd && `Active through ${periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`}
            {subStatus?.status === 'trial' && trialEnd && `Free trial through ${trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`}
            {subStatus?.status === 'expired' && 'Choose your mobile money network to restore full access.'}
            {!subStatus && 'Choose your mobile money network to continue.'}
          </p>
          {plan && (
            <div className="mt-4 inline-flex items-baseline gap-2 rounded-full border border-border-bright bg-surface/80 px-4 py-2 backdrop-blur-md">
              <span className="font-display text-xl font-bold text-ink">{formatXaf(plan.amount_xaf)}</span>
              <span className="text-xs text-stone">for {plan.duration_days} days</span>
            </div>
          )}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h3 className="font-display font-semibold text-ink">Pay with Mobile Money</h3>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-1.5">
          {([
            ['mtn_momo', 'MTN MoMo'],
            ['orange_money', 'Orange Money'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${method === id ? 'border-gold/45 bg-gold-soft text-ink' : 'border-transparent text-stone hover:border-border'}`}
            >
              <Smartphone size={15} /> {label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-xs font-semibold text-stone" htmlFor="subscription-phone">Mobile money number</label>
        <input
          id="subscription-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="e.g. 237 6XX XXX XXX"
          className="input-field mt-1.5 w-full"
        />

        {error && <div className="mt-4 rounded-lg border border-coral/30 bg-coral-soft px-3 py-2.5 text-sm text-coral">{error}</div>}
        {payment && (
          <div className={`mt-4 rounded-lg border px-3 py-3 text-sm ${confirmed ? 'border-moss/35 bg-moss/10 text-moss' : payment.status === 'rejected' ? 'border-coral/35 bg-coral-soft text-coral' : 'border-gold/30 bg-gold-soft text-ink'}`}>
            <div className="flex items-start gap-2">
              {confirmed ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <Smartphone size={17} className="mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className="font-semibold">{confirmed ? 'Subscription active' : 'Payment request sent'}</p>
                <p className="mt-0.5 text-xs opacity-80">{payment.message || 'Approve the prompt on your phone.'}</p>
                <p className="mt-1 truncate text-[10px] opacity-60">Reference: {payment.reference}</p>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={startCheckout}
          disabled={loadingPlan || submitting || !plan}
          className="btn-primary mt-4 w-full justify-center disabled:opacity-50"
        >
          {loadingPlan || submitting ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
          {submitting ? 'Sending payment request...' : isActive ? 'Extend Subscription' : 'Subscribe Now'}
        </button>
        {payment && !confirmed && payment.status !== 'rejected' && (
          <button
            type="button"
            onClick={() => void checkPayment(true)}
            disabled={checking}
            className="btn-secondary mt-2 w-full justify-center disabled:opacity-50"
          >
            {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Check Payment
          </button>
        )}
      </section>
    </div>
  );
}
