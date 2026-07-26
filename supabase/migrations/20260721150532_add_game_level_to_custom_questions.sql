/*
# Add game_level column to custom_questions

1. Changes
- Add `game_level` integer column to `custom_questions` table (nullable).
  When set, the question is intended for the daily game at that level (1-7)
  rather than for a quiz session. `quiz_session_id` remains for quiz questions.
- Add an index on `(game_level, question_type)` for efficient game-time lookups.
2. Security
- No RLS changes. Existing policies on custom_questions remain in effect.
3. Notes
- `game_level` is nullable so existing quiz-linked rows are unaffected.
- The frontend game engine will prefer custom questions for a given level
  before falling back to auto-generated ones.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_questions' AND column_name = 'game_level'
  ) THEN
    ALTER TABLE custom_questions ADD COLUMN game_level integer;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_custom_questions_game_level
  ON custom_questions (game_level, question_type);
