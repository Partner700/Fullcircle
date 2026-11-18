import { createPortal } from 'react-dom';
import { RelicSymbol } from './RelicSymbol';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShoppingCart, X } from 'lucide-react';
import { useDraggableShortcut } from '../hooks/useDraggableShortcut';
import { fetchRelicInventory, purchaseRelic, useRelic } from '../lib/queries';
import { relicCashBundles, relicMoneyPriceXaf } from '../lib/relicPricing';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/connectionErrors';
import { formatDenarii, formatXaf } from '../lib/utils';
import type { RelicType } from '../lib/types';
import { MarketCartCheckout } from './FcxFapshiCheckout';

type RelicOffer = Pick<RelicType, 'id' | 'slug' | 'name' | 'denarii_cost' | 'money_price_xaf' | 'money_price_usd' | 'cash_bundles'>;

export function ContextRelicShop({ userId, slugs, onChanged, timed, activateOwned, onUseOwned, canUseOwned, label = 'Get relics', afterDenariiPurchase, aboveOverlay, showAllPaymentOptions, purchaseDeadline, preload, floating, children }: {
  userId: string;
  slugs: readonly string[];
  onChanged: () => void;
  timed?: boolean;
  activateOwned?: boolean;
  onUseOwned?: (slug: string) => Promise<boolean | void>;
  canUseOwned?: (slug: string) => boolean;
  label?: string;
  afterDenariiPurchase?: () => Promise<void>;
  aboveOverlay?: boolean;
  showAllPaymentOptions?: boolean;
  purchaseDeadline?: number;
  preload?: boolean;
  floating?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState<RelicOffer[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [owned, setOwned] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const notifyChanged = useRef(onChanged);
  notifyChanged.current = onChanged;
  const slugKey = slugs.join(',');
  const showOwned = Boolean(activateOwned || onUseOwned);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    const [{ data, error: catalogError }, wallet, inventory] = await Promise.all([
      supabase.from('relic_types').select('id,slug,name,denarii_cost,money_price_xaf,money_price_usd,cash_bundles')
        .eq('is_active', true).in('slug', slugKey.split(',')).order('name'),
      supabase.rpc('get_user_denarii_total', { p_user_id: userId }),
      showOwned ? fetchRelicInventory(userId) : Promise.resolve([]),
    ]);
    if (version !== request.current) return;
    if (catalogError) throw catalogError;
    const validBalance = !wallet.error && wallet.data != null && Number.isFinite(Number(wallet.data));
    setOffers(data || []);
    setBalance(validBalance ? Number(wallet.data) : null);
    setOwned(Object.fromEntries(inventory.map(item => [item.relic_type_id, item.quantity])));
    setError(validBalance ? '' : 'Your Denarii balance is unavailable.');
  }, [showOwned, slugKey, userId]);

  const loadOffers = open || preload;
  useEffect(() => {
    if (!loadOffers) return;
    if (!slugKey) { setOffers([]); return; }
    void refresh().catch(failure => setError(userFacingError(failure, 'Relic prices could not load.')));
    return () => { request.current++; };
  }, [loadOffers, refresh, slugKey]);

  const confirm = useCallback(() => {
    notifyChanged.current();
    setNotice('Relic added to your inventory.');
    void refresh().catch(() => undefined);
  }, [refresh]);

  async function act(offer: RelicOffer, activate: boolean) {
    if (!offer.slug || busy) return;
    if (purchaseDeadline !== undefined && Date.now() >= purchaseDeadline) {
      setError('The decision timer has expired.');
      return;
    }
    setBusy(offer.id);
    setError('');
    setNotice('');
    try {
      if (activate) {
        if (onUseOwned) {
          if (await onUseOwned(offer.slug) === false) return;
        } else {
          const result = await useRelic(userId, offer.slug);
          if (result?.success === false) throw new Error(result.message || 'The relic could not be used.');
          setNotice(result?.message || 'Relic activated.');
        }
      } else {
        await purchaseRelic(userId, offer.slug);
        if (afterDenariiPurchase) await afterDenariiPurchase();
        else setNotice(`${offer.name} added to your inventory.`);
      }
      onChanged();
    } catch (failure) {
      setError(userFacingError(failure, 'The relic could not be purchased or used.'));
    } finally {
      await refresh().catch(() => undefined);
      setBusy(null);
    }
  }

  const shortcut = useDraggableShortcut(
    floating ? `full-circle-relic-position:${userId}` : '',
    () => setOpen(value => !value),
  );

  if (!floating && !slugs.length && !open) return null;
  const shop = (
    <div className={floating
      ? 'pointer-events-none fixed bottom-36 right-3 z-[2147483590] w-[min(26rem,calc(100vw-1.5rem))] text-xs'
      : 'my-2 w-full text-xs'}>
      {!floating && slugs.length > 0 && (
        <button type="button" aria-expanded={open} className="btn-secondary text-xs"
          onClick={() => setOpen(value => !value)}><ShoppingCart size={15} /> {label}</button>
      )}
      <div hidden={!open} className={floating
        ? 'pointer-events-auto max-h-[50dvh] w-full space-y-2 overflow-y-auto rounded-lg border border-brass/60 bg-surface p-3 shadow-xl'
        : 'mt-2 space-y-2 rounded-lg border border-border bg-surface p-3'}>
        {floating && <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-ink">{label}</h2>
          <button type="button" className="icon-btn" aria-label="Close relics" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>}
        {timed && <p className="text-stone">The timer keeps running during checkout.</p>}
        {balance !== null && <p className="text-stone">Balance {formatDenarii(balance)} Ð</p>}
        {offers === null && !error && <p role="status">Loading relics…</p>}
        {offers?.length === 0 && <p>No relics are available here.</p>}
        {offers?.filter(offer => offer.slug && slugs.includes(offer.slug)).map(offer => {
          if (!offer.slug) return null;
          const cost = Number(offer.denarii_cost || 0);
          const cash = relicMoneyPriceXaf(offer);
          const bundles = relicCashBundles(offer);
          const canBuyWithDenarii = balance !== null && cost > 0 && balance >= cost;
          const hasOwned = showOwned && (owned[offer.id] ?? 0) > 0;
          const showCash = (!hasOwned || showAllPaymentOptions) && (!canBuyWithDenarii || showAllPaymentOptions) && (balance !== null || showAllPaymentOptions);
          return (
            <div key={offer.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
              <span className="inline-flex items-center gap-2 font-semibold text-ink"><RelicSymbol slug={offer.slug} /> {offer.name}</span>
              <div className="flex flex-wrap items-center gap-2">
                {hasOwned ? (
                  <button type="button" className="btn-secondary text-xs"
                    disabled={Boolean(busy) || canUseOwned?.(offer.slug) === false} onClick={() => void act(offer, true)}>
                    <RelicSymbol slug={offer.slug} size={14} /> Use ({owned[offer.id]} owned)
                  </button>
                ) : null}
                {(!hasOwned || showAllPaymentOptions) && (canBuyWithDenarii || showAllPaymentOptions && cost > 0) ? (
                  <button type="button" className="btn-primary text-xs" disabled={Boolean(busy) || !canBuyWithDenarii} onClick={() => void act(offer, false)}>
                    <RelicSymbol slug={offer.slug} size={14} /> {afterDenariiPurchase ? 'Buy & use' : 'Buy'} · {formatDenarii(cost)} Ð
                  </button>
                ) : null}
                {showCash && bundles.length > 0 ? bundles.map(({ size, price }) => (
                  <MarketCartCheckout key={size} className="btn-primary text-xs" onConfirmed={confirm} aboveOverlay={aboveOverlay || floating}
                    lines={[{ key: `${offer.id}:${size}`, name: `${offer.name} (pack of ${size})`,
                      unitPrice: price, quantity: 1, relicSlug: offer.slug ?? undefined, packSize: size }]}>
                    <RelicSymbol slug={offer.slug ?? ""} size={14} /> Buy {size} · {formatXaf(price)}
                  </MarketCartCheckout>
                )) : null}
                {showCash && cash >= 100 && (showAllPaymentOptions || !bundles.length) ? (
                  <MarketCartCheckout className="btn-primary text-xs" onConfirmed={confirm} aboveOverlay={aboveOverlay || floating}
                    lines={[{ key: offer.id, name: offer.name, unitPrice: cash, quantity: 1, relicSlug: offer.slug }]}>
                    <RelicSymbol slug={offer.slug} size={14} /> Buy · {formatXaf(cash)}
                  </MarketCartCheckout>
                ) : null}
                {!hasOwned && !canBuyWithDenarii && cost > 0 && balance !== null
                  && (showAllPaymentOptions || !bundles.length && cash < 100) && (
                    <span className="text-stone">Need {formatDenarii(cost - balance)} Ð more</span>
                  )}
              </div>
            </div>
          );
        })}
        {children}
        {error && <p role="alert" className="text-coral">{error}</p>}
        {notice && <p role="status" className="text-moss">{notice}</p>}
      </div>
    </div>
  );
  return floating ? createPortal(<>
    {shop}
    <button
      type="button"
      {...shortcut}
      data-game-relic-shortcut
      aria-label={open ? 'Close relics' : 'Open relics'}
      aria-expanded={open}
      title={`${label} (drag to move)`}
      className="fixed bottom-20 right-3 z-[2147483600] flex h-11 w-11 cursor-grab select-none items-center justify-center rounded-full border border-gold/45 bg-navy-2 text-gold shadow-xl active:cursor-grabbing md:bottom-6 md:right-6"
    >
      <RelicSymbol slug="relics" size={20} />
    </button>
  </>, document.body) : shop;
}
