import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Coins, Gem, Gift, Loader2, Search, Users, X, XCircle } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { SectionHeader } from './AppShell';
import { UserAvatar } from './UserAvatar';
import { fetchRelicTypes, grantInstructorResourcesBulk } from '../lib/queries';
import { cn } from '../lib/utils';
import type { Profile, RelicType, RoleAssignment } from '../lib/types';
import { useAuth } from '../context/AuthContext';

export function CampTreasury({ profiles, roles, loading }: {
  profiles: Profile[];
  roles: RoleAssignment[];
  loading: boolean;
}) {
  const { profile } = useAuth();
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [denariiAmount, setDenariiAmount] = useState('');
  const [relicTypeId, setRelicTypeId] = useState('');
  const [relicQuantity, setRelicQuantity] = useState('');
  const [note, setNote] = useState('');
  const [relicTypes, setRelicTypes] = useState<RelicType[]>([]);
  const [relicsLoading, setRelicsLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const activeRoleByUser = useMemo(() => {
    const map = new Map<string, RoleAssignment['role']>();
    roles
      .filter((assignment) => assignment.status === 'active' || assignment.status === 'approved')
      .forEach((assignment) => {
        if (!map.has(assignment.user_id)) map.set(assignment.user_id, assignment.role);
      });
    return map;
  }, [roles]);

  const campMembers = useMemo(() => profiles
    .filter((member) => (
      member.id !== profile?.id
      && activeRoleByUser.has(member.id)
    ))
    .sort((left, right) => left.display_name.localeCompare(right.display_name)), [activeRoleByUser, profile?.id, profiles]);

  const selectedRecipientSet = useMemo(() => new Set(selectedRecipientIds), [selectedRecipientIds]);
  const filteredCampMembers = useMemo(() => {
    const query = recipientSearch.trim().toLocaleLowerCase();
    if (!query) return campMembers;
    return campMembers.filter((member) => member.display_name.toLocaleLowerCase().includes(query));
  }, [campMembers, recipientSearch]);
  const selectedMembers = useMemo(
    () => campMembers.filter((member) => selectedRecipientSet.has(member.id)),
    [campMembers, selectedRecipientSet],
  );
  const allFilteredSelected = filteredCampMembers.length > 0
    && filteredCampMembers.every((member) => selectedRecipientSet.has(member.id));
  const someFilteredSelected = filteredCampMembers.some((member) => selectedRecipientSet.has(member.id));

  useEffect(() => {
    let mounted = true;
    setRelicsLoading(true);
    fetchRelicTypes()
      .then((items) => {
        if (mounted) setRelicTypes([...items].sort((left, right) => left.name.localeCompare(right.name)));
      })
      .catch((error) => {
        if (mounted) setFeedback({ type: 'error', message: error.message || 'Relics could not be loaded.' });
      })
      .finally(() => {
        if (mounted) setRelicsLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const validMemberIds = new Set(campMembers.map((member) => member.id));
    setSelectedRecipientIds((current) => {
      const next = current.filter((id) => validMemberIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [campMembers]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [allFilteredSelected, someFilteredSelected]);

  const toggleRecipient = (recipientId: string) => {
    setSelectedRecipientIds((current) => (
      current.includes(recipientId)
        ? current.filter((id) => id !== recipientId)
        : [...current, recipientId]
    ));
  };

  const toggleAllFiltered = () => {
    const filteredIds = new Set(filteredCampMembers.map((member) => member.id));
    setSelectedRecipientIds((current) => {
      if (allFilteredSelected) return current.filter((id) => !filteredIds.has(id));
      const next = new Set(current);
      filteredIds.forEach((id) => next.add(id));
      return [...next];
    });
  };

  const parseGrantAmount = (value: string, label: string) => {
    if (!value.trim()) return 0;
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) {
      throw new Error(`${label} must be a whole number from 0 to 2,147,483,647.`);
    }
    return amount;
  };

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    try {
      if (selectedRecipientIds.length === 0) throw new Error('Choose at least one camp member.');
      const denarii = parseGrantAmount(denariiAmount, 'Denarii');
      const quantity = parseGrantAmount(relicQuantity, 'Relic quantity');
      if (denarii === 0 && quantity === 0) throw new Error('Enter Denarii or a relic quantity to grant.');
      if (quantity > 0 && !relicTypeId) throw new Error('Choose a relic.');

      setGranting(true);
      const result = await grantInstructorResourcesBulk({
        recipientIds: selectedRecipientIds,
        denariiAmount: denarii,
        relicTypeId: relicTypeId || null,
        relicQuantity: quantity,
        note,
      });
      const resources = [
        denarii > 0 ? `${denarii.toLocaleString()} Denarii` : '',
        quantity > 0 ? `${quantity.toLocaleString()} x ${relicTypes.find((relic) => relic.id === relicTypeId)?.name || 'relic'}` : '',
      ].filter(Boolean).join(' and ');
      const recipientLabel = result.recipient_count === 1 ? '1 camp member' : `${result.recipient_count} camp members`;
      setFeedback({ type: 'success', message: `${resources} granted to ${recipientLabel}.` });
      setDenariiAmount('');
      setRelicQuantity('');
      setNote('');
      setSelectedRecipientIds([]);
      setRecipientSearch('');
    } catch (error: unknown) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'The grant could not be completed.',
      });
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Camp Treasury" subtitle="Grant resources to active camp members other than yourself" />
      <form onSubmit={submitGrant} className="card space-y-5 p-4 sm:p-5">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="treasury-recipient-search" className="block text-xs font-semibold text-stone">Recipients</label>
            <span className="text-[11px] font-bold text-stone">
              {selectedRecipientIds.length} selected
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-surface-2/70">
            <div className="border-b border-border p-2.5">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
                <input
                  id="treasury-recipient-search"
                  type="search"
                  value={recipientSearch}
                  onChange={(event) => setRecipientSearch(event.target.value)}
                  disabled={loading || granting}
                  className="input-field w-full pl-9 pr-9"
                  placeholder="Search member names"
                  autoComplete="off"
                />
                {recipientSearch && (
                  <button
                    type="button"
                    aria-label="Clear member search"
                    onClick={() => setRecipientSearch('')}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-stone transition-colors hover:bg-peri-soft hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs font-bold text-ink">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  disabled={loading || granting || filteredCampMembers.length === 0}
                  onChange={toggleAllFiltered}
                  className="h-4 w-4 shrink-0 accent-peri"
                />
                <span className="truncate">
                  {recipientSearch.trim()
                    ? `Select all ${filteredCampMembers.length} results`
                    : `Select all ${campMembers.length} members`}
                </span>
              </label>
              {selectedRecipientIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedRecipientIds([])}
                  disabled={granting}
                  className="text-[11px] font-bold text-stone transition-colors hover:text-ink"
                >
                  Clear selection
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto" role="group" aria-label="Camp members">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-stone">
                  <Loader2 size={16} className="animate-spin" /> Loading camp members...
                </div>
              ) : filteredCampMembers.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-stone">No member matches that name.</p>
              ) : filteredCampMembers.map((member) => {
                const checked = selectedRecipientSet.has(member.id);
                return (
                  <label
                    key={member.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 border-b border-border/70 px-3 py-2.5 transition-colors last:border-b-0',
                      checked ? 'bg-peri-soft' : 'hover:bg-surface-3/70',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={granting}
                      onChange={() => toggleRecipient(member.id)}
                      className="h-4 w-4 shrink-0 accent-peri"
                    />
                    <UserAvatar
                      userId={member.id}
                      name={member.display_name}
                      avatarUrl={member.avatar_url}
                      className="h-9 w-9 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{member.display_name}</span>
                      <span className="block text-[11px] capitalize text-stone">{activeRoleByUser.get(member.id)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {selectedMembers.length > 0 && (
            <div className="mt-2.5 flex min-h-10 items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <Users size={16} className="shrink-0 text-peri" />
              <p className="min-w-0 flex-1 truncate text-xs font-bold text-ink">
                {selectedMembers.length === 1 ? selectedMembers[0].display_name : `${selectedMembers.length} camp members will receive this grant`}
              </p>
              <div className="flex shrink-0 -space-x-2" aria-hidden="true">
                {selectedMembers.slice(0, 5).map((member) => (
                  <UserAvatar
                    key={member.id}
                    userId={member.id}
                    name={member.display_name}
                    avatarUrl={member.avatar_url}
                    className="h-7 w-7 border-2 border-surface-2"
                  />
                ))}
                {selectedMembers.length > 5 && (
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-surface-2 bg-surface-3 px-1 text-[9px] font-black text-ink">
                    +{selectedMembers.length - 5}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone"><Coins size={14} /> Denarii</span>
            <input
              type="number"
              min="0"
              max="2147483647"
              step="1"
              inputMode="numeric"
              className="input-field w-full"
              value={denariiAmount}
              onChange={(event) => setDenariiAmount(event.target.value)}
              placeholder="0"
            />
          </label>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone"><Gem size={14} /> Relic</label>
            <AppSelect
              value={relicTypeId}
              onChange={setRelicTypeId}
              disabled={relicsLoading}
              placeholder={relicsLoading ? 'Loading relics...' : 'No relic selected'}
              options={[{ value: '', label: 'No relic' }, ...relicTypes.map((relic) => ({
                value: relic.id,
                label: relic.name,
                description: relic.rarity,
              }))]}
            />
          </div>
          <label className="block md:col-start-2">
            <span className="mb-1.5 block text-xs font-semibold text-stone">Relic quantity</span>
            <input
              type="number"
              min="0"
              max="2147483647"
              step="1"
              inputMode="numeric"
              disabled={!relicTypeId}
              className="input-field w-full disabled:cursor-not-allowed disabled:opacity-50"
              value={relicQuantity}
              onChange={(event) => setRelicQuantity(event.target.value)}
              placeholder="0"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-stone">Message to recipients</span>
          <input
            className="input-field w-full"
            maxLength={240}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional message shown with their gift"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-stone">Every grant is recorded in the camp ledger.</p>
          <button type="submit" disabled={granting || loading || selectedRecipientIds.length === 0} className="btn-primary min-w-[10rem]">
            {granting ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
            {selectedRecipientIds.length > 1 ? `Grant to ${selectedRecipientIds.length}` : 'Grant resources'}
          </button>
        </div>

        {feedback && (
          <div
            role="status"
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold',
              feedback.type === 'success'
                ? 'border-sage/35 bg-sage/10 text-sage'
                : 'border-coral/35 bg-coral-soft text-coral',
            )}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
        )}
      </form>
    </div>
  );
}
