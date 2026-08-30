/* Sunday keeps the week's best-read passages available as links back to their
   original reading, where every insight, comment, and reaction remains live. */
CREATE TABLE IF NOT EXISTS public.weekly_verse_highlights (
  week_ending date PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  items jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.weekly_verse_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_weekly_verse_highlights" ON public.weekly_verse_highlights;
CREATE POLICY "read_weekly_verse_highlights"
  ON public.weekly_verse_highlights FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.refresh_weekly_verse_highlights(p_week_ending date DEFAULT timezone('Africa/Douala', now())::date)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
BEGIN
  WITH verses AS (
    SELECT
      narrative.id AS narrative_id,
      narrative.narrative_date,
      narrative.title,
      coalesce(verse.value->>'reference', narrative.scripture_reference) AS reference,
      coalesce(verse.value->>'text', narrative.main_text) AS text
    FROM public.daily_narratives narrative
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(narrative.highlighted_verses, '[]'::jsonb)) verse(value)
    WHERE narrative.narrative_date BETWEEN p_week_ending - 6 AND p_week_ending
  ),
  ranked AS (
    SELECT
      verses.*,
      (SELECT count(*) FROM public.daily_verse_reactions reaction WHERE reaction.narrative_date = verses.narrative_date)::integer AS reaction_count,
      (SELECT count(*) FROM public.daily_verse_comments comment WHERE comment.narrative_date = verses.narrative_date)::integer AS comment_count,
      (SELECT count(*) FROM public.scripture_verse_insights insight WHERE insight.narrative_id = verses.narrative_id AND insight.verse_reference = verses.reference)::integer AS insight_count
    FROM verses
  ),
  scored AS (
    SELECT *, (reaction_count + comment_count + insight_count * 2)::integer AS engagement_score
    FROM ranked
    ORDER BY (reaction_count + comment_count + insight_count * 2) DESC, narrative_date DESC, reference ASC
    LIMIT 10
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'narrative_date', narrative_date,
    'title', title,
    'reference', reference,
    'text', text,
    'reaction_count', reaction_count,
    'comment_count', comment_count,
    'insight_count', insight_count,
    'engagement_score', engagement_score
  )), '[]'::jsonb)
  INTO v_items
  FROM scored;

  INSERT INTO public.weekly_verse_highlights AS highlight(week_ending, generated_at, items)
  VALUES (p_week_ending, now(), v_items)
  ON CONFLICT (week_ending) DO UPDATE
  SET generated_at = EXCLUDED.generated_at,
      items = EXCLUDED.items;

  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_weekly_verse_highlights()
RETURNS TABLE(week_ending date, generated_at timestamptz, items jsonb)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_week_ending date := v_today - extract(dow FROM v_today)::integer;
BEGIN
  PERFORM public.refresh_weekly_verse_highlights(v_week_ending);
  RETURN QUERY
  SELECT highlight.week_ending, highlight.generated_at, highlight.items
  FROM public.weekly_verse_highlights highlight
  WHERE highlight.week_ending = v_week_ending;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_weekly_verse_highlights(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_weekly_verse_highlights() TO authenticated, service_role;
