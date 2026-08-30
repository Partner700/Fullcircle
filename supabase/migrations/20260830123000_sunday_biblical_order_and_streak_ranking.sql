/*
  Keep Sunday focused on ten engaged verse conversations. The ten are chosen
  by engagement, stored in canonical Bible order, and retain the source
  narrative that owns their insights, replies, and reactions.
*/

CREATE OR REPLACE FUNCTION public.bible_reference_sort_key(p_reference text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_reference text := lower(regexp_replace(btrim(coalesce(p_reference, '')), '\s+', ' ', 'g'));
  v_book text;
  v_book_position integer;
  v_chapter integer := 0;
  v_verse integer := 0;
  v_match text[];
BEGIN
  v_book := regexp_replace(v_reference, '\s+[0-9]+.*$', '');
  v_book := CASE v_book
    WHEN 'psalm' THEN 'psalms'
    WHEN 'song of songs' THEN 'song of solomon'
    WHEN 'revelations' THEN 'revelation'
    WHEN 'i samuel' THEN '1 samuel'
    WHEN 'ii samuel' THEN '2 samuel'
    WHEN 'i kings' THEN '1 kings'
    WHEN 'ii kings' THEN '2 kings'
    WHEN 'i chronicles' THEN '1 chronicles'
    WHEN 'ii chronicles' THEN '2 chronicles'
    WHEN 'i corinthians' THEN '1 corinthians'
    WHEN 'ii corinthians' THEN '2 corinthians'
    WHEN 'i thessalonians' THEN '1 thessalonians'
    WHEN 'ii thessalonians' THEN '2 thessalonians'
    WHEN 'i timothy' THEN '1 timothy'
    WHEN 'ii timothy' THEN '2 timothy'
    WHEN 'i peter' THEN '1 peter'
    WHEN 'ii peter' THEN '2 peter'
    WHEN 'i john' THEN '1 john'
    WHEN 'ii john' THEN '2 john'
    WHEN 'iii john' THEN '3 john'
    ELSE v_book
  END;

  v_book_position := array_position(ARRAY[
    'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy',
    'joshua', 'judges', 'ruth', '1 samuel', '2 samuel',
    '1 kings', '2 kings', '1 chronicles', '2 chronicles', 'ezra',
    'nehemiah', 'esther', 'job', 'psalms', 'proverbs',
    'ecclesiastes', 'song of solomon', 'isaiah', 'jeremiah', 'lamentations',
    'ezekiel', 'daniel', 'hosea', 'joel', 'amos',
    'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk',
    'zephaniah', 'haggai', 'zechariah', 'malachi', 'matthew',
    'mark', 'luke', 'john', 'acts', 'romans',
    '1 corinthians', '2 corinthians', 'galatians', 'ephesians', 'philippians',
    'colossians', '1 thessalonians', '2 thessalonians', '1 timothy', '2 timothy',
    'titus', 'philemon', 'hebrews', 'james', '1 peter',
    '2 peter', '1 john', '2 john', '3 john', 'jude', 'revelation'
  ]::text[], v_book);

  v_match := regexp_match(v_reference, '\s([0-9]+):');
  IF v_match IS NOT NULL THEN
    v_chapter := v_match[1]::integer;
  END IF;

  v_match := regexp_match(v_reference, ':\s*([0-9]+)');
  IF v_match IS NOT NULL THEN
    v_verse := v_match[1]::integer;
  END IF;

  RETURN lpad(coalesce(v_book_position, 999)::text, 3, '0')
    || ':' || lpad(v_chapter::text, 4, '0')
    || ':' || lpad(v_verse::text, 4, '0')
    || ':' || v_reference;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_weekly_verse_highlights(
  p_week_ending date DEFAULT timezone('Africa/Douala', now())::date
)
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
      narrative.translation,
      coalesce(verse.value->>'reference', narrative.scripture_reference) AS reference,
      coalesce(verse.value->>'text', narrative.main_text) AS text
    FROM public.daily_narratives narrative
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_array_length(coalesce(narrative.highlighted_verses, '[]'::jsonb)) > 0
          THEN narrative.highlighted_verses
        ELSE jsonb_build_array(jsonb_build_object(
          'reference', narrative.scripture_reference,
          'text', narrative.main_text
        ))
      END
    ) verse(value)
    WHERE narrative.narrative_date BETWEEN p_week_ending - 6 AND p_week_ending - 1
      AND coalesce(narrative.game_seed_data->>'auto_sunday_highlights', 'false') <> 'true'
  ),
  engagement AS (
    SELECT
      verse.*,
      (SELECT count(*) FROM public.scripture_verse_insights insight
        WHERE insight.narrative_id = verse.narrative_id
          AND insight.verse_reference = verse.reference)::integer AS insight_count,
      (SELECT count(*)
        FROM public.scripture_insight_comments comment
        JOIN public.scripture_verse_insights insight ON insight.id = comment.insight_id
        WHERE insight.narrative_id = verse.narrative_id
          AND insight.verse_reference = verse.reference)::integer AS comment_count,
      (SELECT count(*)
        FROM public.scripture_insight_reactions reaction
        JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
        WHERE insight.narrative_id = verse.narrative_id
          AND insight.verse_reference = verse.reference)::integer
      + (SELECT count(*) FROM public.public_scripture_insight_reactions reaction
        JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
        WHERE insight.narrative_id = verse.narrative_id
          AND insight.verse_reference = verse.reference)::integer
      + (SELECT count(*) FROM public.daily_verse_reactions reaction
        WHERE reaction.narrative_date = verse.narrative_date)::integer AS reaction_count
    FROM verses verse
    WHERE nullif(btrim(verse.reference), '') IS NOT NULL
      AND nullif(btrim(verse.text), '') IS NOT NULL
  ),
  scored AS (
    SELECT
      engagement.*,
      (reaction_count + comment_count * 2 + insight_count * 3)::integer AS engagement_score
    FROM engagement
  ),
  deduplicated AS (
    SELECT
      scored.*,
      row_number() OVER (
        PARTITION BY lower(btrim(reference))
        ORDER BY engagement_score DESC, narrative_date DESC, narrative_id
      ) AS duplicate_rank
    FROM scored
  ),
  top_ten AS (
    SELECT *
    FROM deduplicated
    WHERE duplicate_rank = 1
    ORDER BY engagement_score DESC, narrative_date DESC, reference ASC
    LIMIT 10
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'narrative_id', narrative_id,
    'narrative_date', narrative_date,
    'title', title,
    'translation', translation,
    'reference', reference,
    'text', text,
    'reaction_count', reaction_count,
    'comment_count', comment_count,
    'insight_count', insight_count,
    'engagement_score', engagement_score
  ) ORDER BY public.bible_reference_sort_key(reference), lower(reference)), '[]'::jsonb)
  INTO v_items
  FROM top_ten;

  INSERT INTO public.weekly_verse_highlights AS highlight(week_ending, generated_at, items)
  VALUES (p_week_ending, now(), v_items)
  ON CONFLICT (week_ending) DO UPDATE
  SET generated_at = EXCLUDED.generated_at,
      items = EXCLUDED.items;

  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_sunday_highlight_reading(
  p_reading_date date DEFAULT timezone('Africa/Douala', now())::date
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_existing_auto boolean := false;
  v_items jsonb;
  v_highlighted jsonb;
  v_passages jsonb;
  v_main_text text;
  v_verse_of_week text;
BEGIN
  IF extract(dow FROM p_reading_date)::integer <> 0 THEN
    RETURN NULL;
  END IF;

  SELECT
    narrative.id,
    coalesce(narrative.game_seed_data->>'auto_sunday_highlights', 'false') = 'true'
  INTO v_existing_id, v_existing_auto
  FROM public.daily_narratives narrative
  WHERE narrative.narrative_date = p_reading_date;

  IF v_existing_id IS NOT NULL AND NOT v_existing_auto THEN
    RETURN v_existing_id;
  END IF;

  v_items := public.refresh_weekly_verse_highlights(p_reading_date);
  IF jsonb_array_length(coalesce(v_items, '[]'::jsonb)) = 0 THEN
    RETURN v_existing_id;
  END IF;

  SELECT item.value->>'text'
  INTO v_verse_of_week
  FROM jsonb_array_elements(v_items) item(value)
  ORDER BY
    coalesce(nullif(item.value->>'engagement_score', '')::integer, 0) DESC,
    item.value->>'reference'
  LIMIT 1;

  SELECT
    jsonb_agg(jsonb_build_object(
      'reference', item.value->>'reference',
      'text', item.value->>'text',
      'meditation', '',
      'source_narrative_id', item.value->>'narrative_id',
      'source_narrative_date', item.value->>'narrative_date'
    ) ORDER BY item.ordinality),
    jsonb_agg(jsonb_build_object(
      'reference', item.value->>'reference',
      'translation', coalesce(item.value->>'translation', 'WEB'),
      'main_text', item.value->>'text',
      'highlighted_verses', jsonb_build_array(jsonb_build_object(
        'reference', item.value->>'reference',
        'text', item.value->>'text',
        'meditation', '',
        'source_narrative_id', item.value->>'narrative_id',
        'source_narrative_date', item.value->>'narrative_date'
      )),
      'source_narrative_id', item.value->>'narrative_id',
      'source_narrative_date', item.value->>'narrative_date'
    ) ORDER BY item.ordinality),
    string_agg((item.ordinality::text || '. ' || (item.value->>'text')), E'\n\n' ORDER BY item.ordinality)
  INTO v_highlighted, v_passages, v_main_text
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS item(value, ordinality);

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.daily_narratives
    SET title = 'Sunday Scripture Highlights',
        theme = 'The Week in the Word',
        scripture_reference = 'Sunday Scripture Highlights',
        translation = 'WEB',
        main_text = coalesce(v_main_text, ''),
        highlighted_verses = coalesce(v_highlighted, '[]'::jsonb),
        scripture_passages = coalesce(v_passages, '[]'::jsonb),
        reflection_prompts = '[]'::jsonb,
        challenge_title = NULL,
        challenge_instructions = NULL,
        challenge_proof_type = 'text',
        challenge_active = false,
        game_seed_data = jsonb_build_object('auto_sunday_highlights', true, 'week_ending', p_reading_date),
        verse_of_day = v_verse_of_week,
        meditation_of_day = NULL,
        quote_of_day = NULL,
        challenge_proof_format = 'text'
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.daily_narratives (
    narrative_date,
    title,
    theme,
    scripture_reference,
    translation,
    main_text,
    highlighted_verses,
    scripture_passages,
    reflection_prompts,
    challenge_title,
    challenge_instructions,
    challenge_proof_type,
    challenge_active,
    game_seed_data,
    verse_of_day,
    meditation_of_day,
    quote_of_day,
    challenge_proof_format
  ) VALUES (
    p_reading_date,
    'Sunday Scripture Highlights',
    'The Week in the Word',
    'Sunday Scripture Highlights',
    'WEB',
    coalesce(v_main_text, ''),
    coalesce(v_highlighted, '[]'::jsonb),
    coalesce(v_passages, '[]'::jsonb),
    '[]'::jsonb,
    NULL,
    NULL,
    'text',
    false,
    jsonb_build_object('auto_sunday_highlights', true, 'week_ending', p_reading_date),
    v_verse_of_week,
    NULL,
    NULL,
    'text'
  )
  ON CONFLICT (narrative_date) DO NOTHING
  RETURNING id INTO v_existing_id;

  IF v_existing_id IS NULL THEN
    SELECT narrative.id INTO v_existing_id
    FROM public.daily_narratives narrative
    WHERE narrative.narrative_date = p_reading_date;
  END IF;

  RETURN v_existing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bible_reference_sort_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_weekly_verse_highlights(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_sunday_highlight_reading(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_sunday_highlight_reading(date) TO authenticated, service_role;

DO $$
DECLARE
  v_reading_date date;
BEGIN
  FOR v_reading_date IN
    SELECT narrative.narrative_date
    FROM public.daily_narratives narrative
    WHERE coalesce(narrative.game_seed_data->>'auto_sunday_highlights', 'false') = 'true'
      AND extract(dow FROM narrative.narrative_date)::integer = 0
  LOOP
    PERFORM public.ensure_sunday_highlight_reading(v_reading_date);
  END LOOP;

  IF extract(dow FROM timezone('Africa/Douala', now()))::integer = 0 THEN
    PERFORM public.ensure_sunday_highlight_reading(timezone('Africa/Douala', now())::date);
  END IF;
END;
$$;
