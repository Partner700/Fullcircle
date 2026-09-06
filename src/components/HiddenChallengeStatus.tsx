import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bomb, CheckCircle2, Gift, Loader2, MapPin, PackageSearch, TimerReset, X, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchMyHiddenChallengeStatus, HIDDEN_CHALLENGE_STATUS_EVENT } from '../lib/hiddenChallenges';
import type { HiddenChallengeCreatorStatus } from '../lib/types';
import { cn, formatDenarii } from '../lib/utils';

const PLACEMENT_LABELS: Record<HiddenChallengeCreatorStatus['placement'], string> = {
  direct_message: 'Direct message',
  verse: 'Scripture',
  todays_reading: "Today's Reading",
  app_open: 'App opening',
  daily_trivia: 'Daily Trivia',
  daily_games: 'Daily Games',
};

function placementLabel(item: HiddenChallengeCreatorStatus) {
  if (item.placement !== 'verse' || !item.reference_key) return PLACEMENT_LABELS[item.placement];
  const reference = item.reference_key.split('|').pop()?.trim();
  return reference ? `Scripture · ${reference}` : 'Scripture';
}

function resultLabel(item: HiddenChallengeCreatorStatus) {
  const actor = item.latest_actor_name || item.current_target_name;
  if (item.claim_status === 'won') return `${actor} unlocked the Treasure.`;
  if (item.claim_status === 'escaped') return `${actor} answered correctly and escaped the Mine.`;
  if (item.claim_status === 'charged') {
    return `${actor} stepped on the Mine${item.denarii_paid > 0 ? ` · ${formatDenarii(item.denarii_paid)} Denarii collected` : ''}.`;
  }
  if (item.claim_status === 'closed' || (item.challenge_status === 'closed' && !['won', 'escaped', 'charged'].includes(item.claim_status))) {
    return 'Expired and restored after 48 hours.';
  }
  if (item.transfer_count > 0) {
    const result = item.last_outcome === 'wrong' ? 'answered incorrectly' : 'left the question';
    return `${item.original_target_name} ${result}; it passed to ${item.current_target_name}.`;
  }
  if (item.claim_status === 'opened') return `${item.current_target_name} is answering now.`;
  return `Waiting for ${item.current_target_name} to find it.`;
}

function rewardLabel(item: HiddenChallengeCreatorStatus) {
  if (item.item_type !== 'treasure') return null;
  const rewards = [
    item.reward_denarii > 0 ? `${formatDenarii(item.reward_denarii)} Denarii` : null,
    item.reward_relic_quantity > 0 ? `${item.reward_relic_quantity} ${item.reward_relic_name || 'relic'}` : null,
    item.reward_freezer_quantity > 0 ? `${item.reward_freezer_quantity} ${item.reward_freezer_type || ''} freezer${item.reward_freezer_quantity === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return rewards.length ? rewards.join(' · ') : 'Empty Treasure Box';
}

export function HiddenChallengeStatus() {
  const { profile } = useAuth();
  const [items, setItems] = useState<HiddenChallengeCreatorStatus[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (showLoading = false) => {
    if (!profile?.id) return;
    if (showLoading) setLoading(true);
    try {
      setItems(await fetchMyHiddenChallengeStatus());
    } catch (error) {
      console.warn('Hidden item status could not be refreshed:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) {
      setItems([]);
      return;
    }
    void load();
    const refresh = () => void load();
    const interval = window.setInterval(refresh, 20_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(HIDDEN_CHALLENGE_STATUS_EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(HIDDEN_CHALLENGE_STATUS_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, profile?.id]);

  const activeCount = useMemo(() => new Set(items
    .filter((item) => item.challenge_status === 'active' && ['pending', 'opened'].includes(item.claim_status))
    .map((item) => item.challenge_id)).size, [items]);

  if (!profile?.id || items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void load(true); }}
        className="fixed bottom-20 right-3 z-[65] flex h-11 w-11 items-center justify-center rounded-full border border-gold/45 bg-navy-2 text-gold shadow-xl transition-transform hover:scale-105 md:bottom-6 md:right-6"
        title="Treasures and Mines you have hidden"
        aria-label="Open hidden item status"
      >
        <PackageSearch size={20} />
        {activeCount > 0 && (
          <span className="notification-badge-ring absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 bg-coral px-1 text-[9px] font-black leading-none text-white">
            {activeCount > 9 ? '9+' : activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[2147482500] flex items-end justify-center bg-navy/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <section className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-border bg-bg shadow-2xl sm:rounded-lg" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold/10 text-gold"><PackageSearch size={19} /></span>
                <div>
                  <h2 className="font-display text-base font-bold text-ink">Your Hidden Items</h2>
                  <p className="text-[10px] text-stone">{activeCount} still waiting · outcomes update here</p>
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close hidden item status"><X size={17} /></button>
            </header>

            <div className="space-y-2 overflow-y-auto p-3 sm:p-4">
              {loading && <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-peri" /></div>}
              {!loading && items.map((item) => {
                const resolved = ['won', 'escaped', 'charged', 'closed'].includes(item.claim_status);
                const reward = rewardLabel(item);
                return (
                  <article key={item.claim_id} className="rounded-md border border-border bg-surface p-3">
                    <div className="flex items-start gap-3">
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', item.item_type === 'treasure' ? 'bg-gold/12 text-gold' : 'bg-coral/12 text-coral')}>
                        {item.item_type === 'treasure' ? <Gift size={16} /> : <Bomb size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-ink">{item.original_target_name}</p>
                            <p className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold uppercase text-stone"><MapPin size={10} /> {placementLabel(item)}</p>
                          </div>
                          {resolved
                            ? item.latest_outcome === 'correct' || item.claim_status === 'won' || item.claim_status === 'escaped'
                              ? <CheckCircle2 size={15} className="shrink-0 text-moss" />
                              : <XCircle size={15} className="shrink-0 text-coral" />
                            : <TimerReset size={15} className="shrink-0 text-gold" />}
                        </div>
                        <p className={cn('mt-2 text-[11px] leading-relaxed', resolved ? 'text-ink' : 'text-stone')}>{resultLabel(item)}</p>
                        {reward && <p className="mt-1 text-[9px] font-semibold text-gold">{reward}</p>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
