CREATE OR REPLACE FUNCTION public.notify_scripture_insight_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insight_author uuid;
  v_narrative_id uuid;
  v_verse_reference text;
  v_actor_name text;
  v_recipient uuid;
BEGIN
  SELECT insight.user_id, insight.narrative_id, insight.verse_reference
  INTO v_insight_author, v_narrative_id, v_verse_reference
  FROM public.scripture_verse_insights insight
  WHERE insight.id = new.insight_id;

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'A reader') INTO v_actor_name
  FROM public.profiles profile WHERE profile.id = new.user_id;

  FOR v_recipient IN
    SELECT DISTINCT recipient_id
    FROM (
      SELECT v_insight_author AS recipient_id
      UNION ALL SELECT new.mentioned_user_id
      UNION ALL SELECT unnest(coalesce(new.mentioned_user_ids, '{}'::uuid[]))
    ) recipients
    WHERE recipient_id IS NOT NULL AND recipient_id <> new.user_id
  LOOP
    INSERT INTO public.user_notifications (
      recipient_id, actor_id, notification_type, title, body, action_key, metadata
    ) VALUES (
      v_recipient,
      new.user_id,
      'scripture_insight_reply',
      'New scripture conversation',
      v_actor_name || ' replied or mentioned you on ' || v_verse_reference || '.',
      'narrative',
      jsonb_build_object(
        'insight_id', new.insight_id,
        'comment_id', new.id,
        'narrative_id', v_narrative_id,
        'verse_reference', v_verse_reference
      )
    );
  END LOOP;
  RETURN new;
END;
$$;

UPDATE public.user_notifications notification
SET metadata = coalesce(notification.metadata, '{}'::jsonb) || jsonb_build_object(
  'narrative_id', insight.narrative_id,
  'verse_reference', insight.verse_reference
)
FROM public.scripture_verse_insights insight
WHERE notification.notification_type IN ('scripture_insight_mention', 'scripture_insight_reply')
  AND notification.metadata ->> 'insight_id' = insight.id::text
  AND (
    notification.metadata ->> 'narrative_id' IS NULL
    OR notification.metadata ->> 'verse_reference' IS NULL
  );
