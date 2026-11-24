import { createPortal } from 'react-dom';
import { RelicSymbol } from './RelicSymbol';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShoppingCart, X } from 'lucide-react';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { registerGameRelicShortcut } from '../lib/gameRelicShortcut';
import { useDraggableShortcut } from '../hooks/useDraggableShortcut';
import { fetchRelicInventory, fetchPanelImageSetting, purchaseRelic, useRelic } from '../lib/queries';
import { relicCashBundles, relicMoneyPriceXaf } from '../lib/relicPricing';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/connectionErrors';
import { formatDenarii, formatXaf } from '../lib/utils';
import type { PanelImageSetting, RelicType } from '../lib/types';
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
  const [marketImage, setMarketImage] = useState<PanelImageSetting | null>(null);
  const [relicFilter, setRelicFilter] = useState<'all' | 'owned' | 'available'>('all');
  const [offers, setOffers] = useState<RelicOffer[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceVerified, setBalanceVerified] = useState(false);
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
      showOwned ? fetchRelicInventory(userId).catch(() => null) : Promise.resolve([]),
    ]);
    if (version !== request.current) return;
    if (catalogError) throw catalogError;
    const validBalance = !wallet.error && wallet.data != null && Number.isFinite(Number(wallet.data));
    setOffers(data || []);
    setBalance(validBalance ? Number(wallet.data) : null);
    setBalanceVerified(validBalance);
    if (inventory) setOwned(Object.fromEntries(inventory.map(item => [item.relic_type_id, item.quantity])));
    // Display failures must not block purchases. The database checks the real
    // wallet amount atomically when the user actually purchases a relic.
    if (inventory === null) setError('Your relic inventory could not be refreshed.');
  }, [showOwned, slugKey, userId]);

  useEffect(() => {
    if (floating) return registerGameRelicShortcut();
  }, [floating]);

  const loadOffers = open || preload;
  useEffect(() => {
    if (!loadOffers) return;
    let active = true;
    void fetchPanelImageSetting('market').then(image => {
      if (active) setMarketImage(image);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [loadOffers]);
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
      ? 'text-xs'
      : 'my-2 w-full text-xs'}
      style={floating ? {
        position: 'fixed', zIndex: 2147483590,
        right: '0.75rem', bottom: 'max(5.1rem, env(safe-area-inset-bottom) + 3.75rem)',
        width: 'min(25rem, calc(100vw - 1.5rem))',
        pointerEvents: 'auto',
      } : undefined}
      onClick={floating ? event => event.stopPropagation() : undefined}>
      {!floating && slugs.length > 0 && (
        <button type="button" aria-expanded={open} className="btn-secondary text-xs"
          onClick={() => setOpen(value => !value)}><ShoppingCart size={15} /> {label}</button>
      )}
      <div hidden={!open} role={floating ? 'region' : undefined} aria-label={floating ? 'Arena relic market' : undefined}
        data-artwork-theme={marketImage?.url ? 'night' : undefined}
        className={floating
        ? 'relative isolate flex max-h-[min(60dvh,31rem)] w-full flex-col overflow-hidden rounded-xl border border-gold/70 bg-[#0b1730] p-3 text-white shadow-2xl'
        : 'relative isolate mt-2 overflow-hidden rounded-xl border border-gold/40 bg-[#0b1730] p-4 text-white'}>
        <PanelImageBackdrop image={marketImage} opacityOverride={42} veilClassName="bg-[#081329]/65" />
        <div className="relative z-10 flex min-h-0 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-300">The Market</p>
              <h2 className="font-display text-base font-bold text-white">{label}</h2>
            </div>
            {floating && <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/40 bg-[#0b1730] text-white" aria-label="Close relics" onClick={() => setOpen(false)}><X size={16} /></button>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/25 bg-[#081329]/90 px-3 py-3">
            <span className="text-sm font-semibold text-white">Your relics · {offers?.filter(offer => (owned[offer.id] ?? 0) > 0).length ?? 0} types owned</span>
            {balanceVerified && balance !== null
              ? <span className="text-sm font-bold text-amber-300">{formatDenarii(balance)} Ð</span>
              : <button type="button" className="text-xs font-semibold text-amber-200 underline underline-offset-2"
                  onClick={() => void refresh().catch(() => undefined)}>
                  Balance not displayed · Retry
                </button>}
          </div>
          {timed && <p className="text-[11px] text-stone">The game timer keeps running during checkout.</p>}
          <div role="group" aria-label="Filter Arena relics" className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#081329]/95 p-1.5">
            {([['all', 'All'], ['owned', 'Owned'], ['available', 'To buy']] as const).map(([value, text]) => (
              <button key={value} type="button" aria-pressed={relicFilter === value} onClick={() => setRelicFilter(value)}
                className={`min-h-10 rounded-md px-2 py-2 text-sm font-bold ${relicFilter === value ? 'bg-amber-300 text-[#081329]' : 'border border-white/25 bg-[#203457] text-white hover:bg-[#30496f]'}`}>{text}</button>
            ))}
          </div>
        {offers === null && !error && <p role="status">Loading relics…</p>}
        {slugs.includes('undo') && !offers?.some(offer => offer.slug === 'undo') && (
          <button type="button" disabled className="btn-secondary text-xs">
            <RelicSymbol slug="undo" /> Undo
          </button>
        )}
        {offers?.length === 0 && <p>No relics are available here.</p>}
        <div className="grid min-h-0 grid-cols-1 content-start gap-2 overflow-y-auto overscroll-contain rounded-lg pr-1 pb-2" role="region" aria-label="Scroll through Arena relics" tabIndex={0}>
        {offers?.filter(offer => offer.slug && slugs.includes(offer.slug)
          && (relicFilter === 'all' || (relicFilter === 'owned' ? (owned[offer.id] ?? 0) > 0 : (owned[offer.id] ?? 0) === 0))).map(offer => {
          if (!offer.slug) return null;
          const cost = Number(offer.denarii_cost || 0);
          const cash = relicMoneyPriceXaf(offer);
          const bundles = relicCashBundles(offer);
          // A temporary balance-read error is not an insufficient-funds result.
          // Let the actual purchase RPC decide whether funds cover the price.
          const canBuyWithDenarii = cost > 0 && (!balanceVerified || balance !== null && balance >= cost);
          const hasOwned = showOwned && (owned[offer.id] ?? 0) > 0;
          const showCash = (!hasOwned || showAllPaymentOptions) && (!canBuyWithDenarii || !balanceVerified || showAllPaymentOptions);
          return (
            <article key={offer.id} className="flex flex-col gap-2 rounded-lg border border-amber-300/35 bg-[#0b1730]/95 p-3 shadow-sm backdrop-blur-md">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex min-w-0 items-start gap-3 text-base font-bold leading-snug text-white"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-300/15 text-amber-300"><RelicSymbol slug={offer.slug} size={22} /></span><span>{offer.name}</span></span>
                {(owned[offer.id] ?? 0) > 0 && <span className="shrink-0 rounded-full border border-amber-300/40 bg-amber-300/15 px-2 py-1 text-xs font-bold text-amber-200">{owned[offer.id]} owned</span>}
              </div>
              {cost > 0 && <span className="text-sm font-medium text-slate-200">Market price: <strong className="text-amber-200">{formatDenarii(cost)} Ð</strong></span>}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-white/15 pt-2 [&_button]:min-h-9 [&_button]:text-xs">
                {hasOwned || offer.slug === 'undo' ? (
                  <button type="button" className="btn-secondary text-xs"
                    disabled={!hasOwned || Boolean(busy) || canUseOwned?.(offer.slug) === false} onClick={() => void act(offer, true)}>
                    <RelicSymbol slug={offer.slug} size={14} /> {offer.slug === 'undo' ? 'Use Undo' : 'Use'} ({owned[offer.id] ?? 0} owned)
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
                {!hasOwned && !canBuyWithDenarii && balanceVerified && cost > 0 && balance !== null
                  && (showAllPaymentOptions || !bundles.length && cash < 100) && (
                    <span className="text-stone">Need {formatDenarii(cost - balance)} Ð more</span>
                  )}
              </div>
            </article>
          );
        })}
        {offers && offers.filter(offer => offer.slug && slugs.includes(offer.slug)
          && (relicFilter === 'all' || (relicFilter === 'owned' ? (owned[offer.id] ?? 0) > 0 : (owned[offer.id] ?? 0) === 0))).length === 0 && (
            <p className="col-span-full rounded-lg border border-white/25 bg-[#081329]/90 p-5 text-center text-sm text-white">No relics in this category. Select another filter to browse.</p>
          )}
        </div>
        {children}
        {error && <p role="alert" className="rounded-lg bg-navy-2/70 p-2 text-coral">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-navy-2/70 p-2 text-moss">{notice}</p>}
        </div>
      </div>
    </div>
  );
  return floating ? createPortal(<>
    {open && <div className="fixed inset-0 bg-black/45" style={{ zIndex: 2147483589 }} aria-hidden="true" onClick={() => setOpen(false)} />}
    {open && shop}
    <button
      type="button"
      {...shortcut}
      style={{
        position: 'fixed', zIndex: 2147483600, pointerEvents: 'auto',
        right: '0.75rem', bottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        ...shortcut.style,
      }}
      onPointerUp={event => {
        event.stopPropagation();
        shortcut.onPointerUp?.(event);
      }}
      onClick={event => {
        event.stopPropagation();
        shortcut.onClick?.(event);
      }}
      aria-label={open ? 'Close relics' : 'Open relics'}
      aria-expanded={open}
      title={`${label} (drag to move)`}
      className={`flex h-11 w-11 cursor-grab select-none items-center justify-center rounded-full border-2 bg-navy-2 text-gold transition-[box-shadow,border-color] duration-200 active:cursor-grabbing ${open ? 'border-yellow-300 ring-4 ring-yellow-300/60 shadow-[0_0_12px_4px_rgba(255,215,0,0.85),0_0_25px_12px_rgba(255,215,0,0.35)]' : 'border-gold/45 shadow-xl'}`}
    >
      <RelicSymbol slug="relics" size={20} />
    </button>
  </>, document.body) : shop;
}
