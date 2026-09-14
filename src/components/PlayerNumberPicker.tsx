import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Coins, Hash, Loader2, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { claimPlayerNumber, fetchPlayerNumberOptions } from '../lib/queries';
import type { PlayerNumberOption, PlayerNumberState } from '../lib/types';
import { formatDenarii, formatPlayerNumber } from '../lib/utils';
import { cn } from '../lib/utils';

const PAGE_SIZE = 96;

function priceLabel(option: PlayerNumberOption) {
  return option.denarii_price > 0 ? `${formatDenarii(option.denarii_price)} Denarii` : 'Free';
}

export function PlayerNumberPicker({ accessActive }: { accessActive: boolean }) {
  const { refreshProfile } = useAuth();
  const [state, setState] = useState<PlayerNumberState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await fetchPlayerNumberOptions());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Player numbers could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const digits = search.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) return state?.options || [];
    return (state?.options || []).filter((option) => String(option.player_number).includes(digits));
  }, [search, state?.options]);
  const selectedOption = state?.options.find((option) => option.player_number === selected) || null;
  const walletDenarii = state?.wallet_denarii || 0;

  const claim = async () => {
    if (!selectedOption || claiming || !accessActive) return;
    if (selectedOption.denarii_price > 0 && !window.confirm(
      `Reserve ${formatPlayerNumber(selectedOption.player_number)} for ${formatDenarii(selectedOption.denarii_price)} Denarii?`,
    )) return;
    setClaiming(true);
    setError('');
    try {
      await claimPlayerNumber(selectedOption.player_number);
      await refreshProfile();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That player number could not be reserved.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="player-number-heading">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-peri/30 bg-peri-soft text-peri">
          <Hash size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="player-number-heading" className="font-display font-semibold text-ink">Resident / Player Number</h3>
          <p className="mt-1 text-xs leading-relaxed text-stone">One permanent camp identity, reserved while your subscription is active and for one month afterward.</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 py-5 text-xs text-stone"><Loader2 size={16} className="animate-spin" /> Loading available numbers...</div>
      ) : state?.current_number ? (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-moss/35 bg-moss/10 px-4 py-3">
          <div>
            <p className="text-[10px] font-black uppercase text-moss">Your number</p>
            <p className="font-display text-2xl font-black text-ink">{formatPlayerNumber(state.current_number)}</p>
          </div>
          <CheckCircle2 size={24} className="shrink-0 text-moss" />
        </div>
      ) : (
        <>
          <label className="relative mt-5 block">
            <span className="sr-only">Find a player number</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }}
              className="input-field pl-9"
              inputMode="numeric"
              placeholder="Find a number"
            />
          </label>

          <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2">
            <div className="grid grid-cols-3 gap-1.5 min-[430px]:grid-cols-4 sm:grid-cols-6">
              {filtered.slice(0, visibleCount).map((option) => (
                <button
                  key={option.player_number}
                  type="button"
                  onClick={() => setSelected(option.player_number)}
                  className={cn(
                    'min-w-0 rounded-md border px-1.5 py-2 text-center transition-colors',
                    selected === option.player_number
                      ? 'border-peri bg-peri-soft text-ink'
                      : 'border-border bg-surface text-stone hover:border-border-bright hover:text-ink',
                  )}
                  aria-pressed={selected === option.player_number}
                  title={`${formatPlayerNumber(option.player_number)} · ${priceLabel(option)}`}
                >
                  <span className="block text-xs font-black tabular-nums">{formatPlayerNumber(option.player_number)}</span>
                  <span className={cn('mt-0.5 block truncate text-[8px] font-bold', option.denarii_price ? 'text-gold' : 'text-moss')}>{option.denarii_price ? formatDenarii(option.denarii_price) : 'Free'}</span>
                </button>
              ))}
            </div>
            {filtered.length === 0 && <p className="py-5 text-center text-xs text-stone">No available number matches that search.</p>}
            {visibleCount < filtered.length && (
              <button type="button" className="btn-secondary mt-2 w-full justify-center text-xs" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Show more numbers
              </button>
            )}
          </div>

          {selectedOption && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border-bright bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-black text-ink">{formatPlayerNumber(selectedOption.player_number)}</p>
                <p className="flex items-center gap-1 text-[10px] text-stone"><Coins size={11} className="text-gold" /> {priceLabel(selectedOption)}</p>
              </div>
              <button
                type="button"
                onClick={() => void claim()}
                disabled={claiming || !accessActive || selectedOption.denarii_price > walletDenarii}
                className="btn-primary text-xs disabled:opacity-45"
              >
                {claiming ? <Loader2 size={14} className="animate-spin" /> : <Hash size={14} />}
                Reserve
              </button>
            </div>
          )}
          {!accessActive && <p className="mt-3 text-xs font-semibold text-coral">Activate or renew your subscription before reserving a number.</p>}
          {selectedOption && selectedOption.denarii_price > walletDenarii && <p className="mt-2 text-xs text-coral">You need {formatDenarii(selectedOption.denarii_price - walletDenarii)} more Denarii for this number.</p>}
        </>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg border border-coral/30 bg-coral-soft px-3 py-2 text-xs text-coral">{error}</p>}
    </section>
  );
}
