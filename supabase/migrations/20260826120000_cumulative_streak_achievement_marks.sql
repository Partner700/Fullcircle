/*
  Full Circle economy normalization, phase 1B.

  Current streak remains the live consecutive-day statistic. Marks now use a
  separate cumulative achievement: one authoritative credited user/day equals
  one lifetime qualifying Streak day. A later streak reset never erases that
  achievement.
*/

CREATE TABLE IF NOT EXISTS public.streak_achievement_days (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_date date NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('earned', 'restored', 'purchased')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_date)
);

CREATE INDEX IF NOT EXISTS streak_achievement_days_date_idx
  ON public.streak_achievement_days (achievement_date, user_id);

ALTER TABLE public.streak_achievement_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.streak_achievement_days FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.streak_achievement_days TO service_role;

/* A reviewed current/longest streak or a published snapshot proves a minimum
   cumulative achievement without inventing unknown calendar dates. Exact dated
   evidence after the baseline remains additive. */
CREATE TABLE IF NOT EXISTS public.streak_achievement_baselines (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  minimum_qualifying_days integer NOT NULL CHECK (minimum_qualifying_days >= 0),
  source_kind text NOT NULL CHECK (source_kind IN ('manual_adjustment', 'published_snapshot')),
  source_reference text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.streak_achievement_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.streak_achievement_baselines FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.streak_achievement_baselines TO service_role;

CREATE OR REPLACE FUNCTION public.streak_achievement_source(
  p_user_id uuid,
  p_achievement_date date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  IF p_user_id IS NULL
    OR p_achievement_date IS NULL
    OR p_achievement_date > v_today
    OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id = p_user_id)
  THEN
    RETURN NULL;
  END IF;

  IF public.streak_requirement_met(p_user_id, p_achievement_date) THEN
    RETURN 'earned';
  END IF;
  IF public.streak_day_is_restored(p_user_id, p_achievement_date) THEN
    RETURN 'restored';
  END IF;
  IF public.streak_day_is_purchased(p_user_id, p_achievement_date) THEN
    RETURN 'purchased';
  END IF;

  -- Ordinary daily/weekly freezers hold a current streak. They never create a
  -- cumulative Streak achievement or a Mark.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.streak_achievement_source(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_achievement_source(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_streak_achievement_day(
  p_user_id uuid,
  p_achievement_date date
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  v_source := public.streak_achievement_source(p_user_id, p_achievement_date);
  IF v_source IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'full-circle-streak-achievement:' || p_user_id::text || ':' || p_achievement_date::text,
      0
    )
  );

  INSERT INTO public.streak_achievement_days (
    user_id,
    achievement_date,
    source_kind,
    recorded_at,
    last_confirmed_at
  )
  VALUES (p_user_id, p_achievement_date, v_source, now(), now())
  ON CONFLICT (user_id, achievement_date) DO UPDATE
  SET source_kind = CASE
        WHEN EXCLUDED.source_kind = 'earned' THEN 'earned'
        WHEN public.streak_achievement_days.source_kind = 'earned' THEN 'earned'
        WHEN EXCLUDED.source_kind = 'restored' THEN 'restored'
        ELSE public.streak_achievement_days.source_kind
      END,
      last_confirmed_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_streak_achievement_day(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_streak_achievement_day(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_streak_achievement_baseline(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_date date;
  v_minimum integer;
  v_source_kind text;
  v_source_reference text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    adjustment.effective_date,
    greatest(adjustment.current_streak, adjustment.longest_streak),
    'manual_adjustment'::text,
    adjustment.reason
  INTO v_effective_date, v_minimum, v_source_kind, v_source_reference
  FROM public.streak_manual_adjustments adjustment
  WHERE adjustment.user_id = p_user_id
  ORDER BY adjustment.effective_date DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT
      snapshot.snapshot_date,
      greatest(coalesce(snapshot.current_streak, 0), coalesce(snapshot.longest_streak, 0))::integer,
      'published_snapshot'::text,
      'streakboard_snapshot:' || snapshot.id::text
    INTO v_effective_date, v_minimum, v_source_kind, v_source_reference
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = p_user_id
      AND greatest(coalesce(snapshot.current_streak, 0), coalesce(snapshot.longest_streak, 0)) > 0
    ORDER BY
      greatest(coalesce(snapshot.current_streak, 0), coalesce(snapshot.longest_streak, 0)) DESC,
      snapshot.snapshot_date ASC,
      snapshot.created_at ASC,
      snapshot.id ASC
    LIMIT 1;
  END IF;

  IF v_effective_date IS NULL OR v_minimum IS NULL THEN
    -- Once reliable historical achievement is established, removing an
    -- unrelated live-streak correction must not erase lifetime Marks.
    RETURN;
  END IF;

  INSERT INTO public.streak_achievement_baselines (
    user_id,
    effective_date,
    minimum_qualifying_days,
    source_kind,
    source_reference,
    updated_at
  ) VALUES (
    p_user_id,
    v_effective_date,
    v_minimum,
    v_source_kind,
    v_source_reference,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET effective_date = CASE
        WHEN EXCLUDED.minimum_qualifying_days
          > public.streak_achievement_baselines.minimum_qualifying_days
        THEN EXCLUDED.effective_date
        ELSE public.streak_achievement_baselines.effective_date
      END,
      minimum_qualifying_days = greatest(
        public.streak_achievement_baselines.minimum_qualifying_days,
        EXCLUDED.minimum_qualifying_days
      ),
      source_kind = CASE
        WHEN EXCLUDED.minimum_qualifying_days
          > public.streak_achievement_baselines.minimum_qualifying_days
        THEN EXCLUDED.source_kind
        ELSE public.streak_achievement_baselines.source_kind
      END,
      source_reference = CASE
        WHEN EXCLUDED.minimum_qualifying_days
          > public.streak_achievement_baselines.minimum_qualifying_days
        THEN EXCLUDED.source_reference
        ELSE public.streak_achievement_baselines.source_reference
      END,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_streak_achievement_baseline(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_streak_achievement_baseline(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_lifetime_qualifying_streak_days(
  p_user_id uuid,
  p_before_date date DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT least(
      coalesce(p_before_date, timezone('Africa/Douala', now())::date + 1),
      timezone('Africa/Douala', now())::date + 1
    ) AS exclusive_end
  ), selected_baseline AS (
    SELECT baseline.*
    FROM public.streak_achievement_baselines baseline
    WHERE baseline.user_id = p_user_id
  )
  SELECT CASE
    WHEN baseline.user_id IS NOT NULL
      AND baseline.effective_date < clock.exclusive_end
    THEN
      greatest(
        (
          SELECT count(*)
          FROM public.streak_achievement_days achievement
          WHERE achievement.user_id = p_user_id
            AND achievement.achievement_date <= baseline.effective_date
        ),
        baseline.minimum_qualifying_days::bigint
      )
      + (
          SELECT count(*)
          FROM public.streak_achievement_days achievement
          WHERE achievement.user_id = p_user_id
            AND achievement.achievement_date > baseline.effective_date
            AND achievement.achievement_date < clock.exclusive_end
        )
    ELSE (
      SELECT count(*)
      FROM public.streak_achievement_days achievement
      WHERE achievement.user_id = p_user_id
        AND achievement.achievement_date < clock.exclusive_end
    )
  END::bigint
  FROM clock
  LEFT JOIN selected_baseline baseline ON true;
$$;

REVOKE ALL ON FUNCTION public.get_lifetime_qualifying_streak_days(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lifetime_qualifying_streak_days(uuid, date)
  TO service_role;

/* Exact-date backfill. Candidate dates come only from persisted completion,
   attendance-duty, quiz or relic records. The canonical lifecycle function
   rejects every candidate that was merely frozen or otherwise unqualified. */
WITH candidate_days AS MATERIALIZED (
  SELECT record.user_id, record.record_date AS achievement_date
  FROM public.daily_records record

  UNION

  SELECT record.attendance_marked_by, record.record_date
  FROM public.daily_records record
  WHERE record.attendance_marked_by IS NOT NULL

  UNION

  SELECT attempt.user_id, session.session_date
  FROM public.quiz_attempts attempt
  JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id

  UNION

  SELECT
    freezer.user_id,
    generated.achievement_date::date
  FROM public.streak_freezers freezer
  CROSS JOIN LATERAL generate_series(
    freezer.applied_to_date,
    least(
      coalesce(freezer.protected_through_date, freezer.applied_to_date),
      timezone('Africa/Douala', now())::date
    ),
    interval '1 day'
  ) generated(achievement_date)
  WHERE freezer.applied_to_date IS NOT NULL
    AND freezer.applied_to_date <= timezone('Africa/Douala', now())::date
), qualifying_days AS MATERIALIZED (
  SELECT
    candidate.user_id,
    candidate.achievement_date,
    public.streak_achievement_source(
      candidate.user_id,
      candidate.achievement_date
    ) AS source_kind
  FROM candidate_days candidate
  WHERE candidate.user_id IS NOT NULL
    AND candidate.achievement_date IS NOT NULL
)
INSERT INTO public.streak_achievement_days (
  user_id,
  achievement_date,
  source_kind,
  recorded_at,
  last_confirmed_at
)
SELECT
  qualifying.user_id,
  qualifying.achievement_date,
  qualifying.source_kind,
  now(),
  now()
FROM qualifying_days qualifying
WHERE qualifying.source_kind IS NOT NULL
ON CONFLICT (user_id, achievement_date) DO UPDATE
SET source_kind = CASE
      WHEN EXCLUDED.source_kind = 'earned' THEN 'earned'
      WHEN public.streak_achievement_days.source_kind = 'earned' THEN 'earned'
      WHEN EXCLUDED.source_kind = 'restored' THEN 'restored'
      ELSE public.streak_achievement_days.source_kind
    END,
    last_confirmed_at = now();

DO $$
DECLARE
  v_profile record;
BEGIN
  FOR v_profile IN
    SELECT adjustment.user_id
    FROM public.streak_manual_adjustments adjustment
    UNION
    SELECT snapshot.user_id
    FROM public.streakboard_snapshots snapshot
    WHERE greatest(
      coalesce(snapshot.current_streak, 0),
      coalesce(snapshot.longest_streak, 0)
    ) > 0
  LOOP
    PERFORM public.refresh_streak_achievement_baseline(v_profile.user_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_streak_achievement_from_daily_record()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  PERFORM public.record_streak_achievement_day(NEW.user_id, NEW.record_date);

  IF NEW.attendance_marked_by IS NOT NULL
    AND NEW.attendance_marked_by IS DISTINCT FROM NEW.user_id
  THEN
    PERFORM public.record_streak_achievement_day(
      NEW.attendance_marked_by,
      NEW.record_date
    );
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.attendance_marked_by IS NOT NULL
    AND OLD.attendance_marked_by IS DISTINCT FROM NEW.attendance_marked_by
    AND OLD.attendance_marked_by IS DISTINCT FROM OLD.user_id
  THEN
    PERFORM public.record_streak_achievement_day(
      OLD.attendance_marked_by,
      OLD.record_date
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_streak_achievement_from_quiz_attempt()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT session.session_date
  INTO v_session_date
  FROM public.quiz_sessions session
  WHERE session.id = NEW.quiz_session_id;

  IF v_session_date IS NOT NULL THEN
    PERFORM public.record_streak_achievement_day(NEW.user_id, v_session_date);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_streak_achievement_from_freezer()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_last_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.applied_to_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_last_date := least(
    coalesce(NEW.protected_through_date, NEW.applied_to_date),
    timezone('Africa/Douala', now())::date
  );

  IF v_last_date < NEW.applied_to_date THEN
    RETURN NEW;
  END IF;

  FOR v_date IN
    SELECT generated.day::date
    FROM generate_series(NEW.applied_to_date, v_last_date, interval '1 day') generated(day)
  LOOP
    PERFORM public.record_streak_achievement_day(NEW.user_id, v_date);
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_streak_achievement_baseline_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_streak_achievement_baseline(OLD.user_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_streak_achievement_baseline(NEW.user_id);
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.refresh_streak_achievement_baseline(OLD.user_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_streak_achievement_from_daily_record()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_streak_achievement_from_quiz_attempt()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_streak_achievement_from_freezer()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_streak_achievement_baseline_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_streak_achievement_from_daily_record
  ON public.daily_records;
CREATE TRIGGER capture_streak_achievement_from_daily_record
AFTER INSERT OR UPDATE ON public.daily_records
FOR EACH ROW EXECUTE FUNCTION public.capture_streak_achievement_from_daily_record();

DROP TRIGGER IF EXISTS capture_streak_achievement_from_quiz_attempt
  ON public.quiz_attempts;
CREATE TRIGGER capture_streak_achievement_from_quiz_attempt
AFTER INSERT OR UPDATE ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.capture_streak_achievement_from_quiz_attempt();

DROP TRIGGER IF EXISTS capture_streak_achievement_from_freezer
  ON public.streak_freezers;
CREATE TRIGGER capture_streak_achievement_from_freezer
AFTER INSERT OR UPDATE ON public.streak_freezers
FOR EACH ROW EXECUTE FUNCTION public.capture_streak_achievement_from_freezer();

DROP TRIGGER IF EXISTS capture_streak_achievement_baseline_change
  ON public.streak_manual_adjustments;
CREATE TRIGGER capture_streak_achievement_baseline_change
AFTER INSERT OR UPDATE OR DELETE ON public.streak_manual_adjustments
FOR EACH ROW EXECUTE FUNCTION public.capture_streak_achievement_baseline_change();

/* Preserve the existing return contract: current_streak remains available for
   display, while lifetime qualifying days become the Streak term in Marks. */
CREATE OR REPLACE FUNCTION public.get_member_mark_components()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text,
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  wallet_denarii bigint,
  qualifying_denarii numeric,
  total_figs numeric,
  current_streak integer,
  rhudes bigint,
  talents numeric,
  marks numeric
)
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
  WITH active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY
      assignment.user_id,
      CASE assignment.role WHEN 'sentry' THEN 1 ELSE 2 END,
      assignment.created_at DESC NULLS LAST
  ), latest_tent AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      member.tent_id,
      tent.name AS tent_name,
      tent.tent_house_id
    FROM public.tent_members member
    LEFT JOIN public.tents tent ON tent.id = member.tent_id
    ORDER BY member.user_id, member.joined_at DESC NULLS LAST
  ), rhude_totals AS (
    SELECT
      room.winner_id AS user_id,
      count(*)::bigint AS rhudes
    FROM public.arena_rooms room
    WHERE room.status = 'completed'
      AND room.winner_id IS NOT NULL
    GROUP BY room.winner_id
  ), raw AS (
    SELECT
      active.user_id,
      profile.display_name,
      profile.avatar_url,
      active.role,
      tent.tent_id,
      tent.tent_name,
      tent.tent_house_id,
      coalesce((
        SELECT sum(entry.amount)::bigint
        FROM public.denarii_ledger_entries entry
        WHERE entry.user_id = active.user_id
      ), 0)::bigint AS wallet_denarii,
      public.get_qualifying_denarii_total(active.user_id, NULL)::numeric AS qualifying_denarii,
      public.get_user_lifetime_figs(active.user_id, NULL)::numeric AS total_figs,
      coalesce(strict.current_streak, 0)::integer AS current_streak,
      public.get_lifetime_qualifying_streak_days(active.user_id, NULL)::numeric
        AS lifetime_qualifying_streak_days,
      coalesce(rhude.rhudes, 0)::bigint AS rhudes
    FROM active_roles active
    JOIN public.profiles profile ON profile.id = active.user_id
    LEFT JOIN latest_tent tent ON tent.user_id = active.user_id
    LEFT JOIN rhude_totals rhude ON rhude.user_id = active.user_id
    LEFT JOIN LATERAL public.compute_strict_streak(active.user_id) strict ON true
  )
  SELECT
    raw.user_id,
    raw.display_name,
    raw.avatar_url,
    raw.role,
    raw.tent_id,
    raw.tent_name,
    raw.tent_house_id,
    raw.wallet_denarii,
    raw.qualifying_denarii,
    raw.total_figs,
    raw.current_streak,
    raw.rhudes,
    raw.qualifying_denarii / rules.denarii_per_talent AS talents,
    public.calculate_normalized_marks(
      raw.lifetime_qualifying_streak_days,
      raw.qualifying_denarii,
      raw.rhudes,
      raw.total_figs
    ) AS marks
  FROM raw
  CROSS JOIN public.full_circle_economy_rules rules
  WHERE rules.rule_key = 'canonical';
$$;

REVOKE ALL ON FUNCTION public.get_member_mark_components()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_mark_components()
  TO service_role;

/* Marks and Tent movements start a new versioned snapshot series because the
   Streak term changed from live current streak to cumulative achievement. Old
   phase1-v1 rows stay available as historical evidence. */
CREATE OR REPLACE FUNCTION public.compute_competitive_board_movements_live(p_audience text)
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
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT
      timezone('Africa/Douala', now())::date AS today,
      timezone('Africa/Douala', now())::date::timestamp
        AT TIME ZONE 'Africa/Douala' AS midnight
  ), legacy AS MATERIALIZED (
    SELECT movement.*
    FROM public.compute_competitive_board_movements_pre_economy_v1(p_audience) movement
  ), live_members AS MATERIALIZED (
    SELECT member.*
    FROM public.get_member_mark_components() member
  ), prior_members AS (
    SELECT
      member.*,
      public.get_qualifying_denarii_total(member.user_id, clock.midnight)
        AS previous_qualifying_denarii,
      public.get_user_lifetime_figs(member.user_id, clock.midnight)
        AS previous_total_figs,
      public.get_lifetime_qualifying_streak_days(member.user_id, NULL)::numeric
        AS lifetime_qualifying_streak_days,
      public.get_lifetime_qualifying_streak_days(member.user_id, clock.today)::numeric
        AS previous_lifetime_qualifying_streak_days,
      coalesce(rhude.previous_value, member.rhudes::numeric) AS previous_rhudes
    FROM live_members member
    CROSS JOIN clock
    LEFT JOIN legacy rhude
      ON rhude.board_key = 'rhude'
     AND rhude.subject_id = member.user_id
  ), member_marks AS (
    SELECT
      member.*,
      public.calculate_normalized_marks(
        member.previous_lifetime_qualifying_streak_days,
        member.previous_qualifying_denarii,
        member.previous_rhudes,
        member.previous_total_figs
      ) AS previous_marks
    FROM prior_members member
  ), marks_ranked AS (
    SELECT
      member.*,
      rank() OVER (
        ORDER BY member.marks DESC, member.rhudes DESC, member.total_figs DESC,
          member.display_name ASC
      )::integer AS current_position,
      rank() OVER (
        ORDER BY member.previous_marks DESC, member.previous_rhudes DESC,
          member.previous_total_figs DESC, member.display_name ASC
      )::integer AS previous_position
    FROM member_marks member
    WHERE member.role = p_audience
      AND (member.marks > 0 OR member.previous_marks > 0)
  ), normalized_marks AS (
    SELECT
      'marks'::text AS board_key,
      ranked.user_id AS subject_id,
      jsonb_build_object(
        'user_id', ranked.user_id,
        'display_name', ranked.display_name,
        'avatar_url', ranked.avatar_url,
        'role', ranked.role,
        'tent_id', ranked.tent_id,
        'tent_name', ranked.tent_name,
        'tent_house_id', ranked.tent_house_id,
        'total_denarii', ranked.wallet_denarii,
        'qualifying_denarii', ranked.qualifying_denarii,
        'talents', ranked.talents,
        'total_figs', ranked.total_figs,
        'current_streak', ranked.current_streak,
        'lifetime_qualifying_streak_days', ranked.lifetime_qualifying_streak_days,
        'rhudes', ranked.rhudes,
        'marks', ranked.marks,
        'rank', ranked.current_position
      ) AS row_data,
      ranked.marks AS current_value,
      ranked.current_position AS current_rank,
      ranked.previous_marks AS previous_value,
      ranked.previous_position AS previous_rank,
      CASE
        WHEN ranked.marks > ranked.previous_marks THEN 1
        WHEN ranked.marks < ranked.previous_marks THEN -1
        WHEN ranked.current_position < ranked.previous_position THEN 1
        WHEN ranked.current_position > ranked.previous_position THEN -1
        ELSE 0
      END::integer AS movement,
      ranked.marks > coalesce((
        SELECT max(snapshot.record_value)
        FROM public.normalized_economy_board_daily_snapshots snapshot
        CROSS JOIN clock
        WHERE snapshot.formula_version = 'phase1b-v2'
          AND snapshot.board_key = 'marks'
          AND snapshot.audience = p_audience
          AND snapshot.subject_id = ranked.user_id
          AND snapshot.snapshot_date < clock.today
      ), ranked.previous_marks) AS is_new_record
    FROM marks_ranked ranked
  ), previous_tents AS (
    SELECT
      member.tent_id,
      coalesce(sum(member.previous_marks) FILTER (WHERE member.role = 'cadet'), 0)::numeric
        AS previous_marks
    FROM member_marks member
    WHERE member.tent_id IS NOT NULL
    GROUP BY member.tent_id
  ), live_tents AS MATERIALIZED (
    SELECT tent.*
    FROM public.get_tent_leaderboard() tent
    WHERE p_audience <> 'instructor'
  ), tent_ranked AS (
    SELECT
      tent.*,
      coalesce(previous.previous_marks, 0)::numeric AS previous_marks,
      rank() OVER (
        ORDER BY tent.combined_score DESC, tent.total_figs DESC, tent.total_streak DESC,
          tent.tent_name ASC
      )::integer AS current_position,
      rank() OVER (
        ORDER BY coalesce(previous.previous_marks, 0) DESC, tent.tent_name ASC
      )::integer AS previous_position
    FROM live_tents tent
    LEFT JOIN previous_tents previous ON previous.tent_id = tent.tent_id
  ), normalized_tents AS (
    SELECT
      'tent'::text AS board_key,
      ranked.tent_id AS subject_id,
      (to_jsonb(ranked) - 'previous_marks' - 'current_position' - 'previous_position')
        || jsonb_build_object('rank', ranked.current_position) AS row_data,
      ranked.combined_score AS current_value,
      ranked.current_position AS current_rank,
      ranked.previous_marks AS previous_value,
      ranked.previous_position AS previous_rank,
      CASE
        WHEN ranked.combined_score > ranked.previous_marks THEN 1
        WHEN ranked.combined_score < ranked.previous_marks THEN -1
        WHEN ranked.current_position < ranked.previous_position THEN 1
        WHEN ranked.current_position > ranked.previous_position THEN -1
        ELSE 0
      END::integer AS movement,
      ranked.combined_score > coalesce((
        SELECT max(snapshot.record_value)
        FROM public.normalized_economy_board_daily_snapshots snapshot
        CROSS JOIN clock
        WHERE snapshot.formula_version = 'phase1b-v2'
          AND snapshot.board_key = 'tent'
          AND snapshot.audience = 'all'
          AND snapshot.subject_id = ranked.tent_id
          AND snapshot.snapshot_date < clock.today
      ), ranked.previous_marks) AS is_new_record
    FROM tent_ranked ranked
  ), passthrough AS (
    SELECT legacy.*
    FROM legacy
    WHERE legacy.board_key NOT IN ('marks', 'tent')
  ), combined AS (
    SELECT * FROM passthrough
    UNION ALL
    SELECT * FROM normalized_marks
    UNION ALL
    SELECT * FROM normalized_tents
  )
  SELECT combined.*
  FROM combined
  ORDER BY combined.board_key, combined.current_rank, combined.subject_id;
$$;

REVOKE ALL ON FUNCTION public.compute_competitive_board_movements_live(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_competitive_board_movements_live(text)
  TO service_role;

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
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live record;
  v_snapshot_audience text;
  v_detected_movement integer;
  v_latched_movement integer;
  v_latched_record boolean;
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  FOR v_live IN
    SELECT result.*
    FROM public.compute_competitive_board_movements_live(p_audience) result
    ORDER BY result.board_key, result.current_rank, result.subject_id
  LOOP
    v_latched_movement := NULL;
    v_latched_record := false;
    v_snapshot_audience := CASE
      WHEN v_live.board_key = 'tent' THEN 'all'
      ELSE p_audience
    END;
    v_detected_movement := CASE
      WHEN v_live.current_value > v_live.previous_value THEN 1
      WHEN v_live.current_value < v_live.previous_value THEN -1
      WHEN v_live.current_rank < v_live.previous_rank THEN 1
      WHEN v_live.current_rank > v_live.previous_rank THEN -1
      ELSE 0
    END;

    IF v_live.board_key IN ('marks', 'tent') THEN
      UPDATE public.normalized_economy_board_daily_snapshots snapshot
      SET current_value = v_live.current_value,
          current_rank = v_live.current_rank,
          record_value = greatest(snapshot.record_value, v_live.current_value),
          day_movement = CASE
            WHEN v_detected_movement <> 0 THEN v_detected_movement
            ELSE snapshot.day_movement
          END,
          day_record = snapshot.day_record OR coalesce(v_live.is_new_record, false),
          updated_at = now()
      WHERE snapshot.formula_version = 'phase1b-v2'
        AND snapshot.board_key = v_live.board_key
        AND snapshot.audience = v_snapshot_audience
        AND snapshot.subject_id = v_live.subject_id
        AND snapshot.snapshot_date = v_today
      RETURNING snapshot.day_movement, snapshot.day_record
      INTO v_latched_movement, v_latched_record;

      IF NOT FOUND THEN
        INSERT INTO public.normalized_economy_board_daily_snapshots (
          formula_version,
          board_key,
          audience,
          subject_id,
          snapshot_date,
          opening_value,
          opening_rank,
          current_value,
          current_rank,
          record_value,
          day_movement,
          day_record,
          updated_at
        )
        VALUES (
          'phase1b-v2',
          v_live.board_key,
          v_snapshot_audience,
          v_live.subject_id,
          v_today,
          v_live.previous_value,
          v_live.previous_rank,
          v_live.current_value,
          v_live.current_rank,
          greatest(v_live.current_value, v_live.previous_value),
          v_detected_movement,
          coalesce(v_live.is_new_record, false),
          now()
        )
        ON CONFLICT (
          formula_version,
          board_key,
          audience,
          subject_id,
          snapshot_date
        ) DO UPDATE
          SET current_value = EXCLUDED.current_value,
              current_rank = EXCLUDED.current_rank,
              record_value = greatest(
                public.normalized_economy_board_daily_snapshots.record_value,
                EXCLUDED.current_value
              ),
              day_movement = CASE
                WHEN EXCLUDED.day_movement <> 0 THEN EXCLUDED.day_movement
                ELSE public.normalized_economy_board_daily_snapshots.day_movement
              END,
              day_record = public.normalized_economy_board_daily_snapshots.day_record
                OR EXCLUDED.day_record,
              updated_at = now()
        RETURNING
          normalized_economy_board_daily_snapshots.day_movement,
          normalized_economy_board_daily_snapshots.day_record
        INTO v_latched_movement, v_latched_record;
      END IF;
    ELSE
      UPDATE public.challenge_board_daily_snapshots snapshot
      SET current_value = v_live.current_value,
          current_rank = v_live.current_rank,
          record_value = greatest(snapshot.record_value, v_live.current_value),
          day_movement = CASE
            WHEN v_detected_movement <> 0 THEN v_detected_movement
            ELSE snapshot.day_movement
          END,
          day_record = snapshot.day_record OR coalesce(v_live.is_new_record, false),
          updated_at = now()
      WHERE snapshot.board_key = v_live.board_key
        AND snapshot.audience = v_snapshot_audience
        AND snapshot.subject_id = v_live.subject_id
        AND snapshot.snapshot_date = v_today
      RETURNING snapshot.day_movement, snapshot.day_record
      INTO v_latched_movement, v_latched_record;

      IF NOT FOUND THEN
        INSERT INTO public.challenge_board_daily_snapshots (
          board_key,
          audience,
          subject_id,
          snapshot_date,
          opening_value,
          opening_rank,
          current_value,
          current_rank,
          record_value,
          day_movement,
          day_record,
          updated_at
        )
        VALUES (
          v_live.board_key,
          v_snapshot_audience,
          v_live.subject_id,
          v_today,
          v_live.previous_value,
          v_live.previous_rank,
          v_live.current_value,
          v_live.current_rank,
          greatest(v_live.current_value, v_live.previous_value),
          v_detected_movement,
          coalesce(v_live.is_new_record, false),
          now()
        )
        ON CONFLICT ON CONSTRAINT challenge_board_daily_snapshots_pkey DO UPDATE
          SET current_value = EXCLUDED.current_value,
              current_rank = EXCLUDED.current_rank,
              record_value = greatest(
                public.challenge_board_daily_snapshots.record_value,
                EXCLUDED.current_value
              ),
              day_movement = CASE
                WHEN EXCLUDED.day_movement <> 0 THEN EXCLUDED.day_movement
                ELSE public.challenge_board_daily_snapshots.day_movement
              END,
              day_record = public.challenge_board_daily_snapshots.day_record
                OR EXCLUDED.day_record,
              updated_at = now()
        RETURNING
          challenge_board_daily_snapshots.day_movement,
          challenge_board_daily_snapshots.day_record
        INTO v_latched_movement, v_latched_record;
      END IF;
    END IF;

    board_key := v_live.board_key;
    subject_id := v_live.subject_id;
    row_data := v_live.row_data;
    current_value := v_live.current_value;
    current_rank := v_live.current_rank;
    previous_value := v_live.previous_value;
    previous_rank := v_live.previous_rank;
    movement := coalesce(
      nullif(v_latched_movement, 0),
      nullif(v_detected_movement, 0),
      0
    );
    is_new_record := coalesce(v_live.is_new_record, false)
      OR coalesce(v_latched_record, false);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_competitive_board_movements(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitive_board_movements(text)
  TO authenticated, service_role;

COMMENT ON TABLE public.streak_achievement_days IS
  'Server-owned, idempotent lifetime qualifying Streak days used by Marks; independent of current streak resets.';
COMMENT ON TABLE public.streak_achievement_baselines IS
  'Known minimum lifetime Streak achievement preserved without fabricating unavailable historical dates.';
COMMENT ON FUNCTION public.get_lifetime_qualifying_streak_days(uuid, date) IS
  'Returns cumulative credited Streak days before an optional exclusive Douala date boundary.';
