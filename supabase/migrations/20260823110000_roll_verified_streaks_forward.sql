/*
  Roll the verified August 22 streak totals forward from real daily evidence.

  The verified values supplied for Victoire and Courage were the totals at the
  close of August 22, not totals that already included August 23. Keeping the
  anchor on that explicit date lets the authoritative calculator add every
  later earned, restored, or purchased day exactly once.
*/

WITH verified_baselines AS (
  SELECT
    profile.id AS user_id,
    CASE
      WHEN regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%victoire%'
        THEN 27
      WHEN regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
        AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
        THEN 26
      ELSE NULL
    END AS verified_streak
  FROM public.profiles profile
)
INSERT INTO public.streak_manual_adjustments(
  user_id,
  effective_date,
  current_streak,
  longest_streak,
  reason
)
SELECT
  baseline.user_id,
  date '2026-08-22',
  baseline.verified_streak,
  greatest(baseline.verified_streak, coalesce(existing.longest_streak, 0)),
  CASE baseline.verified_streak
    WHEN 27 THEN 'Verified Victoire at 27 through 2026-08-22; replay later evidence'
    ELSE 'Verified Courage Webnjoh at 26 through 2026-08-22; replay later evidence'
  END
FROM verified_baselines baseline
LEFT JOIN public.streak_manual_adjustments existing
  ON existing.user_id = baseline.user_id
WHERE baseline.verified_streak IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = EXCLUDED.current_streak,
    longest_streak = greatest(
      public.streak_manual_adjustments.longest_streak,
      EXCLUDED.longest_streak
    ),
    reason = EXCLUDED.reason,
    created_at = now();

-- Recompute the visible values now. If today is already complete it is added
-- immediately; if it is completed later, the evidence triggers refresh it.
SELECT public.refresh_user_streak_snapshot(baseline.user_id)
FROM (
  SELECT profile.id AS user_id
  FROM public.profiles profile
  WHERE (
    regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%victoire%'
    OR (
      regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
      AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
    )
  )
) baseline;
