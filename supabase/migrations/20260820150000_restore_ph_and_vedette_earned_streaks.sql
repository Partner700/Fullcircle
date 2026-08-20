/* Explicitly preserve two verified earned streaks that were lowered by a
   historical snapshot mismatch. This is an audit record, not a daily bonus. */

CREATE TABLE IF NOT EXISTS public.streak_manual_adjustments (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  current_streak integer NOT NULL CHECK (current_streak >= 0),
  longest_streak integer NOT NULL CHECK (longest_streak >= current_streak),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.streak_manual_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.streak_manual_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.streak_manual_adjustments TO service_role;

INSERT INTO public.streak_manual_adjustments (user_id, effective_date, current_streak, longest_streak, reason)
SELECT profile.id, timezone('Africa/Douala', now())::date,
  CASE WHEN lower(trim(profile.display_name)) = 'ph' THEN 27 ELSE 24 END,
  CASE WHEN lower(trim(profile.display_name)) = 'ph' THEN 27 ELSE 24 END,
  'Restored verified earned streak after historical snapshot mismatch'
FROM public.profiles profile
WHERE lower(trim(profile.display_name)) IN ('ph', 'vedette', 'sentinel vedette')
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = EXCLUDED.current_streak,
    longest_streak = GREATEST(public.streak_manual_adjustments.longest_streak, EXCLUDED.longest_streak),
    reason = EXCLUDED.reason;

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date; v_check date; v_baseline_date date;
  v_baseline_current integer := 0; v_baseline_longest integer := 0;
  v_manual boolean := false;
  v_current integer := 0; v_longest integer := 0; v_consecutive integer := 0; v_cumulative integer := 0;
  v_requirement_met boolean; v_protected boolean; v_eligible boolean;
BEGIN
  SELECT least(coalesce((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    coalesce((SELECT min(record.record_date) FROM public.daily_records record WHERE record.user_id = p_user_id), v_today))
  INTO v_start FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_start IS NULL THEN RETURN QUERY SELECT 0, 0, 0, 0; RETURN; END IF;

  /* Manual earned corrections are authoritative at their effective date. All
     ordinary snapshots still need a real zero-loss boundary before they can
     seed a chain. */
  SELECT baseline.snapshot_date, baseline.current_value, baseline.longest_value, baseline.is_manual
  INTO v_baseline_date, v_baseline_current, v_baseline_longest, v_manual
  FROM (
    SELECT adjustment.effective_date AS snapshot_date, adjustment.current_streak AS current_value,
      adjustment.longest_streak AS longest_value, true AS is_manual
    FROM public.streak_manual_adjustments adjustment
    WHERE adjustment.user_id = p_user_id AND adjustment.effective_date <= v_today
    UNION ALL
    SELECT snapshot.snapshot_date, coalesce(snapshot.current_streak, 0),
      greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0)), false
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = p_user_id AND coalesce(snapshot.current_streak, 0) > 0
      AND snapshot.snapshot_date < v_today
      AND snapshot.snapshot_date > coalesce((
        SELECT max(lost.snapshot_date) FROM public.streakboard_snapshots lost
        WHERE lost.user_id = p_user_id AND lost.snapshot_date < v_today
          AND coalesce(lost.current_streak, 0) = 0
      ), date '0001-01-01')
  ) baseline
  ORDER BY baseline.is_manual DESC, baseline.current_value DESC, baseline.snapshot_date DESC
  LIMIT 1;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    IF v_baseline_date IS NOT NULL AND v_check = v_baseline_date THEN
      v_current := greatest(v_current, v_baseline_current);
      v_longest := greatest(v_longest, v_baseline_longest, v_current);
      v_consecutive := 0; v_check := v_check + 1; CONTINUE;
    END IF;

    v_requirement_met := public.streak_requirement_met(p_user_id, v_check);
    v_protected := false;
    IF NOT v_requirement_met THEN
      v_protected := public.streak_day_is_protected(p_user_id, v_check);
      IF NOT v_protected AND v_current > 0
         AND extract(dow FROM v_check) BETWEEN 1 AND 5
         AND (v_check < v_today OR v_local_time >= time '21:00') THEN
        v_protected := public.activate_streak_freezer_for_date(p_user_id, v_check);
      END IF;
    END IF;

    v_eligible := CASE
      WHEN extract(dow FROM v_check) = 0 THEN v_requirement_met OR v_protected
      WHEN extract(dow FROM v_check) = 6 THEN EXISTS (
        SELECT 1 FROM public.quiz_sessions session
        WHERE session.session_date = v_check AND session.quiz_type = 'saturday'
      ) OR v_requirement_met OR v_protected
      ELSE true
    END;
    IF NOT v_eligible OR (v_check = v_today AND NOT v_requirement_met AND NOT v_protected AND v_local_time < time '21:00') THEN
      v_check := v_check + 1; CONTINUE;
    END IF;

    IF v_protected AND NOT v_requirement_met THEN
      v_consecutive := 0;
    ELSIF v_requirement_met THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSE
      v_current := 0;
      v_consecutive := v_consecutive + 1;
      v_cumulative := v_cumulative + 1;
    END IF;
    v_check := v_check + 1;
  END LOOP;
  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated, service_role;

INSERT INTO public.streakboard_snapshots (snapshot_date, user_id, current_streak, longest_streak)
SELECT adjustment.effective_date, adjustment.user_id, adjustment.current_streak, adjustment.longest_streak
FROM public.streak_manual_adjustments adjustment
ON CONFLICT DO NOTHING;
