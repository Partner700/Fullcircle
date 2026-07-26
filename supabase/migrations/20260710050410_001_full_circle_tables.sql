/*
# Full Circle Portal — Tables (no policies yet)

Creates all tables with RLS enabled but no policies.
Helper functions and policies come in the next migration.
This split avoids forward-reference errors (functions reference role_assignments).
*/

-- ============================================================
-- IDENTITY & GOVERNANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS tent_houses (
  id text PRIMARY KEY,
  name text NOT NULL,
  symbol_icon text NOT NULL,
  symbol_motif text NOT NULL,
  color text NOT NULL,
  motto text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('cadet','sentry','instructor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','approved','active','removed')),
  start_date date DEFAULT CURRENT_DATE,
  approver_id uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tent_house_id text NOT NULL REFERENCES tent_houses(id),
  sentry_id uuid REFERENCES profiles(id),
  cycle_label text DEFAULT 'Current Cycle',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tent_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tent_id uuid NOT NULL REFERENCES tents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(tent_id, user_id)
);

-- ============================================================
-- ATTENDANCE & STREAK
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  record_date date NOT NULL,
  day_type text NOT NULL CHECK (day_type IN ('weekday','saturday','sunday')),
  attendance_status text DEFAULT 'unmarked' CHECK (attendance_status IN ('present','absent','unmarked')),
  attendance_marked_at timestamptz,
  attendance_marked_by uuid REFERENCES profiles(id),
  meditation_submitted boolean DEFAULT false,
  meditation_submitted_at timestamptz,
  meditation_text text,
  quiz_attempt_id uuid,
  streak_valid boolean,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, record_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_records_user_date ON daily_records(user_id, record_date);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(record_date);

-- ============================================================
-- NARRATIVE ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_narratives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_date date NOT NULL UNIQUE,
  title text NOT NULL,
  theme text NOT NULL,
  scripture_reference text NOT NULL,
  translation text DEFAULT 'ESV',
  main_text text NOT NULL,
  highlighted_verses jsonb DEFAULT '[]'::jsonb,
  reflection_prompts jsonb DEFAULT '[]'::jsonb,
  challenge_title text,
  challenge_instructions text,
  challenge_proof_type text DEFAULT 'text',
  challenge_active boolean DEFAULT true,
  game_seed_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- QUIZ ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date date NOT NULL,
  title text NOT NULL DEFAULT 'Weekly Quiz',
  scheduled_start_time timestamptz NOT NULL,
  countdown_opens_at timestamptz NOT NULL,
  live_opens_at timestamptz NOT NULL,
  live_closes_at timestamptz NOT NULL,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled','countdown','live','closed')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_date ON quiz_sessions(session_date);

CREATE TABLE IF NOT EXISTS generated_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id uuid NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_index int NOT NULL,
  source_narrative_date date,
  difficulty_tag text NOT NULL CHECK (difficulty_tag IN ('easy','moderate','hard')),
  mechanic_type text NOT NULL,
  recycled_from_game boolean DEFAULT false,
  question_payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(quiz_session_id, question_index)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  quiz_session_id uuid NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','submitted','forfeited','timed_out')),
  talents_scored numeric DEFAULT 0,
  highest_question_reached int DEFAULT 0,
  relics_used jsonb DEFAULT '[]'::jsonb,
  forfeited_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, quiz_session_id)
);

CREATE TABLE IF NOT EXISTS question_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_attempt_id uuid NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES generated_questions(id) ON DELETE CASCADE,
  answer jsonb,
  submitted_at timestamptz DEFAULT now(),
  last_edited_at timestamptz DEFAULT now(),
  UNIQUE(quiz_attempt_id, question_id)
);

-- ============================================================
-- UNIFIED CURRENCY LEDGER
-- ============================================================

CREATE TABLE IF NOT EXISTS denarii_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount int NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('game_level','game_blitz','quiz_reward','relic_purchase','admin_adjustment')),
  source_reference text,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON denarii_ledger_entries(user_id);

-- ============================================================
-- DAILY GAME ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS game_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  narrative_date date NOT NULL,
  level int NOT NULL CHECK (level BETWEEN 1 AND 10),
  mode text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal','blitz','practice')),
  score int DEFAULT 0,
  max_score int DEFAULT 0,
  reward int DEFAULT 0,
  status text DEFAULT 'in_progress' CHECK (status IN ('in_progress','passed','failed')),
  completed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_user_date ON game_attempts(user_id, narrative_date);

CREATE TABLE IF NOT EXISTS relic_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('eliminate','hint','skip','freeze_timer','reveal_reference')),
  rarity text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common','rare','epic','legendary')),
  denarii_cost int,
  effect_scope text NOT NULL DEFAULT 'quiz_aid' CHECK (effect_scope IN ('quiz_aid','streak_protection')),
  icon text DEFAULT 'Gem',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relic_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  relic_type_id uuid NOT NULL REFERENCES relic_types(id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 1,
  source_description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, relic_type_id)
);

CREATE TABLE IF NOT EXISTS relic_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  quiz_attempt_id uuid REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  relic_type_id uuid NOT NULL REFERENCES relic_types(id),
  question_id uuid REFERENCES generated_questions(id),
  effect_applied text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- LEADERBOARD & AWARDS
-- ============================================================

CREATE TABLE IF NOT EXISTS streakboard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tent_id uuid REFERENCES tents(id),
  tent_house_id text REFERENCES tent_houses(id),
  volume int DEFAULT 0,
  consistency int DEFAULT 0,
  improvement numeric DEFAULT 0,
  current_streak int DEFAULT 0,
  longest_streak int DEFAULT 0,
  rank int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streakboard_date ON streakboard_snapshots(snapshot_date, rank);

CREATE TABLE IF NOT EXISTS leaderboard_weekly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending date NOT NULL,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tent_id uuid REFERENCES tents(id),
  tent_house_id text REFERENCES tent_houses(id),
  total_denarii bigint DEFAULT 0,
  rank int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_week ON leaderboard_weekly_snapshots(week_ending, rank);

CREATE TABLE IF NOT EXISTS awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_month date NOT NULL,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  award_type text NOT NULL,
  title text NOT NULL,
  description text,
  metric_value numeric,
  created_at timestamptz DEFAULT now(),
  UNIQUE(award_month, user_id, award_type)
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_type text NOT NULL CHECK (announcement_type IN ('morning_call','midday_reminder','evening_reminder','quote_of_day','streakboard_release','general')),
  publish_at timestamptz NOT NULL,
  audience text DEFAULT 'all' CHECK (audience IN ('all','cadets','sentries','instructors','tent')),
  content text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CHALLENGE SUBMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS challenge_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  narrative_date date NOT NULL,
  proof_text text,
  proof_type text DEFAULT 'text',
  submitted_at timestamptz DEFAULT now(),
  UNIQUE(user_id, narrative_date)
);

-- ============================================================
-- ENABLE RLS ON ALL TABLES (locked until policies added)
-- ============================================================

ALTER TABLE tent_houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tent_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_narratives ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE denarii_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE relic_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE relic_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE relic_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE streakboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_weekly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_submissions ENABLE ROW LEVEL SECURITY;
