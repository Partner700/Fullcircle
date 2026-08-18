import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader } from '../../components/AppShell';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { AppSelect } from '../../components/AppSelect';
import { supabase } from '../../lib/supabase';
import { fetchLedgerTotal, purchaseRelic, useRelic as deployRelic, fetchStreakFreezers, purchaseDailyFreezer, purchaseWeeklyFreezer, startCampayCheckout, fetchUserMobileMoneyPayments, purchaseRelicForCadet, purchaseDailyFreezerForCadet, verifyCampayPayment, fetchPanelImageSetting } from '../../lib/queries';
import { FREEZER_DAILY_COST, FREEZER_WEEKLY_COST, RELIC_SLUGS } from '../../lib/constants';
import { cn, formatDenarii, formatXaf } from '../../lib/utils';
import { playSoundEffect } from '../../lib/soundscape';
import type { CampayPaymentResult } from '../../lib/queries';
import type { PanelImageSetting, RelicType, StreakFreezer } from '../../lib/types';
import {
  ShoppingBag, Coins, Loader2, Snowflake, Sparkles, Swords, MessageSquare,
  Wallet, Cross, CheckCircle2, Lock, Smartphone, X, Landmark, Send, Trophy,
} from 'lucide-react';

const RELIC_ICONS: Record<string, any> = {
  'witch-ball-endor': Sparkles,
  'sword-goliath': Swords,
  'talking-donkey': MessageSquare,
  'simons-purse': Wallet,
  'thieves-request': Cross,
  'masters-reward': Trophy,
  'lazarus-coin': Coins,
  'redemption-coin': Coins,
};

const RELIC_COLORS: Record<string, string> = {
  'witch-ball-endor': '#7B6FB0',
  'sword-goliath': '#B8553E',
  'talking-donkey': '#6B8E5A',
  'simons-purse': '#C9A227',
  'thieves-request': '#3D52C8',
  'masters-reward': '#8F6A2A',
  'lazarus-coin': '#6B8E5A',
  'redemption-coin': '#C9A227',
};

const STORE_USABLE_RELICS = new Set<string>([
  RELIC_SLUGS.MASTERS_REWARD,
  RELIC_SLUGS.THIEVES_REQUEST,
  RELIC_SLUGS.SIMONS_PURSE,
  RELIC_SLUGS.REDEMPTION_COIN,
]);

type StorePaymentMethod = 'mtn_momo' | 'orange_money' | 'other';

const PAYMENT_METHODS: { id: StorePaymentMethod; label: string; icon: typeof Smartphone }[] = [
  { id: 'mtn_momo', label: 'MTN MoMo', icon: Smartphone },
  { id: 'orange_money', label: 'Orange Money', icon: Smartphone },
  { id: 'other', label: 'Other', icon: Landmark },
];

const FALLBACK_XAF_PER_USD = 575;
function relicMoneyPriceXaf(relic: RelicType): number {
  const explicitXaf = Number(relic.money_price_xaf);
  if (Number.isFinite(explicitXaf) && explicitXaf > 0) return Math.round(explicitXaf);

  const legacyUsd = Number(relic.money_price_usd);
  if (Number.isFinite(legacyUsd) && legacyUsd > 0) return Math.round(legacyUsd * FALLBACK_XAF_PER_USD);

  return 0;
}

interface CadetStoreProps {
  onBalanceChanged?: () => Promise<void> | void;
  refreshKey?: number;
  giftRecipients?: { id: string; name: string }[];
}

export function CadetStore({ onBalanceChanged, refreshKey = 0, giftRecipients = [] }: CadetStoreProps) {
  const { profile } = useAuth();
  const [relics, setRelics] = useState<RelicType[]>([]);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [freezers, setFreezers] = useState<StreakFreezer[]>([]);
  const [denarii, setDenarii] = useState(0);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [usingRelic, setUsingRelic] = useState<string | null>(null);
  const [buyingFreezer, setBuyingFreezer] = useState(false);
  const [buyingWeeklyFreezer, setBuyingWeeklyFreezer] = useState(false);
  const [paymentModalRelic, setPaymentModalRelic] = useState<RelicType | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<StorePaymentMethod>('mtn_momo');
  const [payPhone, setPayPhone] = useState('');
  const [otherProvider, setOtherProvider] = useState('');
  const [otherAccountName, setOtherAccountName] = useState('');
  const [otherContact, setOtherContact] = useState('');
  const [otherTransactionReference, setOtherTransactionReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentResult, setPaymentResult] = useState<CampayPaymentResult | null>(null);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [giftRecipientId, setGiftRecipientId] = useState('self');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [marketImage, setMarketImage] = useState<PanelImageSetting | null>(null);

  const paymentConfirmed = paymentResult
    ? ['confirmed', 'successful', 'success', 'completed'].includes(String(paymentResult.status).toLowerCase())
    : false;

  useEffect(() => {
    if (!paymentResult?.status) return;
    const status = String(paymentResult.status).toLowerCase();
    if (['confirmed', 'successful', 'success', 'completed'].includes(status)) {
      void playSoundEffect('sound_purchase_success', 0.68);
    } else if (['rejected', 'failed', 'cancelled', 'expired'].includes(status)) {
      void playSoundEffect('sound_purchase_failed', 0.68);
    }
  }, [paymentResult?.reference, paymentResult?.status]);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [relicData, invData, balance, frz, marketPanelImage] = await Promise.all([
        supabase.from('relic_types').select('*').order('denarii_cost', { ascending: true }),
        supabase.from('relic_inventory').select('relic_type_id, quantity').eq('user_id', profile.id),
        fetchLedgerTotal(profile.id),
        fetchStreakFreezers(profile.id),
        fetchPanelImageSetting('market').catch(() => null),
      ]);
      setRelics(relicData.data as RelicType[] || []);
      const invMap: Record<string, number> = {};
      (invData.data || []).forEach((r: any) => { invMap[r.relic_type_id] = r.quantity; });
      setInventory(invMap);
      setDenarii(balance);
      setFreezers(frz);
      setMarketImage(marketPanelImage);
    } catch (err: any) {
      setLoadError(err?.message || 'The Market could not load. Please try again.');
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const refreshPurchaseState = useCallback(async () => {
    await load();
    await onBalanceChanged?.();
  }, [load, onBalanceChanged]);

  const buyWithDenarii = async (slug: string) => {
    if (!profile) return;
    setPurchasing(slug);
    try {
      if (giftRecipientId !== 'self') {
        await purchaseRelicForCadet(profile.id, giftRecipientId, slug);
      } else {
        await purchaseRelic(profile.id, slug, 'denarii');
      }
      await refreshPurchaseState();
    } catch (e: any) { alert(e.message || 'Failed to purchase'); }
    setPurchasing(null);
  };

  const activateOwnedRelic = async (slug: string) => {
    if (!profile) return;
    setUsingRelic(slug);
    try {
      const result = await deployRelic(profile.id, slug);
      await refreshPurchaseState();
      const awarded = Number(result?.denarii_awarded || 0);
      alert(result?.message || (awarded > 0 ? `Relic used. +${formatDenarii(awarded)} Ð awarded.` : 'Relic used.'));
    } catch (e: any) {
      alert(e.message || 'Failed to use relic');
    }
    setUsingRelic(null);
  };

  const openPaymentModal = (relic: RelicType) => {
    setPaymentModalRelic(relic);
    setPaymentMethod('mtn_momo');
    setPayPhone('');
    setOtherProvider('');
    setOtherAccountName('');
    setOtherContact('');
    setOtherTransactionReference('');
    setPaymentNote('');
    setPaymentResult(null);
  };

  const retryPayment = () => {
    setPaymentResult(null);
    setPaySubmitting(false);
    setCheckingPayment(false);
  };

  const submitPayment = async () => {
    if (!profile || !paymentModalRelic) return;
    setPaySubmitting(true);
    try {
      const slug = paymentModalRelic.slug || paymentModalRelic.id;
      const displayedAmountXaf = relicMoneyPriceXaf(paymentModalRelic);
      const verificationNote = paymentMethod === 'other'
        ? [
          `Provider: ${otherProvider.trim()}`,
          `Account/name used: ${otherAccountName.trim()}`,
          `Contact: ${otherContact.trim()}`,
          `Transaction reference: ${otherTransactionReference.trim()}`,
          paymentNote.trim() ? `Notes: ${paymentNote.trim()}` : '',
        ].filter(Boolean).join('\n')
        : paymentNote.trim();
      const result = await startCampayCheckout(
        slug,
        profile.id,
        paymentMethod,
        profile.email || undefined,
        profile.display_name || undefined,
        payPhone || undefined,
        otherProvider || undefined,
        verificationNote || undefined,
        displayedAmountXaf,
      );
      setPaymentResult(result);
      if (['confirmed', 'successful', 'success', 'completed'].includes(String(result.status).toLowerCase())) {
        await refreshPurchaseState();
      }
    } catch (e: any) { alert(e.message || 'Failed to start payment.'); }
    setPaySubmitting(false);
  };

  const checkPaymentStatus = async () => {
    if (!profile || !paymentResult) return;
    setCheckingPayment(true);
    try {
      const refs = Array.from(new Set([
        paymentResult.provider_reference,
        paymentResult.reference,
      ].filter(Boolean))) as string[];
      for (const ref of refs) {
        await verifyCampayPayment(ref).catch(() => null);
      }
      const payments = await fetchUserMobileMoneyPayments(profile.id);
      const payment = payments.find((item) =>
        item.reference === paymentResult.reference ||
        item.external_reference === paymentResult.reference ||
        item.provider_reference === paymentResult.provider_reference,
      );
      if (!payment) {
        alert('Payment request not found yet. Try again shortly.');
        setCheckingPayment(false);
        return;
      }
      setPaymentResult((prev) => prev ? {
        ...prev,
        status: payment.status,
        amount_local: payment.amount_local,
        currency_code: payment.currency_code,
        provider: payment.provider,
        message: payment.status === 'confirmed'
          ? 'Payment confirmed. Your relic has been added to your inventory.'
          : payment.status === 'rejected'
            ? payment.rejection_reason || 'Payment was not confirmed.'
            : 'Payment is still pending. The relic will appear only after confirmation.',
      } : prev);
      if (payment.status === 'confirmed') await refreshPurchaseState();
    } catch (e: any) {
      alert(e.message || 'Could not check payment status.');
    }
    setCheckingPayment(false);
  };

  useEffect(() => {
    if (!profile || !paymentResult || paymentConfirmed || paymentResult.status === 'rejected') return;
    if (paymentResult.payment_method === 'other') return;

    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      if (cancelled) return false;
      try {
        const refs = Array.from(new Set([
          paymentResult.provider_reference,
          paymentResult.reference,
        ].filter(Boolean))) as string[];
        for (const ref of refs) {
          await verifyCampayPayment(ref).catch(() => null);
        }
        const payments = await fetchUserMobileMoneyPayments(profile.id);
        const payment = payments.find((item) =>
          item.reference === paymentResult.reference ||
          item.external_reference === paymentResult.reference ||
          item.provider_reference === paymentResult.provider_reference,
        );
        if (payment?.status === 'confirmed') {
          setPaymentResult({
            ...paymentResult,
            status: 'confirmed',
            amount_local: payment.amount_local,
            currency_code: payment.currency_code,
            provider: payment.provider,
            message: 'Payment confirmed automatically. Your relic has been added.',
          });
          await refreshPurchaseState();
          return true;
        }
        if (payment?.status === 'rejected') {
          setPaymentResult({
            ...paymentResult,
            status: 'rejected',
            message: payment.rejection_reason || 'Payment was not confirmed. You can try again.',
          });
          return true;
        }
      } catch {}
      return false;
    };
    void poll();
    const interval = window.setInterval(async () => {
      if (await poll()) window.clearInterval(interval);

      if (Date.now() - startedAt >= 35_000) {
        setPaymentResult({
          ...paymentResult,
          status: 'rejected',
          message: 'Payment was not confirmed within 35 seconds. No relic was added. You can try again.',
        });
        window.clearInterval(interval);
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [paymentResult, paymentConfirmed, profile, refreshPurchaseState]);

  useEffect(() => {
    if (!profile || !paymentResult || paymentConfirmed) return;
    const channel = supabase
      .channel(`market_payment_${profile.id}_${paymentResult.reference}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mobile_money_payments', filter: `user_id=eq.${profile.id}` },
        async (payload) => {
          const payment: any = payload.new;
          if (!payment) return;
          const matches =
            payment.reference === paymentResult.reference ||
            payment.external_reference === paymentResult.reference ||
            payment.provider_reference === paymentResult.provider_reference;
          if (!matches) return;
          if (payment.status === 'confirmed') {
            setPaymentResult({
              ...paymentResult,
              status: 'confirmed',
              amount_local: payment.amount_local,
              currency_code: payment.currency_code,
              provider: payment.provider,
              message: 'Payment confirmed automatically. Your relic has been added.',
            });
            await refreshPurchaseState();
          } else if (payment.status === 'rejected') {
            setPaymentResult({
              ...paymentResult,
              status: 'rejected',
              message: payment.rejection_reason || 'Payment was not confirmed. You can try again.',
            });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, paymentResult, paymentConfirmed, refreshPurchaseState]);

  const buyFreezer = async () => {
    if (!profile) return;
    setBuyingFreezer(true);
    try {
      if (giftRecipientId !== 'self') {
        await purchaseDailyFreezerForCadet(profile.id, giftRecipientId);
      } else {
        await purchaseDailyFreezer(profile.id);
      }
      await refreshPurchaseState();
    } catch (e: any) { alert(e.message || 'Failed to purchase freezer'); }
    setBuyingFreezer(false);
  };

  const buyWeeklyFreezer = async () => {
    if (!profile || giftRecipientId !== 'self') return;
    setBuyingWeeklyFreezer(true);
    try {
      await purchaseWeeklyFreezer(profile.id);
      await refreshPurchaseState();
    } catch (e: any) { alert(e.message || 'Failed to purchase weekly freezer'); }
    setBuyingWeeklyFreezer(false);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  const selectedPaymentLabel = PAYMENT_METHODS.find((method) => method.id === paymentMethod)?.label || 'Payment';
  const canSubmitPayment = paymentMethod === 'other'
    ? false
    : payPhone.trim().length > 0;
  const lazarusMarketDescription = 'Take or retake the Saturday quiz late and submit before 2:45 PM. Denarii only.';
  const readyDailyFreezers = freezers.filter((f) => f.freezer_type === 'daily' && !f.used_at && !f.applied_to_date).length;
  const readyWeeklyFreezers = freezers.filter((f) => f.freezer_type === 'weekly' && !f.used_at && !f.applied_to_date).length;

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      <SectionHeader title="The Market" subtitle="Buy freezers and biblical relics to protect your streak and aid your games" />

      {loadError && (
        <div className="rounded-lg border border-coral/30 bg-coral-soft p-3 text-sm text-coral">
          {loadError}
        </div>
      )}

      {giftRecipients.length > 0 && (
        <div className="card p-4">
          <label className="text-xs text-stone block mb-1">Buy for</label>
          <AppSelect
            value={giftRecipientId}
            onChange={setGiftRecipientId}
            options={[{ value: 'self', label: 'Myself' }, ...giftRecipients.map((recipient) => ({ value: recipient.id, label: recipient.name }))]}
          />
          {giftRecipientId !== 'self' && (
            <p className="text-xs text-sage mt-2">
              You pay with your denarii; the item is added to this cadet's account.
            </p>
          )}
        </div>
      )}

      {/* Balance bar */}
      <div className="card relative flex flex-col items-start justify-between gap-2 overflow-hidden p-4 min-[460px]:flex-row min-[460px]:items-center">
        <PanelImageBackdrop image={marketImage} opacityFallback={18} veilClassName="bg-navy-2/78" />
        <div className="relative z-10 flex items-center gap-2">
          <Coins size={20} className="text-gold" />
          <span className="font-display font-bold text-gold text-lg">{formatDenarii(denarii)} Ð</span>
          <span className="text-xs text-stone">denarii balance</span>
        </div>
        <span className="relative z-10 text-xs text-stone">Cash prices in FCFA</span>
      </div>

      {/* Streak Freezers */}
      <div className="card p-5 relative overflow-hidden">
        <PanelImageBackdrop image={marketImage} opacityFallback={18} veilClassName="bg-navy-2/82" />
        <div className="relative z-10 flex items-center gap-2 mb-3">
          <Snowflake size={20} className="text-brass" />
          <h4 className="font-display font-semibold text-ink">Streak Freezers</h4>
        </div>
        <p className="relative z-10 text-xs text-stone mb-4">Protect your streak after a missed day. Without a freezer, one miss = full streak reset.</p>
        <div className="relative z-10 grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[10px] text-stone uppercase font-bold tracking-wide">Daily Ready</p>
            <p className="font-display text-xl text-ink font-bold">{readyDailyFreezers}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[10px] text-stone uppercase font-bold tracking-wide">Weekly Ready</p>
            <p className="font-display text-xl text-ink font-bold">{readyWeeklyFreezers}</p>
          </div>
        </div>

        <div className="relative z-10 grid sm:grid-cols-2 gap-3">
          <div className="p-4 rounded-lg border border-border bg-surface-2">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-ink text-sm">Daily Freezer</span>
              <span className="font-display font-bold text-gold">{FREEZER_DAILY_COST} Ð</span>
            </div>
            <p className="text-xs text-stone mb-3">Protects one missed day.</p>
            <button onClick={buyFreezer} disabled={denarii < FREEZER_DAILY_COST || buyingFreezer}
              className="btn-primary text-xs w-full disabled:opacity-50">
              {buyingFreezer ? <Loader2 size={12} className="animate-spin" /> : <Snowflake size={12} />} Buy
            </button>
          </div>

          <div className="p-4 rounded-lg border border-border bg-surface-2">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-ink text-sm">Weekly Freezer</span>
              <span className="font-display font-bold text-gold">{formatDenarii(FREEZER_WEEKLY_COST)} Ð</span>
            </div>
            <p className="text-xs text-stone mb-3">Protects seven consecutive days and activates only when no daily freezer is ready.</p>
            <button onClick={buyWeeklyFreezer} disabled={giftRecipientId !== 'self' || denarii < FREEZER_WEEKLY_COST || buyingWeeklyFreezer}
              className="btn-primary text-xs w-full disabled:opacity-50">
              {buyingWeeklyFreezer ? <Loader2 size={12} className="animate-spin" /> : <Snowflake size={12} />} Buy
            </button>
            {giftRecipientId !== 'self' && <p className="text-[10px] text-stone mt-2">Weekly freezers are currently purchased for your own account.</p>}
          </div>
        </div>

        {freezers.length > 0 && (
          <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
            {freezers.map((f) => (
              <span key={f.id} className={cn('badge text-[10px]', f.used_at || f.applied_to_date ? 'badge-neutral' : 'badge-brass')}>
                <Snowflake size={10} className="mr-1" />
                {f.freezer_type === 'daily' ? 'Daily' : 'Weekly'} · {f.used_at ? 'Used' : f.applied_to_date ? 'Applied' : 'Ready'}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Relics */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingBag size={20} className="text-royal" />
          <h4 className="font-display font-semibold text-ink">Biblical Relics</h4>
        </div>
        <p className="relative z-10 text-xs text-stone mb-4">Ancient artifacts with powerful effects. Wildly expensive — save your denarii or buy with real money where a cash price exists.</p>

        <div className="relative z-10 space-y-3">
          {relics.map((relic) => {
            const slug = relic.slug || '';
            const Icon = RELIC_ICONS[slug] || Sparkles;
            const color = RELIC_COLORS[slug] || '#C9A227';
            const owned = inventory[relic.id] || 0;
            const denariiCost = Number(relic.denarii_cost || 0);
            const hasDenariiPrice = denariiCost > 0;
            const canAffordDenarii = hasDenariiPrice && denarii >= denariiCost;
            const canUseFromStore = owned > 0 && STORE_USABLE_RELICS.has(slug);
            const moneyPriceXaf = relicMoneyPriceXaf(relic);
            const moneyPrice = formatXaf(moneyPriceXaf);
            const gifting = giftRecipientId !== 'self';

            return (
              <div key={relic.id} className="p-4 rounded-lg border border-border bg-surface-2">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}20` }}>
                    <Icon size={22} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h5 className="font-display font-semibold text-ink text-sm">{relic.name}</h5>
                      <span className={cn('badge text-[9px]', relic.rarity === 'legendary' ? 'badge-brass' : 'badge-neutral')}>
                        {relic.rarity}
                      </span>
                      {owned > 0 && (
                        <span className="badge badge-sage text-[10px] gap-1" title={`${owned} owned`}>
                          <CheckCircle2 size={10} /> {owned}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone mt-1">
                      {slug === RELIC_SLUGS.LAZARUS_COIN ? lazarusMarketDescription : relic.description}
                    </p>

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {hasDenariiPrice ? (
                        <button
                          onClick={() => buyWithDenarii(slug)}
                          disabled={!canAffordDenarii || purchasing === slug}
                          className="btn-secondary text-xs disabled:opacity-40"
                        >
                          {purchasing === slug ? <Loader2 size={12} className="animate-spin" /> : <Coins size={12} />}
                          {formatDenarii(denariiCost)} Ð
                        </button>
                      ) : (
                        <span className="badge badge-neutral text-[10px]">
                          <Lock size={10} /> Cash only
                        </span>
                      )}
                      <button
                        onClick={() => openPaymentModal(relic)}
                        disabled={moneyPriceXaf <= 0 || gifting}
                        className="btn-primary text-xs disabled:opacity-50"
                      >
                          {gifting ? 'Cash gift unavailable' : moneyPriceXaf > 0 ? moneyPrice : 'Denarii only'}
                      </button>
                      {giftRecipientId === 'self' && canUseFromStore && (
                        <button
                          onClick={() => activateOwnedRelic(slug)}
                          disabled={usingRelic === slug}
                          className="btn-secondary text-xs"
                        >
                          {usingRelic === slug ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                          Use
                        </button>
                      )}
                      {hasDenariiPrice && !canAffordDenarii && (
                        <span className="text-[10px] text-stone flex items-center gap-0.5">
                          <Lock size={10} /> Need {denariiCost - denarii} more Ð
                        </span>
                      )}
                      {owned > 0 && slug === RELIC_SLUGS.SWORD_GOLIATH && (
                        <span className="text-[10px] text-stone">Use in Daily Game or Quiz</span>
                      )}
                      {owned > 0 && slug === RELIC_SLUGS.LAZARUS_COIN && (
                        <span className="text-[10px] text-stone">Use inside Saturday Quiz before 2:45 PM</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Payment Method Modal ── */}
      {paymentModalRelic && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setPaymentModalRelic(null)}>
          <div className="card p-6 max-w-lg w-full animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-ink">Complete Purchase</h3>
              <button onClick={() => setPaymentModalRelic(null)} className="text-stone hover:text-ink"><X size={20} /></button>
            </div>

            <div className="p-4 rounded-lg bg-surface-2 mb-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone">Relic:</span>
                <span className="text-sm font-semibold text-ink">{paymentModalRelic.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone">Amount:</span>
                <span className="text-sm font-semibold text-gold">{formatXaf(relicMoneyPriceXaf(paymentModalRelic))}</span>
              </div>
              <p className="text-xs text-stone">This is the exact amount sent to your phone for confirmation.</p>
            </div>

            {paymentResult ? (
              <div className="space-y-4">
                <div key={`${paymentResult.reference}:${paymentResult.status}`} className={cn(
                  'status-surface p-4 rounded-lg border animate-soft-reveal',
                  paymentConfirmed
                    ? 'bg-sage-soft border-sage/30'
                    : paymentResult.status === 'rejected'
                      ? 'bg-roman/10 border-roman/30'
                      : 'bg-brass/10 border-brass/30',
                )}>
                  <div className="flex items-start gap-3">
                    {paymentConfirmed ? (
                      <CheckCircle2 size={20} className="text-moss flex-shrink-0 mt-0.5" />
                    ) : paymentResult.status === 'rejected' ? (
                      <X size={20} className="text-roman flex-shrink-0 mt-0.5" />
                    ) : (
                      <Loader2 size={20} className="text-brass flex-shrink-0 mt-0.5 animate-spin" />
                    )}
                    <div className="space-y-1">
                      <p className="font-display font-semibold text-ink">
                        {paymentConfirmed ? 'Purchase Complete' : paymentResult.status === 'rejected' ? 'Payment Not Confirmed' : 'Awaiting Payment Confirmation'}
                      </p>
                      <p className="text-sm text-stone">
                        {paymentResult.message || 'Approve the prompt on your phone. The relic is added only after the payment is confirmed.'}
                      </p>
                      {!paymentConfirmed && paymentResult.status !== 'rejected' && (
                        <p className="text-xs text-stone">No relic has been added yet.</p>
                      )}
                      {(paymentResult.amount_display || paymentResult.amount_local) && (
                        <p className="text-xs text-stone">
                          Amount: <span className="font-semibold text-ink">{paymentResult.amount_display || formatXaf(paymentResult.amount_local)}</span>
                        </p>
                      )}
                      <p className="text-xs text-stone">Reference: <span className="font-mono text-ink">{paymentResult.reference}</span></p>
                      {paymentResult.ussd_code && (
                        <p className="text-xs text-stone">USSD: <span className="font-mono text-ink">{paymentResult.ussd_code}</span></p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {paymentResult.status === 'rejected' ? (
                    <button onClick={retryPayment} className="btn-secondary text-sm">
                      <Smartphone size={14} /> Try Again
                    </button>
                  ) : (
                    <button onClick={checkPaymentStatus} disabled={checkingPayment} className="btn-secondary text-sm">
                      {checkingPayment ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />} Check Status
                    </button>
                  )}
                  <button onClick={() => setPaymentModalRelic(null)} className="btn-primary text-sm">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-stone block mb-2">Payment method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PAYMENT_METHODS.map((method) => {
                      const MethodIcon = method.icon;
                      return (
                        <button
                          key={method.id}
                          onClick={() => setPaymentMethod(method.id)}
                          className={cn(
                            'p-3 rounded-lg border text-center transition-all text-xs font-medium min-h-[74px]',
                            paymentMethod === method.id
                              ? 'border-brass bg-brass/10 text-ink'
                              : 'border-border bg-surface-2 text-stone hover:border-border-bright',
                          )}
                        >
                          <MethodIcon size={18} className="mx-auto mb-1" />
                          {method.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {paymentMethod === 'other' ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-brass/30 bg-brass/10 p-3 text-xs leading-relaxed text-stone">
                      Other providers are not available yet because the app cannot verify them automatically. No request will be recorded and no relic will be granted until a verified provider integration is added.
                    </div>
                    <div>
                      <label className="text-xs text-stone block mb-1">Specify payment method</label>
                      <input
                        className="input-field text-sm"
                        placeholder="PayPal, Apple Pay, bank transfer..."
                        value={otherProvider}
                        onChange={(e) => setOtherProvider(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-stone block mb-1">Account name or payer name</label>
                      <input
                        className="input-field text-sm"
                        placeholder="Name on the payment account"
                        value={otherAccountName}
                        onChange={(e) => setOtherAccountName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-stone block mb-1">Contact for verification</label>
                      <input
                        className="input-field text-sm"
                        placeholder="Email, phone number, or account handle"
                        value={otherContact}
                        onChange={(e) => setOtherContact(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-stone block mb-1">Transaction reference</label>
                      <input
                        className="input-field text-sm"
                        placeholder="Receipt ID, transfer code, PayPal transaction ID..."
                        value={otherTransactionReference}
                        onChange={(e) => setOtherTransactionReference(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-stone block mb-1">Extra note for the instructor</label>
                      <textarea
                        className="input-field text-sm min-h-[80px]"
                        placeholder="Anything else needed to verify this payment"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                      />
                    </div>
                    <p className="text-[11px] text-stone">The relic will not be added until the payment is verified.</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-stone block mb-1">{selectedPaymentLabel} phone number</label>
                    <input
                      className="input-field text-sm"
                      placeholder="2376XXXXXXXX"
                      value={payPhone}
                      onChange={(e) => setPayPhone(e.target.value)}
                    />
                  </div>
                )}

                <button
                  onClick={submitPayment}
                  disabled={paySubmitting || !canSubmitPayment}
                  className="btn-primary w-full text-sm disabled:opacity-50"
                >
                  {paySubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {paymentMethod === 'other' ? 'Provider Not Available' : `Request ${selectedPaymentLabel} Payment`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
