/*
  Full Circle economy normalization, phase 1.

  Canonical equivalence:
    1 current streak day = 1 Mark
    6,000 qualifying lifetime-earned Denarii = 1 Talent = 1 Mark
    6 Rhudes = 1 Mark
    300 Figs = 1 Mark

  Wallet Denarii remain spendable. Marks use a private achievement ledger of
  qualifying positive rewards, so purchases never erase achievement.
*/

CREATE TABLE IF NOT EXISTS public.full_circle_economy_rules (
  rule_key text PRIMARY KEY,
  streaks_per_mark numeric NOT NULL CHECK (streaks_per_mark > 0),
  denarii_per_talent numeric NOT NULL CHECK (denarii_per_talent > 0),
  talents_per_mark numeric NOT NULL CHECK (talents_per_mark > 0),
  rhudes_per_mark numeric NOT NULL CHECK (rhudes_per_mark > 0),
  figs_per_mark numeric NOT NULL CHECK (figs_per_mark > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.full_circle_economy_rules (
  rule_key,
  streaks_per_mark,
  denarii_per_talent,
  talents_per_mark,
  rhudes_per_mark,
  figs_per_mark,
  updated_at
)
VALUES ('canonical', 1, 6000, 1, 6, 300, now())
ON CONFLICT (rule_key) DO UPDATE
SET streaks_per_mark = EXCLUDED.streaks_per_mark,
    denarii_per_talent = EXCLUDED.denarii_per_talent,
    talents_per_mark = EXCLUDED.talents_per_mark,
    rhudes_per_mark = EXCLUDED.rhudes_per_mark,
    figs_per_mark = EXCLUDED.figs_per_mark,
    updated_at = now();

ALTER TABLE public.full_circle_economy_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.full_circle_economy_rules FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_full_circle_economy_rules()
RETURNS TABLE (
  streaks_per_mark numeric,
  denarii_per_talent numeric,
  talents_per_mark numeric,
  rhudes_per_mark numeric,
  figs_per_mark numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    rules.streaks_per_mark,
    rules.denarii_per_talent,
    rules.talents_per_mark,
    rules.rhudes_per_mark,
    rules.figs_per_mark
  FROM public.full_circle_economy_rules rules
  WHERE rules.rule_key = 'canonical';
$$;

REVOKE ALL ON FUNCTION public.get_full_circle_economy_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_full_circle_economy_rules() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calculate_normalized_marks(
  p_streaks numeric,
  p_qualifying_denarii numeric,
  p_rhudes numeric,
  p_figs numeric
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    greatest(coalesce(p_streaks, 0), 0) / rules.streaks_per_mark
    + (
        greatest(coalesce(p_qualifying_denarii, 0), 0)
        / rules.denarii_per_talent
      ) / rules.talents_per_mark
    + greatest(coalesce(p_rhudes, 0), 0) / rules.rhudes_per_mark
    + greatest(coalesce(p_figs, 0), 0) / rules.figs_per_mark
  FROM public.full_circle_economy_rules rules
  WHERE rules.rule_key = 'canonical';
$$;

REVOKE ALL ON FUNCTION public.calculate_normalized_marks(numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_normalized_marks(numeric, numeric, numeric, numeric)
  TO service_role;

/* Qualifying Denarii are explicit. Purchases, deposits, refunds, inherited
   balances, fees, stakes and manual balance adjustments do not manufacture
   achievement Marks. */
CREATE OR REPLACE FUNCTION public.denarii_entry_qualifies_for_marks(
  p_source_type text,
  p_amount integer,
  p_description text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(p_amount, 0) > 0
    AND p_source_type IN (
      'game_level',
      'game_blitz',
      'quiz_reward',
      'fortune_quiz_reward',
      'relic_reward',
      'attendance',
      'arena_reward',
      'notification_opt_in',
      'challenge_submission'
    )
    AND NOT (
      p_source_type = 'arena_reward'
      AND lower(coalesce(p_description, '')) LIKE '%refund%'
    );
$$;

REVOKE ALL ON FUNCTION public.denarii_entry_qualifies_for_marks(text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.denarii_entry_qualifies_for_marks(text, integer, text)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.denarii_achievement_entries (
  ledger_entry_id uuid PRIMARY KEY
    REFERENCES public.denarii_ledger_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  source_type text NOT NULL,
  source_reference text,
  earned_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS denarii_achievement_reference_uidx
  ON public.denarii_achievement_entries (user_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS denarii_achievement_user_earned_idx
  ON public.denarii_achievement_entries (user_id, earned_at);

ALTER TABLE public.denarii_achievement_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.denarii_achievement_entries FROM PUBLIC, anon, authenticated;

WITH qualifying AS (
  SELECT
    entry.id AS ledger_entry_id,
    entry.user_id,
    entry.amount,
    entry.source_type,
    entry.source_reference,
    coalesce(entry.created_at, now()) AS earned_at,
    row_number() OVER (
      PARTITION BY
        entry.user_id,
        entry.source_type,
        CASE
          WHEN entry.source_reference IS NULL THEN 'ledger:' || entry.id::text
          ELSE 'reference:' || entry.source_reference
        END
      ORDER BY entry.created_at ASC NULLS LAST, entry.id ASC
    ) AS replay_number
  FROM public.denarii_ledger_entries entry
  WHERE public.denarii_entry_qualifies_for_marks(
    entry.source_type,
    entry.amount,
    entry.description
  )
)
INSERT INTO public.denarii_achievement_entries (
  ledger_entry_id,
  user_id,
  amount,
  source_type,
  source_reference,
  earned_at
)
SELECT
  qualifying.ledger_entry_id,
  qualifying.user_id,
  qualifying.amount,
  qualifying.source_type,
  qualifying.source_reference,
  qualifying.earned_at
FROM qualifying
WHERE qualifying.replay_number = 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.capture_qualifying_denarii_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.denarii_achievement_entries achievement
  WHERE achievement.ledger_entry_id = NEW.id;

  IF NOT public.denarii_entry_qualifies_for_marks(
    NEW.source_type,
    NEW.amount,
    NEW.description
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.source_reference IS NULL THEN
    INSERT INTO public.denarii_achievement_entries (
      ledger_entry_id,
      user_id,
      amount,
      source_type,
      source_reference,
      earned_at
    )
    VALUES (
      NEW.id,
      NEW.user_id,
      NEW.amount,
      NEW.source_type,
      NULL,
      coalesce(NEW.created_at, now())
    )
    ON CONFLICT (ledger_entry_id) DO NOTHING;
  ELSE
    INSERT INTO public.denarii_achievement_entries (
      ledger_entry_id,
      user_id,
      amount,
      source_type,
      source_reference,
      earned_at
    )
    VALUES (
      NEW.id,
      NEW.user_id,
      NEW.amount,
      NEW.source_type,
      NEW.source_reference,
      coalesce(NEW.created_at, now())
    )
    ON CONFLICT (user_id, source_type, source_reference)
      WHERE source_reference IS NOT NULL
      DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_qualifying_denarii_achievement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS denarii_achievement_capture
  ON public.denarii_ledger_entries;
CREATE TRIGGER denarii_achievement_capture
AFTER INSERT OR UPDATE OF amount, source_type, source_reference, description, created_at
ON public.denarii_ledger_entries
FOR EACH ROW
EXECUTE FUNCTION public.capture_qualifying_denarii_achievement();

CREATE OR REPLACE FUNCTION public.get_qualifying_denarii_total(
  p_user_id uuid,
  p_before timestamptz DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(achievement.amount), 0)::numeric
  FROM public.denarii_achievement_entries achievement
  WHERE achievement.user_id = p_user_id
    AND (p_before IS NULL OR achievement.earned_at < p_before);
$$;

REVOKE ALL ON FUNCTION public.get_qualifying_denarii_total(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_qualifying_denarii_total(uuid, timestamptz)
  TO service_role;

/* This preserves the Fig sources already used by the application. Assisted
   quiz answers use the attempt's server-computed Fig total when available. */
CREATE OR REPLACE FUNCTION public.get_user_lifetime_figs(
  p_user_id uuid,
  p_before timestamptz DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH quiz_attempt_figs AS (
    SELECT
      attempt.id,
      attempt.user_id,
      attempt.submitted_at,
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
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
    LEFT JOIN public.generated_questions question
      ON question.id = response.question_id
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (p_before IS NULL OR attempt.submitted_at < p_before)
    GROUP BY attempt.id, attempt.user_id, attempt.submitted_at, attempt.talents_scored
  ), fig_sources AS (
    SELECT coalesce(sum(attempt.score), 0)::numeric AS figs
    FROM public.game_attempts attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
      AND (p_before IS NULL OR attempt.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(participant.score), 0)::numeric
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.user_id = p_user_id
      AND participant.finished_at IS NOT NULL
      AND room.status = 'completed'
      AND (p_before IS NULL OR participant.finished_at < p_before)
      AND (p_before IS NULL OR room.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(quiz.figs), 0)::numeric
    FROM quiz_attempt_figs quiz
  )
  SELECT coalesce(sum(source.figs), 0)::numeric
  FROM fig_sources source;
$$;

REVOKE ALL ON FUNCTION public.get_user_lifetime_figs(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_lifetime_figs(uuid, timestamptz)
  TO service_role;

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
      raw.current_streak,
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

CREATE OR REPLACE FUNCTION public.get_marks_board_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text,
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  total_denarii bigint,
  total_figs numeric,
  current_streak integer,
  rhudes bigint,
  marks numeric,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
  SELECT
    member.user_id,
    member.display_name,
    member.avatar_url,
    member.role,
    member.tent_id,
    member.tent_name,
    member.tent_house_id,
    member.wallet_denarii AS total_denarii,
    member.total_figs,
    member.current_streak,
    member.rhudes,
    member.marks,
    rank() OVER (
      ORDER BY member.marks DESC, member.rhudes DESC, member.total_figs DESC, member.display_name ASC
    )::integer AS rank
  FROM public.get_member_mark_components() member
  WHERE member.marks > 0
  ORDER BY rank ASC, member.display_name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_marks_board_live() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marks_board_live() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_tent_leaderboard()
RETURNS TABLE (
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  tent_profile_image_url text,
  sentry_names text[],
  cadet_count bigint,
  total_denarii bigint,
  total_streak bigint,
  total_figs numeric,
  combined_score numeric,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
  WITH components AS MATERIALIZED (
    SELECT * FROM public.get_member_mark_components()
  ), rows AS (
    SELECT
      tent.id AS tent_id,
      tent.name AS tent_name,
      tent.tent_house_id,
      tent.profile_image_url AS tent_profile_image_url,
      coalesce(
        array_remove(
          array_agg(profile.display_name ORDER BY profile.display_name)
            FILTER (WHERE member.role = 'sentry'),
          NULL
        ),
        ARRAY[]::text[]
      ) AS sentry_names,
      count(component.user_id)::bigint AS cadet_count,
      coalesce(sum(component.wallet_denarii), 0)::bigint AS total_denarii,
      coalesce(sum(component.current_streak), 0)::bigint AS total_streak,
      coalesce(sum(component.total_figs), 0)::numeric AS total_figs,
      coalesce(sum(component.marks), 0)::numeric AS combined_score
    FROM public.tents tent
    LEFT JOIN public.tent_members member ON member.tent_id = tent.id
    LEFT JOIN public.profiles profile ON profile.id = member.user_id
    LEFT JOIN components component
      ON component.user_id = member.user_id
     AND component.role = 'cadet'
    GROUP BY tent.id, tent.name, tent.tent_house_id, tent.profile_image_url
  )
  SELECT
    rows.*,
    rank() OVER (
      ORDER BY rows.combined_score DESC, rows.total_figs DESC, rows.total_streak DESC, rows.tent_name ASC
    )::bigint AS rank
  FROM rows
  ORDER BY rank ASC, rows.tent_name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_tent_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tent_leaderboard() TO authenticated, service_role;

/* Old Marks and Tent snapshots use a different numerical scale. Keep them as
   historical evidence, and start a versioned normalized series beside them. */
CREATE TABLE IF NOT EXISTS public.normalized_economy_board_daily_snapshots (
  formula_version text NOT NULL,
  board_key text NOT NULL CHECK (board_key IN ('marks', 'tent')),
  audience text NOT NULL,
  subject_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  opening_value numeric NOT NULL DEFAULT 0,
  opening_rank integer,
  current_value numeric NOT NULL DEFAULT 0,
  current_rank integer,
  record_value numeric NOT NULL DEFAULT 0,
  day_movement integer NOT NULL DEFAULT 0 CHECK (day_movement IN (-1, 0, 1)),
  day_record boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (formula_version, board_key, audience, subject_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS normalized_economy_board_snapshot_lookup_idx
  ON public.normalized_economy_board_daily_snapshots (
    formula_version,
    board_key,
    audience,
    subject_id,
    snapshot_date DESC
  );

ALTER TABLE public.normalized_economy_board_daily_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.normalized_economy_board_daily_snapshots
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.compute_competitive_board_movements_live(text)
  RENAME TO compute_competitive_board_movements_pre_economy_v1;

REVOKE ALL ON FUNCTION public.compute_competitive_board_movements_pre_economy_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_competitive_board_movements_pre_economy_v1(text)
  TO service_role;

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
      public.get_qualifying_denarii_total(member.user_id, clock.midnight) AS previous_qualifying_denarii,
      public.get_user_lifetime_figs(member.user_id, clock.midnight) AS previous_total_figs,
      coalesce(streak.previous_value, member.current_streak::numeric) AS previous_streak,
      coalesce(rhude.previous_value, member.rhudes::numeric) AS previous_rhudes
    FROM live_members member
    CROSS JOIN clock
    LEFT JOIN legacy streak
      ON streak.board_key = 'streak'
     AND streak.subject_id = member.user_id
    LEFT JOIN legacy rhude
      ON rhude.board_key = 'rhude'
     AND rhude.subject_id = member.user_id
  ), member_marks AS (
    SELECT
      member.*,
      public.calculate_normalized_marks(
        member.previous_streak,
        member.previous_qualifying_denarii,
        member.previous_rhudes,
        member.previous_total_figs
      ) AS previous_marks
    FROM prior_members member
  ), marks_ranked AS (
    SELECT
      member.*,
      rank() OVER (
        ORDER BY member.marks DESC, member.rhudes DESC, member.total_figs DESC, member.display_name ASC
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
        WHERE snapshot.formula_version = 'phase1-v1'
          AND snapshot.board_key = 'marks'
          AND snapshot.audience = p_audience
          AND snapshot.subject_id = ranked.user_id
          AND snapshot.snapshot_date < clock.today
      ), ranked.previous_marks) AS is_new_record
    FROM marks_ranked ranked
  ), previous_tents AS (
    SELECT
      member.tent_id,
      coalesce(sum(member.previous_marks) FILTER (WHERE member.role = 'cadet'), 0)::numeric AS previous_marks
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
        ORDER BY tent.combined_score DESC, tent.total_figs DESC, tent.total_streak DESC, tent.tent_name ASC
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
        WHERE snapshot.formula_version = 'phase1-v1'
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
      WHERE snapshot.formula_version = 'phase1-v1'
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
          'phase1-v1',
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

COMMENT ON TABLE public.denarii_achievement_entries IS
  'Server-owned, idempotent lifetime Denarii achievements used by normalized Marks; independent of wallet spending.';
