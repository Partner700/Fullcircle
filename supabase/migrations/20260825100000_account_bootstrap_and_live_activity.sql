/* Repair authenticated accounts that lost their app profile and make the
   activity surfaces used by the live UI available through Supabase Realtime. */

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
  v_profile_repaired boolean := false;
  v_profile public.profiles%ROWTYPE;
  v_assignment public.role_assignments%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  IF NOT FOUND THEN
    v_profile_repaired := true;
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

    IF v_email IS NULL THEN
      RAISE EXCEPTION 'Authenticated account could not be found.';
    END IF;

    INSERT INTO public.profiles (id, display_name, email)
    VALUES (v_user_id, v_display_name, v_email)
    ON CONFLICT (id) DO UPDATE
      SET email = COALESCE(public.profiles.email, EXCLUDED.email)
    RETURNING * INTO v_profile;
  END IF;

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

  IF NOT FOUND AND v_profile_repaired THEN
    INSERT INTO public.role_assignments (user_id, role, status, start_date, end_date)
    VALUES (v_user_id, 'cadet', 'active', CURRENT_DATE, NULL)
    ON CONFLICT DO NOTHING;

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

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'daily_records',
    'denarii_ledger_entries',
    'daily_quote_reactions',
    'daily_quote_comments',
    'daily_verse_reactions',
    'daily_verse_comments',
    'scripture_verse_insights',
    'scripture_insight_comments',
    'scripture_insight_reactions'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_table)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table);

      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END IF;
  END LOOP;
END;
$$;
