import type { RelicType } from './types';

export function relicMoneyPriceXaf(relic: Pick<RelicType, 'money_price_xaf' | 'money_price_usd'>): number {
  const explicitXaf = Number(relic.money_price_xaf);
  if (Number.isFinite(explicitXaf) && explicitXaf > 0) return Math.round(explicitXaf);
  const legacyUsd = Number(relic.money_price_usd);
  return Number.isFinite(legacyUsd) && legacyUsd > 0 ? Math.round(legacyUsd * 575) : 0;
}

export function relicCashBundles(relic: Pick<RelicType, 'cash_bundles'>) {
  return Object.entries(relic.cash_bundles ?? {}).map(([size, price]) => ({
    size: Number(size),
    price,
  })).sort((first, second) => first.size - second.size);
}
