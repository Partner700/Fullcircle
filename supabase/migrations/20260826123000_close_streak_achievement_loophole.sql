/*
  Full Circle economy normalization, phase 1C.

  Current streak continuity may still be preserved by Simon purchases,
  freezers, relics, and administrative corrections. Lifetime Streak
  achievement is narrower: only a genuinely completed qualifying day or an
  explicitly verified recovery of such a completion earns one Mark.
*/

CREATE TABLE IF NOT EXISTS public.streak_achievement_verified_restorations (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_date date NOT NULL,
  evidence_reference text NOT NULL CHECK (btrim(evidence_reference) <> ''),
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_date)
);

CREATE INDEX IF NOT EXISTS streak_achievement_verified_restorations_date_idx
  ON public.streak_achievement_verified_restorations (achievement_date, user_id);

ALTER TABLE public.streak_achievement_verified_restorations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.streak_achievement_verified_restorations
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.streak_achievement_verified_restorations TO service_role;

/* This function is the single qualification boundary for new cumulative
   Streak achievement. Continuity-only evidence is deliberately absent. */
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

  IF EXISTS (
    SELECT 1
    FROM public.streak_achievement_verified_restorations verification
    WHERE verification.user_id = p_user_id
      AND verification.achievement_date = p_achievement_date
  ) THEN
    RETURN 'restored';
  END IF;

  -- Purchases, freezers, relic protection, and unsupported continuity edits
  -- may affect current_streak but never create demonstrated achievement.
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
        ELSE 'restored'
      END,
      last_confirmed_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_streak_achievement_day(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_streak_achievement_day(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.capture_verified_streak_achievement_restoration()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_streak_achievement_day(NEW.user_id, NEW.achievement_date);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_verified_streak_achievement_restoration()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_verified_streak_achievement_restoration
  ON public.streak_achievement_verified_restorations;
CREATE TRIGGER capture_verified_streak_achievement_restoration
AFTER INSERT ON public.streak_achievement_verified_restorations
FOR EACH ROW EXECUTE FUNCTION public.capture_verified_streak_achievement_restoration();

/* Operational entry point for a restoration backed by evidence that the user
   really completed the activity. This is intentionally service-role only. */
CREATE OR REPLACE FUNCTION public.record_verified_streak_restoration(
  p_user_id uuid,
  p_achievement_date date,
  p_evidence_reference text,
  p_verified_by uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL
    OR p_achievement_date IS NULL
    OR p_achievement_date > timezone('Africa/Douala', now())::date
    OR NULLIF(btrim(p_evidence_reference), '') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id = p_user_id)
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.streak_achievement_verified_restorations (
    user_id,
    achievement_date,
    evidence_reference,
    verified_by,
    verified_at
  ) VALUES (
    p_user_id,
    p_achievement_date,
    btrim(p_evidence_reference),
    p_verified_by,
    now()
  )
  ON CONFLICT (user_id, achievement_date) DO UPDATE
  SET evidence_reference = EXCLUDED.evidence_reference,
      verified_by = coalesce(
        EXCLUDED.verified_by,
        public.streak_achievement_verified_restorations.verified_by
      ),
      verified_at = now();

  -- Also repairs a missing ledger row when the verification already existed.
  RETURN public.record_streak_achievement_day(p_user_id, p_achievement_date);
END;
$$;

REVOKE ALL ON FUNCTION public.record_verified_streak_restoration(uuid, date, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_streak_restoration(uuid, date, text, uuid)
  TO service_role;

/* Reclassify any old continuity credit that now has genuine completion proof,
   then remove only the reliably distinguishable purchase/convenience rows.
   Earned rows are immutable lifetime achievements and are never reduced. */
UPDATE public.streak_achievement_days achievement
SET source_kind = public.streak_achievement_source(
      achievement.user_id,
      achievement.achievement_date
    ),
    last_confirmed_at = now()
WHERE achievement.source_kind IN ('purchased', 'restored')
  AND public.streak_achievement_source(
    achievement.user_id,
    achievement.achievement_date
  ) IS NOT NULL;

DELETE FROM public.streak_achievement_days achievement
WHERE achievement.source_kind IN ('purchased', 'restored')
  AND public.streak_achievement_source(
    achievement.user_id,
    achievement.achievement_date
  ) IS NULL;

ALTER TABLE public.streak_achievement_days
  DROP CONSTRAINT IF EXISTS streak_achievement_days_source_kind_check;
ALTER TABLE public.streak_achievement_days
  ADD CONSTRAINT streak_achievement_days_source_kind_check
  CHECK (source_kind IN ('earned', 'restored'));

/* Freezers and continuity adjustments must not even attempt to write to the
   lifetime ledger. Their current-streak behavior remains unchanged. */
DROP TRIGGER IF EXISTS capture_streak_achievement_from_freezer
  ON public.streak_freezers;
DROP FUNCTION IF EXISTS public.capture_streak_achievement_from_freezer();

DROP TRIGGER IF EXISTS capture_streak_achievement_baseline_change
  ON public.streak_manual_adjustments;
DROP FUNCTION IF EXISTS public.capture_streak_achievement_baseline_change();

/* Backfill exact demonstrated dates only. No freezer, Simon, relic, manual
   adjustment, or current-streak snapshot is accepted as completion evidence. */
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

  SELECT verification.user_id, verification.achievement_date
  FROM public.streak_achievement_verified_restorations verification
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
      ELSE 'restored'
    END,
    last_confirmed_at = now();

/* Phase 1B continuity baselines are retained as audit evidence, but they can
   no longer fabricate lifetime achievement without exact qualifying dates. */
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
  )
  SELECT count(*)::bigint
  FROM public.streak_achievement_days achievement
  CROSS JOIN clock
  WHERE achievement.user_id = p_user_id
    AND achievement.achievement_date < clock.exclusive_end;
$$;

REVOKE ALL ON FUNCTION public.get_lifetime_qualifying_streak_days(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lifetime_qualifying_streak_days(uuid, date)
  TO service_role;

COMMENT ON TABLE public.streak_achievement_verified_restorations IS
  'Service-owned proof that a missing lifetime Streak day reflects activity actually completed by the user.';
COMMENT ON TABLE public.streak_achievement_days IS
  'Server-owned, idempotent demonstrated Streak days: genuine completion or explicitly verified completion recovery only.';
COMMENT ON TABLE public.streak_achievement_baselines IS
  'Legacy phase 1B continuity anchors retained for audit only; not counted as lifetime qualifying Streak achievement.';
COMMENT ON FUNCTION public.streak_achievement_source(uuid, date) IS
  'Returns earned for authoritative completion, restored for explicit verified completion recovery, and null for continuity-only assistance.';
COMMENT ON FUNCTION public.get_lifetime_qualifying_streak_days(uuid, date) IS
  'Counts exact demonstrated Streak achievement dates before an optional exclusive Douala date boundary.';
