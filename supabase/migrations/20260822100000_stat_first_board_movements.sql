/*
  Stat-first challenge-board movement.

  The previous implementation depended on a board having been opened on the
  prior day. When that RPC timed out, a new phone fell back to localStorage and
  could only notice rank changes. This function derives yesterday's values from
  the authoritative event tables on every call:

  1. A higher stat is up.
  2. A lower stat is down.
  3. If the stat is unchanged, a better rank is up and a worse rank is down.
  4. Otherwise there is no arrow.
*/

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
  v_midnight timestamptz := v_today::timestamp AT TIME ZONE 'Africa/Douala';
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_audience NOT IN ('cadet', 'sentry', 'instructor') THEN
    RAISE EXCEPTION 'Unknown challenge-board audience.';
  END IF;

  IF p_audience = 'instructor' THEN
    RETURN QUERY
    WITH instructors AS (
      SELECT DISTINCT ON (assignment.user_id)
        assignment.user_id,
        profile.display_name,
        profile.avatar_url
      FROM public.role_assignments assignment
      JOIN public.profiles profile ON profile.id = assignment.user_id
      WHERE assignment.role = 'instructor'
        AND assignment.status IN ('active', 'approved')
      ORDER BY assignment.user_id, assignment.created_at DESC NULLS LAST
    ),
    totals AS (
      SELECT
        instructor.user_id,
        instructor.display_name,
        instructor.avatar_url,
        (SELECT COUNT(*)::numeric FROM public.daily_narratives) AS current_narratives,
        (SELECT COUNT(*)::numeric FROM public.daily_narratives narrative
          WHERE narrative.created_at < v_midnight) AS previous_narratives,
        (SELECT COUNT(DISTINCT assignment.user_id)::numeric
          FROM public.role_assignments assignment
          WHERE assignment.role IN ('cadet', 'sentry')
            AND assignment.status IN ('active', 'approved')) AS current_residents,
        (SELECT COUNT(DISTINCT assignment.user_id)::numeric
          FROM public.role_assignments assignment
          WHERE assignment.role IN ('cadet', 'sentry')
            AND assignment.status IN ('active', 'approved')
            AND assignment.created_at < v_midnight) AS previous_residents
      FROM instructors instructor
    ),
    ranked AS (
      SELECT
        total.*,
        RANK() OVER (
          ORDER BY total.current_narratives DESC, total.current_residents DESC, total.display_name ASC
        )::integer AS current_position,
        RANK() OVER (
          ORDER BY total.previous_narratives DESC, total.previous_residents DESC, total.display_name ASC
        )::integer AS previous_position
      FROM totals total
    ),
    saved AS (
      INSERT INTO public.challenge_board_daily_snapshots (
        board_key, audience, subject_id, snapshot_date,
        opening_value, opening_rank, current_value, current_rank, record_value, updated_at
      )
      SELECT
        'instructor', 'instructor', ranked.user_id, v_today,
        ranked.previous_narratives, ranked.previous_position,
        ranked.current_narratives, ranked.current_position,
        GREATEST(ranked.current_narratives, ranked.previous_narratives), now()
      FROM ranked
      ON CONFLICT (board_key, audience, subject_id, snapshot_date) DO UPDATE
        SET opening_value = EXCLUDED.opening_value,
            opening_rank = EXCLUDED.opening_rank,
            current_value = EXCLUDED.current_value,
            current_rank = EXCLUDED.current_rank,
            record_value = GREATEST(
              public.challenge_board_daily_snapshots.record_value,
              EXCLUDED.current_value
            ),
            updated_at = now()
      RETURNING challenge_board_daily_snapshots.subject_id
    )
    SELECT
      'instructor'::text,
      ranked.user_id,
      jsonb_build_object(
        'user_id', ranked.user_id,
        'display_name', ranked.display_name,
        'avatar_url', ranked.avatar_url,
        'narratives', ranked.current_narratives,
        'residents', ranked.current_residents,
        'rank', ranked.current_position
      ),
      ranked.current_narratives,
      ranked.current_position,
      ranked.previous_narratives,
      ranked.previous_position,
      CASE
        WHEN ranked.current_narratives > ranked.previous_narratives THEN 1
        WHEN ranked.current_narratives < ranked.previous_narratives THEN -1
        WHEN ranked.current_position < ranked.previous_position THEN 1
        WHEN ranked.current_position > ranked.previous_position THEN -1
        ELSE 0
      END::integer,
      ranked.current_narratives > COALESCE((
        SELECT MAX(snapshot.record_value)
        FROM public.challenge_board_daily_snapshots snapshot
        WHERE snapshot.board_key = 'instructor'
          AND snapshot.audience = 'instructor'
          AND snapshot.subject_id = ranked.user_id
          AND snapshot.snapshot_date < v_today
      ), ranked.previous_narratives)
    FROM ranked
    JOIN saved ON saved.subject_id = ranked.user_id
    ORDER BY ranked.current_position, ranked.display_name;
    RETURN;
  END IF;

  RETURN QUERY
  WITH clock AS (
    SELECT
      v_today AS today,
      v_today - 1 AS yesterday,
      v_today - ((EXTRACT(DOW FROM v_today)::integer - 6 + 7) % 7) AS current_week_start,
      (v_today - 1) - ((EXTRACT(DOW FROM (v_today - 1))::integer - 6 + 7) % 7) AS previous_week_start,
      timezone('Africa/Douala', now()) AS local_now
  ),
  people AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role,
      profile.display_name,
      profile.avatar_url
    FROM public.role_assignments assignment
    JOIN public.profiles profile ON profile.id = assignment.user_id
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY
      assignment.user_id,
      CASE assignment.role WHEN 'sentry' THEN 1 ELSE 2 END,
      assignment.created_at DESC NULLS LAST
  ),
  memberships AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      member.tent_id,
      tent.name AS tent_name,
      tent.tent_house_id
    FROM public.tent_members member
    JOIN public.tents tent ON tent.id = member.tent_id
    ORDER BY member.user_id, member.joined_at DESC NULLS LAST
  ),
  denarii AS (
    SELECT
      person.user_id,
      COALESCE(SUM(entry.amount), 0)::numeric AS current_denarii,
      COALESCE(SUM(entry.amount) FILTER (WHERE entry.created_at < v_midnight), 0)::numeric AS previous_denarii
    FROM people person
    LEFT JOIN public.denarii_ledger_entries entry ON entry.user_id = person.user_id
    GROUP BY person.user_id
  ),
  game_figs AS (
    SELECT
      attempt.user_id,
      COALESCE(SUM(attempt.score) FILTER (
        WHERE (attempt.completed_at AT TIME ZONE 'Africa/Douala')::date >= clock.current_week_start
          AND (attempt.completed_at AT TIME ZONE 'Africa/Douala')::date < clock.current_week_start + 7
      ), 0)::numeric AS weekly_current,
      COALESCE(SUM(attempt.score) FILTER (
        WHERE (attempt.completed_at AT TIME ZONE 'Africa/Douala')::date >= clock.previous_week_start
          AND attempt.completed_at < v_midnight
      ), 0)::numeric AS weekly_previous,
      COALESCE(SUM(attempt.score), 0)::numeric AS lifetime_current,
      COALESCE(SUM(attempt.score) FILTER (WHERE attempt.completed_at < v_midnight), 0)::numeric AS lifetime_previous
    FROM public.game_attempts attempt
    CROSS JOIN clock
    WHERE attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
    GROUP BY attempt.user_id
  ),
  arena_figs AS (
    SELECT
      participant.user_id,
      COALESCE(SUM(participant.score) FILTER (
        WHERE (participant.finished_at AT TIME ZONE 'Africa/Douala')::date >= clock.current_week_start
          AND (participant.finished_at AT TIME ZONE 'Africa/Douala')::date < clock.current_week_start + 7
      ), 0)::numeric AS weekly_current,
      COALESCE(SUM(participant.score) FILTER (
        WHERE (participant.finished_at AT TIME ZONE 'Africa/Douala')::date >= clock.previous_week_start
          AND participant.finished_at < v_midnight
      ), 0)::numeric AS weekly_previous,
      COALESCE(SUM(participant.score), 0)::numeric AS lifetime_current,
      COALESCE(SUM(participant.score) FILTER (WHERE participant.finished_at < v_midnight), 0)::numeric AS lifetime_previous
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    CROSS JOIN clock
    WHERE participant.finished_at IS NOT NULL
      AND room.status = 'completed'
    GROUP BY participant.user_id
  ),
  weighted_quiz_rows AS (
    SELECT
      attempt.user_id,
      attempt.submitted_at,
      session.quiz_type,
      CASE
        WHEN question.difficulty_tag = 'hard' THEN 5
        WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
        ELSE 1
      END::numeric AS figs
    FROM public.quiz_attempts attempt
    JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
    JOIN public.question_responses response ON response.quiz_attempt_id = attempt.id
    JOIN public.generated_questions question ON question.id = response.question_id
    WHERE attempt.status IN ('submitted', 'timed_out')
      AND attempt.submitted_at IS NOT NULL
      AND response.answer = question.question_payload->'correct_answer'
  ),
  quiz_figs AS (
    SELECT
      quiz.user_id,
      COALESCE(SUM(quiz.figs) FILTER (
        WHERE (quiz.submitted_at AT TIME ZONE 'Africa/Douala')::date >= clock.current_week_start
          AND (quiz.submitted_at AT TIME ZONE 'Africa/Douala')::date < clock.current_week_start + 7
          AND (
            quiz.quiz_type <> 'saturday'
            OR clock.local_now >= clock.current_week_start::timestamp + time '15:00'
          )
      ), 0)::numeric AS weekly_current,
      COALESCE(SUM(quiz.figs) FILTER (
        WHERE (quiz.submitted_at AT TIME ZONE 'Africa/Douala')::date >= clock.previous_week_start
          AND quiz.submitted_at < v_midnight
      ), 0)::numeric AS weekly_previous,
      COALESCE(SUM(quiz.figs), 0)::numeric AS lifetime_current,
      COALESCE(SUM(quiz.figs) FILTER (WHERE quiz.submitted_at < v_midnight), 0)::numeric AS lifetime_previous
    FROM weighted_quiz_rows quiz
    CROSS JOIN clock
    GROUP BY quiz.user_id
  ),
  figs AS (
    SELECT
      person.user_id,
      COALESCE(game.weekly_current, 0)::numeric AS daily_game_score,
      COALESCE(arena.weekly_current, 0)::numeric AS arena_figs,
      COALESCE(quiz.weekly_current, 0)::numeric AS quiz_figs,
      (
        COALESCE(game.weekly_current, 0)
        + COALESCE(arena.weekly_current, 0)
        + COALESCE(quiz.weekly_current, 0)
      )::numeric AS weekly_current,
      (
        COALESCE(game.weekly_previous, 0)
        + COALESCE(arena.weekly_previous, 0)
        + COALESCE(quiz.weekly_previous, 0)
      )::numeric AS weekly_previous,
      (
        COALESCE(game.lifetime_current, 0)
        + COALESCE(arena.lifetime_current, 0)
        + COALESCE(quiz.lifetime_current, 0)
      )::numeric AS lifetime_current,
      (
        COALESCE(game.lifetime_previous, 0)
        + COALESCE(arena.lifetime_previous, 0)
        + COALESCE(quiz.lifetime_previous, 0)
      )::numeric AS lifetime_previous
    FROM people person
    LEFT JOIN game_figs game ON game.user_id = person.user_id
    LEFT JOIN arena_figs arena ON arena.user_id = person.user_id
    LEFT JOIN quiz_figs quiz ON quiz.user_id = person.user_id
  ),
  volumes AS (
    SELECT
      person.user_id,
      COUNT(record.user_id) FILTER (WHERE COALESCE(record.streak_valid, false))::integer AS volume
    FROM people person
    LEFT JOIN public.daily_records record ON record.user_id = person.user_id
    GROUP BY person.user_id
  ),
  streaks AS (
    SELECT
      person.user_id,
      COALESCE(strict.current_streak, 0)::integer AS current_streak,
      COALESCE(
        previous_board.current_streak,
        previous_public.current_streak,
        CASE
          WHEN COALESCE(strict.current_streak, 0) > 0
            AND public.streak_requirement_met(person.user_id, v_today)
            THEN COALESCE(strict.current_streak, 0) - 1
          ELSE COALESCE(strict.current_streak, 0)
        END
      )::integer AS previous_streak,
      GREATEST(COALESCE(strict.longest_streak, 0), COALESCE(strict.current_streak, 0))::integer AS longest_streak,
      COALESCE(strict.consecutive_inactive, 0)::integer AS consecutive_inactive,
      COALESCE(strict.cumulative_inactive, 0)::integer AS cumulative_inactive
    FROM people person
    LEFT JOIN LATERAL public.compute_strict_streak(person.user_id) strict ON true
    LEFT JOIN LATERAL (
      SELECT snapshot.current_value::integer AS current_streak
      FROM public.challenge_board_daily_snapshots snapshot
      WHERE snapshot.board_key = 'streak'
        AND snapshot.audience = person.role
        AND snapshot.subject_id = person.user_id
        AND snapshot.snapshot_date < v_today
      ORDER BY snapshot.snapshot_date DESC
      LIMIT 1
    ) previous_board ON true
    LEFT JOIN LATERAL (
      SELECT snapshot.current_streak
      FROM public.streakboard_snapshots snapshot
      WHERE snapshot.user_id = person.user_id
        AND snapshot.snapshot_date < v_today
      ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC NULLS LAST
      LIMIT 1
    ) previous_public ON true
  ),
  rhudes AS (
    SELECT
      person.user_id,
      COUNT(room.id) FILTER (WHERE room.status = 'completed')::numeric AS current_rhudes,
      COUNT(room.id) FILTER (
        WHERE room.status = 'completed' AND room.completed_at < v_midnight
      )::numeric AS previous_rhudes,
      MAX(room.completed_at) FILTER (WHERE room.status = 'completed') AS latest_victory_at
    FROM people person
    LEFT JOIN public.arena_rooms room ON room.winner_id = person.user_id
    GROUP BY person.user_id
  ),
  metrics AS (
    SELECT
      person.user_id,
      person.role,
      person.display_name,
      person.avatar_url,
      membership.tent_id,
      membership.tent_name,
      membership.tent_house_id,
      COALESCE(denarii.current_denarii, 0)::numeric AS current_denarii,
      COALESCE(denarii.previous_denarii, 0)::numeric AS previous_denarii,
      COALESCE(figs.daily_game_score, 0)::numeric AS daily_game_score,
      COALESCE(figs.arena_figs, 0)::numeric AS arena_figs,
      COALESCE(figs.quiz_figs, 0)::numeric AS quiz_figs,
      COALESCE(figs.weekly_current, 0)::numeric AS current_weekly_figs,
      COALESCE(figs.weekly_previous, 0)::numeric AS previous_weekly_figs,
      COALESCE(figs.lifetime_current, 0)::numeric AS current_lifetime_figs,
      COALESCE(figs.lifetime_previous, 0)::numeric AS previous_lifetime_figs,
      COALESCE(streak.current_streak, 0)::numeric AS current_streak,
      COALESCE(streak.previous_streak, 0)::numeric AS previous_streak,
      COALESCE(streak.longest_streak, 0)::integer AS longest_streak,
      COALESCE(streak.consecutive_inactive, 0)::integer AS consecutive_inactive,
      COALESCE(streak.cumulative_inactive, 0)::integer AS cumulative_inactive,
      COALESCE(volume.volume, 0)::integer AS volume,
      COALESCE(rhude.current_rhudes, 0)::numeric AS current_rhudes,
      COALESCE(rhude.previous_rhudes, 0)::numeric AS previous_rhudes,
      rhude.latest_victory_at,
      (
        COALESCE(denarii.current_denarii, 0)
        + COALESCE(figs.lifetime_current, 0) * 100
        + COALESCE(streak.current_streak, 0) * 1000
        + COALESCE(rhude.current_rhudes, 0) * 5000
      )::numeric AS current_marks,
      (
        COALESCE(denarii.previous_denarii, 0)
        + COALESCE(figs.lifetime_previous, 0) * 100
        + COALESCE(streak.previous_streak, 0) * 1000
        + COALESCE(rhude.previous_rhudes, 0) * 5000
      )::numeric AS previous_marks
    FROM people person
    LEFT JOIN memberships membership ON membership.user_id = person.user_id
    LEFT JOIN denarii ON denarii.user_id = person.user_id
    LEFT JOIN figs ON figs.user_id = person.user_id
    LEFT JOIN streaks streak ON streak.user_id = person.user_id
    LEFT JOIN volumes volume ON volume.user_id = person.user_id
    LEFT JOIN rhudes rhude ON rhude.user_id = person.user_id
  ),
  person_rows AS (
    SELECT
      'denarii'::text AS board_key,
      metric.role AS audience,
      metric.user_id AS subject_id,
      jsonb_build_object(
        'user_id', metric.user_id,
        'display_name', metric.display_name,
        'avatar_url', metric.avatar_url,
        'role', metric.role,
        'tent_id', metric.tent_id,
        'tent_name', metric.tent_name,
        'tent_house_id', metric.tent_house_id,
        'total_denarii', metric.current_denarii
      ) AS row_data,
      metric.current_denarii AS current_value,
      metric.previous_denarii AS previous_value,
      metric.display_name AS sort_name
    FROM metrics metric
    WHERE metric.role = p_audience

    UNION ALL

    SELECT
      'figs', metric.role, metric.user_id,
      jsonb_build_object(
        'user_id', metric.user_id,
        'display_name', metric.display_name,
        'avatar_url', metric.avatar_url,
        'role', metric.role,
        'tent_house_id', metric.tent_house_id,
        'daily_game_score', metric.daily_game_score,
        'arena_figs', metric.arena_figs,
        'random_quiz_score', metric.quiz_figs,
        'saturday_quiz_score', 0,
        'total_score', metric.current_weekly_figs
      ),
      metric.current_weekly_figs,
      metric.previous_weekly_figs,
      metric.display_name
    FROM metrics metric
    WHERE metric.role = p_audience

    UNION ALL

    SELECT
      'streak', metric.role, metric.user_id,
      jsonb_build_object(
        'id', metric.user_id,
        'snapshot_date', v_today,
        'user_id', metric.user_id,
        'role', metric.role,
        'tent_id', metric.tent_id,
        'tent_house_id', metric.tent_house_id,
        'volume', metric.volume,
        'consistency', metric.longest_streak,
        'improvement', metric.current_streak - metric.previous_streak,
        'current_streak', metric.current_streak,
        'longest_streak', metric.longest_streak,
        'consecutive_inactive', metric.consecutive_inactive,
        'cumulative_inactive', metric.cumulative_inactive,
        'profiles', jsonb_build_object(
          'display_name', metric.display_name,
          'avatar_url', metric.avatar_url
        )
      ),
      metric.current_streak,
      metric.previous_streak,
      metric.display_name
    FROM metrics metric
    WHERE metric.role = p_audience

    UNION ALL

    SELECT
      'rhude', metric.role, metric.user_id,
      jsonb_build_object(
        'user_id', metric.user_id,
        'display_name', metric.display_name,
        'avatar_url', metric.avatar_url,
        'role', metric.role,
        'tent_id', metric.tent_id,
        'tent_name', metric.tent_name,
        'tent_house_id', metric.tent_house_id,
        'rhudes', metric.current_rhudes,
        'latest_victory_at', metric.latest_victory_at
      ),
      metric.current_rhudes,
      metric.previous_rhudes,
      metric.display_name
    FROM metrics metric
    WHERE metric.role = p_audience

    UNION ALL

    SELECT
      'marks', metric.role, metric.user_id,
      jsonb_build_object(
        'user_id', metric.user_id,
        'display_name', metric.display_name,
        'avatar_url', metric.avatar_url,
        'role', metric.role,
        'tent_id', metric.tent_id,
        'tent_name', metric.tent_name,
        'tent_house_id', metric.tent_house_id,
        'total_denarii', metric.current_denarii,
        'total_figs', metric.current_lifetime_figs,
        'current_streak', metric.current_streak,
        'rhudes', metric.current_rhudes,
        'marks', metric.current_marks
      ),
      metric.current_marks,
      metric.previous_marks,
      metric.display_name
    FROM metrics metric
    WHERE metric.role = p_audience
  ),
  tent_totals AS (
    SELECT
      tent.id AS tent_id,
      tent.name AS tent_name,
      tent.tent_house_id,
      tent.profile_image_url AS tent_profile_image_url,
      ARRAY_REMOVE(ARRAY_AGG(profile.display_name ORDER BY profile.display_name)
        FILTER (WHERE member.role = 'sentry'), NULL) AS sentry_names,
      COUNT(*) FILTER (WHERE metric.role = 'cadet')::bigint AS cadet_count,
      COALESCE(SUM(metric.current_denarii) FILTER (WHERE metric.role = 'cadet'), 0)::numeric AS total_denarii,
      COALESCE(SUM(metric.current_streak) FILTER (WHERE metric.role = 'cadet'), 0)::numeric AS total_streak,
      COALESCE(SUM(metric.current_lifetime_figs) FILTER (WHERE metric.role = 'cadet'), 0)::numeric AS total_figs,
      COALESCE(SUM(
        metric.current_denarii + metric.current_lifetime_figs * 100 + metric.current_streak * 1000
      ) FILTER (WHERE metric.role = 'cadet'), 0)::numeric AS current_value,
      COALESCE(SUM(
        metric.previous_denarii + metric.previous_lifetime_figs * 100 + metric.previous_streak * 1000
      ) FILTER (WHERE metric.role = 'cadet'), 0)::numeric AS previous_value
    FROM public.tents tent
    LEFT JOIN public.tent_members member ON member.tent_id = tent.id
    LEFT JOIN public.profiles profile ON profile.id = member.user_id
    LEFT JOIN metrics metric ON metric.user_id = member.user_id
    GROUP BY tent.id, tent.name, tent.tent_house_id, tent.profile_image_url
  ),
  tent_rows AS (
    SELECT
      'tent'::text AS board_key,
      'all'::text AS audience,
      tent.tent_id AS subject_id,
      jsonb_build_object(
        'tent_id', tent.tent_id,
        'tent_name', tent.tent_name,
        'tent_house_id', tent.tent_house_id,
        'tent_profile_image_url', tent.tent_profile_image_url,
        'sentry_names', COALESCE(tent.sentry_names, ARRAY[]::text[]),
        'cadet_count', tent.cadet_count,
        'total_denarii', tent.total_denarii,
        'total_streak', tent.total_streak,
        'total_figs', tent.total_figs,
        'combined_score', tent.current_value
      ) AS row_data,
      tent.current_value,
      tent.previous_value,
      tent.tent_name AS sort_name
    FROM tent_totals tent
  ),
  all_rows AS (
    SELECT * FROM person_rows
    UNION ALL
    SELECT * FROM tent_rows
  ),
  ranked AS (
    SELECT
      row.*,
      RANK() OVER (
        PARTITION BY row.board_key, row.audience
        ORDER BY row.current_value DESC, row.sort_name ASC
      )::integer AS current_position,
      RANK() OVER (
        PARTITION BY row.board_key, row.audience
        ORDER BY row.previous_value DESC, row.sort_name ASC
      )::integer AS previous_position
    FROM all_rows row
  ),
  saved AS (
    INSERT INTO public.challenge_board_daily_snapshots (
      board_key, audience, subject_id, snapshot_date,
      opening_value, opening_rank, current_value, current_rank, record_value, updated_at
    )
    SELECT
      ranked.board_key,
      ranked.audience,
      ranked.subject_id,
      v_today,
      ranked.previous_value,
      ranked.previous_position,
      ranked.current_value,
      ranked.current_position,
      GREATEST(ranked.current_value, ranked.previous_value),
      now()
    FROM ranked
    ON CONFLICT (board_key, audience, subject_id, snapshot_date) DO UPDATE
      SET opening_value = EXCLUDED.opening_value,
          opening_rank = EXCLUDED.opening_rank,
          current_value = EXCLUDED.current_value,
          current_rank = EXCLUDED.current_rank,
          record_value = GREATEST(
            public.challenge_board_daily_snapshots.record_value,
            EXCLUDED.current_value
          ),
          updated_at = now()
    RETURNING
      challenge_board_daily_snapshots.board_key,
      challenge_board_daily_snapshots.audience,
      challenge_board_daily_snapshots.subject_id
  )
  SELECT
    ranked.board_key,
    ranked.subject_id,
    ranked.row_data || jsonb_build_object('rank', ranked.current_position),
    ranked.current_value,
    ranked.current_position,
    ranked.previous_value,
    ranked.previous_position,
    CASE
      WHEN ranked.current_value > ranked.previous_value THEN 1
      WHEN ranked.current_value < ranked.previous_value THEN -1
      WHEN ranked.current_position < ranked.previous_position THEN 1
      WHEN ranked.current_position > ranked.previous_position THEN -1
      ELSE 0
    END::integer,
    ranked.current_value > COALESCE((
      SELECT MAX(snapshot.record_value)
      FROM public.challenge_board_daily_snapshots snapshot
      WHERE snapshot.board_key = ranked.board_key
        AND snapshot.audience = ranked.audience
        AND snapshot.subject_id = ranked.subject_id
        AND snapshot.snapshot_date < v_today
    ), ranked.previous_value)
  FROM ranked
  JOIN saved
    ON saved.board_key = ranked.board_key
   AND saved.audience = ranked.audience
   AND saved.subject_id = ranked.subject_id
  ORDER BY ranked.board_key, ranked.current_position, ranked.sort_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_competitive_board_movements(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitive_board_movements(text) TO authenticated, service_role;
