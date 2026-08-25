export const DENARII_GAIN_EVENT = 'full-circle-denarii-gained';

export function announceDenariiGain(amount: number) {
  if (typeof window === 'undefined' || !Number.isFinite(amount) || amount <= 0) return;
  window.dispatchEvent(new CustomEvent(DENARII_GAIN_EVENT, { detail: { amount } }));
}
