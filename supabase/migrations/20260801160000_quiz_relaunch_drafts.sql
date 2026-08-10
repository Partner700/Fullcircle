-- Keep historical attempts immutable while allowing an instructor to edit and
-- relaunch a quiz as a new attempt cycle.
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS relaunch_of_id uuid REFERENCES public.quiz_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relaunch_ready boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS quiz_sessions_relaunch_of_idx
  ON public.quiz_sessions(relaunch_of_id)
  WHERE relaunch_of_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS quiz_sessions_one_scheduled_relaunch_draft_idx
  ON public.quiz_sessions(relaunch_of_id)
  WHERE relaunch_of_id IS NOT NULL AND status = 'scheduled';

-- Preserve the relaunch copies created by the earlier UI and label them
-- correctly in the quiz list.
UPDATE public.quiz_sessions
SET relaunch_ready = true
WHERE status = 'scheduled'
  AND title ILIKE '%(Relaunch)%';
