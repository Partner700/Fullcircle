/*
# Profile preferences RPC

Lets signed-in users save their own contact, language, country, timezone, and
birthday preferences without relying on table-level profile update grants.
*/

CREATE OR REPLACE FUNCTION public.save_own_profile_preferences(
  p_display_name text DEFAULT NULL,
  p_whatsapp_number text DEFAULT NULL,
  p_country_code text DEFAULT 'CM',
  p_language_code text DEFAULT 'en',
  p_timezone text DEFAULT 'Africa/Douala',
  p_birth_month integer DEFAULT NULL,
  p_birth_day integer DEFAULT NULL,
  p_onboarding_completed boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in again before saving profile settings.';
  END IF;
  IF p_birth_month IS NOT NULL AND (p_birth_month < 1 OR p_birth_month > 12) THEN
    RAISE EXCEPTION 'Birthday month must be between 1 and 12.';
  END IF;
  IF p_birth_day IS NOT NULL AND (p_birth_day < 1 OR p_birth_day > 31) THEN
    RAISE EXCEPTION 'Birthday day must be between 1 and 31.';
  END IF;

  UPDATE public.profiles
  SET
    display_name = COALESCE(NULLIF(btrim(p_display_name), ''), display_name),
    whatsapp_number = NULLIF(btrim(COALESCE(p_whatsapp_number, '')), ''),
    country_code = COALESCE(NULLIF(btrim(p_country_code), ''), country_code, 'CM'),
    language_code = COALESCE(NULLIF(btrim(p_language_code), ''), language_code, 'en'),
    timezone = COALESCE(NULLIF(btrim(p_timezone), ''), timezone, 'Africa/Douala'),
    birth_month = p_birth_month,
    birth_day = p_birth_day,
    onboarding_completed = COALESCE(p_onboarding_completed, onboarding_completed)
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile was not found for this account.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_own_profile_preferences(text, text, text, text, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_own_profile_preferences(text, text, text, text, text, integer, integer, boolean) TO authenticated;
