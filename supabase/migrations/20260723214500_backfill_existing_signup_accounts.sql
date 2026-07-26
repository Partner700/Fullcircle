/*
# Backfill accounts created during failed signup

Some auth users were created before complete_signup was fixed. They need the
same profile and cadet role that a successful signup would have created.
*/

INSERT INTO profiles (id, display_name, email)
SELECT
  u.id,
  COALESCE(
    NULLIF(u.raw_user_meta_data ->> 'display_name', ''),
    NULLIF(split_part(u.email, '@', 1), ''),
    'Cadet'
  ) AS display_name,
  u.email
FROM auth.users u
ON CONFLICT (id) DO UPDATE
  SET email = COALESCE(profiles.email, EXCLUDED.email),
      display_name = COALESCE(NULLIF(profiles.display_name, ''), EXCLUDED.display_name);

INSERT INTO role_assignments (user_id, role, status, start_date, end_date)
SELECT u.id, 'cadet', 'active', CURRENT_DATE, NULL
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM role_assignments ra
  WHERE ra.user_id = u.id
    AND ra.status IN ('active', 'approved')
)
ON CONFLICT (user_id, role) WHERE status IN ('active', 'approved') DO NOTHING;
