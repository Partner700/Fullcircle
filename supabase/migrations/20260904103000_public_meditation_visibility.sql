ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS meditation_public boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_daily_meditation_public(p_record_date date, p_public boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.daily_records
  SET meditation_public = coalesce(p_public, false)
  WHERE user_id = auth.uid() AND record_date = p_record_date AND meditation_submitted = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submit your meditation before changing its visibility.'; END IF;
  RETURN p_public;
END;
$$;

REVOKE ALL ON FUNCTION public.set_daily_meditation_public(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_meditation_public(date, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_meditation(p_user_id uuid, p_record_date date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT meditation_text FROM public.daily_records
  WHERE user_id = p_user_id AND record_date = p_record_date
    AND meditation_submitted = true AND meditation_public = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_meditation(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_meditation(uuid, date) TO anon, authenticated, service_role;
