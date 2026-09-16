import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Coins, Gem, Gift, Loader2, XCircle } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { SectionHeader } from './AppShell';
import { UserAvatar } from './UserAvatar';
import { fetchRelicTypes, grantInstructorResources } from '../lib/queries';
import { cn } from '../lib/utils';
import type { Profile, RelicType, RoleAssignment } from '../lib/types';

export function CampTreasury({ profiles, roles, loading }: {
  profiles: Profile[];
  roles: RoleAssignment[];
  loading: boolean;
}) {
  const [recipientId, setRecipientId] = useState('');
  const [denariiAmount, setDenariiAmount] = useState('');
  const [relicTypeId, setRelicTypeId] = useState('');
  const [relicQuantity, setRelicQuantity] = useState('');
  const [note, setNote] = useState('');
  const [relicTypes, setRelicTypes] = useState<RelicType[]>([]);
  const [relicsLoading, setRelicsLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
    .filter((member) => activeRoleByUser.has(member.id))
    .sort((left, right) => left.display_name.localeCompare(right.display_name)), [activeRoleByUser, profiles]);

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
      if (!recipientId) throw new Error('Choose a camp member.');
      const denarii = parseGrantAmount(denariiAmount, 'Denarii');
      const quantity = parseGrantAmount(relicQuantity, 'Relic quantity');
      if (denarii === 0 && quantity === 0) throw new Error('Enter Denarii or a relic quantity to grant.');
      if (quantity > 0 && !relicTypeId) throw new Error('Choose a relic.');

      setGranting(true);
      const result = await grantInstructorResources({
        recipientId,
        denariiAmount: denarii,
        relicTypeId: relicTypeId || null,
        relicQuantity: quantity,
        note,
      });
      const resources = [
        result.denarii_granted > 0 ? `${result.denarii_granted.toLocaleString()} Denarii` : '',
        result.relic_quantity_granted > 0 ? `${result.relic_quantity_granted.toLocaleString()} x ${result.relic_name}` : '',
      ].filter(Boolean).join(' and ');
      setFeedback({ type: 'success', message: `${resources} granted to ${result.recipient_name}.` });
      setDenariiAmount('');
      setRelicQuantity('');
      setNote('');
    } catch (error: unknown) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'The grant could not be completed.',
      });
    } finally {
      setGranting(false);
    }
  };

  const selectedMember = campMembers.find((member) => member.id === recipientId);

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Camp Treasury" subtitle="Grant Denarii and relics to any active camp member" />
      <form onSubmit={submitGrant} className="card space-y-5 p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-stone">Recipient</label>
            <AppSelect
              value={recipientId}
              onChange={setRecipientId}
              disabled={loading}
              placeholder={loading ? 'Loading camp members...' : 'Choose a camp member'}
              options={campMembers.map((member) => ({
                value: member.id,
                label: member.display_name,
                description: activeRoleByUser.get(member.id) || 'member',
              }))}
            />
          </div>
          {selectedMember && (
            <div className="flex min-h-[4.4rem] items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              <UserAvatar userId={selectedMember.id} name={selectedMember.display_name} avatarUrl={selectedMember.avatar_url} className="h-11 w-11" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{selectedMember.display_name}</p>
                <p className="text-xs capitalize text-stone">{activeRoleByUser.get(selectedMember.id)}</p>
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
          <span className="mb-1.5 block text-xs font-semibold text-stone">Grant note</span>
          <input
            className="input-field w-full"
            maxLength={240}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional reason"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-stone">Every grant is recorded in the camp ledger.</p>
          <button type="submit" disabled={granting || loading || !recipientId} className="btn-primary min-w-[10rem]">
            {granting ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
            Grant resources
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
