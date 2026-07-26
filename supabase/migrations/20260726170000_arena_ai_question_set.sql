-- Persist generated arena question sets so every participant receives the same battle.
ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS question_set jsonb,
  ADD COLUMN IF NOT EXISTS question_generated_at timestamptz;
