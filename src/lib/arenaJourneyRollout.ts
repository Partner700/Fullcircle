export type ArenaGameType = 'standard' | 'ludo' | 'journey' | 'prelude';
export type ArenaOpponent = 'players' | 'machine';

export function preferredArenaGameType(current: ArenaGameType, _opponent: ArenaOpponent,
  readyCharacterCount: number): ArenaGameType {
  if (readyCharacterCount > 0 && current === 'standard') return 'journey';
  return current;
}

export function arenaGameOptions(_opponent: ArenaOpponent, readyCharacterCount: number) {
  return [
    { value: 'journey', label: 'Journey Trivia' },
    { value: 'standard', label: 'Classic Trivia' },
    { value: 'ludo', label: 'Ludo Trivia' },
  ];
}
