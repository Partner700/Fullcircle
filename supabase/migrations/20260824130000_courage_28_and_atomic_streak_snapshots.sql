/*
  Restore Courage Webnjoh's verified 28-day total for 24 August 2026 and make
  published streak snapshots atomic for every user.

  The live calculator remains authoritative. This migration only removes the
  possibility of duplicate same-day snapshots disagreeing across views and
  adds an hourly reconciliation fallback alongside the immediate evidence
  triggers installed by the canonical lifecycle migration.
*/

/* Keep the strongest historical row before enforcing one published value per
   user and app-calendar day. Today's rows are recalculated below. */
WITH ranked_snapshots AS (
  SELECT
    snapshot.id,
    row_number() OVER (
      PARTITION BY snapshot.snapshot_date, snapshot.user_id
      ORDER BY
        coalesce(snapshot.current_streak, 0) DESC,
        coalesce(snapshot.longest_streak, 0) DESC,
        snapshot.created_at DESC NULLS LAST,
        snapshot.id DESC
    ) AS row_number
  FROM public.streakboard_snapshots snapshot
)
DELETE FROM public.streakboard_snapshots snapshot
USING ranked_snapshots ranked
WHERE snapshot.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS streakboard_one_user_per_day_idx
ON public.streakboard_snapshots(snapshot_date, user_id);

CREATE OR REPLACE FUNCTION public.refresh_user_streak_snapshot(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_snapshot_id uuid;
  v_tent_id uuid;
  v_tent_house_id text;
  v_streak record;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id = p_user_id
  ) THEN
    RETURN jsonb_build_object('refreshed', false, 'reason', 'profile_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('full-circle-streak-snapshot:' || p_user_id::text, 0)
  );

  SELECT * INTO v_streak
  FROM public.get_authoritative_streak(p_user_id)
  LIMIT 1;

  SELECT member.tent_id, tent.tent_house_id
  INTO v_tent_id, v_tent_house_id
  FROM public.tent_members member
  LEFT JOIN public.tents tent ON tent.id = member.tent_id
  WHERE member.user_id = p_user_id
  ORDER BY member.joined_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO public.streakboard_snapshots AS published(
    snapshot_date,
    user_id,
    tent_id,
    tent_house_id,
    current_streak,
    longest_streak
  ) VALUES (
    v_today,
    p_user_id,
    v_tent_id,
    v_tent_house_id,
    coalesce(v_streak.current_streak, 0),
    coalesce(v_streak.longest_streak, 0)
  )
  ON CONFLICT (snapshot_date, user_id) DO UPDATE
  SET tent_id = coalesce(EXCLUDED.tent_id, published.tent_id),
      tent_house_id = coalesce(EXCLUDED.tent_house_id, published.tent_house_id),
      current_streak = EXCLUDED.current_streak,
      longest_streak = greatest(
        coalesce(published.longest_streak, 0),
        coalesce(EXCLUDED.longest_streak, 0),
        coalesce(EXCLUDED.current_streak, 0)
      )
  RETURNING id INTO v_snapshot_id;

  RETURN jsonb_build_object(
    'refreshed', true,
    'user_id', p_user_id,
    'snapshot_id', v_snapshot_id,
    'snapshot_date', v_today,
    'current_streak', coalesce(v_streak.current_streak, 0),
    'longest_streak', coalesce(v_streak.longest_streak, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_user_streak_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_streak_snapshot(uuid)
  TO service_role;

/* This is the verified total through today. Dating the baseline today means
   today's evidence is included exactly once, and tomorrow resumes normal
   evidence-based advancement from 28. */
WITH courage_profiles AS (
  SELECT profile.id AS user_id
  FROM public.profiles profile
  WHERE regexp_replace(
      lower(trim(profile.display_name)),
      '[^a-z0-9]+',
      '',
      'g'
    ) LIKE '%courage%'
    AND regexp_replace(
      lower(trim(profile.display_name)),
      '[^a-z0-9]+',
      '',
      'g'
    ) LIKE '%webnjoh%'
)
INSERT INTO public.streak_manual_adjustments(
  user_id,
  effective_date,
  current_streak,
  longest_streak,
  reason
)
SELECT
  courage.user_id,
  date '2026-08-24',
  28,
  greatest(28, coalesce(existing.longest_streak, 0)),
  'Verified Courage Webnjoh at 28 through 2026-08-24; continue from live daily evidence'
FROM courage_profiles courage
LEFT JOIN public.streak_manual_adjustments existing
  ON existing.user_id = courage.user_id
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = 28,
    longest_streak = greatest(
      public.streak_manual_adjustments.longest_streak,
      EXCLUDED.longest_streak,
      28
    ),
    reason = EXCLUDED.reason,
    created_at = now();

/* Reconcile every current view now, not only Courage's. */
SELECT public.refresh_all_streak_snapshots();

/* Evidence triggers remain the immediate path. This hourly run is a fallback
   for interrupted clients, old releases, and any administrative bulk update. */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('full-circle-streak-snapshots');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'full-circle-streak-snapshots',
      '7 * * * *',
      'SELECT public.refresh_all_streak_snapshots();'
    );
  END IF;
END;
$$;
