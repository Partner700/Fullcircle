import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  Check,
  Coins,
  Gift,
  Loader2,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Pickaxe,
  Plus,
  Search,
  Snowflake,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  createHiddenChallenge,
  fetchHiddenItemInventory,
  purchaseHiddenItem,
  readingVerseChallengeKey,
} from '../lib/hiddenChallenges';
import { fetchCampMentionCandidates, fetchNarrative, type CampMentionCandidate } from '../lib/queries';
import type {
  DailyNarrative,
  FreezerType,
  HiddenChallengeDifficulty,
  HiddenChallengePlacement,
  HiddenItemInventory,
  HiddenItemType,
  RelicType,
  StreakFreezer,
} from '../lib/types';
import { cn, formatDenarii, getTodayISODate } from '../lib/utils';
import { AppSelect } from './AppSelect';

type VerseOption = { label: string; key: string };

const EMPTY_INVENTORY: HiddenItemInventory = { treasure_boxes: 0, mines: 0, wallet_denarii: 0 };

const DIFFICULTIES: Array<{ value: HiddenChallengeDifficulty; label: string }> = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
];

const TREASURE_PLACEMENTS = [
  { value: 'direct_message', label: 'Direct message' },
  { value: 'verse', label: 'Verse insights' },
];

const MINE_PLACEMENTS = [
  { value: 'direct_message', label: 'Direct message' },
  { value: 'app_open', label: 'When they open the app' },
  { value: 'todays_reading', label: "When they open Today's Reading" },
  { value: 'verse', label: 'Inside verse insights' },
  { value: 'daily_games', label: 'When they open Daily Games' },
  { value: 'daily_trivia', label: 'When they open Daily Trivia' },
];

function wholeNumber(value: string, label: string, max = 100_000_000) {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new Error(`${label} must be a whole number between 0 and ${max.toLocaleString()}.`);
  }
  return number;
}

function narrativeVerseOptions(narrative: DailyNarrative | null): VerseOption[] {
  if (!narrative) return [];
  const passages = narrative.scripture_passages?.length
    ? narrative.scripture_passages
    : [{
      reference: narrative.scripture_reference,
      highlighted_verses: narrative.highlighted_verses || [],
      source_narrative_id: narrative.id,
    }];

  const seen = new Set<string>();
  return passages.flatMap((passage) => (passage.highlighted_verses || []).map((verse) => {
    const narrativeId = verse.source_narrative_id || passage.source_narrative_id || narrative.id;
    const key = readingVerseChallengeKey(narrativeId, verse.reference);
    return { key, label: verse.reference };
  })).filter((verse) => {
    if (seen.has(verse.key)) return false;
    seen.add(verse.key);
    return true;
  });
}

function ItemComposer({
  itemType,
  inventory,
  relics,
  relicInventory,
  freezers,
  onClose,
  onCreated,
}: {
  itemType: HiddenItemType;
  inventory: HiddenItemInventory;
  relics: RelicType[];
  relicInventory: Record<string, number>;
  freezers: StreakFreezer[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const [candidates, setCandidates] = useState<CampMentionCandidate[]>([]);
  const [narrative, setNarrative] = useState<DailyNarrative | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<HiddenChallengeDifficulty>('moderate');
  const [placement, setPlacement] = useState<HiddenChallengePlacement>('direct_message');
  const [verseKey, setVerseKey] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [rewardDenarii, setRewardDenarii] = useState('0');
  const [relicTypeId, setRelicTypeId] = useState('none');
  const [relicQuantity, setRelicQuantity] = useState('0');
  const [freezerType, setFreezerType] = useState<'none' | FreezerType>('none');
  const [freezerQuantity, setFreezerQuantity] = useState('0');
  const [minePenalty, setMinePenalty] = useState('100');

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCampMentionCandidates(),
      fetchNarrative(getTodayISODate()).catch(() => null),
    ]).then(([people, todayNarrative]) => {
      if (!active) return;
      setCandidates(people.filter((person) => person.user_id !== profile?.id));
      setNarrative(todayNarrative);
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Camp members could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile?.id]);

  const verseOptions = useMemo(() => narrativeVerseOptions(narrative), [narrative]);
  const ownedRelics = useMemo(() => relics.filter((relic) => (relicInventory[relic.id] || 0) > 0), [relicInventory, relics]);
  const readyDaily = freezers.filter((freezer) => freezer.freezer_type === 'daily' && !freezer.used_at && !freezer.applied_to_date && !freezer.activated_at).length;
  const readyWeekly = freezers.filter((freezer) => freezer.freezer_type === 'weekly' && !freezer.used_at && !freezer.applied_to_date && !freezer.activated_at).length;
  const visibleCandidates = candidates.filter((candidate) => candidate.display_name.toLowerCase().includes(search.trim().toLowerCase()));
  const targetCount = Math.max(1, targets.length);
  const perTargetDenarii = Number(rewardDenarii) || 0;
  const totalDenarii = perTargetDenarii * targetCount;
  const selectedRelic = relicTypeId === 'none' ? null : relics.find((relic) => relic.id === relicTypeId) || null;
  const selectedRelicNeeded = (Number(relicQuantity) || 0) * targetCount;
  const selectedFreezerNeeded = (Number(freezerQuantity) || 0) * targetCount;
  const selectedFreezerAvailable = freezerType === 'daily' ? readyDaily : freezerType === 'weekly' ? readyWeekly : 0;
  const placements = itemType === 'treasure' ? TREASURE_PLACEMENTS : MINE_PLACEMENTS;

  useEffect(() => {
    if (placement !== 'verse') setVerseKey('');
  }, [placement]);

  const toggleTarget = (userId: string) => {
    setTargets((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId);
      if (current.length >= 3) return current;
      return [...current, userId];
    });
  };

  const submit = async () => {
    if (saving) return;
    setNotice(null);
    setSaving(true);
    try {
      if (targets.length < 1) throw new Error('Tag at least one person.');
      if (placement === 'verse' && !verseKey) throw new Error('Choose the verse where this will be hidden.');
      const denarii = itemType === 'treasure' ? wholeNumber(rewardDenarii, 'Denarii') : 0;
      const relicsPerTarget = itemType === 'treasure' ? wholeNumber(relicQuantity, 'Relic quantity', 100) : 0;
      const freezersPerTarget = itemType === 'treasure' ? wholeNumber(freezerQuantity, 'Freezer quantity', 100) : 0;
      const penalty = itemType === 'mine' ? wholeNumber(minePenalty, 'Mine amount') : 0;
      if (itemType === 'mine' && penalty < 1) throw new Error('Set how many Denarii the Mine can collect.');
      if (totalDenarii > inventory.wallet_denarii) throw new Error(`Funding every box needs ${formatDenarii(totalDenarii)} Denarii.`);
      if (selectedRelic && selectedRelicNeeded > (relicInventory[selectedRelic.id] || 0)) {
        throw new Error(`Funding every box needs ${selectedRelicNeeded} copies of ${selectedRelic.name}.`);
      }
      if (freezerType !== 'none' && selectedFreezerNeeded > selectedFreezerAvailable) {
        throw new Error(`Funding every box needs ${selectedFreezerNeeded} unused ${freezerType} freezers.`);
      }

      const referenceKey = placement === 'verse'
        ? verseKey
        : placement === 'todays_reading'
          ? narrative?.id || null
          : placement === 'daily_games' || placement === 'daily_trivia'
            ? getTodayISODate()
            : null;

      await createHiddenChallenge({
        itemType,
        targetIds: targets,
        difficulty,
        placement,
        referenceKey,
        messageBody: messageBody.trim() || null,
        rewardDenarii: denarii,
        rewardRelicTypeId: relicsPerTarget > 0 ? relicTypeId : null,
        rewardRelicQuantity: relicsPerTarget,
        rewardFreezerType: freezersPerTarget > 0 && freezerType !== 'none' ? freezerType : null,
        rewardFreezerQuantity: freezersPerTarget,
        minePenaltyDenarii: penalty,
      });
      await onCreated();
      onClose();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This item could not be hidden.');
    } finally {
      setSaving(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[2147483400] flex items-end justify-center overflow-y-auto bg-navy/75 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <section className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-border bg-bg shadow-2xl sm:rounded-lg" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-md', itemType === 'treasure' ? 'bg-gold/15 text-gold' : 'bg-coral/15 text-coral')}>
              {itemType === 'treasure' ? <Gift size={21} /> : <Pickaxe size={21} />}
            </span>
            <div>
              <h3 className="font-display text-lg font-bold text-ink">Hide a {itemType === 'treasure' ? 'Treasure Box' : 'Mine'}</h3>
              <p className="text-[10px] text-stone">One purchased item will be used when this is sent.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        <div className="space-y-5 overflow-y-auto p-4 sm:p-5">
          {notice && <div role="alert" className="rounded-md border border-coral/35 bg-coral/10 px-3 py-2 text-xs text-coral">{notice}</div>}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-xs font-bold text-ink">Tag people</label>
              <span className="text-[10px] font-bold text-stone">{targets.length}/3</span>
            </div>
            <div className="relative mb-2">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="input-field w-full pl-9 text-xs" placeholder="Find a camp member" />
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-2 p-2">
              {loading ? <div className="flex justify-center py-5"><Loader2 size={18} className="animate-spin text-peri" /></div> : visibleCandidates.map((candidate) => {
                const selected = targets.includes(candidate.user_id);
                const disabled = !selected && targets.length >= 3;
                return (
                  <button
                    key={candidate.user_id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleTarget(candidate.user_id)}
                    className={cn('flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-40', selected ? 'border-peri/45 bg-peri/10' : 'border-transparent hover:bg-surface')}
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface text-xs font-bold text-peri">
                      {candidate.avatar_url ? <img src={candidate.avatar_url} alt="" className="h-full w-full object-cover" /> : candidate.display_name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-ink">{candidate.display_name}</span>
                      <span className="block text-[9px] capitalize text-stone">{candidate.role}</span>
                    </span>
                    {selected && <Check size={15} className="text-peri" />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-ink">Question difficulty</label>
              <div className="grid grid-cols-3 rounded-md border border-border bg-surface-2 p-1">
                {DIFFICULTIES.map((option) => (
                  <button key={option.value} type="button" className={cn('rounded px-2 py-2 text-[10px] font-bold', difficulty === option.value ? 'bg-peri text-white' : 'text-stone')} onClick={() => setDifficulty(option.value)}>{option.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-ink">Hiding place</label>
              <AppSelect value={placement} onChange={(value) => setPlacement(value as HiddenChallengePlacement)} options={placements} />
            </div>
          </section>

          {placement === 'verse' && (
            <div>
              <label className="mb-1 block text-xs font-bold text-ink">Verse in today&apos;s reading</label>
              {verseOptions.length ? (
                <AppSelect value={verseKey} onChange={setVerseKey} options={[{ value: '', label: 'Choose a verse' }, ...verseOptions.map((verse) => ({ value: verse.key, label: verse.label }))]} />
              ) : <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-stone">Today&apos;s reading has no highlighted verses available for hiding.</p>}
            </div>
          )}

          {(placement === 'direct_message' || placement === 'verse') && (
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-bold text-ink"><MessageCircle size={13} /> {placement === 'verse' ? 'Insight note' : 'Message'}</label>
              <textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} rows={3} maxLength={2000} className="input-field w-full resize-y whitespace-pre-wrap text-sm" placeholder={placement === 'verse' ? 'Optional words to leave with the hidden item' : 'Write the message where it will be hidden'} />
            </div>
          )}

          {itemType === 'treasure' ? (
            <section className="space-y-3 rounded-md border border-gold/30 bg-gold/5 p-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-gold" />
                <div>
                  <h4 className="text-sm font-bold text-ink">What is inside?</h4>
                  <p className="text-[10px] text-stone">All rewards are optional. Empty boxes are allowed.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-[10px] font-bold text-stone">Denarii per person
                  <input type="number" min="0" step="1" value={rewardDenarii} onChange={(event) => setRewardDenarii(event.target.value)} className="input-field mt-1 w-full text-xs" />
                </label>
                <label className="text-[10px] font-bold text-stone">Relic
                  <AppSelect value={relicTypeId} onChange={setRelicTypeId} options={[{ value: 'none', label: 'No relic' }, ...ownedRelics.map((relic) => ({ value: relic.id, label: `${relic.name} (${relicInventory[relic.id]})` }))]} className="mt-1" />
                </label>
                <label className="text-[10px] font-bold text-stone">Relics per person
                  <input type="number" min="0" max="100" step="1" value={relicQuantity} onChange={(event) => setRelicQuantity(event.target.value)} disabled={relicTypeId === 'none'} className="input-field mt-1 w-full text-xs disabled:opacity-40" />
                </label>
                <label className="text-[10px] font-bold text-stone">Freezer
                  <AppSelect value={freezerType} onChange={(value) => setFreezerType(value as 'none' | FreezerType)} options={[{ value: 'none', label: 'No freezer' }, { value: 'daily', label: `Daily (${readyDaily})` }, { value: 'weekly', label: `Weekly (${readyWeekly})` }]} className="mt-1" />
                </label>
                <label className="text-[10px] font-bold text-stone">Freezers per person
                  <input type="number" min="0" max="100" step="1" value={freezerQuantity} onChange={(event) => setFreezerQuantity(event.target.value)} disabled={freezerType === 'none'} className="input-field mt-1 w-full text-xs disabled:opacity-40" />
                </label>
              </div>
              {targets.length > 1 && (
                <p className="text-[10px] leading-relaxed text-stone">
                  The contents are copied for all {targets.length} tagged people. Total reserved: {formatDenarii(totalDenarii)} Denarii{selectedRelicNeeded ? `, ${selectedRelicNeeded} relics` : ''}{selectedFreezerNeeded ? `, ${selectedFreezerNeeded} freezers` : ''}.
                </p>
              )}
            </section>
          ) : (
            <section className="rounded-md border border-coral/30 bg-coral/5 p-4">
              <label className="text-xs font-bold text-ink">Denarii collected after a wrong answer or forfeit
                <div className="relative mt-1">
                  <Coins size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-coral" />
                  <input type="number" min="1" step="1" value={minePenalty} onChange={(event) => setMinePenalty(event.target.value)} className="input-field w-full pl-9 text-sm" />
                </div>
              </label>
              <p className="mt-2 text-[10px] leading-relaxed text-stone">The popup clearly shows the amount at risk. A Mine can collect only what is actually available in the person&apos;s wallet.</p>
            </section>
          )}

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[10px] leading-relaxed text-stone">
            <LockKeyhole size={12} className="mr-1 inline text-peri" />
            The app chooses an approved {difficulty} question at random only when the item is opened. The correct answer remains on the server.
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3">
          <span className="text-[10px] font-bold text-stone">{targets.length ? `${targets.length} tagged` : 'Tag someone first'}</span>
          <button type="button" className="btn-primary" disabled={saving || loading || targets.length === 0 || (placement === 'verse' && !verseKey)} onClick={() => void submit()}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <MapPin size={15} />}
            Hide it
          </button>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

export function HiddenItemsMarket({
  denarii,
  relics,
  relicInventory,
  freezers,
  onChanged,
}: {
  denarii: number;
  relics: RelicType[];
  relicInventory: Record<string, number>;
  freezers: StreakFreezer[];
  onChanged: () => Promise<void>;
}) {
  const [inventory, setInventory] = useState<HiddenItemInventory>(EMPTY_INVENTORY);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<HiddenItemType | null>(null);
  const [composing, setComposing] = useState<HiddenItemType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      setInventory(await fetchHiddenItemInventory());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Treasures and Mines could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const buy = async (itemType: HiddenItemType) => {
    if (buying) return;
    setBuying(itemType);
    setNotice(null);
    try {
      await purchaseHiddenItem(itemType);
      await Promise.all([load(), onChanged()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The purchase could not be completed.');
    } finally {
      setBuying(null);
    }
  };

  const afterCreated = async () => {
    await Promise.all([load(), onChanged()]);
  };

  return (
    <>
      <section className="card relative overflow-hidden p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-peri/25 bg-peri/10 text-peri"><Box size={21} /></span>
            <div>
              <h4 className="font-display font-semibold text-ink">Treasures &amp; Mines</h4>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-stone">Hide a funded gift or a Denarii trap behind one random Bible question.</p>
            </div>
          </div>
          <span className="badge badge-neutral text-[9px]">50 Ð each</span>
        </div>

        {notice && <div role="alert" className="mt-3 rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-xs text-coral">{notice}</div>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gold/30 bg-gold/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><Gift size={18} className="text-gold" /><span className="text-sm font-bold text-ink">Treasure Box</span></div>
              <span className="text-lg font-black text-gold">{loading ? '...' : inventory.treasure_boxes}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-stone">Add Denarii, relics, freezers, any combination, or leave it empty.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary justify-center text-xs" disabled={buying !== null || denarii < 50} onClick={() => void buy('treasure')}>
                {buying === 'treasure' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Buy
              </button>
              <button type="button" className="btn-primary justify-center text-xs" disabled={inventory.treasure_boxes < 1} onClick={() => setComposing('treasure')}>
                <Gift size={13} /> Hide
              </button>
            </div>
          </div>

          <div className="rounded-md border border-coral/30 bg-coral/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><Pickaxe size={18} className="text-coral" /><span className="text-sm font-bold text-ink">Mine</span></div>
              <span className="text-lg font-black text-coral">{loading ? '...' : inventory.mines}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-stone">Choose the difficulty, location, targets, and Denarii at risk.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary justify-center text-xs" disabled={buying !== null || denarii < 50} onClick={() => void buy('mine')}>
                {buying === 'mine' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Buy
              </button>
              <button type="button" className="btn-primary justify-center text-xs" disabled={inventory.mines < 1} onClick={() => setComposing('mine')}>
                <Pickaxe size={13} /> Hide
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-stone">
          <span className="inline-flex items-center gap-1"><Users size={12} /> 1 to 3 people</span>
          <span className="inline-flex items-center gap-1"><Snowflake size={12} /> Rewards are reserved first</span>
          <span className="inline-flex items-center gap-1"><Coins size={12} /> Balance: {formatDenarii(denarii)} Ð</span>
        </div>
      </section>

      {composing && (
        <ItemComposer
          itemType={composing}
          inventory={{ ...inventory, wallet_denarii: denarii }}
          relics={relics}
          relicInventory={relicInventory}
          freezers={freezers}
          onClose={() => setComposing(null)}
          onCreated={afterCreated}
        />
      )}
    </>
  );
}
