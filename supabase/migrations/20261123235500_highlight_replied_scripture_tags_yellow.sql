-- Personal color for tags: red until a response, then yellow.
CREATE OR REPLACE FUNCTION public.get_my_scripture_verse_marks(p_verse_references text[])
RETURNS TABLE(verse_reference text, has_insight boolean, has_pending_question boolean, has_answered_question boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
WITH actor AS (SELECT auth.uid() AS id),
requested AS (
  SELECT DISTINCT btrim(reference) AS verse_reference
  FROM unnest(coalesce(p_verse_references, ARRAY[]::text[])) reference
  WHERE btrim(reference) <> '' LIMIT 250
),
tagged AS (
  SELECT i.verse_reference, i.id AS insight_id, i.created_at AS tagged_at
  FROM public.scripture_verse_insights i CROSS JOIN actor
  WHERE actor.id = ANY(coalesce(i.mentioned_user_ids, ARRAY[]::uuid[]))
    AND i.user_id <> actor.id
    AND i.verse_reference IN (SELECT requested.verse_reference FROM requested)
  UNION ALL
  SELECT i.verse_reference, i.id AS insight_id, c.created_at AS tagged_at
  FROM public.scripture_insight_comments c
  JOIN public.scripture_verse_insights i ON i.id = c.insight_id
  CROSS JOIN actor
  WHERE c.user_id <> actor.id
    AND (c.mentioned_user_id = actor.id OR actor.id = ANY(coalesce(c.mentioned_user_ids, ARRAY[]::uuid[])))
    AND i.verse_reference IN (SELECT requested.verse_reference FROM requested)
  UNION ALL
  SELECT i.verse_reference, i.id AS insight_id, d.delivered_at AS tagged_at
  FROM private.scripture_question_deliveries d
  JOIN public.scripture_verse_insights i ON i.id = d.question_id
  CROSS JOIN actor
  WHERE d.recipient_id = actor.id
    AND i.verse_reference IN (SELECT requested.verse_reference FROM requested)
),
tag_status AS (
  SELECT t.verse_reference,
    EXISTS (
      SELECT 1 FROM public.scripture_insight_comments c CROSS JOIN actor
      WHERE c.insight_id = t.insight_id
        AND c.user_id = actor.id
        AND c.created_at >= t.tagged_at
    ) AS answered
  FROM tagged t
)
SELECT requested.verse_reference,
  EXISTS (
    SELECT 1 FROM public.scripture_verse_insights i CROSS JOIN actor
    WHERE i.user_id = actor.id
      AND i.verse_reference = requested.verse_reference
      AND i.is_question = false
  ) AS has_insight,
  EXISTS (
    SELECT 1 FROM tag_status ts
    WHERE ts.verse_reference = requested.verse_reference AND NOT ts.answered
  ) AS has_pending_question,
  EXISTS (
    SELECT 1 FROM tag_status ts
    WHERE ts.verse_reference = requested.verse_reference AND ts.answered
  ) AS has_answered_question
FROM requested;
$function$;
REVOKE ALL ON FUNCTION public.get_my_scripture_verse_marks(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_scripture_verse_marks(text[]) TO authenticated;