import { RelicSymbol } from './RelicSymbol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { fetchRelicInventory, purchaseRelic, useRelic } from '../lib/queries';
import { relicCashBundles, relicMoneyPriceXaf } from '../lib/relicPricing';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/connectionErrors';
import { formatDenarii, formatXaf } from '../lib/utils';
import type { RelicType } from '../lib/types';
import { MarketCartCheckout } from './FcxFapshiCheckout';

type RelicOffer = Pick<RelicType, 'id' | 'slug' | 'name' | 'denarii_cost' | 'money_price_xaf' | 'money_price_usd' | 'cash_bundles'>;

export function ContextRelicShop({ userId, slugs, onChanged, timed, activateOwned, onUseOwned, canUseOwned, label = 'Get relics', afterDenariiPurchase, aboveOverlay }: {
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

  useEffect(() => {
    if (!open) return;
    if (!slugKey) { setOffers([]); return; }
    void refresh().catch(failure => setError(userFacingError(failure, 'Relic prices could not load.')));
    return () => { request.current++; };
  }, [open, refresh, slugKey]);

  const confirm = useCallback(() => {
    notifyChanged.current();
    setNotice('Relic added to your inventory.');
    void refresh().catch(() => undefined);
  }, [refresh]);

  async function act(offer: RelicOffer, activate: boolean) {
    if (!offer.slug || busy) return;
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

  if (!slugs.length && !open) return null;
  return (
    <div className="my-2 w-full text-xs">
      {slugs.length > 0 && <button type="button" aria-expanded={open} className="btn-secondary text-xs"
        onClick={() => setOpen(value => !value)}><ShoppingCart size={13} /> {label}</button>}
      <div hidden={!open} className="mt-2 space-y-2 rounded-lg border border-border bg-surface p-3">
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
          return (
            <div key={offer.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
              <span className="inline-flex items-center gap-2 font-semibold text-ink"><RelicSymbol slug={offer.slug} /> {offer.name}</span>
              <div className="flex flex-wrap items-center gap-2">
                {showOwned && (owned[offer.id] ?? 0) > 0 ? (
                  <button type="button" className="btn-secondary text-xs"
                    disabled={Boolean(busy) || canUseOwned?.(offer.slug) === false} onClick={() => void act(offer, true)}>
                    <RelicSymbol slug={offer.slug} size={14} /> Use ({owned[offer.id]} owned)
                  </button>
                ) : canBuyWithDenarii ? (
                  <button type="button" className="btn-primary text-xs" disabled={Boolean(busy)} onClick={() => void act(offer, false)}>
                    <RelicSymbol slug={offer.slug} size={14} /> {afterDenariiPurchase ? 'Buy & use' : 'Buy'} · {formatDenarii(cost)} Ð
                  </button>
                ) : bundles.length > 0 && balance !== null ? bundles.map(({ size, price }) => (
                  <MarketCartCheckout key={size} className="btn-primary text-xs" onConfirmed={confirm} aboveOverlay={aboveOverlay}
                    lines={[{ key: `${offer.id}:${size}`, name: `${offer.name} (pack of ${size})`,
                      unitPrice: price, quantity: 1, relicSlug: offer.slug ?? undefined, packSize: size }]}>
                    <RelicSymbol slug={offer.slug ?? ""} size={14} /> Buy {size} · {formatXaf(price)}
                  </MarketCartCheckout>
                )) : cash >= 100 && balance !== null ? (
                  <MarketCartCheckout className="btn-primary text-xs" onConfirmed={confirm} aboveOverlay={aboveOverlay}
                    lines={[{ key: offer.id, name: offer.name, unitPrice: cash, quantity: 1, relicSlug: offer.slug }]}>
                    <RelicSymbol slug={offer.slug} size={14} /> Buy · {formatXaf(cash)}
                  </MarketCartCheckout>
                ) : cost > 0 && balance !== null ? <span className="text-stone">Need {formatDenarii(cost - balance)} Ð more</span> : null}
              </div>
            </div>
          );
        })}
        {error && <p role="alert" className="text-coral">{error}</p>}
        {notice && <p role="status" className="text-moss">{notice}</p>}
      </div>
    </div>
  );
}
