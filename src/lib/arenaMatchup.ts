export type ArenaMatchupPlayer = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  tent_house_id: string | null;
  /** Exact tent membership, not the broader house symbol. */
  tent_id?: string | null;
  player_number?: number | null;
  correct_count: number;
  score?: number;
};

export function shortArenaName(name: string) {
  if (name.trim().toLowerCase() === 'the scribe') return 'The Scribe';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Player';
  const candidates = words.filter((word) => !/^(the|a|an)$/i.test(word));
  return (candidates.length ? candidates : words).reduce((shortest, word) =>
    word.length < shortest.length ? word : shortest);
}


/** Only exact tent membership makes Arena players teammates.
 * Sharing a house symbol does not make them the same tent. */
export function groupArenaMatchupSides(players: ArenaMatchupPlayer[]) {
  const sides: Array<{ key: string; players: ArenaMatchupPlayer[] }> = [];
  for (const player of players) {
    const key = player.tent_id ? `tent:${player.tent_id}` : `player:${player.user_id}`;
    const existing = sides.find((side) => side.key === key);
    if (existing) existing.players.push(player);
    else sides.push({ key, players: [player] });
  }
  return sides;
}
