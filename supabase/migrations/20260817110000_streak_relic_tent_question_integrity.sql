/*
  Recover stable streak history, complete Thief's Request repairs, stop
  destructive tent removals, and prevent repeated gameplay questions.
*/

-- A streak that was confirmed by the board must not move backwards merely
-- because a later calculator version reinterprets an already-earned day.
CREATE OR REPLACE FUNCTION public.get_authoritative_streak(p_user_id uuid)
RETURNS TABLE (
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH strict AS (
    SELECT * FROM public.compute_strict_streak(p_user_id) LIMIT 1
  ),
  best_recent_snapshot AS (
    SELECT snapshot.snapshot_date, snapshot.current_streak, snapshot.longest_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = p_user_id
      AND snapshot.snapshot_date >= timezone('Africa/Douala', now())::date - 14
    ORDER BY snapshot.current_streak DESC, snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  ),
  break_after_snapshot AS (
    SELECT EXISTS (
      SELECT 1
      FROM best_recent_snapshot snapshot
      CROSS JOIN LATERAL generate_series(
        snapshot.snapshot_date + 1,
        timezone('Africa/Douala', now())::date,
        interval '1 day'
      ) day
      WHERE (
        day::date < timezone('Africa/Douala', now())::date
        OR timezone('Africa/Douala', now())::time >= time '21:00'
      )
      AND NOT (extract(dow FROM day) = 0 AND day::date < date '2026-08-02')
      AND (
        extract(dow FROM day) <> 6
        OR EXISTS (
          SELECT 1 FROM public.quiz_sessions session
          WHERE session.session_date = day::date AND session.quiz_type = 'saturday'
        )
      )
      AND NOT public.streak_requirement_met(p_user_id, day::date)
      AND NOT EXISTS (
        SELECT 1 FROM public.streak_freezers protection
        WHERE protection.user_id = p_user_id
          AND protection.used_at IS NULL
          AND protection.applied_to_date = day::date
          AND (protection.expires_at IS NULL OR protection.expires_at::date >= day::date)
      )
    ) AS found
  )
  SELECT
    CASE
      WHEN NOT COALESCE(break_after_snapshot.found, false)
      THEN GREATEST(COALESCE(strict.current_streak, 0), COALESCE(best_recent_snapshot.current_streak, 0))
      ELSE COALESCE(strict.current_streak, 0)
    END::integer,
    GREATEST(COALESCE(strict.longest_streak, 0), COALESCE(best_recent_snapshot.longest_streak, 0))::integer,
    COALESCE(strict.consecutive_inactive, 0)::integer,
    COALESCE(strict.cumulative_inactive, 0)::integer
  FROM (VALUES (1)) seed(value)
  LEFT JOIN strict ON true
  LEFT JOIN best_recent_snapshot ON true
  LEFT JOIN break_after_snapshot ON true;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_streak(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_toolbar_stats_v5()
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
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  RETURN QUERY
  SELECT
    v_user_id,
    COALESCE((SELECT sum(entry.amount)::bigint FROM public.denarii_ledger_entries entry WHERE entry.user_id = v_user_id), 0)::bigint,
    streak.current_streak,
    streak.longest_streak,
    streak.consecutive_inactive,
    streak.cumulative_inactive
  FROM public.get_authoritative_streak(v_user_id) streak
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_toolbar_stats_v5() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toolbar_stats_v5() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_live_stats(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  total_denarii bigint,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer,
  total_figs numeric,
  rhudes bigint,
  marks numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_target IS NULL THEN RAISE EXCEPTION 'A signed-in user is required.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_caller IS DISTINCT FROM v_target
    AND NOT public.is_instructor(v_caller)
    AND NOT EXISTS (
      SELECT 1 FROM public.tents tent
      JOIN public.tent_members member ON member.tent_id = tent.id
      WHERE tent.sentry_id = v_caller AND member.user_id = v_target
    ) THEN
    RAISE EXCEPTION 'You cannot view these stats.';
  END IF;

  RETURN QUERY
  WITH board AS (
    SELECT * FROM public.get_marks_board_live() marks_board
    WHERE marks_board.user_id = v_target LIMIT 1
  )
  SELECT
    v_target,
    COALESCE((SELECT sum(entry.amount)::bigint FROM public.denarii_ledger_entries entry WHERE entry.user_id = v_target), 0)::bigint,
    streak.current_streak,
    streak.longest_streak,
    streak.consecutive_inactive,
    streak.cumulative_inactive,
    COALESCE(board.total_figs, 0)::numeric,
    COALESCE(board.rhudes, 0)::bigint,
    COALESCE(board.marks, 0)::numeric
  FROM public.get_authoritative_streak(v_target) streak
  LEFT JOIN board ON true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_live_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_live_stats(uuid) TO authenticated, service_role;

-- Thief's Request restores every eligible missed streak day up to its use,
-- never a later absence.
CREATE OR REPLACE FUNCTION public.restore_thiefs_request_history(
  p_user_id uuid,
  p_cutoff_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_join_date date;
  v_restore_date date;
  v_restored integer := 0;
BEGIN
  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_join_date IS NULL OR p_cutoff_date < v_join_date THEN RETURN 0; END IF;

  FOR v_restore_date IN
    SELECT day::date
    FROM generate_series(v_join_date, p_cutoff_date, interval '1 day') day
    WHERE (
      extract(dow FROM day) BETWEEN 1 AND 5
      OR (extract(dow FROM day) = 0 AND day::date >= date '2026-08-02')
      OR (
        extract(dow FROM day) = 6
        AND EXISTS (
          SELECT 1 FROM public.quiz_sessions session
          WHERE session.session_date = day::date AND session.quiz_type = 'saturday'
        )
      )
    )
    AND NOT public.streak_requirement_met(p_user_id, day::date)
    AND NOT EXISTS (
      SELECT 1 FROM public.streak_freezers protection
      WHERE protection.user_id = p_user_id
        AND protection.used_at IS NULL
        AND protection.applied_to_date = day::date
    )
    ORDER BY day::date
  LOOP
    INSERT INTO public.streak_freezers(user_id, freezer_type, source, applied_to_date)
    VALUES (p_user_id, 'weekly', 'relic', v_restore_date);
    v_restored := v_restored + 1;
  END LOOP;
  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_thiefs_request_history(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_thiefs_request_history(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_thiefs_request_after_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_cutoff date;
BEGIN
  SELECT relic.slug INTO v_slug FROM public.relic_types relic WHERE relic.id = NEW.relic_type_id;
  IF v_slug = 'thieves-request'
    OR NEW.effect_applied ILIKE '%revive_lost_streak%'
    OR NEW.effect_applied ILIKE '%resurrect_lost_streak%' THEN
    v_cutoff := (NEW.created_at AT TIME ZONE 'Africa/Douala')::date
      - CASE WHEN (NEW.created_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0 ELSE 1 END;
    PERFORM public.restore_thiefs_request_history(NEW.user_id, v_cutoff);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complete_thiefs_request_after_use ON public.relic_usage_log;
CREATE TRIGGER trg_complete_thiefs_request_after_use
  AFTER INSERT ON public.relic_usage_log
  FOR EACH ROW EXECUTE FUNCTION public.complete_thiefs_request_after_use();

-- Repair all recorded historical uses, including Linda Karen's account.
DO $$
DECLARE
  v_use record;
  v_cutoff date;
BEGIN
  FOR v_use IN
    SELECT candidate.user_id, max(candidate.used_at) AS used_at
    FROM (
      SELECT log.user_id, log.created_at AS used_at
      FROM public.relic_usage_log log
      JOIN public.relic_types relic ON relic.id = log.relic_type_id
      WHERE relic.slug = 'thieves-request'
         OR log.effect_applied ILIKE '%revive_lost_streak%'
         OR log.effect_applied ILIKE '%resurrect_lost_streak%'
      UNION ALL
      SELECT ledger.user_id, ledger.created_at
      FROM public.denarii_ledger_entries ledger
      WHERE ledger.source_type = 'relic_reward'
        AND ledger.description ILIKE '%Thief''s Request%'
    ) candidate
    GROUP BY candidate.user_id
  LOOP
    v_cutoff := (v_use.used_at AT TIME ZONE 'Africa/Douala')::date
      - CASE WHEN (v_use.used_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0 ELSE 1 END;
    PERFORM public.restore_thiefs_request_history(v_use.user_id, v_cutoff);
  END LOOP;
END;
$$;

-- Stop daily-record edits from silently deleting tent membership.
DROP TRIGGER IF EXISTS trg_remove_cadets_at_tent_limit ON public.daily_records;

-- Recover Victoire's demonstrably associated cadets: only active, currently
-- unassigned cadets she previously marked, up to the ten-cadet tent limit.
DO $$
DECLARE
  v_sentry_id uuid;
  v_tent_id uuid;
  v_capacity integer;
BEGIN
  SELECT profile.id INTO v_sentry_id
  FROM public.profiles profile
  WHERE profile.display_name ILIKE '%victoire%'
  ORDER BY profile.created_at DESC LIMIT 1;
  IF v_sentry_id IS NULL THEN RETURN; END IF;

  SELECT tent.id INTO v_tent_id FROM public.tents tent
  WHERE tent.sentry_id = v_sentry_id ORDER BY tent.created_at DESC LIMIT 1;
  IF v_tent_id IS NULL THEN
    SELECT member.tent_id INTO v_tent_id FROM public.tent_members member
    WHERE member.user_id = v_sentry_id AND member.role = 'sentry'
    ORDER BY member.joined_at DESC LIMIT 1;
  END IF;
  IF v_tent_id IS NULL THEN RETURN; END IF;

  SELECT greatest(10 - count(*) FILTER (WHERE member.role = 'cadet'), 0)::integer
  INTO v_capacity FROM public.tent_members member WHERE member.tent_id = v_tent_id;

  INSERT INTO public.tent_members(tent_id, user_id, role)
  SELECT v_tent_id, candidate.user_id, 'cadet'
  FROM (
    SELECT evidence.user_id, max(evidence.last_seen) AS last_seen
    FROM (
      SELECT record.user_id, max(record.record_date)::timestamptz AS last_seen
      FROM public.daily_records record
      WHERE record.attendance_marked_by = v_sentry_id
        AND record.user_id <> v_sentry_id
      GROUP BY record.user_id

      UNION ALL

      SELECT request.user_id, max(coalesce(request.reviewed_at, request.created_at)) AS last_seen
      FROM public.tent_join_requests request
      WHERE request.tent_id = v_tent_id AND request.status = 'approved'
      GROUP BY request.user_id

      UNION ALL

      SELECT participant.user_id, max(participant.created_at) AS last_seen
      FROM (
        SELECT message.sender_id AS user_id, message.created_at
        FROM public.tent_messages message WHERE message.tent_id = v_tent_id
        UNION ALL
        SELECT message.recipient_id AS user_id, message.created_at
        FROM public.tent_messages message WHERE message.tent_id = v_tent_id
      ) participant
      WHERE participant.user_id <> v_sentry_id
      GROUP BY participant.user_id
    ) evidence
    WHERE NOT EXISTS (SELECT 1 FROM public.tent_members existing WHERE existing.user_id = evidence.user_id)
      AND EXISTS (
        SELECT 1 FROM public.role_assignments role
        WHERE role.user_id = evidence.user_id AND role.role = 'cadet'
          AND role.status IN ('active', 'approved')
      )
    GROUP BY evidence.user_id
    ORDER BY max(evidence.last_seen) DESC
    LIMIT v_capacity
  ) candidate
  ON CONFLICT (tent_id, user_id) DO UPDATE SET role = 'cadet';
END;
$$;

-- Never assemble the same approved prompt twice in one daily-game run.
CREATE OR REPLACE FUNCTION public.start_daily_game_level(
  p_narrative_date date,
  p_level integer,
  p_mode text DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_question_ids jsonb;
  v_payloads jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_level NOT BETWEEN 1 AND 7 OR p_mode NOT IN ('normal', 'practice', 'blitz') THEN RAISE EXCEPTION 'Invalid game level or mode.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments role
    WHERE role.user_id = v_user_id AND role.role IN ('cadet', 'sentry') AND role.status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'Only active cadets and sentries can play the daily game.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives WHERE narrative_date = p_narrative_date) THEN RAISE EXCEPTION 'Narrative not found.'; END IF;
  IF p_level > 1 AND p_mode <> 'practice' AND NOT EXISTS (
    SELECT 1 FROM public.game_attempts previous
    WHERE previous.user_id = v_user_id AND previous.narrative_date = p_narrative_date
      AND previous.level = p_level - 1 AND previous.status = 'passed'
  ) THEN RAISE EXCEPTION 'Complete the previous level first.'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT * INTO v_run FROM public.daily_game_runs
  WHERE user_id = v_user_id AND narrative_date = p_narrative_date
    AND level = p_level AND mode = p_mode AND status = 'in_progress'
  ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('run_id', v_run.id, 'questions', v_run.question_payloads); END IF;

  WITH ranked AS (
    SELECT question.*,
      row_number() OVER (
        PARTITION BY lower(regexp_replace(btrim(question.question_text), '[^a-zA-Z0-9]+', ' ', 'g'))
        ORDER BY coalesce(question.game_round, 1), question.question_index, question.id
      ) AS duplicate_rank
    FROM public.custom_questions question
    WHERE question.narrative_date = p_narrative_date
      AND question.game_level = p_level
      AND question.is_approved = true
      AND (p_level >= 5 OR coalesce(question.is_bonus, false) = false)
  ), selected AS (
    SELECT * FROM ranked WHERE duplicate_rank = 1
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(question.id::text) ORDER BY coalesce(question.game_round, 1), question.question_index, question.id), '[]'::jsonb),
    coalesce(jsonb_agg(public.build_daily_game_question_payload(question.id, false) ORDER BY coalesce(question.game_round, 1), question.question_index, question.id), '[]'::jsonb)
  INTO v_question_ids, v_payloads
  FROM selected question;

  IF jsonb_array_length(v_question_ids) = 0 THEN RAISE EXCEPTION 'This level has no instructor-approved questions yet.'; END IF;
  INSERT INTO public.daily_game_runs(user_id, narrative_date, level, mode, question_ids, question_payloads)
  VALUES (v_user_id, p_narrative_date, p_level, p_mode, v_question_ids, v_payloads)
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('run_id', v_run.id, 'questions', v_run.question_payloads);
END;
$$;

REVOKE ALL ON FUNCTION public.start_daily_game_level(date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_daily_game_level(date, integer, text) TO authenticated;

-- Existing unfinished runs with duplicate prompts are retired so reopening a
-- level immediately receives a clean question set.
UPDATE public.daily_game_runs run
SET status = 'abandoned'
WHERE run.status = 'in_progress'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(run.question_payloads) WITH ORDINALITY AS first_question(value, position)
    JOIN jsonb_array_elements(run.question_payloads) WITH ORDINALITY AS second_question(value, position)
      ON second_question.position > first_question.position
    WHERE lower(regexp_replace(coalesce(first_question.value->>'question', ''), '[^a-zA-Z0-9]+', ' ', 'g'))
        = lower(regexp_replace(coalesce(second_question.value->>'question', ''), '[^a-zA-Z0-9]+', ' ', 'g'))
  );

-- New quiz records cannot silently store the same prompt twice. The AI and
-- fallback generators already retry with unique prompts; this is the final DB guard.
CREATE OR REPLACE FUNCTION public.reject_duplicate_quiz_prompt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prompt text := lower(regexp_replace(coalesce(NEW.question_payload->>'question', ''), '[^a-zA-Z0-9]+', ' ', 'g'));
BEGIN
  IF v_prompt = '' THEN RAISE EXCEPTION 'Quiz question text is required.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.generated_questions existing
    WHERE existing.quiz_session_id = NEW.quiz_session_id
      AND existing.id IS DISTINCT FROM NEW.id
      AND lower(regexp_replace(coalesce(existing.question_payload->>'question', ''), '[^a-zA-Z0-9]+', ' ', 'g')) = v_prompt
  ) THEN
    RAISE EXCEPTION 'This quiz already contains the same question.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_duplicate_quiz_prompt ON public.generated_questions;
CREATE TRIGGER trg_reject_duplicate_quiz_prompt
  BEFORE INSERT OR UPDATE OF quiz_session_id, question_payload ON public.generated_questions
  FOR EACH ROW EXECUTE FUNCTION public.reject_duplicate_quiz_prompt();
