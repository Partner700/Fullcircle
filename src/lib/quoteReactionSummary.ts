type Actor = { user_id: string; display_name: string; avatar_url: string | null };
export type QuoteReactionSummary = Record<string, Record<string, { count: number; reacted: boolean; actors?: Actor[] }>>;
export type CompactQuoteReactionSummary = {
  quotes: Record<string, Record<string, { count: number; reacted: boolean; actor_ids?: string[] }>>;
  actors: Record<string, Actor>;
};

export function expandQuoteReactionSummary(data: CompactQuoteReactionSummary): QuoteReactionSummary {
  return Object.fromEntries(Object.entries(data.quotes).map(([key, reactions]) => [key,
    Object.fromEntries(Object.entries(reactions).map(([type, reaction]) => [type, {
      count: reaction.count,
      reacted: reaction.reacted,
      ...(reaction.actor_ids ? { actors: reaction.actor_ids.flatMap(id => data.actors[id] ? [data.actors[id]] : []) } : {}),
    }])),
  ]));
}
