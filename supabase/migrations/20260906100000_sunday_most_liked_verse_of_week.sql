/*
  Keep the Sunday top-ten conversation selection unchanged, but make the
  featured Verse of the Week the most-liked Verse of the Day from Monday
  through Saturday. "Amen" is the heart reaction on Verse of the Day.
*/

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

  SELECT narrative.verse_of_day
  INTO v_verse_of_week
  FROM public.daily_narratives narrative
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE reaction.reaction_type = 'amen')::integer AS like_count,
      count(*)::integer AS total_reactions
    FROM public.daily_verse_reactions reaction
    WHERE reaction.narrative_date = narrative.narrative_date
  ) reactions ON true
  WHERE narrative.narrative_date BETWEEN p_reading_date - 6 AND p_reading_date - 1
    AND nullif(btrim(narrative.verse_of_day), '') IS NOT NULL
    AND coalesce(narrative.game_seed_data->>'auto_sunday_highlights', 'false') <> 'true'
  ORDER BY
    coalesce(reactions.like_count, 0) DESC,
    coalesce(reactions.total_reactions, 0) DESC,
    narrative.narrative_date DESC
  LIMIT 1;

  IF v_verse_of_week IS NULL THEN
    SELECT item.value->>'text'
    INTO v_verse_of_week
    FROM jsonb_array_elements(v_items) item(value)
    ORDER BY
      coalesce(nullif(item.value->>'reaction_count', '')::integer, 0) DESC,
      item.value->>'reference'
    LIMIT 1;
  END IF;

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
        game_seed_data = jsonb_build_object(
          'auto_sunday_highlights', true,
          'week_ending', p_reading_date,
          'verse_of_week_rule', 'most_liked_verse_of_day'
        ),
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
    jsonb_build_object(
      'auto_sunday_highlights', true,
      'week_ending', p_reading_date,
      'verse_of_week_rule', 'most_liked_verse_of_day'
    ),
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

REVOKE ALL ON FUNCTION public.ensure_sunday_highlight_reading(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_sunday_highlight_reading(date) TO authenticated, service_role;

SELECT public.ensure_sunday_highlight_reading(timezone('Africa/Douala', now())::date)
WHERE extract(dow FROM timezone('Africa/Douala', now()))::integer = 0;
