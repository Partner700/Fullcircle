/*
  Publish weekly quiz positions with the results, record successful outbound
  shares, and expose one authoritative weekly activity summary for awards.
*/

CREATE TABLE IF NOT EXISTS public.external_share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  share_kind text NOT NULL CHECK (share_kind IN ('reading', 'quiz', 'game', 'meditation')),
  reference_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_share_events_user_created_idx
  ON public.external_share_events(user_id, created_at DESC);

ALTER TABLE public.external_share_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.external_share_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.external_share_events TO service_role;

CREATE OR REPLACE FUNCTION public.record_external_share(
  p_share_kind text,
  p_reference_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_share_kind NOT IN ('reading', 'quiz', 'game', 'meditation') THEN
    RAISE EXCEPTION 'Unsupported share type.';
  END IF;
  IF nullif(btrim(coalesce(p_reference_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A share reference is required.';
  END IF;

  INSERT INTO public.external_share_events(user_id, share_kind, reference_key)
  VALUES (v_user_id, p_share_kind, left(btrim(p_reference_key), 200))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_external_share(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_external_share(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_latest_weekly_quiz_rankings(
  p_quiz_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  quiz_session_id uuid,
  quiz_title text,
  session_date date,
  user_id uuid,
  display_name text,
  avatar_url text,
  correct_count integer,
  question_count integer,
  figs_earned integer,
  denarii_award integer,
  answered_at timestamptz,
  placement integer,
  ranking_released_at timestamptz,
  slide_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_ranking_release timestamptz;
  v_slide_expiry timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.quiz_sessions session
  WHERE coalesce(session.quiz_type, 'saturday') = 'saturday'
    AND (p_quiz_session_id IS NULL OR session.id = p_quiz_session_id)
    AND EXISTS (
      SELECT 1
      FROM public.weekly_quiz_result_releases pending
      WHERE pending.quiz_session_id = session.id
        AND pending.release_at <= statement_timestamp()
    )
  ORDER BY session.session_date DESC, session.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT min(pending.release_at)
  INTO v_ranking_release
  FROM public.weekly_quiz_result_releases pending
  WHERE pending.quiz_session_id = v_session.id;
  v_slide_expiry := v_ranking_release + interval '24 hours';

  IF p_quiz_session_id IS NULL AND statement_timestamp() >= v_slide_expiry THEN
    RETURN;
  END IF;

  -- Viewing released results also settles any due attempts that cron has not
  -- processed yet, keeping the result sheet and positions synchronized.
  PERFORM public.release_due_weekly_quiz_results(NULL);

  RETURN QUERY
  WITH scored AS (
    SELECT
      attempt.id AS attempt_id,
      attempt.user_id,
      profile.display_name,
      profile.avatar_url,
      release.correct_count,
      release.question_count,
      release.figs_earned,
      release.denarii_award,
      attempt.submitted_at AS answered_at
    FROM public.quiz_attempts attempt
    JOIN public.weekly_quiz_result_releases release
      ON release.attempt_id = attempt.id
      AND release.released_at IS NOT NULL
    JOIN public.profiles profile ON profile.id = attempt.user_id
    WHERE attempt.quiz_session_id = v_session.id
      AND attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.question_responses response
        WHERE response.quiz_attempt_id = attempt.id
      )
  ), ranked AS (
    SELECT scored.*,
      row_number() OVER (
        ORDER BY scored.correct_count DESC, scored.figs_earned DESC,
          scored.answered_at ASC, scored.user_id ASC
      )::integer AS placement
    FROM scored
  )
  SELECT
    v_session.id,
    v_session.title,
    v_session.session_date,
    ranked.user_id,
    coalesce(nullif(btrim(ranked.display_name), ''), 'Full Circle member'),
    ranked.avatar_url,
    ranked.correct_count,
    ranked.question_count,
    ranked.figs_earned,
    ranked.denarii_award,
    ranked.answered_at,
    ranked.placement,
    v_ranking_release,
    v_slide_expiry
  FROM ranked
  ORDER BY ranked.placement;
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_weekly_quiz_rankings(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_weekly_award_metrics(
  p_week_start date DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  total_figs bigint,
  quote_reactions bigint,
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
    FROM fig_events event GROUP BY event.user_id
  ), quote_totals AS (
    SELECT reaction.quote_user_id AS user_id, count(*)::bigint AS total
    FROM public.daily_quote_reactions reaction
    WHERE reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    GROUP BY reaction.quote_user_id
  ), insight_like_events AS (
    SELECT insight.user_id, reaction.id
    FROM public.scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
    UNION ALL
    SELECT insight.user_id, reaction.id
    FROM public.public_scripture_insight_reactions reaction
    JOIN public.scripture_verse_insights insight ON insight.id = reaction.insight_id
    WHERE reaction.reaction_type = 'heart'
      AND reaction.created_at >= v_start_at AND reaction.created_at < v_end_at
  ), insight_totals AS (
    SELECT event.user_id, count(*)::bigint AS total
    FROM insight_like_events event GROUP BY event.user_id
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
      coalesce(quote_totals.total, 0)::bigint AS quote_reactions,
      coalesce(insight_totals.total, 0)::bigint AS insight_likes,
      coalesce(meditation_totals.total, 0)::bigint AS public_meditations,
      coalesce(share_totals.total, 0)::bigint AS external_shares
    FROM public.profiles profile
    LEFT JOIN figs ON figs.user_id = profile.id
    LEFT JOIN quote_totals ON quote_totals.user_id = profile.id
    LEFT JOIN insight_totals ON insight_totals.user_id = profile.id
    LEFT JOIN meditation_totals ON meditation_totals.user_id = profile.id
    LEFT JOIN share_totals ON share_totals.user_id = profile.id
  )
  SELECT
    measured.user_id,
    measured.display_name,
    measured.avatar_url,
    measured.total_figs,
    measured.quote_reactions,
    measured.insight_likes,
    measured.public_meditations,
    measured.external_shares,
    (measured.insight_likes + measured.public_meditations + measured.external_shares)::bigint
  FROM measured
  WHERE measured.total_figs > 0 OR measured.quote_reactions > 0
    OR measured.insight_likes > 0 OR measured.public_meditations > 0
    OR measured.external_shares > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_award_metrics(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_award_metrics(date) TO authenticated, service_role;

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

  IF p_title IN (
    'Rhetoric Award (Orator)', 'Messenger Award (Nuncio)', 'Angel Award (Angelos)',
    'Rumor Award', 'Scribe Award', 'The Sprout', 'Reputation Award', 'Tutorix',
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
