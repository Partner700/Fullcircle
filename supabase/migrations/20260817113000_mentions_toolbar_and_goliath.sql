/* Camp-wide scripture mentions, resilient toolbar counters, and relic pricing. */

ALTER TABLE public.scripture_verse_insights
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.scripture_insight_comments
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE OR REPLACE FUNCTION public.get_camp_mention_candidates()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    profile.id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Camp member'),
    profile.avatar_url,
    coalesce(active_role.role, 'cadet')
  FROM public.profiles profile
  LEFT JOIN LATERAL (
    SELECT assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.user_id = profile.id
      AND assignment.status IN ('active', 'approved')
    ORDER BY CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END
    LIMIT 1
  ) active_role ON true
  WHERE active_role.role IS NOT NULL
  ORDER BY lower(coalesce(nullif(btrim(profile.display_name), ''), 'Camp member'));
$$;

REVOKE ALL ON FUNCTION public.get_camp_mention_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_camp_mention_candidates() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_scripture_verse_insight_secure(
  p_narrative_id uuid,
  p_verse_reference text,
  p_body text,
  p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_insight_id uuid;
  v_previous_mentions uuid[] := '{}'::uuid[];
  v_mentions uuid[];
  v_recipient uuid;
  v_actor_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF nullif(btrim(coalesce(p_body, '')), '') IS NULL THEN RAISE EXCEPTION 'Insight text is required.'; END IF;
  IF char_length(btrim(p_body)) > 3000 THEN RAISE EXCEPTION 'Insight is too long.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives narrative WHERE narrative.id = p_narrative_id) THEN
    RAISE EXCEPTION 'Reading not found.';
  END IF;

  SELECT insight.id, insight.mentioned_user_ids
  INTO v_insight_id, v_previous_mentions
  FROM public.scripture_verse_insights insight
  WHERE insight.narrative_id = p_narrative_id
    AND insight.user_id = v_user_id
    AND insight.verse_reference = btrim(p_verse_reference)
  FOR UPDATE;

  SELECT coalesce(array_agg(DISTINCT candidate.id), '{}'::uuid[])
  INTO v_mentions
  FROM public.profiles candidate
  WHERE candidate.id = ANY(coalesce(p_mentioned_user_ids, '{}'::uuid[]))
    AND candidate.id <> v_user_id;

  INSERT INTO public.scripture_verse_insights (
    narrative_id, user_id, verse_reference, body, mentioned_user_ids, updated_at
  ) VALUES (
    p_narrative_id, v_user_id, btrim(p_verse_reference), btrim(p_body), v_mentions, now()
  )
  ON CONFLICT (narrative_id, user_id, verse_reference) DO UPDATE
  SET body = excluded.body,
      mentioned_user_ids = excluded.mentioned_user_ids,
      updated_at = now()
  RETURNING id INTO v_insight_id;

  SELECT coalesce(nullif(btrim(profile.display_name), ''), 'A reader')
  INTO v_actor_name FROM public.profiles profile WHERE profile.id = v_user_id;

  FOR v_recipient IN
    SELECT unnest(v_mentions)
    EXCEPT
    SELECT unnest(coalesce(v_previous_mentions, '{}'::uuid[]))
  LOOP
    INSERT INTO public.user_notifications (
      recipient_id, actor_id, notification_type, title, body, action_key, metadata
    ) VALUES (
      v_recipient,
      v_user_id,
      'scripture_insight_mention',
      'You were mentioned in Today''s Reading',
      v_actor_name || ' mentioned you in an insight on ' || btrim(p_verse_reference) || '.',
      'narrative',
      jsonb_build_object('insight_id', v_insight_id, 'narrative_id', p_narrative_id, 'verse_reference', btrim(p_verse_reference))
    );
  END LOOP;

  RETURN v_insight_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_scripture_verse_insight_secure(uuid, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_scripture_verse_insight_secure(uuid, text, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_scripture_insight_comment_secure(
  p_insight_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_parent_comment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_comment_id uuid;
  v_mentions uuid[];
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF nullif(btrim(coalesce(p_body, '')), '') IS NULL THEN RAISE EXCEPTION 'Reply text is required.'; END IF;
  IF char_length(btrim(p_body)) > 1200 THEN RAISE EXCEPTION 'Reply is too long.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scripture_verse_insights insight WHERE insight.id = p_insight_id) THEN
    RAISE EXCEPTION 'Insight not found.';
  END IF;
  IF p_parent_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.scripture_insight_comments comment
    WHERE comment.id = p_parent_comment_id AND comment.insight_id = p_insight_id
  ) THEN RAISE EXCEPTION 'Reply target not found.'; END IF;

  SELECT coalesce(array_agg(DISTINCT candidate.id), '{}'::uuid[])
  INTO v_mentions
  FROM public.profiles candidate
  WHERE candidate.id = ANY(coalesce(p_mentioned_user_ids, '{}'::uuid[]))
    AND candidate.id <> v_user_id;

  INSERT INTO public.scripture_insight_comments (
    insight_id, user_id, mentioned_user_id, mentioned_user_ids, parent_comment_id, body
  ) VALUES (
    p_insight_id, v_user_id, v_mentions[1], v_mentions, p_parent_comment_id, btrim(p_body)
  ) RETURNING id INTO v_comment_id;
  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_scripture_insight_comment_secure(uuid, text, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_scripture_insight_comment_secure(uuid, text, uuid[], uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_scripture_insight_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insight_author uuid;
  v_actor_name text;
  v_recipient uuid;
BEGIN
  SELECT insight.user_id INTO v_insight_author
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
      v_actor_name || ' replied or mentioned you in Today''s Reading.',
      'narrative',
      jsonb_build_object('insight_id', new.insight_id, 'comment_id', new.id)
    );
  END LOOP;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_toolbar_stats_v6()
RETURNS TABLE (
  user_id uuid,
  total_denarii bigint,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_denarii bigint := 0;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
  v_streak record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT coalesce(sum(entry.amount), 0)::bigint INTO v_denarii
  FROM public.denarii_ledger_entries entry WHERE entry.user_id = v_user_id;

  BEGIN
    SELECT * INTO v_streak FROM public.get_authoritative_streak(v_user_id) LIMIT 1;
    v_current := coalesce(v_streak.current_streak, 0);
    v_longest := coalesce(v_streak.longest_streak, 0);
    v_consecutive := coalesce(v_streak.consecutive_inactive, 0);
    v_cumulative := coalesce(v_streak.cumulative_inactive, 0);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      SELECT * INTO v_streak FROM public.compute_strict_streak(v_user_id) LIMIT 1;
      v_current := coalesce(v_streak.current_streak, 0);
      v_longest := coalesce(v_streak.longest_streak, 0);
      v_consecutive := coalesce(v_streak.consecutive_inactive, 0);
      v_cumulative := coalesce(v_streak.cumulative_inactive, 0);
    EXCEPTION WHEN OTHERS THEN
      SELECT
        coalesce(snapshot.current_streak, 0),
        coalesce(snapshot.longest_streak, 0),
        coalesce(snapshot.consecutive_inactive, 0),
        coalesce(snapshot.cumulative_inactive, 0)
      INTO v_current, v_longest, v_consecutive, v_cumulative
      FROM public.streakboard_snapshots snapshot
      WHERE snapshot.user_id = v_user_id
      ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
      LIMIT 1;
    END;
  END;

  RETURN QUERY SELECT v_user_id, v_denarii, coalesce(v_current, 0), coalesce(v_longest, 0),
    coalesce(v_consecutive, 0), coalesce(v_cumulative, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_toolbar_stats_v6() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toolbar_stats_v6() TO authenticated, service_role;

UPDATE public.relic_types
SET denarii_cost = 3000
WHERE slug = 'sword-goliath';
