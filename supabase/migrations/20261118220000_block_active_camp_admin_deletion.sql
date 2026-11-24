-- Run the administrator check before any inheritance or reference cleanup.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.prepare_account_inheritance(uuid,uuid)'::regprocedure);
  anchor text := '  SELECT *' || chr(10) || '  INTO v_existing';
  guard text := $guard$  IF EXISTS (SELECT 1 FROM camp_management.admin WHERE user_id = p_account_id) THEN
    RAISE EXCEPTION 'Transfer the Camp Administrator role before deleting this account.';
  END IF;

$guard$;
BEGIN
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'Could not locate the account inheritance preflight.';
  END IF;
  EXECUTE replace(definition, anchor, guard || anchor);
END;
$migration$;
