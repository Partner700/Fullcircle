-- Profile completion, ten-cadet tents, secure join requests, and strict relic-aware streaks.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language_code text DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Africa/Douala';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Existing members should not be interrupted; only new signups enter onboarding.
UPDATE public.profiles
SET onboarding_completed = true,
    language_code = COALESCE(language_code, 'en'),
    timezone = COALESCE(timezone, 'Africa/Douala')
WHERE created_at < now() - interval '5 minutes';

ALTER TABLE public.tents ALTER COLUMN max_cadets SET DEFAULT 10;
UPDATE public.tents SET max_cadets = 10 WHERE max_cadets < 10;

CREATE OR REPLACE FUNCTION public.enforce_tent_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_cadet_count integer;
  maximum_cadets integer;
BEGIN
  IF NEW.role = 'sentry' THEN RETURN NEW; END IF;
  SELECT count(*) INTO current_cadet_count
  FROM public.tent_members WHERE tent_id = NEW.tent_id AND role = 'cadet';
  SELECT max_cadets INTO maximum_cadets FROM public.tents WHERE id = NEW.tent_id;
  IF current_cadet_count >= COALESCE(maximum_cadets, 10) THEN
    RAISE EXCEPTION 'Tent is full (maximum % cadets plus its sentry)', COALESCE(maximum_cadets, 10);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.tent_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tent_id uuid NOT NULL REFERENCES public.tents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tent_join_requests_one_pending
  ON public.tent_join_requests(user_id) WHERE status = 'pending';
ALTER TABLE public.tent_join_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tent_join_requests_read ON public.tent_join_requests;
CREATE POLICY tent_join_requests_read ON public.tent_join_requests FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_instructor(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tents t
    WHERE t.id = tent_id AND t.sentry_id = auth.uid()
  )
);
REVOKE ALL ON public.tent_join_requests FROM anon, authenticated;
GRANT SELECT ON public.tent_join_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.request_to_join_tent(p_tent_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request_id uuid; v_capacity integer; v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to request a tent.'; END IF;
  IF EXISTS (SELECT 1 FROM public.tent_members WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You already belong to a tent.';
  END IF;
  SELECT max_cadets INTO v_capacity FROM public.tents WHERE id = p_tent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;
  SELECT count(*) INTO v_count FROM public.tent_members WHERE tent_id = p_tent_id AND role = 'cadet';
  IF v_count >= COALESCE(v_capacity, 10) THEN RAISE EXCEPTION 'This tent is full.'; END IF;
  UPDATE public.tent_join_requests SET status = 'cancelled'
  WHERE user_id = auth.uid() AND status = 'pending';
  INSERT INTO public.tent_join_requests(tent_id,user_id) VALUES (p_tent_id,auth.uid()) RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_tent_join_request(p_request_id uuid, p_approve boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.tent_join_requests%ROWTYPE; v_allowed boolean;
BEGIN
  SELECT * INTO v_request FROM public.tent_join_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending request not found.'; END IF;
  SELECT public.is_instructor(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tents WHERE id = v_request.tent_id AND sentry_id = auth.uid()
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Only the tent sentry or instructor can review this request.'; END IF;
  IF p_approve THEN
    DELETE FROM public.tent_members WHERE user_id = v_request.user_id;
    INSERT INTO public.tent_members(tent_id,user_id,role) VALUES(v_request.tent_id,v_request.user_id,'cadet');
  END IF;
  UPDATE public.tent_join_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_request_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_to_join_tent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tent_join_request(uuid,boolean) TO authenticated;

-- Owning Simon's Purse does not deploy it. use_relic creates dated protection rows.
-- Likewise, unused freezers must never be virtually consumed without being marked.
DO $$
DECLARE definition text; original text;
BEGIN
  SELECT pg_get_functiondef('public.compute_strict_streak(uuid)'::regprocedure) INTO definition;
  original := definition;
  definition := regexp_replace(definition,
    'SELECT count\(\*\)::integer\s+INTO v_available_freezers\s+FROM public\.streak_freezers sf\s+WHERE sf\.user_id = p_user_id\s+AND sf\.freezer_type = ''daily''\s+AND sf\.used_at IS NULL\s+AND sf\.applied_to_date IS NULL\s+AND \(sf\.expires_at IS NULL OR sf\.expires_at::date >= v_start\);',
    'v_available_freezers := 0;', 'n');
  definition := regexp_replace(definition,
    'SELECT EXISTS \(\s+SELECT 1\s+FROM public\.relic_inventory ri\s+JOIN public\.relic_types rt ON rt\.id = ri\.relic_type_id\s+WHERE ri\.user_id = p_user_id\s+AND rt\.slug = ''simons-purse''\s+AND ri\.quantity > 0\s+\) INTO v_simons_purse;',
    'v_simons_purse := false;', 'n');
  definition := replace(definition,
    E'      ) INTO v_complete;\n    END IF;\n\n    IF extract(dow FROM v_check) = 0 THEN\n      NULL; -- Keep the automatic Sunday credit.',
    E'      ) INTO v_complete;\n      IF v_check = v_today AND NOT v_complete THEN\n        v_check := v_check + 1;\n        CONTINUE;\n      END IF;\n    END IF;\n\n    IF extract(dow FROM v_check) = 0 THEN\n      NULL; -- Sunday requires an actual Today''s Reading visit.');
  definition := replace(definition,
    E'      IF EXISTS (\n        SELECT 1 FROM public.streak_freezers sf',
    E'      IF extract(dow FROM v_check) BETWEEN 1 AND 5 AND EXISTS (\n        SELECT 1 FROM public.streak_freezers sf');
  IF definition IS DISTINCT FROM original
    AND position('v_simons_purse := false' in definition) > 0
    AND position('v_available_freezers := 0' in definition) > 0
    AND position('Sunday requires an actual' in definition) > 0 THEN
    EXECUTE definition;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;

-- In alternating 19-question machine matches, each side receives about half the deck.
CREATE OR REPLACE FUNCTION public.prepare_arena_question_set(p_room_id uuid,p_user_id uuid,p_questions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_questions jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'You can only prepare questions for your own Arena match.'; END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions)=0 THEN RAISE EXCEPTION 'The Arena question deck cannot be empty.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id=p_room_id AND user_id=p_user_id AND forfeited_at IS NULL) THEN RAISE EXCEPTION 'You are not an active participant in this Arena match.'; END IF;
  UPDATE public.arena_rooms SET question_set=p_questions,question_generated_at=now(),machine_score=CASE
    WHEN play_mode='machine' AND room_name ILIKE '%[difficulty:easy]%' THEN 3
    WHEN play_mode='machine' AND room_name ILIKE '%[difficulty:hard]%' THEN 8
    WHEN play_mode='machine' THEN 5 ELSE machine_score END
  WHERE id=p_room_id AND status IN ('waiting','playing') AND (question_set IS NULL OR jsonb_array_length(question_set)=0);
  SELECT question_set INTO v_questions FROM public.arena_rooms WHERE id=p_room_id;
  IF v_questions IS NULL OR jsonb_array_length(v_questions)=0 THEN RAISE EXCEPTION 'The Arena could not store its question deck.'; END IF;
  RETURN v_questions;
END;
$$;
GRANT EXECUTE ON FUNCTION public.prepare_arena_question_set(uuid,uuid,jsonb) TO authenticated;
