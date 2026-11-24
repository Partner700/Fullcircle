import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Shield } from 'lucide-react';
import { ARENA_SHIELD_SLUG, type ArenaShieldOffer } from '../../supabase/functions/_shared/arenaShield';
import { ContextRelicShop } from './ContextRelicShop';
import { JourneyDialog } from './JourneyDialog';

export function ArenaShieldDecision({ offer, viewerId, sending, onDecide }: {
  offer: ArenaShieldOffer;
  viewerId?: string;
  sending: boolean;
  onDecide: (decision: 'use' | 'expire' | 'reflect') => Promise<boolean>;
}) {
  const [now, setNow] = useState(Date.now);
  const [useFailed, setUseFailed] = useState(false);
  const [boughtWithDenarii, setBoughtWithDenarii] = useState(false);
  const [boomerangFailed, setBoomerangFailed] = useState(false);
  const expireRequest = useRef({ nextAttemptAt: 0, finished: false });
  const deadline = Date.parse(offer.deadline);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const canUse = viewerId === offer.playerId;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const request = expireRequest.current;
    if (!viewerId || sending || now < deadline || request.finished || now < request.nextAttemptAt) return;
    request.nextAttemptAt = now + 1500;
    void onDecide('expire').then((applied) => {
      request.finished = applied;
    });
  }, [deadline, now, onDecide, sending, viewerId]);

  if (!canUse) {
    return <p className="rounded-lg border border-brass/40 bg-brass-soft p-3 text-center text-sm text-ink" role="status">
      {seconds > 0 ? `Waiting for a defensive relic decision · ${seconds}s` : 'Resolving the penalty…'}
    </p>;
  }

  async function useShield() {
    if (sending || Date.now() >= deadline) return;
    setUseFailed(false);
    if (!await onDecide('use')) setUseFailed(true);
  }

  return <JourneyDialog label={offer.attackerId ? "Defend Your Square" : "Shield of Faith"}>
    <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink"><Shield size={22} className="text-gold" /> {offer.attackerId ? 'Defend your square' : 'Shield of Faith'}</h2>
    <p className="mt-2 text-sm text-ink">{offer.consequence}</p>
    <p className="mt-1 text-sm text-stone">{seconds > 0 ? `Use Shield of Faith to block this, or Boomerang to reverse a capture, within ${seconds}s.` : 'Time is up. Resolving the penalty…'}</p>
    {useFailed && seconds > 0 && <p role="alert" className="mt-2 text-sm text-coral">The Shield could not be used. Try again before time runs out.</p>}
    {(offer.ownsShield || boughtWithDenarii) && <button type="button" className="btn-primary mt-4 w-full" disabled={sending || seconds === 0}
      onClick={() => void useShield()}><Shield size={16} /> Use Shield of Faith</button>}
    {!offer.ownsShield && !boughtWithDenarii && seconds > 0 && <ContextRelicShop
      userId={offer.playerId} slugs={[ARENA_SHIELD_SLUG]} label="Buy Shield of Faith"
      timed aboveOverlay preload showAllPaymentOptions purchaseDeadline={deadline}
      onChanged={() => undefined} onUseOwned={() => useShield()}
      canUseOwned={() => !sending && Date.now() < deadline}
      afterDenariiPurchase={async () => {
        setBoughtWithDenarii(true);
        await useShield();
      }} />}
    {offer.attackerId && seconds > 0 && <>
      <p className="mt-3 text-xs font-semibold text-gold">Boomerang sends the player who landed on you back to the start instead.</p>
      {boomerangFailed && <p role="alert" className="text-xs text-coral">Boomerang could not be used. Check your relic inventory.</p>}
      <ContextRelicShop
        userId={offer.playerId} slugs={['boomerang']} label="Use / Buy Boomerang"
        timed aboveOverlay preload showAllPaymentOptions purchaseDeadline={deadline}
        onChanged={() => undefined}
        onUseOwned={async () => { const applied = await onDecide('reflect'); if (!applied) setBoomerangFailed(true); }}
        canUseOwned={() => !sending && Date.now() < deadline}
        afterDenariiPurchase={async () => { const applied = await onDecide('reflect'); if (!applied) setBoomerangFailed(true); }}
      />
    </>}
    {!offer.ownsShield && seconds > 0 && <p className="mt-2 text-xs text-stone">A purchase confirmed too late stays in your inventory for next time.</p>}
  </JourneyDialog>;
}
