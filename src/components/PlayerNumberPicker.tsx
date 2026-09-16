import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Clock3,
  Coins,
  Gavel,
  Hash,
  Loader2,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  acceptPlayerNumberBid,
  cancelPlayerNumberBid,
  cancelPlayerNumberListing,
  claimPlayerNumber,
  fetchPlayerNumberMarketplace,
  fetchPlayerNumberOptions,
  listPlayerNumber,
  placePlayerNumberBid,
} from '../lib/queries';
import type {
  PlayerNumberListing,
  PlayerNumberMarketplaceState,
  PlayerNumberOption,
  PlayerNumberState,
} from '../lib/types';
import { cn, formatDenarii, formatPlayerNumber } from '../lib/utils';
import { UserAvatar } from './UserAvatar';

const PAGE_SIZE = 96;

function priceLabel(option: PlayerNumberOption) {
  return option.denarii_price > 0 ? `${formatDenarii(option.denarii_price)} Denarii` : 'Free';
}

function dateLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function PlayerNumberPicker({ accessActive }: { accessActive: boolean }) {
  const { profile, refreshProfile } = useAuth();
  const [state, setState] = useState<PlayerNumberState | null>(null);
  const [market, setMarket] = useState<PlayerNumberMarketplaceState>({ listings: [], own_bids: [] });
  const [view, setView] = useState<'choose' | 'trade'>('choose');
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showChooser, setShowChooser] = useState(false);
  const [askingPrice, setAskingPrice] = useState('');
  const [bidAmounts, setBidAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [numberState, marketState] = await Promise.all([
        fetchPlayerNumberOptions(),
        fetchPlayerNumberMarketplace(),
      ]);
      setState(numberState);
      setMarket(marketState);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Player numbers could not load.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ownListing = useMemo(
    () => market.listings.find((listing) => listing.seller_id === profile?.id) || null,
    [market.listings, profile?.id],
  );
  const availableListings = useMemo(
    () => market.listings.filter((listing) => listing.seller_id !== profile?.id),
    [market.listings, profile?.id],
  );

  useEffect(() => {
    if (ownListing) setAskingPrice(String(ownListing.asking_price));
  }, [ownListing]);

  const filtered = useMemo(() => {
    const digits = search.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) return state?.options || [];
    return (state?.options || []).filter((option) => String(option.player_number).includes(digits));
  }, [search, state?.options]);
  const selectedOption = state?.options.find((option) => option.player_number === selected) || null;
  const walletDenarii = state?.wallet_denarii || 0;
  const canChange = state?.can_change !== false;

  const perform = async (
    key: string,
    task: () => Promise<unknown>,
    success: string,
    refreshOwner = false,
  ) => {
    if (busyKey) return false;
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      await task();
      if (refreshOwner) await refreshProfile();
      await load(true);
      setNotice(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The number market could not complete that action.');
      return false;
    } finally {
      setBusyKey('');
    }
  };

  const claim = async () => {
    if (!selectedOption || busyKey || !accessActive || !canChange) return;
    const changing = Boolean(state?.current_number);
    const prompt = changing
      ? `Change from ${formatPlayerNumber(state?.current_number || 0)} to ${formatPlayerNumber(selectedOption.player_number)}${selectedOption.denarii_price ? ` for ${formatDenarii(selectedOption.denarii_price)} Denarii` : ''}? Your current number becomes available.`
      : `Reserve ${formatPlayerNumber(selectedOption.player_number)}${selectedOption.denarii_price ? ` for ${formatDenarii(selectedOption.denarii_price)} Denarii` : ''}?`;
    if (!window.confirm(prompt)) return;
    const completed = await perform(
      'claim',
      () => claimPlayerNumber(selectedOption.player_number),
      `${formatPlayerNumber(selectedOption.player_number)} is now your player number.`,
      true,
    );
    if (completed) {
      setSelected(null);
      setShowChooser(false);
    }
  };

  const saveListing = async () => {
    const amount = Math.floor(Number(askingPrice));
    if (!Number.isFinite(amount) || amount < 1) {
      setError('Enter the Denarii asking tag for your number.');
      return;
    }
    await perform(
      'listing',
      () => listPlayerNumber(amount),
      ownListing ? 'Your asking tag has been updated.' : 'Your number is now open for bids.',
    );
  };

  const bidOn = async (listing: PlayerNumberListing) => {
    const amount = Math.floor(Number(bidAmounts[listing.id] ?? listing.my_bid?.amount ?? listing.asking_price));
    if (!Number.isFinite(amount) || amount < 1) {
      setError('Enter your Denarii bid.');
      return;
    }
    await perform(
      `bid:${listing.id}`,
      () => placePlayerNumberBid(listing.id, amount),
      `Your ${formatDenarii(amount)} Denarii bid is secured.`,
    );
  };

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="player-number-heading">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-peri/30 bg-peri-soft text-peri">
          <Hash size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="player-number-heading" className="font-display font-semibold text-ink">Resident / Player Number</h3>
          <p className="mt-1 text-xs leading-relaxed text-stone">Choose one identity or trade it securely for Denarii. A number can change only once every 48 hours.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 rounded-lg border border-border bg-surface-2 p-1" role="tablist" aria-label="Player number options">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'choose'}
          onClick={() => setView('choose')}
          className={cn('flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold', view === 'choose' ? 'bg-surface text-ink shadow-sm' : 'text-stone')}
        >
          <Hash size={14} /> Choose
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'trade'}
          onClick={() => setView('trade')}
          className={cn('flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold', view === 'trade' ? 'bg-surface text-ink shadow-sm' : 'text-stone')}
        >
          <Gavel size={14} /> Trade
        </button>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 py-6 text-xs text-stone"><Loader2 size={16} className="animate-spin" /> Loading player numbers...</div>
      ) : view === 'choose' ? (
        <div className="mt-4">
          {state?.current_number && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-moss/35 bg-moss/10 px-4 py-3">
              <div>
                <p className="text-[10px] font-black uppercase text-moss">Your number</p>
                <p className="font-display text-2xl font-black text-ink">{formatPlayerNumber(state.current_number)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowChooser((shown) => !shown)}
                  disabled={!accessActive || !canChange || market.own_bids.length > 0 || Boolean(ownListing)}
                  className="btn-secondary text-xs disabled:opacity-45"
                >
                  <ArrowRightLeft size={14} /> Change
                </button>
                <CheckCircle2 size={22} className="shrink-0 text-moss" />
              </div>
            </div>
          )}

          {!canChange && state?.next_change_at && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-gold/25 bg-gold-soft px-3 py-2 text-xs text-stone">
              <Clock3 size={14} className="mt-0.5 shrink-0 text-gold" /> Another number can be chosen after {dateLabel(state.next_change_at)}.
            </p>
          )}
          {state?.current_number && (ownListing || market.own_bids.length > 0) && (
            <p className="mt-3 text-xs text-stone">Close your listing and withdraw active bids before changing to an unused number.</p>
          )}

          {(!state?.current_number || showChooser) && (
            <>
              <label className="relative mt-4 block">
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

              <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2">
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
                    disabled={busyKey === 'claim' || !accessActive || !canChange || selectedOption.denarii_price > walletDenarii}
                    className="btn-primary text-xs disabled:opacity-45"
                  >
                    {busyKey === 'claim' ? <Loader2 size={14} className="animate-spin" /> : <Hash size={14} />}
                    {state?.current_number ? 'Change' : 'Reserve'}
                  </button>
                </div>
              )}
              {selectedOption && selectedOption.denarii_price > walletDenarii && <p className="mt-2 text-xs text-coral">You need {formatDenarii(selectedOption.denarii_price - walletDenarii)} more Denarii for this number.</p>}
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <section className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <Tag size={15} className="text-brass" />
              <h4 className="text-xs font-black uppercase text-ink">Sell your number</h4>
            </div>
            {!state?.current_number ? (
              <p className="mt-2 text-xs text-stone">Choose a number first, then you can place a Denarii asking tag on it.</p>
            ) : (
              <>
                {!canChange && (
                  <p className="mt-2 text-xs text-stone">You can collect bids now. The number can transfer after {dateLabel(state.next_change_at)}.</p>
                )}
                <div className="mt-3 flex gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Denarii asking price</span>
                    <input
                      value={askingPrice}
                      onChange={(event) => setAskingPrice(event.target.value.replace(/\D/g, ''))}
                      className="input-field"
                      inputMode="numeric"
                      placeholder="Denarii asking tag"
                    />
                  </label>
                  <button type="button" onClick={() => void saveListing()} disabled={!accessActive || busyKey === 'listing'} className="btn-primary text-xs disabled:opacity-45">
                    {busyKey === 'listing' ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                    {ownListing ? 'Update' : 'List'}
                  </button>
                  {ownListing && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Cancel this listing and return every active bid?')) {
                          void perform('cancel-listing', () => cancelPlayerNumberListing(ownListing.id), 'The listing is closed and all bids were returned.');
                        }
                      }}
                      disabled={busyKey === 'cancel-listing'}
                      className="icon-button h-10 w-10 shrink-0 text-coral"
                      title="Cancel number listing"
                      aria-label="Cancel number listing"
                    >
                      {busyKey === 'cancel-listing' ? <Loader2 size={15} className="animate-spin" /> : <X size={16} />}
                    </button>
                  )}
                </div>

                {ownListing && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-ink">Bids for {formatPlayerNumber(ownListing.player_number)}</p>
                      <span className="text-[10px] text-stone">{ownListing.bids.length} active</span>
                    </div>
                    {ownListing.bids.length === 0 ? (
                      <p className="mt-2 text-xs text-stone">No bids yet.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {ownListing.bids.map((bid) => (
                          <div key={bid.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
                            <UserAvatar userId={bid.bidder_id} name={bid.bidder_name} avatarUrl={bid.bidder_avatar_url} className="h-8 w-8" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-ink">{bid.bidder_name || 'Full Circle member'}</p>
                              <p className="text-[10px] font-black text-gold">{formatDenarii(bid.amount)} Denarii</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Sell ${formatPlayerNumber(ownListing.player_number)} for ${formatDenarii(bid.amount)} Denarii? You will become numberless.`)) {
                                  void perform(`accept:${bid.id}`, () => acceptPlayerNumberBid(bid.id), 'The number and Denarii were transferred.', true);
                                }
                              }}
                              disabled={Boolean(busyKey) || !canChange || bid.can_change === false}
                              className="btn-primary px-2.5 py-1.5 text-[10px] disabled:opacity-45"
                              title={!canChange
                                ? `Your number can transfer after ${dateLabel(state?.next_change_at || null)}`
                                : bid.can_change === false
                                  ? `This bidder can receive a number after ${dateLabel(bid.next_change_at || null)}`
                                  : 'Accept this bid'}
                            >
                              {busyKey === `accept:${bid.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                              Accept
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 text-xs font-black uppercase text-ink"><Gavel size={15} className="text-peri" /> Number market</h4>
              <span className="text-[10px] text-stone">{availableListings.length} available</span>
            </div>
            {availableListings.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-stone">No player numbers are listed right now.</p>
            ) : (
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto pr-1">
                {availableListings.map((listing) => {
                  const value = bidAmounts[listing.id] ?? String(listing.my_bid?.amount || listing.asking_price);
                  return (
                    <div key={listing.id} className="rounded-lg border border-border bg-surface-2 p-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar userId={listing.seller_id} name={listing.seller_name} avatarUrl={listing.seller_avatar_url} className="h-8 w-8" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-display text-base font-black text-ink">{formatPlayerNumber(listing.player_number)}</p>
                            {listing.my_bid && <span className="badge badge-moss text-[8px]">Bid placed</span>}
                          </div>
                          <p className="truncate text-[10px] text-stone">{listing.seller_name} · asks <span className="font-bold text-gold">{formatDenarii(listing.asking_price)}</span></p>
                        </div>
                        {listing.highest_bid > 0 && <span className="text-right text-[9px] text-stone">Highest<br /><strong className="text-ink">{formatDenarii(listing.highest_bid)}</strong></span>}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={value}
                          onChange={(event) => setBidAmounts((current) => ({ ...current, [listing.id]: event.target.value.replace(/\D/g, '') }))}
                          className="input-field min-w-0 flex-1"
                          inputMode="numeric"
                          aria-label={`Bid for ${formatPlayerNumber(listing.player_number)}`}
                        />
                        <button
                          type="button"
                          onClick={() => void bidOn(listing)}
                          disabled={!accessActive || Boolean(busyKey)}
                          className="btn-primary text-xs disabled:opacity-45"
                        >
                          {busyKey === `bid:${listing.id}` ? <Loader2 size={14} className="animate-spin" /> : <Gavel size={14} />}
                          {listing.my_bid ? 'Update' : 'Bid'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {market.own_bids.length > 0 && (
            <section className="border-t border-border pt-3">
              <h4 className="text-xs font-black uppercase text-ink">Your active bids</h4>
              <div className="mt-2 space-y-2">
                {market.own_bids.map((bid) => (
                  <div key={bid.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
                    <p className="min-w-0 text-xs text-stone">
                      <strong className="text-ink">{formatPlayerNumber(bid.player_number || 0)}</strong> · {formatDenarii(bid.amount)} Denarii
                    </p>
                    <button
                      type="button"
                      onClick={() => void perform(`cancel-bid:${bid.id}`, () => cancelPlayerNumberBid(bid.id), 'Your bid was withdrawn and its Denarii returned.')}
                      disabled={Boolean(busyKey)}
                      className="btn-secondary px-2.5 py-1.5 text-[10px] text-coral disabled:opacity-45"
                    >
                      {busyKey === `cancel-bid:${bid.id}` ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      Withdraw
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!accessActive && <p className="mt-3 text-xs font-semibold text-coral">Activate or renew your subscription before choosing or trading a number.</p>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-moss/30 bg-moss/10 px-3 py-2 text-xs font-semibold text-moss">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-coral/30 bg-coral-soft px-3 py-2 text-xs text-coral">{error}</p>}
    </section>
  );
}
