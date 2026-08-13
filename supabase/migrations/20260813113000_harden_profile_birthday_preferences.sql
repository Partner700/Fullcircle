/*
# Harden profile birthday preferences

Keeps birthday storage and the self-service profile preferences RPC available
even when earlier profile migrations were applied out of order.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_month integer,
  ADD COLUMN IF NOT EXISTS birth_day integer,
  ADD COLUMN IF NOT EXISTS country_code text DEFAULT 'CM',
  ADD COLUMN IF NOT EXISTS language_code text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Africa/Douala',
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_birth_month_check,
  DROP CONSTRAINT IF EXISTS profiles_birth_day_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_birth_month_check CHECK (birth_month IS NULL OR birth_month BETWEEN 1 AND 12),
  ADD CONSTRAINT profiles_birth_day_check CHECK (birth_day IS NULL OR birth_day BETWEEN 1 AND 31);

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
