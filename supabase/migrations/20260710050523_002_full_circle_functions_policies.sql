/*
# Full Circle Portal — Helper Functions & RLS Policies

## Overview
Adds SECURITY DEFINER helper functions for role checks, then creates all RLS policies
on every table. Policies enforce: cadets see/modify own data; sentries manage their
tent's attendance; instructors manage everything.
*/

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_active_role(p_user_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT role FROM role_assignments
  WHERE user_id = p_user_id AND status IN ('active', 'approved')
  ORDER BY created_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_instructor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignments
    WHERE user_id = p_user_id AND role = 'instructor' AND status IN ('active','approved')
  );
$$;

CREATE OR REPLACE FUNCTION is_sentry(p_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignments
    WHERE user_id = p_user_id AND role = 'sentry' AND status IN ('active','approved')
  );
$$;

CREATE OR REPLACE FUNCTION get_user_tent_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT tent_id FROM tent_members WHERE user_id = p_user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_sentry_of_tent(p_user_id uuid, p_tent_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tents t
    JOIN role_assignments ra ON ra.user_id = p_user_id AND ra.role = 'sentry' AND ra.status IN ('active','approved')
    WHERE t.id = p_tent_id AND t.sentry_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION is_cadet_of_tent(p_user_id uuid, p_tent_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tent_members WHERE user_id = p_user_id AND tent_id = p_tent_id
  );
$$;

-- ============================================================
-- TENT HOUSES (public read)
-- ============================================================
DROP POLICY IF EXISTS "read_tent_houses" ON tent_houses;
CREATE POLICY "read_tent_houses" ON tent_houses FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- PROFILES
-- ============================================================
DROP POLICY IF EXISTS "read_profiles" ON profiles;
CREATE POLICY "read_profiles" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- ROLE ASSIGNMENTS
-- ============================================================
DROP POLICY IF EXISTS "read_role_assignments" ON role_assignments;
CREATE POLICY "read_role_assignments" ON role_assignments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_own_role_assignment" ON role_assignments;
CREATE POLICY "insert_own_role_assignment" ON role_assignments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_role_assignments" ON role_assignments;
CREATE POLICY "update_role_assignments" ON role_assignments FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));

-- ============================================================
-- TENTS
-- ============================================================
DROP POLICY IF EXISTS "read_tents" ON tents;
CREATE POLICY "read_tents" ON tents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_tents_instructor" ON tents;
CREATE POLICY "insert_tents_instructor" ON tents FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_tents_instructor" ON tents;
CREATE POLICY "update_tents_instructor" ON tents FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_tents_instructor" ON tents;
CREATE POLICY "delete_tents_instructor" ON tents FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- TENT MEMBERS
-- ============================================================
DROP POLICY IF EXISTS "read_tent_members" ON tent_members;
CREATE POLICY "read_tent_members" ON tent_members FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_tent_members_instructor" ON tent_members;
CREATE POLICY "insert_tent_members_instructor" ON tent_members FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_tent_members_instructor" ON tent_members;
CREATE POLICY "delete_tent_members_instructor" ON tent_members FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- DAILY RECORDS (attendance & streak)
-- ============================================================
DROP POLICY IF EXISTS "read_daily_records" ON daily_records;
CREATE POLICY "read_daily_records" ON daily_records FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR is_instructor(auth.uid())
  OR (is_sentry(auth.uid()) AND is_sentry_of_tent(auth.uid(), get_user_tent_id(user_id)))
);

DROP POLICY IF EXISTS "insert_meditation_own" ON daily_records;
CREATE POLICY "insert_meditation_own" ON daily_records FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_meditation_own" ON daily_records;
CREATE POLICY "update_meditation_own" ON daily_records FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_attendance_sentry" ON daily_records;
CREATE POLICY "update_attendance_sentry" ON daily_records FOR UPDATE TO authenticated
USING (is_sentry_of_tent(auth.uid(), get_user_tent_id(user_id)))
WITH CHECK (is_sentry_of_tent(auth.uid(), get_user_tent_id(user_id)));

DROP POLICY IF EXISTS "insert_daily_records_instructor" ON daily_records;
CREATE POLICY "insert_daily_records_instructor" ON daily_records FOR INSERT TO authenticated
WITH CHECK (is_instructor(auth.uid()));

DROP POLICY IF EXISTS "update_daily_records_instructor" ON daily_records;
CREATE POLICY "update_daily_records_instructor" ON daily_records FOR UPDATE TO authenticated
USING (is_instructor(auth.uid()))
WITH CHECK (is_instructor(auth.uid()));

-- ============================================================
-- DAILY NARRATIVES
-- ============================================================
DROP POLICY IF EXISTS "read_narratives" ON daily_narratives;
CREATE POLICY "read_narratives" ON daily_narratives FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_narratives_instructor" ON daily_narratives;
CREATE POLICY "insert_narratives_instructor" ON daily_narratives FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_narratives_instructor" ON daily_narratives;
CREATE POLICY "update_narratives_instructor" ON daily_narratives FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_narratives_instructor" ON daily_narratives;
CREATE POLICY "delete_narratives_instructor" ON daily_narratives FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- QUIZ SESSIONS
-- ============================================================
DROP POLICY IF EXISTS "read_quiz_sessions" ON quiz_sessions;
CREATE POLICY "read_quiz_sessions" ON quiz_sessions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_quiz_sessions_instructor" ON quiz_sessions;
CREATE POLICY "insert_quiz_sessions_instructor" ON quiz_sessions FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_quiz_sessions_instructor" ON quiz_sessions;
CREATE POLICY "update_quiz_sessions_instructor" ON quiz_sessions FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));

-- ============================================================
-- GENERATED QUESTIONS
-- ============================================================
DROP POLICY IF EXISTS "read_questions" ON generated_questions;
CREATE POLICY "read_questions" ON generated_questions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_questions_instructor" ON generated_questions;
CREATE POLICY "insert_questions_instructor" ON generated_questions FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_questions_instructor" ON generated_questions;
CREATE POLICY "delete_questions_instructor" ON generated_questions FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- QUIZ ATTEMPTS
-- ============================================================
DROP POLICY IF EXISTS "read_quiz_attempts" ON quiz_attempts;
CREATE POLICY "read_quiz_attempts" ON quiz_attempts FOR SELECT TO authenticated
USING (auth.uid() = user_id OR is_instructor(auth.uid()));
DROP POLICY IF EXISTS "insert_quiz_attempts_own" ON quiz_attempts;
CREATE POLICY "insert_quiz_attempts_own" ON quiz_attempts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_quiz_attempts_own" ON quiz_attempts;
CREATE POLICY "update_quiz_attempts_own" ON quiz_attempts FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- QUESTION RESPONSES
-- ============================================================
DROP POLICY IF EXISTS "read_responses" ON question_responses;
CREATE POLICY "read_responses" ON question_responses FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.id = question_responses.quiz_attempt_id
    AND (qa.user_id = auth.uid() OR is_instructor(auth.uid())))
);
DROP POLICY IF EXISTS "insert_responses_own" ON question_responses;
CREATE POLICY "insert_responses_own" ON question_responses FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.id = question_responses.quiz_attempt_id AND qa.user_id = auth.uid())
);
DROP POLICY IF EXISTS "update_responses_own" ON question_responses;
CREATE POLICY "update_responses_own" ON question_responses FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.id = question_responses.quiz_attempt_id AND qa.user_id = auth.uid())
);

-- ============================================================
-- DENARII LEDGER
-- ============================================================
DROP POLICY IF EXISTS "read_ledger" ON denarii_ledger_entries;
CREATE POLICY "read_ledger" ON denarii_ledger_entries FOR SELECT TO authenticated
USING (auth.uid() = user_id OR is_instructor(auth.uid()));
DROP POLICY IF EXISTS "insert_ledger_own" ON denarii_ledger_entries;
CREATE POLICY "insert_ledger_own" ON denarii_ledger_entries FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_ledger_instructor" ON denarii_ledger_entries;
CREATE POLICY "insert_ledger_instructor" ON denarii_ledger_entries FOR INSERT TO authenticated
WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_ledger_instructor" ON denarii_ledger_entries;
CREATE POLICY "delete_ledger_instructor" ON denarii_ledger_entries FOR DELETE TO authenticated
USING (is_instructor(auth.uid()));

-- ============================================================
-- GAME ATTEMPTS
-- ============================================================
DROP POLICY IF EXISTS "read_game_attempts" ON game_attempts;
CREATE POLICY "read_game_attempts" ON game_attempts FOR SELECT TO authenticated
USING (auth.uid() = user_id OR is_instructor(auth.uid()));
DROP POLICY IF EXISTS "insert_game_attempts_own" ON game_attempts;
CREATE POLICY "insert_game_attempts_own" ON game_attempts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_game_attempts_own" ON game_attempts;
CREATE POLICY "update_game_attempts_own" ON game_attempts FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- RELIC TYPES (public read)
-- ============================================================
DROP POLICY IF EXISTS "read_relic_types" ON relic_types;
CREATE POLICY "read_relic_types" ON relic_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_relic_types_instructor" ON relic_types;
CREATE POLICY "insert_relic_types_instructor" ON relic_types FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_relic_types_instructor" ON relic_types;
CREATE POLICY "update_relic_types_instructor" ON relic_types FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));

-- ============================================================
-- RELIC INVENTORY
-- ============================================================
DROP POLICY IF EXISTS "read_relic_inventory" ON relic_inventory;
CREATE POLICY "read_relic_inventory" ON relic_inventory FOR SELECT TO authenticated
USING (auth.uid() = user_id OR is_instructor(auth.uid()));
DROP POLICY IF EXISTS "insert_relic_inventory_own" ON relic_inventory;
CREATE POLICY "insert_relic_inventory_own" ON relic_inventory FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_relic_inventory_own" ON relic_inventory;
CREATE POLICY "update_relic_inventory_own" ON relic_inventory FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- RELIC USAGE LOG
-- ============================================================
DROP POLICY IF EXISTS "read_relic_usage" ON relic_usage_log;
CREATE POLICY "read_relic_usage" ON relic_usage_log FOR SELECT TO authenticated
USING (auth.uid() = user_id OR is_instructor(auth.uid()));
DROP POLICY IF EXISTS "insert_relic_usage_own" ON relic_usage_log;
CREATE POLICY "insert_relic_usage_own" ON relic_usage_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- STREAKBOARD SNAPSHOTS
-- ============================================================
DROP POLICY IF EXISTS "read_streakboard" ON streakboard_snapshots;
CREATE POLICY "read_streakboard" ON streakboard_snapshots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "write_streakboard_instructor" ON streakboard_snapshots;
CREATE POLICY "write_streakboard_instructor" ON streakboard_snapshots FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_streakboard_instructor" ON streakboard_snapshots;
CREATE POLICY "update_streakboard_instructor" ON streakboard_snapshots FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_streakboard_instructor" ON streakboard_snapshots;
CREATE POLICY "delete_streakboard_instructor" ON streakboard_snapshots FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- LEADERBOARD WEEKLY SNAPSHOTS
-- ============================================================
DROP POLICY IF EXISTS "read_leaderboard_weekly" ON leaderboard_weekly_snapshots;
CREATE POLICY "read_leaderboard_weekly" ON leaderboard_weekly_snapshots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "write_leaderboard_weekly_instructor" ON leaderboard_weekly_snapshots;
CREATE POLICY "write_leaderboard_weekly_instructor" ON leaderboard_weekly_snapshots FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_leaderboard_weekly_instructor" ON leaderboard_weekly_snapshots;
CREATE POLICY "update_leaderboard_weekly_instructor" ON leaderboard_weekly_snapshots FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_leaderboard_weekly_instructor" ON leaderboard_weekly_snapshots;
CREATE POLICY "delete_leaderboard_weekly_instructor" ON leaderboard_weekly_snapshots FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- AWARDS
-- ============================================================
DROP POLICY IF EXISTS "read_awards" ON awards;
CREATE POLICY "read_awards" ON awards FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "write_awards_instructor" ON awards;
CREATE POLICY "write_awards_instructor" ON awards FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_awards_instructor" ON awards;
CREATE POLICY "update_awards_instructor" ON awards FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_awards_instructor" ON awards;
CREATE POLICY "delete_awards_instructor" ON awards FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- SCHEDULED ANNOUNCEMENTS
-- ============================================================
DROP POLICY IF EXISTS "read_announcements" ON scheduled_announcements;
CREATE POLICY "read_announcements" ON scheduled_announcements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "write_announcements_instructor" ON scheduled_announcements;
CREATE POLICY "write_announcements_instructor" ON scheduled_announcements FOR INSERT TO authenticated WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "update_announcements_instructor" ON scheduled_announcements;
CREATE POLICY "update_announcements_instructor" ON scheduled_announcements FOR UPDATE TO authenticated USING (is_instructor(auth.uid())) WITH CHECK (is_instructor(auth.uid()));
DROP POLICY IF EXISTS "delete_announcements_instructor" ON scheduled_announcements;
CREATE POLICY "delete_announcements_instructor" ON scheduled_announcements FOR DELETE TO authenticated USING (is_instructor(auth.uid()));

-- ============================================================
-- CHALLENGE SUBMISSIONS
-- ============================================================
DROP POLICY IF EXISTS "read_challenge_submissions" ON challenge_submissions;
CREATE POLICY "read_challenge_submissions" ON challenge_submissions FOR SELECT TO authenticated
USING (auth.uid() = user_id OR is_instructor(auth.uid()));
DROP POLICY IF EXISTS "insert_challenge_own" ON challenge_submissions;
CREATE POLICY "insert_challenge_own" ON challenge_submissions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_challenge_own" ON challenge_submissions;
CREATE POLICY "update_challenge_own" ON challenge_submissions FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
