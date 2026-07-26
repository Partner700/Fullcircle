/*
# Major feature migration:
1. Matricules table for sentry signup
2. promote_user RPC (cadet->sentry->instructor)
3. Fix re-signup: allow 'removed' status users to rejoin as cadet
4. Restrict instructor self-signup (bootstrap: first instructor allowed)
5. House competition RPC
6. Fix profiles RLS for whatsapp_number updates
*/

-- ============================================================
-- 1. MATRICULES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS sentry_matricules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricule text NOT NULL UNIQUE,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id),
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sentry_matricules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_matricules_instructor" ON sentry_matricules;
CREATE POLICY "select_matricules_instructor" ON sentry_matricules FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM role_assignments WHERE user_id = auth.uid() AND role = 'instructor' AND status = 'active')
  );
DROP POLICY IF EXISTS "insert_matricules_instructor" ON sentry_matricules;
CREATE POLICY "insert_matricules_instructor" ON sentry_matricules FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM role_assignments WHERE user_id = auth.uid() AND role = 'instructor' AND status = 'active')
  );
DROP POLICY IF EXISTS "delete_matricules_instructor" ON sentry_matricules;
CREATE POLICY "delete_matricules_instructor" ON sentry_matricules FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM role_assignments WHERE user_id = auth.uid() AND role = 'instructor' AND status = 'active')
  );
DROP POLICY IF EXISTS "update_matricules_instructor" ON sentry_matricules;
CREATE POLICY "update_matricules_instructor" ON sentry_matricules FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM role_assignments WHERE user_id = auth.uid() AND role = 'instructor' AND status = 'active')
  );

-- ============================================================
-- 2. PROMOTE_USER RPC
-- ============================================================
DROP FUNCTION IF EXISTS promote_user(uuid, text);
CREATE OR REPLACE FUNCTION promote_user(p_user_id uuid, p_new_role text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller AND role = 'instructor' AND status = 'active'
  ) INTO v_is_instructor;
  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can promote users';
  END IF;
  IF p_new_role NOT IN ('cadet','sentry','instructor') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE role_assignments SET status = 'removed'
  WHERE user_id = p_user_id AND status = 'active';

  INSERT INTO role_assignments (user_id, role, status, start_date, approver_id)
  VALUES (p_user_id, p_new_role, 'active', CURRENT_DATE, v_caller)
  ON CONFLICT (user_id, role) DO UPDATE SET status = 'active', approver_id = v_caller;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION promote_user(uuid, text) TO authenticated;

-- ============================================================
-- 3. FIX COMPLETE_SIGNUP: allow re-signup, restrict instructor, sentry matricule
-- ============================================================
DROP FUNCTION IF EXISTS complete_signup(text, text);
CREATE OR REPLACE FUNCTION complete_signup(p_display_name text, p_role text, p_matricule text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_role text;
  v_existing_status text;
  v_matricule_valid boolean;
  v_instructor_exists boolean;
BEGIN
  INSERT INTO profiles (id, display_name, email)
  SELECT v_user_id, p_display_name, u.email
  FROM auth.users u WHERE u.id = v_user_id
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  SELECT role, status INTO v_existing_role, v_existing_status
  FROM role_assignments WHERE user_id = v_user_id AND status = 'active'
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing_role IS NOT NULL THEN
    RETURN true;
  END IF;

  IF p_role = 'instructor' THEN
    SELECT EXISTS(
      SELECT 1 FROM role_assignments WHERE role = 'instructor' AND status = 'active'
    ) INTO v_instructor_exists;
    IF v_instructor_exists THEN
      RAISE EXCEPTION 'Instructor accounts can only be created by an existing instructor.';
    END IF;
  END IF;

  IF p_role = 'sentry' THEN
    IF p_matricule IS NULL OR p_matricule = '' THEN
      RAISE EXCEPTION 'A matricule is required to sign up as a sentry.';
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM sentry_matricules
      WHERE matricule = p_matricule AND used = false
    ) INTO v_matricule_valid;
    IF NOT v_matricule_valid THEN
      RAISE EXCEPTION 'Invalid or already-used matricule.';
    END IF;
    UPDATE sentry_matricules SET used = true, assigned_to = v_user_id
    WHERE matricule = p_matricule;
  END IF;

  INSERT INTO role_assignments (user_id, role, status, start_date)
  VALUES (v_user_id, p_role, 'active', CURRENT_DATE)
  ON CONFLICT (user_id, role) DO UPDATE SET status = 'active';

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION complete_signup(text, text, text) TO authenticated;

-- ============================================================
-- 4. GENERATE_MATRICULES RPC
-- ============================================================
DROP FUNCTION IF EXISTS generate_matricules(int);
CREATE OR REPLACE FUNCTION generate_matricules(p_count int DEFAULT 5)
RETURNS TABLE(matricule text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_instructor boolean;
  v_code text;
  i int;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = v_caller AND role = 'instructor' AND status = 'active'
  ) INTO v_is_instructor;
  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only instructors can generate matricules';
  END IF;

  FOR i IN 1..LEAST(p_count, 50) LOOP
    v_code := 'SEN-' || upper(substring(md5(random()::text || clock_timestamp()::text), 1, 6));
    INSERT INTO sentry_matricules (matricule, created_by)
    VALUES (v_code, v_caller)
    ON CONFLICT (matricule) DO NOTHING
    RETURNING sentry_matricules.matricule INTO v_code;
    IF v_code IS NULL THEN
      v_code := 'SEN-' || upper(substring(md5(random()::text || now()::text || i::text), 1, 6));
      INSERT INTO sentry_matricules (matricule, created_by)
      VALUES (v_code, v_caller)
      ON CONFLICT (matricule) DO NOTHING
      RETURNING sentry_matricules.matricule INTO v_code;
    END IF;
    IF v_code IS NOT NULL THEN
      matricule := v_code;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_matricules(int) TO authenticated;

-- ============================================================
-- 5. HOUSE COMPETITION RPC
-- ============================================================
DROP FUNCTION IF EXISTS get_house_standings();
CREATE OR REPLACE FUNCTION get_house_standings()
RETURNS TABLE(
  tent_house_id text,
  house_name text,
  avg_streak numeric,
  avg_denarii numeric,
  member_count bigint,
  rank int
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH house_members AS (
    SELECT t.tent_house_id, tm.user_id
    FROM tent_members tm
    JOIN tents t ON t.id = tm.tent_id
    WHERE tm.role = 'cadet'
  ),
  streak_scores AS (
    SELECT hm.tent_house_id, AVG(COALESCE(s.max_streak, 0)) as avg_streak
    FROM house_members hm
    LEFT JOIN LATERAL (
      SELECT MAX(current_streak) as max_streak
      FROM (
        SELECT COUNT(*) as current_streak
        FROM daily_records dr
        WHERE dr.user_id = hm.user_id
          AND dr.streak_valid = true
        GROUP BY dr.user_id
      ) sub
    ) s ON true
    GROUP BY hm.tent_house_id
  ),
  denarii_scores AS (
    SELECT hm.tent_house_id, AVG(COALESCE(d.total, 0)) as avg_denarii
    FROM house_members hm
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(amount), 0) as total
      FROM denarii_ledger_entries
      WHERE user_id = hm.user_id
    ) d ON true
    GROUP BY hm.tent_house_id
  ),
  combined AS (
    SELECT
      th.id as tent_house_id,
      th.name as house_name,
      COALESCE(ss.avg_streak, 0) as avg_streak,
      COALESCE(ds.avg_denarii, 0) as avg_denarii,
      COUNT(DISTINCT hm.user_id) as member_count
    FROM tent_houses th
    LEFT JOIN house_members hm ON hm.tent_house_id = th.id
    LEFT JOIN streak_scores ss ON ss.tent_house_id = th.id
    LEFT JOIN denarii_scores ds ON ds.tent_house_id = th.id
    GROUP BY th.id, th.name, ss.avg_streak, ds.avg_denarii
  )
  SELECT
    c.tent_house_id,
    c.house_name,
    c.avg_streak,
    c.avg_denarii,
    c.member_count,
    RANK() OVER (ORDER BY (c.avg_streak * 0.5 + c.avg_denarii / 1000 * 0.5) DESC) as rank
  FROM combined c;
END;
$$;
GRANT EXECUTE ON FUNCTION get_house_standings() TO authenticated;

-- ============================================================
-- 6. FIX PROFILES RLS
-- ============================================================
DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id OR EXISTS(
    SELECT 1 FROM role_assignments WHERE user_id = auth.uid() AND role = 'instructor' AND status = 'active'
  ));
