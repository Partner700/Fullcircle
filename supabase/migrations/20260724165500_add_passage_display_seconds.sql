/*
# Per-round comprehension passage display time

- Stores how long each comprehension round passage should remain on screen before questions begin.
*/

ALTER TABLE public.custom_questions
  ADD COLUMN IF NOT EXISTS passage_display_seconds integer;
