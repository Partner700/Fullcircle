-- Create a SECURITY DEFINER function to handle profile + role creation after signup
-- This bypasses RLS so it works even before the user has an active session

CREATE OR REPLACE FUNCTION complete_signup(p_display_name text, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Insert profile if it doesn't exist
  INSERT INTO profiles (id, display_name, email)
  SELECT v_user_id, p_display_name, u.email
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Insert role assignment
  INSERT INTO role_assignments (user_id, role, status, start_date)
  VALUES (v_user_id, p_role, 'active', CURRENT_DATE)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION complete_signup(text, text) TO authenticated;
