/*
  Keep award cadence and recommendations authoritative:
  - Nuncio is monthly; Angelos remains its weekly equivalent.
  - Orator measures all reactions and comments received on quotes and insights.
  - Instructors can inspect the current month's Nuncio standings directly.
*/

DROP FUNCTION IF EXISTS public.get_weekly_award_metrics(date);

CREATE FUNCTION public.get_weekly_award_metrics(
  p_week_start date DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  total_figs bigint,
  quote_reactions bigint,
  quote_comments bigint,
  insight_reactions bigint,
  insight_comments bigint,
  rhetoric_score bigint,
  insight_likes bigint,
  public_meditations bigint,
  external_shares bigint,
  messenger_score bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_week_start date := coalesce(
    p_week_start,
    timezone('Africa/Douala', statement_timestamp())::date
      - (extract(isodow FROM timezone('Africa/Douala', statement_timestamp()))::integer - 1)
  );
  v_start_at timestamptz;
  v_end_at timestamptz;
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view award metrics.';
  END IF;

  v_start_at := v_week_start::timestamp AT TIME ZONE 'Africa/Douala';
  v_end_at := (v_week_start + 7)::timestamp AT TIME ZONE 'Africa/Douala';

  RETURN QUERY
  WITH fig_events AS (
    SELECT attempt.user_id, coalesce(attempt.score, 0)::bigint AS figs
    FROM public.game_attempts attempt
    WHERE attempt.completed_at >= v_start_at AND attempt.completed_at < v_end_at
      AND attempt.status IN ('passed', 'failed')
    UNION ALL
    SELECT participant.user_id, coalesce(participant.score, 0)::bigint
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.finished_at >= v_start_at AND participant.finished_at < v_end_at
      AND room.status = 'completed'
    UNION ALL
    SELECT attempt.user_id, coalesce(attempt.talents_scored, 0)::bigint
    FROM public.quiz_attempts attempt
    WHERE attempt.submitted_at >= v_start_at AND attempt.submitted_at < v_end_at
      AND attempt.status IN ('submitted', 'timed_out')
    UNION ALL
    SELECT entry.user_id, coalesce(entry.figs, 0)::bigint
    FROM public.story_mode_fig_entries entry
    WHERE entry.earned_at >= v_start_at AND entry.earned_at < v_end_at
  ), figs AS (
    SELECT event.user_id, sum(event.figs)::bigint AS total
    FROM fig_events event
    GROUP BY event.user_id
  ), quote_reaction_totals AS (
    SELECT reaction.quote_user_id AS user_id, count(*)::bigint AS total
    FROM public.daily_quote_reactions reaction
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    GROUP BY reaction.quote_user_id
  ), quote_comment_totals AS (
    SELECT comment.quote_user_id AS user_id, count(*)::bigint AS total
    FROM public.daily_quote_comments comment
    WHERE comment.created_at >= v_start_at AND comment.created_at < v_end_at
    GROUP BY comment.quote_user_id
  ), insight_reaction_events AS (
    SELECT insight.user_id
    FROM public.scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    UNION ALL
    SELECT insight.user_id
    FROM public.public_scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
  ), insight_reaction_totals AS (
    SELECT event.user_id, count(*)::bigint AS total
    FROM insight_reaction_events event
    GROUP BY event.user_id
  ), insight_comment_totals AS (
    SELECT insight.user_id, count(*)::bigint AS total
    FROM public.scripture_insight_comments comment
    JOIN public.scripture_verse_insights insight ON insight.id = comment.insight_id
    WHERE comment.created_at >= v_start_at AND comment.created_at < v_end_at
    GROUP BY insight.user_id
  ), insight_like_events AS (
    SELECT insight.user_id
    FROM public.scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    UNION ALL
    SELECT insight.user_id
    FROM public.public_scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
  ), insight_like_totals AS (
    SELECT event.user_id, count(*)::bigint AS total
    FROM insight_like_events event
    GROUP BY event.user_id
  ), meditation_totals AS (
    SELECT record.user_id, count(*)::bigint AS total
    FROM public.daily_records record
    WHERE record.record_date >= v_week_start AND record.record_date < v_week_start + 7
      AND record.meditation_submitted = true
      AND record.meditation_public = true
    GROUP BY record.user_id
  ), share_totals AS (
    SELECT share.user_id, count(*)::bigint AS total
    FROM public.external_share_events share
    WHERE share.created_at >= v_start_at AND share.created_at < v_end_at
    GROUP BY share.user_id
  ), measured AS (
    SELECT
      profile.id AS user_id,
      profile.display_name,
      profile.avatar_url,
      coalesce(figs.total, 0)::bigint AS total_figs,
      coalesce(quote_reaction_totals.total, 0)::bigint AS quote_reactions,
      coalesce(quote_comment_totals.total, 0)::bigint AS quote_comments,
      coalesce(insight_reaction_totals.total, 0)::bigint AS insight_reactions,
      coalesce(insight_comment_totals.total, 0)::bigint AS insight_comments,
      coalesce(insight_like_totals.total, 0)::bigint AS insight_likes,
      coalesce(meditation_totals.total, 0)::bigint AS public_meditations,
      coalesce(share_totals.total, 0)::bigint AS external_shares
    FROM public.profiles profile
    LEFT JOIN figs ON figs.user_id = profile.id
    LEFT JOIN quote_reaction_totals ON quote_reaction_totals.user_id = profile.id
    LEFT JOIN quote_comment_totals ON quote_comment_totals.user_id = profile.id
    LEFT JOIN insight_reaction_totals ON insight_reaction_totals.user_id = profile.id
    LEFT JOIN insight_comment_totals ON insight_comment_totals.user_id = profile.id
    LEFT JOIN insight_like_totals ON insight_like_totals.user_id = profile.id
    LEFT JOIN meditation_totals ON meditation_totals.user_id = profile.id
    LEFT JOIN share_totals ON share_totals.user_id = profile.id
  )
  SELECT
    measured.user_id,
    measured.display_name,
    measured.avatar_url,
    measured.total_figs,
    measured.quote_reactions,
    measured.quote_comments,
    measured.insight_reactions,
    measured.insight_comments,
    (
      measured.quote_reactions
      + measured.quote_comments
      + measured.insight_reactions
      + measured.insight_comments
    )::bigint AS rhetoric_score,
    measured.insight_likes,
    measured.public_meditations,
    measured.external_shares,
    (measured.insight_likes + measured.public_meditations + measured.external_shares)::bigint AS messenger_score
  FROM measured
  WHERE measured.total_figs > 0
    OR measured.quote_reactions > 0
    OR measured.quote_comments > 0
    OR measured.insight_reactions > 0
    OR measured.insight_comments > 0
    OR measured.insight_likes > 0
    OR measured.public_meditations > 0
    OR measured.external_shares > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_award_metrics(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_award_metrics(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_monthly_messenger_award_metrics(
  p_month_start date DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  insight_likes bigint,
  public_meditations bigint,
  external_shares bigint,
  messenger_score bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc(
    'month',
    coalesce(p_month_start, timezone('Africa/Douala', statement_timestamp())::date)
  )::date;
  v_month_end date := (v_month_start + interval '1 month')::date;
  v_start_at timestamptz := v_month_start::timestamp AT TIME ZONE 'Africa/Douala';
  v_end_at timestamptz := v_month_end::timestamp AT TIME ZONE 'Africa/Douala';
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view award metrics.';
  END IF;

  RETURN QUERY
  WITH insight_like_events AS (
    SELECT insight.user_id
    FROM public.scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    UNION ALL
    SELECT insight.user_id
    FROM public.public_scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
  ), insight_like_totals AS (
    SELECT event.user_id, count(*)::bigint AS total
    FROM insight_like_events event
    GROUP BY event.user_id
  ), meditation_totals AS (
    SELECT record.user_id, count(*)::bigint AS total
    FROM public.daily_records record
    WHERE record.record_date >= v_month_start AND record.record_date < v_month_end
      AND record.meditation_submitted = true
      AND record.meditation_public = true
    GROUP BY record.user_id
  ), share_totals AS (
    SELECT share.user_id, count(*)::bigint AS total
    FROM public.external_share_events share
    WHERE share.created_at >= v_start_at AND share.created_at < v_end_at
    GROUP BY share.user_id
  ), measured AS (
    SELECT
      profile.id AS user_id,
      profile.display_name,
      profile.avatar_url,
      coalesce(insight_like_totals.total, 0)::bigint AS insight_likes,
      coalesce(meditation_totals.total, 0)::bigint AS public_meditations,
      coalesce(share_totals.total, 0)::bigint AS external_shares
    FROM public.profiles profile
    LEFT JOIN insight_like_totals ON insight_like_totals.user_id = profile.id
    LEFT JOIN meditation_totals ON meditation_totals.user_id = profile.id
    LEFT JOIN share_totals ON share_totals.user_id = profile.id
  )
  SELECT
    measured.user_id,
    measured.display_name,
    measured.avatar_url,
    measured.insight_likes,
    measured.public_meditations,
    measured.external_shares,
    (measured.insight_likes + measured.public_meditations + measured.external_shares)::bigint
  FROM measured
  WHERE measured.insight_likes > 0
    OR measured.public_meditations > 0
    OR measured.external_shares > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_monthly_messenger_award_metrics(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_messenger_award_metrics(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.give_award(
  p_user_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_award_type text DEFAULT 'individual',
  p_award_month text DEFAULT NULL,
  p_metric_value numeric DEFAULT NULL,
  p_target_type text DEFAULT 'cadet',
  p_target_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_cycle text := coalesce(nullif(p_award_month, ''), to_char(current_date, 'YYYY-MM'));
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can give awards';
  END IF;

  IF p_title = 'Messenger Award (Nuncio)' THEN
    IF v_cycle ~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      v_cycle := substr(v_cycle, 6, 7);
    ELSIF v_cycle !~ '^[0-9]{4}-[0-9]{2}$' THEN
      v_cycle := to_char(current_date, 'YYYY-MM');
    END IF;
  ELSIF p_title IN (
    'Rhetoric Award (Orator)', 'Angel Award (Angelos)', 'Rumor Award',
    'Scribe Award', 'The Sprout', 'Reputation Award', 'Tutorix',
    'Valley Champion', 'The Lord''s Secret'
  ) AND v_cycle !~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_cycle := 'week-' || to_char(current_date - (extract(isodow FROM current_date)::integer - 1), 'YYYY-MM-DD');
  END IF;

  INSERT INTO public.awards (
    user_id, title, description, award_type, award_month,
    metric_value, award_target_type, award_target_id
  ) VALUES (
    p_user_id, p_title, p_description, p_award_type, v_cycle,
    p_metric_value, p_target_type, coalesce(p_target_id, p_user_id)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.give_award(uuid, text, text, text, text, numeric, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.give_award(uuid, text, text, text, text, numeric, text, uuid)
  TO authenticated, service_role;

-- Reclassify the latest historical Nuncio for each recipient/month without
-- deleting older records or risking a collision with an existing monthly row.
WITH ranked_nuncio AS (
  SELECT
    award.id,
    substr(award.award_month, 6, 7) AS month_cycle,
    row_number() OVER (
      PARTITION BY
        coalesce(award.award_target_type, 'cadet'),
        coalesce(award.award_target_id, award.user_id),
        substr(award.award_month, 6, 7)
      ORDER BY award.created_at DESC, award.id DESC
    ) AS cycle_rank
  FROM public.awards award
  WHERE lower(btrim(award.title)) = 'messenger award (nuncio)'
    AND award.award_month ~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
)
UPDATE public.awards award
SET award_month = ranked.month_cycle
FROM ranked_nuncio ranked
WHERE award.id = ranked.id
  AND ranked.cycle_rank = 1
  AND NOT EXISTS (
    SELECT 1
    FROM public.awards existing
    WHERE existing.id <> award.id
      AND existing.award_month = ranked.month_cycle
      AND lower(btrim(existing.title)) = 'messenger award (nuncio)'
      AND coalesce(existing.award_target_type, 'cadet') = coalesce(award.award_target_type, 'cadet')
      AND coalesce(existing.award_target_id, existing.user_id) = coalesce(award.award_target_id, award.user_id)
  );
