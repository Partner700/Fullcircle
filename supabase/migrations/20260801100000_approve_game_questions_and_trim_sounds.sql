-- Instructor approval is required before a game question can be served to players.
ALTER TABLE public.custom_questions
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_custom_questions_approved_game
  ON public.custom_questions (narrative_date, game_level, game_round, question_index)
  WHERE is_approved = true;

-- Sound slots remain regular announcement rows, with optional non-destructive
-- start/end markers. The original upload is never altered.
ALTER TABLE public.scheduled_announcements
  ADD COLUMN IF NOT EXISTS audio_start_seconds numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audio_end_seconds numeric;
