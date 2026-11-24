export const ARENA_SHIELD_SLUG = 'shield-of-faith';

export type ArenaShieldOffer = {
  playerId: string;
  deadline: string;
  consequence: string;
  ownsShield: boolean;
  attackerId?: string;
};

export function createArenaShieldOffer(playerId: string, consequence: string, ownsShield: boolean): ArenaShieldOffer {
  return { playerId, consequence, ownsShield, deadline: new Date(Date.now() + 10_000).toISOString() };
}

export function validateArenaShieldDecision(offer: ArenaShieldOffer, actorId: string, decision: 'use' | 'expire' | 'reflect') {
  const expired = Date.now() >= Date.parse(offer.deadline);
  if ((decision === 'use' || decision === 'reflect') && (expired || offer.playerId !== actorId || (decision === 'reflect' && !offer.attackerId))) {
    throw new Error('Only the affected player may use the Shield of Faith before time runs out.');
  }
  if (decision === 'expire' && !expired) throw new Error('The Shield of Faith window has not expired.');
}

// Read the Market inventory on the server. The commit RPC rechecks and spends
// the relic atomically with the move, since inventory can change concurrently.
export async function arenaShieldOwners(
  rest: (path: string) => Promise<unknown>,
  playerIds: readonly string[],
  spendingPlayerId?: string,
): Promise<string[]> {
  if (!playerIds.length) return [];
  const rows = await rest(`relic_inventory?select=user_id,quantity,relic_types!inner(slug)&user_id=in.(${playerIds.join(',')})&quantity=gt.0&relic_types.slug=eq.${ARENA_SHIELD_SLUG}`) as
    Array<{ user_id: string; quantity: number }>;
  const quantities = new Map<string, number>();
  for (const row of rows || []) quantities.set(row.user_id, (quantities.get(row.user_id) ?? 0) + row.quantity);
  return [...quantities].filter(([id, quantity]) => quantity > (id === spendingPlayerId ? 1 : 0)).map(([id]) => id);
}
