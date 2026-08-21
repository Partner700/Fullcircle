-- Let authors correct their own text without granting edit access to anyone else.

ALTER TABLE public.daily_quote_comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.daily_verse_comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.scripture_verse_insights ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.scripture_insight_comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.tent_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.tent_group_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.edit_daily_quote_comment(p_comment_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Comment must be between 1 and 500 characters'; END IF;
  UPDATE public.daily_quote_comments SET body = btrim(p_body), edited_at = now()
  WHERE id = p_comment_id AND commenter_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own comment.'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.edit_daily_verse_comment(p_comment_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Comment must be between 1 and 500 characters'; END IF;
  UPDATE public.daily_verse_comments SET body = btrim(p_body), edited_at = now()
  WHERE id = p_comment_id AND commenter_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own comment.'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.edit_scripture_verse_insight(p_insight_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'Insight must be between 1 and 3000 characters'; END IF;
  UPDATE public.scripture_verse_insights SET body = btrim(p_body), edited_at = now(), updated_at = now()
  WHERE id = p_insight_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own insight.'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.edit_scripture_insight_comment(p_comment_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'Reply must be between 1 and 1200 characters'; END IF;
  UPDATE public.scripture_insight_comments SET body = btrim(p_body), edited_at = now()
  WHERE id = p_comment_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own reply.'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.edit_tent_message(p_message_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Message must be between 1 and 2000 characters'; END IF;
  UPDATE public.tent_messages SET body = btrim(p_body), edited_at = now()
  WHERE id = p_message_id AND sender_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own message.'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.edit_tent_group_message(p_message_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Message must be between 1 and 1000 characters'; END IF;
  UPDATE public.tent_group_messages SET body = btrim(p_body), edited_at = now()
  WHERE id = p_message_id AND sender_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own message.'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.edit_direct_message(p_message_id uuid, p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Message must be between 1 and 2000 characters'; END IF;
  UPDATE public.direct_messages SET body = btrim(p_body), edited_at = now()
  WHERE id = p_message_id AND sender_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only edit your own message.'; END IF;
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.edit_daily_quote_comment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_daily_verse_comment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_scripture_verse_insight(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_scripture_insight_comment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_tent_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_tent_group_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_direct_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_daily_quote_comment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_daily_verse_comment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_scripture_verse_insight(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_scripture_insight_comment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_tent_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_tent_group_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_direct_message(uuid, text) TO authenticated;
