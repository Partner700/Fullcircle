/* Server-owned challenge-board movement.

   Movement must be identical on every phone. The previous implementation kept
   its baseline in localStorage, so a new device always compared today's value
   with itself and reported Rising 0 / Falling 0 / Records 0. */

CREATE TABLE IF NOT EXISTS public.challenge_board_daily_snapshots (
  board_key text NOT NULL,
  audience text NOT NULL,
  subject_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  opening_value numeric NOT NULL DEFAULT 0,
  opening_rank integer,
  current_value numeric NOT NULL DEFAULT 0,
  current_rank integer,
  record_value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_key, audience, subject_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS challenge_board_daily_snapshots_lookup_idx
  ON public.challenge_board_daily_snapshots (board_key, audience, subject_id, snapshot_date DESC);

ALTER TABLE public.challenge_board_daily_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.challenge_board_daily_snapshots FROM PUBLIC, anon, authenticated;

/* Establish a real start-of-day baseline from existing authoritative events.
   This lets movement appear immediately after deployment instead of waiting
   for every device to observe a second day. */
WITH clock AS (
  SELECT
    timezone('Africa/Douala', now())::date AS today,
    timezone('Africa/Douala', now())::date - 1 AS baseline_date
),
people AS (
  SELECT DISTINCT ON (assignment.user_id, assignment.role)
    assignment.user_id,
    assignment.role,
    profile.display_name
  FROM public.role_assignments assignment
  JOIN public.profiles profile ON profile.id = assignment.user_id
  WHERE assignment.role IN ('cadet', 'sentry', 'instructor')
    AND assignment.status IN ('active', 'approved')
  ORDER BY assignment.user_id, assignment.role, assignment.created_at DESC NULLS LAST
),
denarii AS (
  SELECT
    person.user_id,
    COALESCE(SUM(entry.amount) FILTER (
      WHERE entry.created_at < (clock.today::timestamp AT TIME ZONE 'Africa/Douala')
    ), 0)::numeric AS value
  FROM people person
  CROSS JOIN clock
  LEFT JOIN public.denarii_ledger_entries entry ON entry.user_id = person.user_id
  GROUP BY person.user_id
),
fig_events AS (
  SELECT attempt.user_id, SUM(attempt.score)::numeric AS value
  FROM public.game_attempts attempt
  CROSS JOIN clock
  WHERE attempt.completed_at IS NOT NULL
    AND attempt.status IN ('passed', 'failed')
    AND (attempt.completed_at AT TIME ZONE 'Africa/Douala')::date
      >= clock.today - ((EXTRACT(DOW FROM clock.today)::integer - 6 + 7) % 7)
    AND (attempt.completed_at AT TIME ZONE 'Africa/Douala')::date < clock.today
  GROUP BY attempt.user_id

  UNION ALL

  SELECT participant.user_id, SUM(participant.score)::numeric AS value
  FROM public.arena_participants participant
  JOIN public.arena_rooms room ON room.id = participant.room_id
  CROSS JOIN clock
  WHERE participant.finished_at IS NOT NULL
    AND room.status = 'completed'
    AND (participant.finished_at AT TIME ZONE 'Africa/Douala')::date
      >= clock.today - ((EXTRACT(DOW FROM clock.today)::integer - 6 + 7) % 7)
    AND (participant.finished_at AT TIME ZONE 'Africa/Douala')::date < clock.today
  GROUP BY participant.user_id

  UNION ALL

  SELECT attempt.user_id,
    SUM(CASE
      WHEN question.difficulty_tag = 'hard' THEN 5
      WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
      ELSE 1
    END)::numeric AS value
  FROM public.quiz_attempts attempt
  JOIN public.question_responses response ON response.quiz_attempt_id = attempt.id
  JOIN public.generated_questions question ON question.id = response.question_id
  CROSS JOIN clock
  WHERE attempt.status IN ('submitted', 'timed_out')
    AND attempt.submitted_at IS NOT NULL
    AND response.answer = question.question_payload->'correct_answer'
    AND (attempt.submitted_at AT TIME ZONE 'Africa/Douala')::date
      >= clock.today - ((EXTRACT(DOW FROM clock.today)::integer - 6 + 7) % 7)
    AND (attempt.submitted_at AT TIME ZONE 'Africa/Douala')::date < clock.today
  GROUP BY attempt.user_id
),
figs AS (
  SELECT person.user_id, COALESCE(SUM(event.value), 0)::numeric AS value
  FROM people person
  LEFT JOIN fig_events event ON event.user_id = person.user_id
  GROUP BY person.user_id
),
streaks AS (
  SELECT
    person.user_id,
    COALESCE((
      SELECT snapshot.current_streak
      FROM public.streakboard_snapshots snapshot
      CROSS JOIN clock
      WHERE snapshot.user_id = person.user_id
        AND snapshot.snapshot_date <= clock.baseline_date
      ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC NULLS LAST
      LIMIT 1
    ), 0)::numeric AS value
  FROM people person
),
rhudes AS (
  SELECT
    person.user_id,
    COUNT(room.id) FILTER (
      WHERE room.status = 'completed'
        AND room.completed_at < (clock.today::timestamp AT TIME ZONE 'Africa/Douala')
    )::numeric AS value
  FROM people person
  CROSS JOIN clock
  LEFT JOIN public.arena_rooms room ON room.winner_id = person.user_id
  GROUP BY person.user_id
),
person_metrics AS (
  SELECT
    person.user_id,
    person.role,
    person.display_name,
    COALESCE(denarii.value, 0)::numeric AS denarii,
    COALESCE(figs.value, 0)::numeric AS figs,
    COALESCE(streaks.value, 0)::numeric AS streak,
    COALESCE(rhudes.value, 0)::numeric AS rhudes,
    (
      COALESCE(denarii.value, 0)
      + COALESCE(figs.value, 0) * 100
      + COALESCE(streaks.value, 0) * 1000
      + COALESCE(rhudes.value, 0) * 5000
    )::numeric AS marks
  FROM people person
  LEFT JOIN denarii ON denarii.user_id = person.user_id
  LEFT JOIN figs ON figs.user_id = person.user_id
  LEFT JOIN streaks ON streaks.user_id = person.user_id
  LEFT JOIN rhudes ON rhudes.user_id = person.user_id
),
person_rows AS (
  SELECT 'denarii'::text AS board_key, metric.role AS audience, metric.user_id AS subject_id, metric.denarii AS value, metric.display_name
  FROM person_metrics metric WHERE metric.role IN ('cadet', 'sentry')
  UNION ALL
  SELECT 'figs', metric.role, metric.user_id, metric.figs, metric.display_name
  FROM person_metrics metric WHERE metric.role IN ('cadet', 'sentry')
  UNION ALL
  SELECT 'streak', metric.role, metric.user_id, metric.streak, metric.display_name
  FROM person_metrics metric WHERE metric.role IN ('cadet', 'sentry')
  UNION ALL
  SELECT 'rhude', metric.role, metric.user_id, metric.rhudes, metric.display_name
  FROM person_metrics metric WHERE metric.role IN ('cadet', 'sentry')
  UNION ALL
  SELECT 'marks', metric.role, metric.user_id, metric.marks, metric.display_name
  FROM person_metrics metric WHERE metric.role IN ('cadet', 'sentry')
),
tent_rows AS (
  SELECT
    'tent'::text AS board_key,
    'all'::text AS audience,
    tent.id AS subject_id,
    COALESCE(SUM(
      metric.denarii + metric.figs * 100 + metric.streak * 1000
    ) FILTER (WHERE member.role = 'cadet'), 0)::numeric AS value,
    tent.name AS display_name
  FROM public.tents tent
  LEFT JOIN public.tent_members member ON member.tent_id = tent.id
  LEFT JOIN person_metrics metric ON metric.user_id = member.user_id AND metric.role = 'cadet'
  GROUP BY tent.id, tent.name
),
instructor_rows AS (
  SELECT
    'instructor'::text AS board_key,
    'instructor'::text AS audience,
    person.user_id AS subject_id,
    (SELECT COUNT(*)::numeric FROM public.daily_narratives narrative CROSS JOIN clock
      WHERE narrative.created_at < (clock.today::timestamp AT TIME ZONE 'Africa/Douala')) AS value,
    person.display_name
  FROM people person
  WHERE person.role = 'instructor'
),
all_rows AS (
  SELECT * FROM person_rows
  UNION ALL SELECT * FROM tent_rows
  UNION ALL SELECT * FROM instructor_rows
),
ranked AS (
  SELECT
    row.board_key,
    row.audience,
    row.subject_id,
    row.value,
    RANK() OVER (
      PARTITION BY row.board_key, row.audience
      ORDER BY row.value DESC, row.display_name ASC
    )::integer AS rank
  FROM all_rows row
)
INSERT INTO public.challenge_board_daily_snapshots (
  board_key, audience, subject_id, snapshot_date,
  opening_value, opening_rank, current_value, current_rank, record_value
)
SELECT
  ranked.board_key,
  ranked.audience,
  ranked.subject_id,
  clock.baseline_date,
  ranked.value,
  ranked.rank,
  ranked.value,
  ranked.rank,
  ranked.value
FROM ranked
CROSS JOIN clock
ON CONFLICT (board_key, audience, subject_id, snapshot_date) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_competitive_current_rows(p_audience text)
RETURNS TABLE (
  board_key text,
  audience text,
  subject_id uuid,
  row_data jsonb,
  current_value numeric,
  current_rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_audience = 'instructor' THEN
    RETURN QUERY
    SELECT
      'instructor'::text,
      'instructor'::text,
      row.user_id,
      to_jsonb(row),
      row.narratives::numeric,
      row.rank::integer
    FROM public.get_instructor_challenge_board_live() row;
    RETURN;
  END IF;

  IF p_audience NOT IN ('cadet', 'sentry') THEN
    RAISE EXCEPTION 'Unknown challenge-board audience.';
  END IF;

  RETURN QUERY
  WITH board_values AS (
    SELECT
      'streak'::text AS board_key,
      p_audience AS audience,
      row.user_id AS subject_id,
      to_jsonb(row) || jsonb_build_object(
        'current_streak', GREATEST(row.current_streak, COALESCE(public_streak.current_streak, 0)),
        'longest_streak', GREATEST(row.longest_streak, row.current_streak, COALESCE(public_streak.current_streak, 0))
      ) AS row_data,
      GREATEST(row.current_streak, COALESCE(public_streak.current_streak, 0))::numeric AS current_value,
      COALESCE(row.profiles->>'display_name', row.user_id::text) AS sort_name
    FROM public.get_streakboard_live_for_role(p_audience) row
    LEFT JOIN LATERAL public.get_public_quote_streak(row.user_id) public_streak ON true

    UNION ALL

    SELECT 'denarii', p_audience, row.user_id, to_jsonb(row), row.total_denarii::numeric, row.display_name
    FROM public.get_leaderboard_live_for_role(p_audience) row

    UNION ALL

    SELECT 'figs', p_audience, row.user_id, to_jsonb(row), row.total_score::numeric, row.display_name
    FROM public.get_quiz_scoreboard_for_role(p_audience) row

    UNION ALL

    SELECT 'rhude', p_audience, row.user_id, to_jsonb(row), row.rhudes::numeric, row.display_name
    FROM public.get_rhude_board_live() row
    WHERE row.role = p_audience

    UNION ALL

    SELECT 'marks', p_audience, row.user_id, to_jsonb(row), row.marks::numeric, row.display_name
    FROM public.get_marks_board_live() row
    WHERE row.role = p_audience

    UNION ALL

    SELECT 'tent', 'all', row.tent_id, to_jsonb(row), row.combined_score::numeric, row.tent_name
    FROM public.get_tent_leaderboard() row
  )
  SELECT
    board_value.board_key,
    board_value.audience,
    board_value.subject_id,
    board_value.row_data,
    board_value.current_value,
    RANK() OVER (
      PARTITION BY board_value.board_key, board_value.audience
      ORDER BY board_value.current_value DESC, board_value.sort_name ASC
    )::integer
  FROM board_values board_value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_competitive_current_rows(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_competitive_board_movements(p_audience text)
RETURNS TABLE (
  board_key text,
  subject_id uuid,
  row_data jsonb,
  current_value numeric,
  current_rank integer,
  previous_value numeric,
  previous_rank integer,
  movement integer,
  is_new_record boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_audience NOT IN ('cadet', 'sentry', 'instructor') THEN
    RAISE EXCEPTION 'Unknown challenge-board audience.';
  END IF;

  RETURN QUERY
  WITH current_rows AS MATERIALIZED (
    SELECT * FROM public.get_competitive_current_rows(p_audience)
  ),
  saved AS (
    INSERT INTO public.challenge_board_daily_snapshots (
      board_key, audience, subject_id, snapshot_date,
      opening_value, opening_rank, current_value, current_rank, record_value, updated_at
    )
    SELECT
      row.board_key,
      row.audience,
      row.subject_id,
      v_today,
      row.current_value,
      row.current_rank,
      row.current_value,
      row.current_rank,
      row.current_value,
      now()
    FROM current_rows row
    ON CONFLICT (board_key, audience, subject_id, snapshot_date) DO UPDATE
      SET current_value = EXCLUDED.current_value,
          current_rank = EXCLUDED.current_rank,
          record_value = GREATEST(
            public.challenge_board_daily_snapshots.record_value,
            EXCLUDED.current_value
          ),
          updated_at = now()
    RETURNING
      challenge_board_daily_snapshots.board_key,
      challenge_board_daily_snapshots.audience,
      challenge_board_daily_snapshots.subject_id,
      challenge_board_daily_snapshots.opening_value,
      challenge_board_daily_snapshots.opening_rank
  )
  SELECT
    row.board_key,
    row.subject_id,
    row.row_data,
    row.current_value,
    row.current_rank,
    COALESCE(prior.current_value, saved.opening_value)::numeric AS previous_value,
    COALESCE(prior.current_rank, saved.opening_rank)::integer AS previous_rank,
    CASE
      WHEN row.current_value > COALESCE(prior.current_value, saved.opening_value) THEN 1
      WHEN row.current_value < COALESCE(prior.current_value, saved.opening_value) THEN -1
      WHEN row.current_rank < COALESCE(prior.current_rank, saved.opening_rank, row.current_rank) THEN 1
      WHEN row.current_rank > COALESCE(prior.current_rank, saved.opening_rank, row.current_rank) THEN -1
      ELSE 0
    END::integer AS movement,
    (
      row.current_value > COALESCE(history.best_value, saved.opening_value)
    )::boolean AS is_new_record
  FROM current_rows row
  JOIN saved
    ON saved.board_key = row.board_key
   AND saved.audience = row.audience
   AND saved.subject_id = row.subject_id
  LEFT JOIN LATERAL (
    SELECT snapshot.current_value, snapshot.current_rank
    FROM public.challenge_board_daily_snapshots snapshot
    WHERE snapshot.board_key = row.board_key
      AND snapshot.audience = row.audience
      AND snapshot.subject_id = row.subject_id
      AND snapshot.snapshot_date < v_today
    ORDER BY snapshot.snapshot_date DESC
    LIMIT 1
  ) prior ON true
  LEFT JOIN LATERAL (
    SELECT MAX(snapshot.record_value)::numeric AS best_value
    FROM public.challenge_board_daily_snapshots snapshot
    WHERE snapshot.board_key = row.board_key
      AND snapshot.audience = row.audience
      AND snapshot.subject_id = row.subject_id
      AND snapshot.snapshot_date < v_today
  ) history ON true
  ORDER BY row.board_key, row.current_rank, row.subject_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_competitive_board_movements(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitive_board_movements(text) TO authenticated, service_role;
