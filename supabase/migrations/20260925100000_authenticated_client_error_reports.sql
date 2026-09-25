/*
  Keep account-specific phone crashes observable without exposing reports to
  other users. The RPC deduplicates repeated React retries from the same
  device, and optional UI failures never need to take down the core app.
*/

CREATE TABLE IF NOT EXISTS public.client_error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  message text NOT NULL,
  stack text,
  component_stack text,
  release text,
  path text,
  user_agent text,
  online boolean,
  connection_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS client_error_reports_user_time_idx
  ON public.client_error_reports(user_id, occurred_at DESC);

ALTER TABLE public.client_error_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Instructors can inspect client errors" ON public.client_error_reports;
CREATE POLICY "Instructors can inspect client errors"
ON public.client_error_reports
FOR SELECT
TO authenticated
USING (public.is_instructor(auth.uid()));

REVOKE ALL ON TABLE public.client_error_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.client_error_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.report_client_error(
  p_message text,
  p_stack text DEFAULT NULL,
  p_component_stack text DEFAULT NULL,
  p_release text DEFAULT NULL,
  p_path text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_online boolean DEFAULT NULL,
  p_connection_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_report_id uuid;
  v_message text := left(coalesce(nullif(btrim(p_message), ''), 'Unknown application error'), 2000);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT report.id
  INTO v_report_id
  FROM public.client_error_reports report
  WHERE report.user_id = v_user_id
    AND report.message = v_message
    AND report.release IS NOT DISTINCT FROM left(p_release, 120)
    AND report.occurred_at > now() - interval '1 minute'
  ORDER BY report.occurred_at DESC
  LIMIT 1;

  IF v_report_id IS NOT NULL THEN
    RETURN v_report_id;
  END IF;

  INSERT INTO public.client_error_reports (
    user_id,
    message,
    stack,
    component_stack,
    release,
    path,
    user_agent,
    online,
    connection_type,
    metadata
  ) VALUES (
    v_user_id,
    v_message,
    left(p_stack, 12000),
    left(p_component_stack, 12000),
    left(p_release, 120),
    left(p_path, 1000),
    left(p_user_agent, 1000),
    p_online,
    left(p_connection_type, 80),
    coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_client_error(text, text, text, text, text, text, boolean, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_client_error(text, text, text, text, text, text, boolean, text, jsonb)
  TO authenticated;
