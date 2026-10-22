export type ArenaMatchupPlayer = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  tent_house_id: string | null;
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
