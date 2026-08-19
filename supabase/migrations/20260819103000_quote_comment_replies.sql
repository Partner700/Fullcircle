-- Threaded replies for daily quote comments.

ALTER TABLE public.daily_quote_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES public.daily_quote_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_daily_quote_comments_parent
  ON public.daily_quote_comments(parent_comment_id, created_at);

CREATE OR REPLACE FUNCTION public.comment_on_daily_quote(
  p_quote_user_id uuid,
  p_quote_record_date date,
  p_commenter_user_id uuid,
  p_body text,
  p_parent_comment_id uuid DEFAULT NULL,
  p_mentioned_user_ids uuid[] DEFAULT '{}'
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
  v_comment_id uuid;
  v_parent_author uuid;
  v_recipient uuid;
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

  IF p_parent_comment_id IS NOT NULL THEN
    SELECT commenter_user_id INTO v_parent_author
    FROM public.daily_quote_comments
    WHERE id = p_parent_comment_id
      AND quote_user_id = p_quote_user_id
      AND quote_record_date = p_quote_record_date;

    IF v_parent_author IS NULL THEN
      RAISE EXCEPTION 'Comment to reply to was not found';
    END IF;
  END IF;

  INSERT INTO public.daily_quote_comments (
    quote_user_id,
    quote_record_date,
    commenter_user_id,
    body,
    parent_comment_id,
    mentioned_user_ids
  )
  VALUES (
    p_quote_user_id,
    p_quote_record_date,
    p_commenter_user_id,
    v_body,
    p_parent_comment_id,
    COALESCE(p_mentioned_user_ids, '{}')
  )
  RETURNING id INTO v_comment_id;

  SELECT display_name INTO v_commenter_name FROM public.profiles WHERE id = p_commenter_user_id;

  IF p_quote_user_id <> p_commenter_user_id THEN
    PERFORM public.notify_user(
      p_quote_user_id,
      p_commenter_user_id,
      'social',
      CASE WHEN p_parent_comment_id IS NULL THEN 'Quote comment' ELSE 'Quote reply' END,
      COALESCE(v_commenter_name, 'Someone') || CASE WHEN p_parent_comment_id IS NULL THEN ' commented on your quote.' ELSE ' replied under your quote.' END,
      'dashboard',
      jsonb_build_object(
        'quote_user_id', p_quote_user_id,
        'quote_record_date', p_quote_record_date,
        'comment_id', v_comment_id,
        'parent_comment_id', p_parent_comment_id
      )
    );
  END IF;

  IF v_parent_author IS NOT NULL AND v_parent_author NOT IN (p_commenter_user_id, p_quote_user_id) THEN
    PERFORM public.notify_user(
      v_parent_author,
      p_commenter_user_id,
      'social',
      'Quote reply',
      COALESCE(v_commenter_name, 'Someone') || ' replied to your quote comment.',
      'dashboard',
      jsonb_build_object(
        'quote_user_id', p_quote_user_id,
        'quote_record_date', p_quote_record_date,
        'comment_id', v_comment_id,
        'parent_comment_id', p_parent_comment_id
      )
    );
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT unnest(COALESCE(p_mentioned_user_ids, '{}'))
  LOOP
    IF v_recipient NOT IN (p_commenter_user_id, p_quote_user_id, COALESCE(v_parent_author, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
      PERFORM public.notify_user(
        v_recipient,
        p_commenter_user_id,
        'message_mention',
        'You were mentioned',
        COALESCE(v_commenter_name, 'Someone') || ' mentioned you in a quote comment.',
        'dashboard',
        jsonb_build_object(
          'quote_user_id', p_quote_user_id,
          'quote_record_date', p_quote_record_date,
          'comment_id', v_comment_id,
          'parent_comment_id', p_parent_comment_id
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'comment_id', v_comment_id);
END;
$$;

DROP FUNCTION IF EXISTS public.get_daily_quote_comments(uuid, date);

CREATE FUNCTION public.get_daily_quote_comments(
  p_quote_user_id uuid,
  p_quote_record_date date
)
RETURNS TABLE (
  id uuid,
  body text,
  created_at timestamptz,
  commenter_user_id uuid,
  parent_comment_id uuid,
  mentioned_user_ids uuid[],
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
    c.parent_comment_id,
    c.mentioned_user_ids,
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
  ORDER BY c.created_at ASC
  LIMIT 60;
$$;

REVOKE ALL ON FUNCTION public.comment_on_daily_quote(uuid, date, uuid, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comment_on_daily_quote(uuid, date, uuid, text, uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.get_daily_quote_comments(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quote_comments(uuid, date) TO authenticated;
