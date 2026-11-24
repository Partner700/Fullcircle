-- Personal scripture verse highlights shared by Today’s Reading and the Bible.
-- Question colors come from actual delivery and answer records, never
-- generic mentions; ignored questions do not count as answered.
CREATE OR REPLACE FUNCTION public.get_my_scripture_verse_marks(p_verse_references text[])
RETURNS TABLE(verse_reference text, has_insight boolean, has_pending_question boolean, has_answered_question boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  WITH requested AS (
    SELECT DISTINCT btrim(reference) AS verse_reference
    FROM unnest(coalesce(p_verse_references, ARRAY[]::text[])) reference
    WHERE btrim(reference) <> ''
    LIMIT 250
  )
  SELECT requested.verse_reference,
    EXISTS (
      SELECT 1 FROM public.scripture_verse_insights i
      WHERE i.user_id = (SELECT auth.uid())
        AND i.verse_reference = requested.verse_reference
        AND i.is_question = false
    ) AS has_insight,
    EXISTS (
      SELECT 1
      FROM private.scripture_question_deliveries d
      JOIN public.scripture_verse_insights i ON i.id = d.question_id
      WHERE d.recipient_id = (SELECT auth.uid())
        AND i.verse_reference = requested.verse_reference
        AND d.resolved_at IS NULL
    ) AS has_pending_question,
    EXISTS (
      SELECT 1
      FROM private.scripture_question_deliveries d
      JOIN public.scripture_verse_insights i ON i.id = d.question_id
      WHERE d.recipient_id = (SELECT auth.uid())
        AND i.verse_reference = requested.verse_reference
        AND d.resolved_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.scripture_insight_comments c
          WHERE c.insight_id = d.question_id
            AND c.user_id = (SELECT auth.uid())
            AND c.created_at >= d.delivered_at
        )
    ) AS has_answered_question
  FROM requested;
$function$;
REVOKE ALL ON FUNCTION public.get_my_scripture_verse_marks(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_scripture_verse_marks(text[]) TO authenticated;