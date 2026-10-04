-- Keep server-side Web Push delivery attached to the project that owns the
-- notification data. The source project URL was embedded in three functions
-- before the controlled migration to Full Circle Production.

ALTER TABLE private.push_webhook_config
  ADD COLUMN IF NOT EXISTS endpoint text;

UPDATE private.push_webhook_config
SET endpoint = 'https://nffqohxdelaglrmuzjwb.supabase.co/functions/v1/send-push-notification'
WHERE singleton;

ALTER TABLE private.push_webhook_config
  ALTER COLUMN endpoint SET DEFAULT 'https://nffqohxdelaglrmuzjwb.supabase.co/functions/v1/send-push-notification',
  ALTER COLUMN endpoint SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'private.push_webhook_config'::regclass
      AND conname = 'push_webhook_config_endpoint_check'
  ) THEN
    ALTER TABLE private.push_webhook_config
      ADD CONSTRAINT push_webhook_config_endpoint_check
      CHECK (
        endpoint ~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/send-push-notification$'
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.push_delivery_endpoint()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private
AS $$
  SELECT endpoint
  FROM private.push_webhook_config
  WHERE singleton;
$$;

REVOKE ALL ON FUNCTION private.push_delivery_endpoint() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  old_endpoint constant text := 'https://kckzqsafzemeijxfohuy.supabase.co/functions/v1/send-push-notification';
  target_endpoint constant text := 'https://nffqohxdelaglrmuzjwb.supabase.co/functions/v1/send-push-notification';
  function_row record;
  remaining_old_routes integer;
  remaining_direct_routes integer;
  configured_routes integer;
BEGIN
  FOR function_row IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.prokind = 'f'
      AND (
        position(old_endpoint IN p.prosrc) > 0
        OR position(target_endpoint IN p.prosrc) > 0
      )
  LOOP
    EXECUTE replace(
      replace(
        function_row.definition,
        quote_literal(old_endpoint),
        'private.push_delivery_endpoint()'
      ),
      quote_literal(target_endpoint),
      'private.push_delivery_endpoint()'
    );
  END LOOP;

  SELECT count(*)::integer
  INTO remaining_old_routes
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.prokind = 'f'
    AND position(old_endpoint IN p.prosrc) > 0;

  SELECT count(*)::integer
  INTO remaining_direct_routes
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.prokind = 'f'
    AND position(target_endpoint IN p.prosrc) > 0;

  SELECT count(*)::integer
  INTO configured_routes
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.prokind = 'f'
    AND position('private.push_delivery_endpoint()' IN p.prosrc) > 0;

  IF remaining_old_routes <> 0 THEN
    RAISE EXCEPTION 'One or more push functions still route to the retired project.';
  END IF;
  IF remaining_direct_routes <> 0 THEN
    RAISE EXCEPTION 'One or more push functions bypass the private endpoint configuration.';
  END IF;
  IF configured_routes < 3 THEN
    RAISE EXCEPTION 'Expected all three push dispatch functions to use the configured endpoint.';
  END IF;
END;
$$;

REVOKE ALL ON private.push_webhook_config FROM PUBLIC, anon, authenticated;
