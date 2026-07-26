/*
# Game question metadata and daily quote feed

- Adds narrative/round/timer/quiz-tag metadata to instructor game questions.
- Adds a read-only security-definer feed for submitted daily quotes.
*/

ALTER TABLE public.custom_questions
  ADD COLUMN IF NOT EXISTS narrative_date date,
  ADD COLUMN IF NOT EXISTS narrative_title text,
  ADD COLUMN IF NOT EXISTS narrative_theme text,
  ADD COLUMN IF NOT EXISTS game_round integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS round_timer_seconds integer,
  ADD COLUMN IF NOT EXISTS is_bonus boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS use_for_quiz boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS generated_from_packet boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS packet_section text;

CREATE INDEX IF NOT EXISTS idx_custom_questions_narrative_level
  ON public.custom_questions(narrative_date, game_level, game_round, question_index);

CREATE INDEX IF NOT EXISTS idx_custom_questions_quiz_tag
  ON public.custom_questions(use_for_quiz)
  WHERE use_for_quiz = true;

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  WHERE dr.meditation_submitted = true
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.record_date DESC, dr.meditation_submitted_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;
