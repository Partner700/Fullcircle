export const ARENA_HEART = '❤️';
export type EngagementMessage = { id: string; sender_id: string | null; body: string; created_at: string };

export function isArenaHeart(body: string) { return body.trim() === ARENA_HEART; }

export function newArenaEngagement(previous: Set<string> | null, messages: EngagementMessage[], userId: string) {
  const seen = new Set([...(previous || []), ...messages.map(message => message.id)]);
  const fresh = previous ? messages.filter(message => !previous.has(message.id)) : [];
  return {
    seen,
    hearts: fresh.filter(message => isArenaHeart(message.body) && Date.now() - Date.parse(message.created_at) < 15_000).length,
    unread: fresh.filter(message => !isArenaHeart(message.body) && (!userId || message.sender_id !== userId)).length,
  };
}
