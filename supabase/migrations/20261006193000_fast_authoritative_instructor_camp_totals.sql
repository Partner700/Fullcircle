/*
  Return the signed-in instructor's camp totals without invoking the
  per-member board function. The earlier fallback was correct, but its nested
  per-user calculations could exceed the mobile client's timeout and leave an
  otherwise valid instructor board with no rows.

  These grouped sources mirror the canonical member-Mark inputs while keeping
  the request bounded: wallet Denarii, qualifying Denarii, demonstrated Streak
  days, completed Arena wins, and every canonical Fig source.
*/

CREATE OR REPLACE FUNCTION public.get_current_instructor_camp_totals()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  narratives numeric,
  residents numeric,
  marks numeric,
  total_denarii numeric,
  total_figs numeric,
  rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view instructor camp totals.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH members AS MATERIALIZED (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), wallet_totals AS MATERIALIZED (
    SELECT entry.user_id, coalesce(sum(entry.amount), 0)::numeric AS denarii
    FROM public.denarii_ledger_entries entry
    JOIN members member ON member.user_id = entry.user_id
    GROUP BY entry.user_id
  ), qualifying_denarii_totals AS MATERIALIZED (
    SELECT entry.user_id, coalesce(sum(entry.amount), 0)::numeric AS denarii
    FROM public.denarii_achievement_entries entry
    JOIN members member ON member.user_id = entry.user_id
    GROUP BY entry.user_id
  ), streak_totals AS MATERIALIZED (
    SELECT achievement.user_id, count(*)::numeric AS streak_days
    FROM public.streak_achievement_days achievement
    JOIN members member ON member.user_id = achievement.user_id
    GROUP BY achievement.user_id
  ), rhude_totals AS MATERIALIZED (
    SELECT room.winner_id AS user_id, count(*)::numeric AS rhudes
    FROM public.arena_rooms room
    JOIN members member ON member.user_id = room.winner_id
    WHERE room.status = 'completed'
      AND room.winner_id IS NOT NULL
    GROUP BY room.winner_id
  ), quiz_attempt_figs AS MATERIALIZED (
    SELECT
      attempt.id,
      attempt.user_id,
      coalesce(
        attempt.talents_scored::numeric,
        sum(
          CASE
            WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
              AND NOT coalesce(response.assisted_by_relic, false)
            THEN CASE
              WHEN question.difficulty_tag = 'hard' THEN 5
              WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
              ELSE 1
            END
            ELSE 0
          END
        )::numeric,
        0
      ) AS figs
    FROM public.quiz_attempts attempt
    JOIN members member ON member.user_id = attempt.user_id
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
    LEFT JOIN public.generated_questions question
      ON question.id = response.question_id
    WHERE attempt.status IN ('submitted', 'timed_out')
    GROUP BY attempt.id, attempt.user_id, attempt.talents_scored
  ), fig_entries AS MATERIALIZED (
    SELECT attempt.user_id, coalesce(sum(attempt.score), 0)::numeric AS figs
    FROM public.game_attempts attempt
    JOIN members member ON member.user_id = attempt.user_id
    WHERE attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
    GROUP BY attempt.user_id

    UNION ALL

    SELECT participant.user_id, coalesce(sum(participant.score), 0)::numeric
    FROM public.arena_participants participant
    JOIN members member ON member.user_id = participant.user_id
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.finished_at IS NOT NULL
      AND room.status = 'completed'
    GROUP BY participant.user_id

    UNION ALL

    SELECT attempt.user_id, coalesce(sum(attempt.figs), 0)::numeric
    FROM quiz_attempt_figs attempt
    GROUP BY attempt.user_id

    UNION ALL

    SELECT entry.user_id, coalesce(sum(entry.figs), 0)::numeric
    FROM public.story_mode_fig_entries entry
    JOIN members member ON member.user_id = entry.user_id
    GROUP BY entry.user_id

    UNION ALL

    SELECT adjustment.user_id, coalesce(sum(adjustment.amount), 0)::numeric
    FROM public.account_fig_adjustments adjustment
    JOIN members member ON member.user_id = adjustment.user_id
    GROUP BY adjustment.user_id
  ), fig_totals AS MATERIALIZED (
    SELECT entry.user_id, coalesce(sum(entry.figs), 0)::numeric AS figs
    FROM fig_entries entry
    GROUP BY entry.user_id
  ), rules AS MATERIALIZED (
    SELECT
      economy.streaks_per_mark,
      economy.denarii_per_talent,
      economy.talents_per_mark,
      economy.rhudes_per_mark,
      economy.figs_per_mark
    FROM public.full_circle_economy_rules economy
    WHERE economy.rule_key = 'canonical'
  ), member_components AS MATERIALIZED (
    SELECT
      member.user_id,
      coalesce(wallet.denarii, 0)::numeric AS wallet_denarii,
      coalesce(qualifying.denarii, 0)::numeric AS qualifying_denarii,
      coalesce(streak.streak_days, 0)::numeric AS streak_days,
      coalesce(rhude.rhudes, 0)::numeric AS rhudes,
      coalesce(fig.figs, 0)::numeric AS figs
    FROM members member
    LEFT JOIN wallet_totals wallet ON wallet.user_id = member.user_id
    LEFT JOIN qualifying_denarii_totals qualifying ON qualifying.user_id = member.user_id
    LEFT JOIN streak_totals streak ON streak.user_id = member.user_id
    LEFT JOIN rhude_totals rhude ON rhude.user_id = member.user_id
    LEFT JOIN fig_totals fig ON fig.user_id = member.user_id
  ), totals AS MATERIALIZED (
    SELECT
      (SELECT count(*)::numeric FROM public.daily_narratives) AS narratives,
      (SELECT count(*)::numeric FROM members) AS residents,
      coalesce(sum(component.wallet_denarii), 0)::numeric AS denarii,
      coalesce(sum(component.figs), 0)::numeric AS figs,
      coalesce(sum(
        greatest(component.streak_days, 0) / rule.streaks_per_mark
        + (greatest(component.qualifying_denarii, 0) / rule.denarii_per_talent) / rule.talents_per_mark
        + greatest(component.rhudes, 0) / rule.rhudes_per_mark
        + greatest(component.figs, 0) / rule.figs_per_mark
      ), 0)::numeric AS member_marks
    FROM member_components component
    CROSS JOIN rules rule
  )
  SELECT
    profile.id,
    profile.display_name,
    profile.avatar_url,
    totals.narratives,
    totals.residents,
    (totals.member_marks + totals.narratives + totals.residents * 5)::numeric,
    totals.denarii,
    totals.figs,
    1
  FROM public.profiles profile
  CROSS JOIN totals
  WHERE profile.id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_instructor_camp_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_instructor_camp_totals() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_current_instructor_camp_totals() IS
  'Returns fast authoritative camp totals for the signed-in instructor using grouped canonical economy sources.';
