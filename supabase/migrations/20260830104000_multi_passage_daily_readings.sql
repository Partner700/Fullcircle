/* Preserve every scripture chosen for a daily reading as one reader-visible packet. */
ALTER TABLE public.daily_narratives
  ADD COLUMN IF NOT EXISTS scripture_passages jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.daily_narratives narrative
SET scripture_passages = jsonb_build_array(
  jsonb_build_object(
    'reference', narrative.scripture_reference,
    'translation', narrative.translation,
    'main_text', narrative.main_text,
    'highlighted_verses', coalesce(narrative.highlighted_verses, '[]'::jsonb)
  )
)
WHERE coalesce(jsonb_array_length(narrative.scripture_passages), 0) = 0;
