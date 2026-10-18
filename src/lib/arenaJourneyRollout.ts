export type ArenaGameType = 'standard' | 'ludo' | 'journey';
export type ArenaOpponent = 'players' | 'machine';

export function preferredArenaGameType(current: ArenaGameType, opponent: ArenaOpponent,
  readyCharacterCount: number): ArenaGameType {
  if (opponent === 'machine' && current === 'journey') return 'standard';
  if (opponent === 'players' && readyCharacterCount > 0 && current === 'standard') return 'journey';
  return current;
}

export function arenaGameOptions(opponent: ArenaOpponent, readyCharacterCount: number) {
  return [
    ...(opponent === 'players' && readyCharacterCount > 0
      ? [{ value: 'journey', label: 'Standard Trivia: Biblical Journey' }] : []),
    { value: 'standard', label: 'Classic Trivia' },
    { value: 'ludo', label: 'Ludo Trivia' },
  ];
}
