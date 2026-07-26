-- Fix promote_to_sentry to preserve data access
-- The cadet role is marked 'removed' but all data (denarii, streaks, records, relics) 
-- stays in the database tied to user_id, not to the role.
-- Sentries should still see their own stats from when they were cadets.
-- This migration ensures the SentryApp and shared screens can read historical data.

-- Update promote_to_sentry to also keep the cadet role as 'promoted' (not 'removed')
-- so that historical queries that filter on role='cadet' AND status='active' 
-- don't lose the sentry's data. We use 'promoted' status to distinguish from 'removed'.
CREATE OR REPLACE FUNCTION public.promote_to_sentry(p_user_id uuid, p_approver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
v_is_instructor boolean;
BEGIN
SELECT EXISTS(SELECT 1 FROM role_assignments WHERE user_id = p_approver_id AND role = 'instructor' AND status IN ('active','approved')) INTO v_is_instructor;
IF NOT v_is_instructor THEN RAISE EXCEPTION 'Only instructors can promote cadets'; END IF;

-- Mark the cadet role as 'promoted' instead of 'removed' so historical data is preserved
-- and queries that check for past cadet activity still work.
UPDATE role_assignments SET status = 'promoted', end_date = CURRENT_DATE 
WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active','approved');

-- Add the sentry role
INSERT INTO role_assignments (user_id, role, status, approver_id, start_date)
VALUES (p_user_id, 'sentry', 'active', p_approver_id, CURRENT_DATE) 
ON CONFLICT DO NOTHING;
END;
$function$;

-- Add a function to get a user's total denarii that works regardless of current role
-- (already exists as get_user_denarii_total, but ensure it doesn't filter by role)
-- It already doesn't filter by role — it just sums ledger entries by user_id. Good.

-- Ensure the streak computation works for sentries too (it already does — it queries by user_id)
-- No changes needed there.

-- Add a view that shows all users with their current denarii total and streak,
-- regardless of role, for the leaderboard to use.
CREATE OR REPLACE VIEW public.user_stats_summary AS
SELECT 
p.id AS user_id,
p.display_name,
COALESCE(d.total_denarii, 0) AS total_denarii,
COALESCE(s.current_streak, 0) AS current_streak,
COALESCE(s.longest_streak, 0) AS longest_streak,
ra.role AS current_role,
tm.tent_house_id
FROM profiles p
LEFT JOIN LATERAL (
SELECT get_user_denarii_total(p.id) AS total_denarii
) d ON true
LEFT JOIN LATERAL (
SELECT * FROM compute_strict_streak(p.id)
) s ON true
LEFT JOIN LATERAL (
SELECT role FROM role_assignments 
WHERE user_id = p.id AND status = 'active' 
ORDER BY start_date DESC LIMIT 1
) ra ON true
LEFT JOIN LATERAL (
SELECT t.tent_house_id 
FROM tent_members tm2 
JOIN tents t ON t.id = tm2.tent_id 
WHERE tm2.user_id = p.id 
LIMIT 1
) tm ON true;
