CREATE TABLE IF NOT EXISTS public.daily_quote_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote_record_date date NOT NULL,
  commenter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_quote_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_quote_comments_select" ON public.daily_quote_comments;
CREATE POLICY "daily_quote_comments_select"
  ON public.daily_quote_comments FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "daily_quote_comments_insert_own" ON public.daily_quote_comments;
CREATE POLICY "daily_quote_comments_insert_own"
  ON public.daily_quote_comments FOR INSERT TO authenticated
  WITH CHECK (commenter_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_daily_quote_comments_quote
  ON public.daily_quote_comments(quote_user_id, quote_record_date, created_at);

CREATE OR REPLACE FUNCTION public.comment_on_daily_quote(
  p_quote_user_id uuid,
  p_quote_record_date date,
  p_commenter_user_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote text;
  v_commenter_name text;
  v_body text := btrim(COALESCE(p_body, ''));
BEGIN
  IF auth.uid() IS DISTINCT FROM p_commenter_user_id THEN
    RAISE EXCEPTION 'You can only comment as yourself';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 500 THEN
    RAISE EXCEPTION 'Comment must be between 1 and 500 characters';
  END IF;

  SELECT daily_quote INTO v_quote
  FROM public.daily_records
  WHERE user_id = p_quote_user_id
    AND record_date = p_quote_record_date
    AND NULLIF(btrim(COALESCE(daily_quote, '')), '') IS NOT NULL;

  IF v_quote IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  INSERT INTO public.daily_quote_comments (quote_user_id, quote_record_date, commenter_user_id, body)
  VALUES (p_quote_user_id, p_quote_record_date, p_commenter_user_id, v_body);

  IF p_quote_user_id <> p_commenter_user_id THEN
    SELECT display_name INTO v_commenter_name FROM public.profiles WHERE id = p_commenter_user_id;
    PERFORM public.notify_user(
      p_quote_user_id,
      p_commenter_user_id,
      'social',
      'Quote comment',
      COALESCE(v_commenter_name, 'Someone') || ' commented on your quote.',
      'dashboard',
      jsonb_build_object('quote_record_date', p_quote_record_date)
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_quote_comments(
  p_quote_user_id uuid,
  p_quote_record_date date
)
RETURNS TABLE (
  id uuid,
  body text,
  created_at timestamptz,
  commenter_user_id uuid,
  display_name text,
  avatar_url text,
  rank_label text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.body,
    c.created_at,
    c.commenter_user_id,
    p.display_name,
    p.avatar_url,
    initcap(COALESCE((
      SELECT ra.role
      FROM public.role_assignments ra
      WHERE ra.user_id = c.commenter_user_id
        AND ra.status = 'active'
      ORDER BY ra.created_at DESC
      LIMIT 1
    ), 'cadet')) AS rank_label
  FROM public.daily_quote_comments c
  JOIN public.profiles p ON p.id = c.commenter_user_id
  WHERE c.quote_user_id = p_quote_user_id
    AND c.quote_record_date = p_quote_record_date
  ORDER BY c.created_at DESC
  LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_quote_interaction_summary(p_limit int DEFAULT 50)
RETURNS TABLE (
  quote_user_id uuid,
  quote_record_date date,
  daily_quote text,
  display_name text,
  avatar_url text,
  reaction_count bigint,
  comment_count bigint,
  interaction_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH quotes AS (
    SELECT dr.user_id, dr.record_date, dr.daily_quote, p.display_name, p.avatar_url
    FROM public.daily_records dr
    JOIN public.profiles p ON p.id = dr.user_id
    WHERE NULLIF(btrim(COALESCE(dr.daily_quote, '')), '') IS NOT NULL
    ORDER BY dr.record_date DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  )
  SELECT
    q.user_id AS quote_user_id,
    q.record_date AS quote_record_date,
    q.daily_quote,
    q.display_name,
    q.avatar_url,
    COALESCE(r.reaction_count, 0) AS reaction_count,
    COALESCE(c.comment_count, 0) AS comment_count,
    COALESCE(r.reaction_count, 0) + COALESCE(c.comment_count, 0) AS interaction_count
  FROM quotes q
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS reaction_count
    FROM public.daily_quote_reactions r
    WHERE r.quote_user_id = q.user_id AND r.quote_record_date = q.record_date
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS comment_count
    FROM public.daily_quote_comments c
    WHERE c.quote_user_id = q.user_id AND c.quote_record_date = q.record_date
  ) c ON true
  ORDER BY interaction_count DESC, q.record_date DESC;
$$;

GRANT SELECT, INSERT ON public.daily_quote_comments TO authenticated;
GRANT EXECUTE ON FUNCTION public.comment_on_daily_quote(uuid, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_comments(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_interaction_summary(int) TO authenticated;
