/*
  Publish the Sunday top-ten reading as a durable narrative, expose the
  previous Muralis with an authoritative profile join, and let shared reading
  links carry the same sanitized insight threads as the signed-in reader.
*/

CREATE TABLE IF NOT EXISTS public.public_scripture_insight_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id uuid NOT NULL REFERENCES public.scripture_verse_insights(id) ON DELETE CASCADE,
  guest_key_hash text NOT NULL,
  reaction_type text NOT NULL CHECK (reaction_type IN ('heart', 'lightbulb')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insight_id, guest_key_hash, reaction_type)
);

ALTER TABLE public.public_scripture_insight_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_scripture_insight_reactions FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS public_scripture_insight_reactions_insight_idx
  ON public.public_scripture_insight_reactions(insight_id, reaction_type);

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
  ),
  scored AS (
    SELECT
      engagement.*,
      (reaction_count + comment_count * 2 + insight_count * 3)::integer AS engagement_score
    FROM engagement
    ORDER BY
      (reaction_count + comment_count * 2 + insight_count * 3) DESC,
      narrative_date DESC,
      reference ASC
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
  ) ORDER BY engagement_score DESC, narrative_date DESC, reference ASC), '[]'::jsonb)
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
  v_items jsonb;
  v_highlighted jsonb;
  v_passages jsonb;
  v_reference text;
  v_main_text text;
  v_verse_of_day text;
BEGIN
  IF extract(dow FROM p_reading_date)::integer <> 0 THEN
    RETURN NULL;
  END IF;

  SELECT narrative.id INTO v_existing_id
  FROM public.daily_narratives narrative
  WHERE narrative.narrative_date = p_reading_date;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  v_items := public.refresh_weekly_verse_highlights(p_reading_date);
  IF jsonb_array_length(coalesce(v_items, '[]'::jsonb)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT
    jsonb_agg(jsonb_build_object(
      'reference', item.value->>'reference',
      'text', item.value->>'text',
      'meditation', ''
    ) ORDER BY item.ordinality),
    jsonb_agg(jsonb_build_object(
      'reference', item.value->>'reference',
      'translation', coalesce(item.value->>'translation', 'WEB'),
      'main_text', item.value->>'text',
      'highlighted_verses', jsonb_build_array(jsonb_build_object(
        'reference', item.value->>'reference',
        'text', item.value->>'text',
        'meditation', ''
      )),
      'source_narrative_id', item.value->>'narrative_id',
      'source_narrative_date', item.value->>'narrative_date'
    ) ORDER BY item.ordinality),
    string_agg(item.value->>'reference', ' · ' ORDER BY item.ordinality),
    string_agg((item.ordinality::text || '. ' || item.value->>'text'), E'\n\n' ORDER BY item.ordinality),
    (array_agg(item.value->>'text' ORDER BY item.ordinality))[1]
  INTO v_highlighted, v_passages, v_reference, v_main_text, v_verse_of_day
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS item(value, ordinality);

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
    coalesce(v_reference, 'This Week''s Most Engaged Verses'),
    'WEB',
    coalesce(v_main_text, ''),
    coalesce(v_highlighted, '[]'::jsonb),
    coalesce(v_passages, '[]'::jsonb),
    jsonb_build_array(
      'Return to the verses that shaped the camp this week.',
      'Read the insights and replies, then carry one truth into the new week.'
    ),
    NULL,
    NULL,
    'text',
    false,
    jsonb_build_object('auto_sunday_highlights', true, 'week_ending', p_reading_date),
    v_verse_of_day,
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
  IF extract(dow FROM v_today)::integer = 0 THEN
    PERFORM public.ensure_sunday_highlight_reading(v_today);
  ELSE
    PERFORM public.refresh_weekly_verse_highlights(v_week_ending);
  END IF;

  RETURN QUERY
  SELECT highlight.week_ending, highlight.generated_at, highlight.items
  FROM public.weekly_verse_highlights highlight
  WHERE highlight.week_ending = v_week_ending;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_previous_muralis(p_event_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', award.id,
    'award_month', award.award_month,
    'user_id', coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END),
    'award_type', award.award_type,
    'title', award.title,
    'description', award.description,
    'metric_value', award.metric_value,
    'award_target_type', award.award_target_type,
    'award_target_id', award.award_target_id,
    'created_at', award.created_at,
    'profiles', CASE WHEN profile.id IS NULL THEN NULL ELSE jsonb_build_object(
      'display_name', profile.display_name,
      'avatar_url', profile.avatar_url
    ) END,
    'recipient_tent', CASE WHEN tent.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', tent.id,
      'name', tent.name,
      'tent_house_id', tent.tent_house_id
    ) END
  )
  FROM public.awards award
  LEFT JOIN public.profiles profile
    ON profile.id = coalesce(award.user_id, CASE WHEN award.award_target_type <> 'tent' THEN award.award_target_id END)
  LEFT JOIN LATERAL (
    SELECT member_tent.id, member_tent.name, member_tent.tent_house_id
    FROM public.tent_members member
    JOIN public.tents member_tent ON member_tent.id = member.tent_id
    WHERE member.user_id = profile.id
    ORDER BY member.joined_at DESC
    LIMIT 1
  ) tent ON true
  WHERE (
      lower(btrim(award.title)) IN ('muralis', 'muralis award')
      OR lower(btrim(coalesce(award.award_type, ''))) = 'muralis'
    )
    AND date_trunc('month', award.award_month::date) < date_trunc('month', p_event_month)
  ORDER BY award.award_month DESC, award.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.public_reading_panel_image(p_announcement_type text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'content', announcement.content,
    'image_position_x', coalesce(announcement.image_position_x, 50),
    'image_position_y', coalesce(announcement.image_position_y, 50)
  )
  FROM public.scheduled_announcements announcement
  WHERE announcement.announcement_type = p_announcement_type
    AND announcement.is_active = true
    AND announcement.publish_at <= now()
    AND announcement.audience IN ('all', 'cadets')
  ORDER BY (announcement.audience <> 'all') DESC, announcement.publish_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.public_reading_insight_threads(
  p_narrative_ids uuid[],
  p_guest_key_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', insight.id,
    'narrative_id', insight.narrative_id,
    'verse_reference', insight.verse_reference,
    'body', insight.body,
    'created_at', insight.created_at,
    'user_id', insight.user_id,
    'profiles', jsonb_build_object(
      'display_name', author.display_name,
      'avatar_url', author.avatar_url
    ),
    'comments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', comment.id,
        'insight_id', comment.insight_id,
        'user_id', comment.user_id,
        'parent_comment_id', comment.parent_comment_id,
        'body', comment.body,
        'created_at', comment.created_at,
        'profile', jsonb_build_object(
          'display_name', commenter.display_name,
          'avatar_url', commenter.avatar_url
        )
      ) ORDER BY comment.created_at)
      FROM public.scripture_insight_comments comment
      JOIN public.profiles commenter ON commenter.id = comment.user_id
      WHERE comment.insight_id = insight.id
    ), '[]'::jsonb),
    'reactions', jsonb_build_object(
      'heart', jsonb_build_object(
        'count',
          (SELECT count(*) FROM public.scripture_insight_reactions reaction
            WHERE reaction.insight_id = insight.id AND reaction.reaction_type = 'heart')
          + (SELECT count(*) FROM public.public_scripture_insight_reactions reaction
            WHERE reaction.insight_id = insight.id AND reaction.reaction_type = 'heart'),
        'reacted', p_guest_key_hash IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.public_scripture_insight_reactions reaction
          WHERE reaction.insight_id = insight.id
            AND reaction.reaction_type = 'heart'
            AND reaction.guest_key_hash = p_guest_key_hash
        ),
        'actors', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'user_id', reactor.id,
            'display_name', reactor.display_name,
            'avatar_url', reactor.avatar_url
          ) ORDER BY reaction.created_at DESC)
          FROM public.scripture_insight_reactions reaction
          JOIN public.profiles reactor ON reactor.id = reaction.reactor_user_id
          WHERE reaction.insight_id = insight.id AND reaction.reaction_type = 'heart'
        ), '[]'::jsonb)
      ),
      'lightbulb', jsonb_build_object(
        'count',
          (SELECT count(*) FROM public.scripture_insight_reactions reaction
            WHERE reaction.insight_id = insight.id AND reaction.reaction_type = 'lightbulb')
          + (SELECT count(*) FROM public.public_scripture_insight_reactions reaction
            WHERE reaction.insight_id = insight.id AND reaction.reaction_type = 'lightbulb'),
        'reacted', p_guest_key_hash IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.public_scripture_insight_reactions reaction
          WHERE reaction.insight_id = insight.id
            AND reaction.reaction_type = 'lightbulb'
            AND reaction.guest_key_hash = p_guest_key_hash
        ),
        'actors', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'user_id', reactor.id,
            'display_name', reactor.display_name,
            'avatar_url', reactor.avatar_url
          ) ORDER BY reaction.created_at DESC)
          FROM public.scripture_insight_reactions reaction
          JOIN public.profiles reactor ON reactor.id = reaction.reactor_user_id
          WHERE reaction.insight_id = insight.id AND reaction.reaction_type = 'lightbulb'
        ), '[]'::jsonb)
      )
    )
  ) ORDER BY insight.created_at DESC), '[]'::jsonb)
  FROM public.scripture_verse_insights insight
  JOIN public.profiles author ON author.id = insight.user_id
  WHERE insight.narrative_id = ANY(coalesce(p_narrative_ids, ARRAY[]::uuid[]));
$$;

CREATE OR REPLACE FUNCTION public.get_shared_daily_reading_v2(
  p_narrative_date date,
  p_guest_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_narrative public.daily_narratives%ROWTYPE;
  v_weekly_items jsonb := '[]'::jsonb;
  v_narrative_ids uuid[] := ARRAY[]::uuid[];
  v_guest_hash text := CASE
    WHEN nullif(btrim(coalesce(p_guest_key, '')), '') IS NULL THEN NULL
    ELSE md5(btrim(p_guest_key))
  END;
BEGIN
  IF extract(dow FROM p_narrative_date)::integer = 0
     AND p_narrative_date = timezone('Africa/Douala', now())::date THEN
    PERFORM public.ensure_sunday_highlight_reading(p_narrative_date);
  END IF;

  SELECT narrative.* INTO v_narrative
  FROM public.daily_narratives narrative
  WHERE narrative.narrative_date = p_narrative_date
    AND narrative.narrative_date <= timezone('Africa/Douala', now())::date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_narrative_ids := array_append(v_narrative_ids, v_narrative.id);

  IF extract(dow FROM p_narrative_date)::integer = 0 THEN
    SELECT coalesce(highlight.items, '[]'::jsonb) INTO v_weekly_items
    FROM public.weekly_verse_highlights highlight
    WHERE highlight.week_ending = p_narrative_date;

    SELECT coalesce(array_agg(DISTINCT (item.value->>'narrative_id')::uuid), ARRAY[]::uuid[])
    INTO v_narrative_ids
    FROM jsonb_array_elements(coalesce(v_weekly_items, '[]'::jsonb)) item(value)
    WHERE nullif(item.value->>'narrative_id', '') IS NOT NULL;

    v_narrative_ids := array_append(v_narrative_ids, v_narrative.id);
  END IF;

  RETURN jsonb_build_object(
    'id', v_narrative.id,
    'narrative_date', v_narrative.narrative_date,
    'title', v_narrative.title,
    'theme', v_narrative.theme,
    'scripture_reference', v_narrative.scripture_reference,
    'translation', v_narrative.translation,
    'main_text', v_narrative.main_text,
    'highlighted_verses', coalesce(v_narrative.highlighted_verses, '[]'::jsonb),
    'scripture_passages', coalesce(v_narrative.scripture_passages, '[]'::jsonb),
    'verse_of_day', v_narrative.verse_of_day,
    'reflection_prompts', coalesce(v_narrative.reflection_prompts, '[]'::jsonb),
    'weekly_highlights', coalesce(v_weekly_items, '[]'::jsonb),
    'insights', public.public_reading_insight_threads(v_narrative_ids, v_guest_hash),
    'panel_images', jsonb_build_object(
      'reading', public.public_reading_panel_image('panel_image_reading'),
      'scripture', coalesce(
        public.public_reading_panel_image('panel_image_scripture'),
        public.public_reading_panel_image('panel_image_verse_day_tr')
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_daily_reading(p_narrative_date date)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_shared_daily_reading_v2(p_narrative_date, NULL);
$$;

CREATE OR REPLACE FUNCTION public.toggle_public_scripture_insight_reaction(
  p_insight_id uuid,
  p_guest_key text,
  p_reaction_type text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_hash text;
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) < 8
     OR char_length(btrim(coalesce(p_guest_key, ''))) > 200 THEN
    RAISE EXCEPTION 'A valid guest session is required.';
  END IF;
  IF p_reaction_type NOT IN ('heart', 'lightbulb') THEN
    RAISE EXCEPTION 'Unsupported insight reaction.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scripture_verse_insights insight WHERE insight.id = p_insight_id) THEN
    RAISE EXCEPTION 'Insight not found.';
  END IF;

  v_guest_hash := md5(btrim(p_guest_key));

  DELETE FROM public.public_scripture_insight_reactions reaction
  WHERE reaction.insight_id = p_insight_id
    AND reaction.guest_key_hash = v_guest_hash
    AND reaction.reaction_type = p_reaction_type;

  IF FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.public_scripture_insight_reactions(insight_id, guest_key_hash, reaction_type)
  VALUES (p_insight_id, v_guest_hash, p_reaction_type)
  ON CONFLICT (insight_id, guest_key_hash, reaction_type) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_weekly_verse_highlights(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_sunday_highlight_reading(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_weekly_verse_highlights() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_previous_muralis(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_reading_panel_image(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_reading_insight_threads(uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_shared_daily_reading_v2(date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shared_daily_reading(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_public_scripture_insight_reaction(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_sunday_highlight_reading(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_weekly_verse_highlights() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_previous_muralis(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_daily_reading_v2(date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_daily_reading(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_public_scripture_insight_reaction(uuid, text, text) TO anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('full-circle-sunday-reading')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-sunday-reading');
    PERFORM cron.schedule(
      'full-circle-sunday-reading',
      '5 23 * * 6',
      $job$SELECT public.ensure_sunday_highlight_reading(timezone('Africa/Douala', now())::date);$job$
    );
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
    NULL;
END;
$$;

SELECT public.ensure_sunday_highlight_reading(timezone('Africa/Douala', now())::date)
WHERE extract(dow FROM timezone('Africa/Douala', now()))::integer = 0;
