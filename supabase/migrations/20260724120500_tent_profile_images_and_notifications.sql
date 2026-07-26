/*
# Tent profile images and notification polish

- Adds a tent-level profile image URL.
- Allows assigned sentries to update their tent image through an RPC.
*/

ALTER TABLE public.tents
  ADD COLUMN IF NOT EXISTS profile_image_url text;

CREATE OR REPLACE FUNCTION public.update_tent_profile_image(
  p_tent_id uuid,
  p_sentry_id uuid,
  p_profile_image_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tents t
    LEFT JOIN public.tent_members tm
      ON tm.tent_id = t.id
      AND tm.user_id = p_sentry_id
      AND tm.role = 'sentry'
    WHERE t.id = p_tent_id
      AND (t.sentry_id = p_sentry_id OR tm.id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    WHERE ra.user_id = p_sentry_id
      AND ra.role = 'instructor'
      AND ra.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'You can only update the profile picture for your assigned tent.';
  END IF;

  UPDATE public.tents
  SET profile_image_url = NULLIF(btrim(p_profile_image_url), '')
  WHERE id = p_tent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tent_profile_image(uuid, uuid, text) TO authenticated;
