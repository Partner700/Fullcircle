/* Public sharing extensions: guest insights and a safe Level 1 game feed. */

CREATE TABLE IF NOT EXISTS public.public_scripture_guest_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_id uuid NOT NULL REFERENCES public.daily_narratives(id) ON DELETE CASCADE,
  verse_reference text NOT NULL,
  body text NOT NULL,
  guest_key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_scripture_guest_insights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_scripture_guest_insights FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS public_scripture_guest_insights_lookup_idx
  ON public.public_scripture_guest_insights(narrative_id, verse_reference, created_at DESC);

CREATE OR REPLACE FUNCTION public.add_public_scripture_insight(
  p_narrative_id uuid,
  p_verse_reference text,
  p_body text,
  p_guest_key text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_hash text := md5(btrim(coalesce(p_guest_key, '')));
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) < 8 OR char_length(btrim(coalesce(p_guest_key, ''))) > 200 THEN
    RAISE EXCEPTION 'A valid guest session is required.';
  END IF;
  IF nullif(btrim(coalesce(p_body, '')), '') IS NULL THEN RAISE EXCEPTION 'Insight text is required.'; END IF;
  IF char_length(btrim(p_body)) > 3000 THEN RAISE EXCEPTION 'Insight is too long.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives WHERE id = p_narrative_id) THEN RAISE EXCEPTION 'Reading not found.'; END IF;

  INSERT INTO public.public_scripture_guest_insights(narrative_id, verse_reference, body, guest_key_hash)
  VALUES (p_narrative_id, btrim(p_verse_reference), btrim(p_body), v_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_public_scripture_insight(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_public_scripture_insight(uuid, text, text, text) TO anon, authenticated, service_role;

/* Keep the existing authenticated thread shape and append guest insights. */
CREATE OR REPLACE FUNCTION public.public_reading_insight_threads(
  p_narrative_ids uuid[], p_guest_key_hash text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', insight.id, 'narrative_id', insight.narrative_id, 'verse_reference', insight.verse_reference,
      'body', insight.body, 'created_at', insight.created_at, 'user_id', insight.user_id,
      'profiles', jsonb_build_object('display_name', author.display_name, 'avatar_url', author.avatar_url),
      'comments', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', comment.id, 'insight_id', comment.insight_id, 'user_id', comment.user_id,
        'parent_comment_id', comment.parent_comment_id, 'body', comment.body, 'created_at', comment.created_at,
        'profile', jsonb_build_object('display_name', commenter.display_name, 'avatar_url', commenter.avatar_url)
      ) ORDER BY comment.created_at) FROM public.scripture_insight_comments comment
        JOIN public.profiles commenter ON commenter.id = comment.user_id WHERE comment.insight_id = insight.id), '[]'::jsonb),
      'reactions', jsonb_build_object(
        'heart', jsonb_build_object('count',
          (SELECT count(*) FROM public.scripture_insight_reactions r WHERE r.insight_id = insight.id AND r.reaction_type = 'heart')
          + (SELECT count(*) FROM public.public_scripture_insight_reactions r WHERE r.insight_id = insight.id AND r.reaction_type = 'heart'),
          'reacted', p_guest_key_hash IS NOT NULL AND EXISTS (SELECT 1 FROM public.public_scripture_insight_reactions r WHERE r.insight_id = insight.id AND r.guest_key_hash = p_guest_key_hash AND r.reaction_type = 'heart'), 'actors', '[]'::jsonb),
        'lightbulb', jsonb_build_object('count',
          (SELECT count(*) FROM public.scripture_insight_reactions r WHERE r.insight_id = insight.id AND r.reaction_type = 'lightbulb')
          + (SELECT count(*) FROM public.public_scripture_insight_reactions r WHERE r.insight_id = insight.id AND r.reaction_type = 'lightbulb'),
          'reacted', p_guest_key_hash IS NOT NULL AND EXISTS (SELECT 1 FROM public.public_scripture_insight_reactions r WHERE r.insight_id = insight.id AND r.guest_key_hash = p_guest_key_hash AND r.reaction_type = 'lightbulb'), 'actors', '[]'::jsonb)
      )
    ) ORDER BY insight.created_at DESC)
    FROM public.scripture_verse_insights insight JOIN public.profiles author ON author.id = insight.user_id
    WHERE insight.narrative_id = ANY(coalesce(p_narrative_ids, ARRAY[]::uuid[]))
  ), '[]'::jsonb) || coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', guest.id, 'narrative_id', guest.narrative_id, 'verse_reference', guest.verse_reference,
      'body', guest.body, 'created_at', guest.created_at, 'user_id', guest.id,
      'profiles', jsonb_build_object('display_name', 'Guest reader', 'avatar_url', NULL),
      'comments', '[]'::jsonb,
      'reactions', jsonb_build_object(
        'heart', jsonb_build_object('count', 0, 'reacted', false, 'actors', '[]'::jsonb),
        'lightbulb', jsonb_build_object('count', 0, 'reacted', false, 'actors', '[]'::jsonb)
      )
    ) ORDER BY guest.created_at DESC)
    FROM public.public_scripture_guest_insights guest
    WHERE guest.narrative_id = ANY(coalesce(p_narrative_ids, ARRAY[]::uuid[]))
  ), '[]'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.public_reading_insight_threads(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_reading_insight_threads(uuid[], text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_shared_daily_game(p_narrative_date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'date', p_narrative_date,
    'level', 1,
    'title', coalesce((SELECT title FROM public.daily_narratives WHERE narrative_date = p_narrative_date LIMIT 1), 'Daily Trivia'),
    'questions', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', question.id, 'question_text', question.question_text, 'options', coalesce(question.options, '[]'::jsonb)
    ) ORDER BY question.question_index) FROM public.custom_questions question
      WHERE question.narrative_date = p_narrative_date AND question.game_level = 1
        AND coalesce(question.is_approved, true)), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_shared_daily_game(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_daily_game(date) TO anon, authenticated, service_role;
