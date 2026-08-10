-- Tent awards are one collective honor, represented by the tent's sentry.
ALTER TABLE public.awards
  DROP CONSTRAINT IF EXISTS awards_award_month_user_id_award_type_key;

WITH ranked AS (
  SELECT
    award.id,
    row_number() OVER (
      PARTITION BY award.award_target_id, award.title, award.award_month
      ORDER BY CASE WHEN award.user_id = tent.sentry_id THEN 0 ELSE 1 END, award.created_at, award.id
    ) AS position
  FROM public.awards award
  LEFT JOIN public.tents tent ON tent.id = award.award_target_id
  WHERE award.award_target_type = 'tent'
)
DELETE FROM public.awards award
USING ranked
WHERE award.id = ranked.id
  AND ranked.position > 1;

UPDATE public.awards award
SET user_id = tent.sentry_id
FROM public.tents tent
WHERE award.award_target_type = 'tent'
  AND award.award_target_id = tent.id
  AND tent.sentry_id IS NOT NULL
  AND award.user_id IS DISTINCT FROM tent.sentry_id;

CREATE UNIQUE INDEX IF NOT EXISTS awards_collective_target_cycle_title_key
  ON public.awards (
    award_month,
    COALESCE(award_target_type, 'cadet'),
    COALESCE(award_target_id, user_id),
    title
  );

CREATE OR REPLACE FUNCTION public.award_tent(
  p_tent_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_award_month text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sentry_id uuid;
  v_award_month text := COALESCE(p_award_month, to_char(CURRENT_DATE, 'YYYY-MM'));
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can award a tent';
  END IF;

  SELECT sentry_id INTO v_sentry_id
  FROM public.tents
  WHERE id = p_tent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tent not found';
  END IF;
  IF v_sentry_id IS NULL THEN
    RAISE EXCEPTION 'Assign a sentry to this tent before giving it an award';
  END IF;

  INSERT INTO public.awards (
    user_id, title, description, award_type, award_month,
    award_target_type, award_target_id
  ) VALUES (
    v_sentry_id, p_title, p_description, 'tent', v_award_month,
    'tent', p_tent_id
  )
  ON CONFLICT (award_month, (COALESCE(award_target_type, 'cadet')), (COALESCE(award_target_id, user_id)), title)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    description = EXCLUDED.description,
    award_type = 'tent';

  RETURN 1;
END;
$$;
