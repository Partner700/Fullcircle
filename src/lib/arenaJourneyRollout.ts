export type ArenaGameType = 'standard' | 'ludo' | 'journey';
export type ArenaOpponent = 'players' | 'machine';

export function preferredArenaGameType(current: ArenaGameType, _opponent: ArenaOpponent,
  readyCharacterCount: number): ArenaGameType {
  if (readyCharacterCount > 0 && current === 'standard') return 'journey';
  return current;
}

export function arenaGameOptions(_opponent: ArenaOpponent, readyCharacterCount: number) {
  return [
    ...(readyCharacterCount > 0
      ? [{ value: 'journey', label: 'Standard Trivia: Biblical Journey' }] : []),
    { value: 'standard', label: 'Classic Trivia' },
    { value: 'ludo', label: 'Ludo Trivia' },
  ];
}
