export type PuzzleDifficulty = 'easy' | 'medium' | 'hard';
export const PUZZLE_DIFFICULTIES = {
 easy: { label: 'Easy', seconds: 240, wordCount: 3, detail: 'Familiar words · full clues · 4 minutes' },
 medium: { label: 'Medium', seconds: 180, wordCount: 4, detail: 'Longer words · Scripture clues · 3 minutes' },
 hard: { label: 'Hard', seconds: 120, wordCount: 6, detail: 'Less obvious words · hidden clues · 2 minutes' },
} as const;
