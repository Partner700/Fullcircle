-- Sunday is an earned grace day: no task is required, it extends an active
-- streak, and it starts a fresh streak after a broken week.
DO $$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.compute_strict_streak(uuid)'::regprocedure)
  INTO v_definition;
  v_original := v_definition;

  v_definition := replace(
    v_definition,
    E'    -- Sunday is always a day of rest.\n    IF extract(dow FROM v_check) = 0 THEN\n      v_check := v_check + 1;\n      CONTINUE;\n    END IF;\n\n    v_complete := false;',
    E'    -- Sunday grants a free valid streak day to every user.\n    v_complete := extract(dow FROM v_check) = 0;'
  );

  v_definition := replace(
    v_definition,
    E'    IF extract(dow FROM v_check) = 6 THEN',
    E'    IF extract(dow FROM v_check) = 0 THEN\n      NULL; -- Keep the automatic Sunday credit.\n    ELSIF extract(dow FROM v_check) = 6 THEN'
  );

  IF v_definition = v_original
    OR position('Sunday grants a free valid streak day' in v_definition) = 0
    OR position('Keep the automatic Sunday credit' in v_definition) = 0 THEN
    RAISE EXCEPTION 'The Sunday streak update could not safely match compute_strict_streak.';
  END IF;

  EXECUTE v_definition;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;
