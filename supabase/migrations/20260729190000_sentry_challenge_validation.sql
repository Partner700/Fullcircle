-- Daily challenge evidence only counts after review by the cadet's sentry or an instructor.

CREATE OR REPLACE FUNCTION public.is_sentry_for_cadet(p_sentry_id uuid, p_cadet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tents t
    JOIN public.tent_members tm ON tm.tent_id = t.id
    JOIN public.role_assignments ra ON ra.user_id = p_sentry_id
    WHERE t.sentry_id = p_sentry_id
      AND tm.user_id = p_cadet_id
      AND ra.role = 'sentry'
      AND ra.status = 'active'
  );
$$;

DROP POLICY IF EXISTS "read_challenge_submissions" ON public.challenge_submissions;
CREATE POLICY "read_challenge_submissions" ON public.challenge_submissions FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR is_instructor(auth.uid())
  OR is_sentry_for_cadet(auth.uid(), user_id)
);

DROP POLICY IF EXISTS "insert_challenge_own" ON public.challenge_submissions;
CREATE POLICY "insert_challenge_own" ON public.challenge_submissions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "update_challenge_own" ON public.challenge_submissions;
CREATE POLICY "update_challenge_own" ON public.challenge_submissions FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND status IN ('pending', 'rejected'))
WITH CHECK (auth.uid() = user_id AND status = 'pending' AND reviewed_by IS NULL);

DROP POLICY IF EXISTS "sentry_update_challenge_status" ON public.challenge_submissions;
CREATE POLICY "sentry_update_challenge_status" ON public.challenge_submissions FOR UPDATE TO authenticated
USING (is_sentry_for_cadet(auth.uid(), user_id))
WITH CHECK (
  is_sentry_for_cadet(auth.uid(), user_id)
  AND status IN ('approved', 'rejected')
  AND reviewed_by = auth.uid()
);
