/* Notify every active camp member tagged by display name in a message. */

CREATE OR REPLACE FUNCTION public.notify_text_message_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_body text := btrim(coalesce(v_row ->> 'body', ''));
  v_actor_id uuid;
  v_actor_name text;
  v_action_key text;
  v_context_label text;
  v_metadata jsonb;
  v_recipient record;
BEGIN
  IF v_body = '' OR strpos(v_body, '@') = 0 THEN
    RETURN NEW;
  END IF;

  v_actor_id := coalesce(
    nullif(v_row ->> 'sender_id', '')::uuid,
    nullif(v_row ->> 'commenter_user_id', '')::uuid,
    nullif(v_row ->> 'user_id', '')::uuid
  );

  IF v_actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'Someone')
  INTO v_actor_name
  FROM public.profiles profile
  WHERE profile.id = v_actor_id;

  CASE TG_TABLE_NAME
    WHEN 'tent_messages' THEN
      v_action_key := 'tent';
      v_context_label := 'a tent message';
    WHEN 'direct_messages' THEN
      v_action_key := 'tent';
      v_context_label := 'a direct message';
    WHEN 'arena_room_messages' THEN
      v_action_key := 'arena';
      v_context_label := 'Arena chat';
    WHEN 'quiz_waiting_messages' THEN
      v_action_key := 'quiz';
      v_context_label := 'quiz waiting-room chat';
    WHEN 'daily_quote_comments' THEN
      v_action_key := 'dashboard';
      v_context_label := 'a quote comment';
    WHEN 'daily_verse_comments' THEN
      v_action_key := 'dashboard';
      v_context_label := 'a verse comment';
    ELSE
      RETURN NEW;
  END CASE;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'source_table', TG_TABLE_NAME,
    'message_id', v_row ->> 'id',
    'tent_id', v_row ->> 'tent_id',
    'room_id', v_row ->> 'room_id',
    'quiz_session_id', v_row ->> 'quiz_session_id',
    'narrative_date', v_row ->> 'narrative_date',
    'quote_user_id', v_row ->> 'quote_user_id',
    'quote_record_date', v_row ->> 'quote_record_date'
  ));

  FOR v_recipient IN
    SELECT DISTINCT profile.id
    FROM public.profiles profile
    CROSS JOIN LATERAL (
      SELECT strpos(lower(v_body), '@' || lower(btrim(profile.display_name))) AS mention_position
    ) match
    WHERE profile.id <> v_actor_id
      AND nullif(btrim(profile.display_name), '') IS NOT NULL
      AND match.mention_position > 0
      AND (
        match.mention_position + char_length(btrim(profile.display_name)) >= char_length(v_body)
        OR substring(
          v_body
          FROM match.mention_position + char_length(btrim(profile.display_name)) + 1
          FOR 1
        ) !~ '[[:alnum:]_]'
      )
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        WHERE assignment.user_id = profile.id
          AND assignment.status IN ('active', 'approved')
      )
  LOOP
    PERFORM public.notify_user(
      v_recipient.id,
      v_actor_id,
      'message_mention',
      'You were mentioned',
      coalesce(v_actor_name, 'Someone') || ' mentioned you in ' || v_context_label || '.',
      v_action_key,
      v_metadata
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_text_message_mentions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_text_message_mentions() TO service_role;

DROP TRIGGER IF EXISTS trg_notify_tent_message_mentions ON public.tent_messages;
CREATE TRIGGER trg_notify_tent_message_mentions
AFTER INSERT ON public.tent_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_text_message_mentions();

DROP TRIGGER IF EXISTS trg_notify_direct_message_mentions ON public.direct_messages;
CREATE TRIGGER trg_notify_direct_message_mentions
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_text_message_mentions();

DROP TRIGGER IF EXISTS trg_notify_arena_message_mentions ON public.arena_room_messages;
CREATE TRIGGER trg_notify_arena_message_mentions
AFTER INSERT ON public.arena_room_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_text_message_mentions();

DROP TRIGGER IF EXISTS trg_notify_quiz_message_mentions ON public.quiz_waiting_messages;
CREATE TRIGGER trg_notify_quiz_message_mentions
AFTER INSERT ON public.quiz_waiting_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_text_message_mentions();

DROP TRIGGER IF EXISTS trg_notify_quote_comment_mentions ON public.daily_quote_comments;
CREATE TRIGGER trg_notify_quote_comment_mentions
AFTER INSERT ON public.daily_quote_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_text_message_mentions();

DROP TRIGGER IF EXISTS trg_notify_verse_comment_mentions ON public.daily_verse_comments;
CREATE TRIGGER trg_notify_verse_comment_mentions
AFTER INSERT ON public.daily_verse_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_text_message_mentions();
