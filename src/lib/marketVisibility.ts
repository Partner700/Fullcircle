// Keep global shortcuts out of the Market where their full controls already exist.
let marketOpen = false;
const listeners = new Set<() => void>();

export function isMarketOpen() { return marketOpen; }
export function subscribeMarketVisibility(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setMarketVisibility(open: boolean) {
  if (marketOpen === open) return;
  marketOpen = open;
  listeners.forEach(listener => listener());
}
