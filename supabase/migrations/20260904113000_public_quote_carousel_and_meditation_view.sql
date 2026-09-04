/* Public quote carousel metadata and the signed-in full meditation view. */

CREATE OR REPLACE FUNCTION public.get_public_daily_quotes(
  p_record_date date,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'record_date', quote.record_date,
    'daily_quote', quote.daily_quote,
    'user_id', quote.user_id,
    'display_name', quote.display_name,
    'avatar_url', quote.avatar_url,
    'current_streak', quote.current_streak,
    'has_public_meditation', quote.has_public_meditation
  ) ORDER BY quote.meditation_submitted_at DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      record.record_date,
      record.daily_quote,
      record.user_id,
      profile.display_name,
      profile.avatar_url,
      coalesce((SELECT streak.current_streak FROM public.compute_strict_streak(record.user_id) streak LIMIT 1), 0)::integer AS current_streak,
      (record.meditation_public AND nullif(btrim(record.meditation_text), '') IS NOT NULL) AS has_public_meditation,
      record.meditation_submitted_at
    FROM public.daily_records record
    JOIN public.profiles profile ON profile.id = record.user_id
    WHERE record.record_date = p_record_date
      AND record.meditation_submitted = true
      AND nullif(btrim(record.daily_quote), '') IS NOT NULL
    ORDER BY record.meditation_submitted_at DESC NULLS LAST
    LIMIT least(greatest(coalesce(p_limit, 12), 1), 30)
  ) quote;
$$;

CREATE OR REPLACE FUNCTION public.get_public_meditation_view(p_user_id uuid, p_record_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'meditation_text', record.meditation_text,
    'best_verse', record.best_verse,
    'daily_quote', record.daily_quote,
    'record_date', record.record_date
  ) END
  FROM public.daily_records record
  WHERE record.user_id = p_user_id
    AND record.record_date = p_record_date
    AND record.meditation_submitted = true
    AND record.meditation_public = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_daily_quotes(date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_meditation_view(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_daily_quotes(date, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_meditation_view(uuid, date) TO authenticated, service_role;
