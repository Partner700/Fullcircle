import type { RelicType } from './types';

export function relicMoneyPriceXaf(relic: Pick<RelicType, 'money_price_xaf' | 'money_price_usd'>): number {
  const explicitXaf = Number(relic.money_price_xaf);
  if (Number.isFinite(explicitXaf) && explicitXaf > 0) return Math.round(explicitXaf);
  const legacyUsd = Number(relic.money_price_usd);
  return Number.isFinite(legacyUsd) && legacyUsd > 0 ? Math.round(legacyUsd * 575) : 0;
}
