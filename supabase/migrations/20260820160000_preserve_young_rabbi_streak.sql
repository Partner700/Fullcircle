/* Preserve Young Rabbi's verified five-day streak baseline. The calculator
   may continue the streak from this date, but must not rebuild it from a
   lower historical chain after a snapshot refresh. */

INSERT INTO public.streak_manual_adjustments (
  user_id,
  effective_date,
  current_streak,
  longest_streak,
  reason
)
SELECT
  profile.id,
  timezone('Africa/Douala', now())::date,
  5,
  GREATEST(
    5,
    COALESCE((
      SELECT MAX(snapshot.longest_streak)
      FROM public.streakboard_snapshots snapshot
      WHERE snapshot.user_id = profile.id
    ), 0)
  ),
  'Preserved verified Young Rabbi streak after an erroneous downward recalculation'
FROM public.profiles profile
WHERE lower(trim(profile.display_name)) = 'young rabbi'
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = GREATEST(public.streak_manual_adjustments.current_streak, EXCLUDED.current_streak),
    longest_streak = GREATEST(public.streak_manual_adjustments.longest_streak, EXCLUDED.longest_streak),
    reason = EXCLUDED.reason;

INSERT INTO public.streakboard_snapshots (snapshot_date, user_id, current_streak, longest_streak)
SELECT adjustment.effective_date, adjustment.user_id, adjustment.current_streak, adjustment.longest_streak
FROM public.streak_manual_adjustments adjustment
JOIN public.profiles profile ON profile.id = adjustment.user_id
WHERE lower(trim(profile.display_name)) = 'young rabbi'
ON CONFLICT DO NOTHING;
