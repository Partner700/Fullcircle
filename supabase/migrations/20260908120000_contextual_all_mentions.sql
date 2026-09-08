/*
  Add a context-safe @all mention.

  Public quote/verse discussions and the quiz room can notify the active camp;
  Arena messages notify only room participants. Tent group chat already sends
  one notification to every tent member, so @all changes its wording without
  producing a second notification. Direct conversations remain private.
*/

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
  v_mentions_all boolean;
  v_quote_user_id uuid;
  v_parent_author_id uuid;
  v_recipient record;
BEGIN
  IF v_body = '' OR strpos(v_body, '@') = 0 THEN
    RETURN NEW;
  END IF;

  v_mentions_all := v_body ~* '(^|[^[:alnum:]_])@all([^[:alnum:]_]|$)';
  v_actor_id := coalesce(
    nullif(v_row ->> 'sender_id', '')::uuid,
    nullif(v_row ->> 'commenter_user_id', '')::uuid,
    nullif(v_row ->> 'user_id', '')::uuid
  );
  IF v_actor_id IS NULL THEN RETURN NEW; END IF;

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

  v_quote_user_id := nullif(v_row ->> 'quote_user_id', '')::uuid;
  IF TG_TABLE_NAME = 'daily_quote_comments'
     AND nullif(v_row ->> 'parent_comment_id', '') IS NOT NULL
  THEN
    SELECT comment.commenter_user_id INTO v_parent_author_id
    FROM public.daily_quote_comments comment
    WHERE comment.id = (v_row ->> 'parent_comment_id')::uuid;
  END IF;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'source_table', TG_TABLE_NAME,
    'message_id', v_row ->> 'id',
    'tent_id', v_row ->> 'tent_id',
    'room_id', v_row ->> 'room_id',
    'quiz_session_id', v_row ->> 'quiz_session_id',
    'narrative_date', v_row ->> 'narrative_date',
    'quote_user_id', v_row ->> 'quote_user_id',
    'quote_record_date', v_row ->> 'quote_record_date',
    'mention_all', v_mentions_all
  ));

  FOR v_recipient IN
    SELECT DISTINCT mentioned.id
    FROM (
      -- Existing display-name mentions continue to work in every supported
      -- message context.
      SELECT profile.id
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
            AND assignment.status IN ('active', 'approved', 'promoted')
        )

      UNION ALL

      -- @all is limited to people who can actually open the shared context.
      SELECT profile.id
      FROM public.profiles profile
      WHERE v_mentions_all
        AND profile.id <> v_actor_id
        AND EXISTS (
          SELECT 1
          FROM public.role_assignments assignment
          WHERE assignment.user_id = profile.id
            AND assignment.status IN ('active', 'approved', 'promoted')
        )
        AND (
          TG_TABLE_NAME IN ('daily_quote_comments', 'daily_verse_comments', 'quiz_waiting_messages')
          OR (
            TG_TABLE_NAME = 'arena_room_messages'
            AND EXISTS (
              SELECT 1
              FROM public.arena_participants participant
              WHERE participant.room_id = nullif(v_row ->> 'room_id', '')::uuid
                AND participant.user_id = profile.id
            )
          )
        )
        -- Quote authors and replied-to authors receive the normal contextual
        -- notification from comment_on_daily_quote, so do not duplicate it.
        AND profile.id IS DISTINCT FROM v_quote_user_id
        AND profile.id IS DISTINCT FROM v_parent_author_id
    ) mentioned
  LOOP
    PERFORM public.notify_user(
      v_recipient.id,
      v_actor_id,
      'message_mention',
      CASE WHEN v_mentions_all THEN 'Everyone was mentioned' ELSE 'You were mentioned' END,
      coalesce(v_actor_name, 'Someone')
        || CASE WHEN v_mentions_all THEN ' mentioned everyone in ' ELSE ' mentioned you in ' END
        || v_context_label || '.',
      v_action_key,
      v_metadata
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_text_message_mentions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_text_message_mentions() TO service_role;

CREATE OR REPLACE FUNCTION public.notify_tent_group_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient uuid;
  sender_name text;
  tent_name text;
  mentions_all boolean := NEW.body ~* '(^|[^[:alnum:]_])@all([^[:alnum:]_]|$)';
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO tent_name FROM public.tents WHERE id = NEW.tent_id;

  FOR recipient IN
    SELECT DISTINCT member.user_id
    FROM public.tent_members member
    WHERE member.tent_id = NEW.tent_id
      AND member.user_id IS DISTINCT FROM NEW.sender_id
  LOOP
    PERFORM public.notify_user(
      recipient,
      NEW.sender_id,
      'message',
      CASE WHEN mentions_all THEN '@all in ' || coalesce(tent_name, 'Tent chat') ELSE coalesce(tent_name, 'Tent chat') END,
      coalesce(sender_name, 'A tent member')
        || CASE WHEN mentions_all THEN ' mentioned everyone in the tent chat.' ELSE ' sent a message in the tent chat.' END,
      'tent',
      jsonb_build_object(
        'tent_id', NEW.tent_id,
        'group_message_id', NEW.id,
        'message_preview', left(NEW.body, 120),
        'mention_all', mentions_all
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_tent_group_message_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_tent_group_message_insert() TO service_role;

