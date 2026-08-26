/* Keep valid authenticated accounts out of signup by repairing their profile
   and first role assignment in one authoritative bootstrap transaction. */

CREATE OR REPLACE FUNCTION public.get_my_app_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_display_name text;
  v_profile public.profiles%ROWTYPE;
  v_assignment public.role_assignments%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    auth_user.email,
    COALESCE(
      NULLIF(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
      NULLIF(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(split_part(auth_user.email, '@', 1), ''),
      'Full Circle member'
    )
  INTO v_email, v_display_name
  FROM auth.users auth_user
  WHERE auth_user.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated account could not be found.';
  END IF;

  INSERT INTO public.profiles (id, display_name, email)
  VALUES (v_user_id, v_display_name, v_email)
  ON CONFLICT (id) DO UPDATE
    SET display_name = CASE
          WHEN NULLIF(btrim(public.profiles.display_name), '') IS NULL THEN EXCLUDED.display_name
          ELSE public.profiles.display_name
        END,
        email = COALESCE(EXCLUDED.email, public.profiles.email)
  RETURNING * INTO v_profile;

  SELECT assignment.*
  INTO v_assignment
  FROM public.role_assignments assignment
  WHERE assignment.user_id = v_user_id
    AND assignment.status IN ('active', 'approved')
  ORDER BY
    CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
    CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
    assignment.start_date DESC NULLS LAST,
    assignment.created_at DESC
  LIMIT 1;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.role_assignments historical
    WHERE historical.user_id = v_user_id
  ) THEN
    INSERT INTO public.role_assignments (user_id, role, status, start_date, end_date)
    VALUES (v_user_id, 'cadet', 'active', CURRENT_DATE, NULL)
    ON CONFLICT DO NOTHING;

    SELECT assignment.*
    INTO v_assignment
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'role_assignment', CASE
      WHEN v_assignment.user_id IS NULL THEN NULL
      ELSE to_jsonb(v_assignment) || jsonb_build_object(
        'id', COALESCE(to_jsonb(v_assignment) ->> 'id', 'role-' || v_assignment.user_id::text)
      )
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_app_bootstrap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_bootstrap() TO authenticated;

-- Accounts created during an older broken signup window may already have a
-- profile but no role history. Repair only that unambiguous case; removed or
-- promoted accounts retain their historical governance state.
INSERT INTO public.role_assignments (user_id, role, status, start_date, end_date)
SELECT profile.id, 'cadet', 'active', CURRENT_DATE, NULL
FROM public.profiles profile
JOIN auth.users auth_user ON auth_user.id = profile.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_assignments assignment
  WHERE assignment.user_id = profile.id
)
ON CONFLICT DO NOTHING;
