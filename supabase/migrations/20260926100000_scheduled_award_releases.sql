-- Keep unreleased selections private. One batch is published in one transaction.
CREATE TABLE public.award_releases (
  id uuid PRIMARY KEY,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 200),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'published', 'cancelled', 'failed')),
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX award_releases_due ON public.award_releases(scheduled_at) WHERE status = 'scheduled';
ALTER TABLE public.award_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.award_releases FROM anon, authenticated;
GRANT SELECT ON public.award_releases TO authenticated;
CREATE POLICY instructors_read_award_releases ON public.award_releases
  FOR SELECT TO authenticated USING (public.is_instructor(auth.uid()));

CREATE OR REPLACE FUNCTION private.award_release_catalog()
RETURNS TABLE(title text, cadence text, targets text[])
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  VALUES
    ('Rhetoric Award (Orator)', 'weekly', ARRAY['cadet']),
    ('Angel Award (Angelos)', 'weekly', ARRAY['cadet']),
    ('Rumor Award', 'weekly', ARRAY['cadet']),
    ('Scribe Award', 'weekly', ARRAY['cadet']),
    ('The Sprout', 'weekly', ARRAY['cadet']),
    ('Reputation Award', 'weekly', ARRAY['sentry']),
    ('Tutorix', 'weekly', ARRAY['sentry']),
    ('Valley Champion', 'weekly', ARRAY['cadet','sentry']),
    ('The Lord''s Secret', 'weekly', ARRAY['tent']),
    ('Vallum', 'monthly', ARRAY['cadet']),
    ('Messenger Award (Nuncio)', 'monthly', ARRAY['cadet']),
    ('Monthly Scribe', 'monthly', ARRAY['cadet']),
    ('Monthly Valley Champion', 'monthly', ARRAY['cadet']),
    ('Muralis', 'monthly', ARRAY['cadet']),
    ('Centurion', 'monthly', ARRAY['sentry']),
    ('Bethel Stone', 'monthly', ARRAY['tent']),
    ('Grand Vallum', 'annual', ARRAY['cadet','sentry']),
    ('Grand Scribe', 'annual', ARRAY['cadet','sentry']),
    ('Grand Valley Champion', 'annual', ARRAY['cadet','sentry']),
    ('Grand Orator', 'annual', ARRAY['cadet','sentry']),
    ('Temple Mount', 'annual', ARRAY['tent']);
$$;
REVOKE ALL ON FUNCTION private.award_release_catalog() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validate_award_release_items(p_items jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_item jsonb; v_target uuid;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Select at least one award.'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Select between 1 and 200 awards.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    GROUP BY item->>'title', item->>'target_type', item->>'target_id', item->>'award_month'
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'An award recipient appears twice in this release.'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (SELECT 1 FROM private.award_release_catalog() c
      WHERE c.title = v_item->>'title' AND v_item->>'target_type' = ANY(c.targets)) THEN
      RAISE EXCEPTION 'Choose a valid award and recipient category.';
    END IF;
    IF coalesce(v_item->>'award_month', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
      RAISE EXCEPTION 'Choose a valid award month.';
    END IF;
    IF length(coalesce(v_item->>'description', '')) > 2000 THEN RAISE EXCEPTION 'Award notes must not exceed 2000 characters.'; END IF;
    v_target := (v_item->>'target_id')::uuid;
    IF v_item->>'target_type' = 'tent' THEN
      IF NOT EXISTS (SELECT 1 FROM public.tents WHERE id = v_target AND sentry_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Assign a sentry to the selected tent before releasing its award.';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.profiles p JOIN public.role_assignments r ON r.user_id = p.id
      WHERE p.id = v_target AND r.role = v_item->>'target_type'
        AND r.status IN ('active','approved') AND r.end_date IS NULL
    ) THEN RAISE EXCEPTION 'An award recipient is no longer active in the selected role.';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_award_release_items(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.publish_award_release(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_release public.award_releases%ROWTYPE;
  v_item jsonb; v_user uuid; v_award uuid; v_cadence text; v_cycle text; v_day date; v_member uuid;
BEGIN
  SELECT * INTO v_release FROM public.award_releases WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_release.status <> 'scheduled' OR v_release.scheduled_at > now() THEN RETURN; END IF;
  IF v_release.created_by IS NULL OR NOT public.is_instructor(v_release.created_by) THEN RAISE EXCEPTION 'The scheduling instructor is no longer authorized.'; END IF;
  PERFORM private.validate_award_release_items(v_release.items);
  v_day := timezone('Africa/Douala', v_release.scheduled_at)::date;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_release.items) ORDER BY value->>'title', value->>'target_id' LOOP
    SELECT cadence INTO v_cadence FROM private.award_release_catalog() WHERE title = v_item->>'title';
    v_cycle := CASE v_cadence
      WHEN 'weekly' THEN 'week-' || to_char(v_day - (extract(isodow FROM v_day)::integer - 1), 'YYYY-MM-DD')
      ELSE v_item->>'award_month' END;
    v_user := (v_item->>'target_id')::uuid;
    IF v_item->>'target_type' = 'tent' THEN SELECT sentry_id INTO v_user FROM public.tents WHERE id = v_user; END IF;
    v_award := NULL;
    INSERT INTO public.awards(user_id, title, description, award_type, award_month, award_target_type, award_target_id, created_at)
    VALUES(v_user, v_item->>'title', v_item->>'description',
      CASE v_item->>'target_type' WHEN 'sentry' THEN 'leadership' ELSE v_item->>'target_type' END,
      v_cycle, v_item->>'target_type', (v_item->>'target_id')::uuid, v_release.scheduled_at)
    ON CONFLICT (award_month, (coalesce(award_target_type,'cadet')), (coalesce(award_target_id,user_id)), title) DO NOTHING
    RETURNING id INTO v_award;
    IF v_award IS NOT NULL THEN
      IF v_item->>'target_type' = 'tent' THEN
        FOR v_member IN SELECT user_id FROM public.tent_members WHERE tent_id = (v_item->>'target_id')::uuid UNION SELECT v_user LOOP
          PERFORM public.notify_user(v_member, v_release.created_by, 'award', 'Your tent received an award', v_item->>'title', 'awards', jsonb_build_object('award_id',v_award,'release_id',p_id));
        END LOOP;
      ELSE
        PERFORM public.notify_user(v_user, v_release.created_by, 'award', 'You received an award', v_item->>'title', 'awards', jsonb_build_object('award_id',v_award,'release_id',p_id));
      END IF;
    END IF;
  END LOOP;
  UPDATE public.award_releases SET status = 'published', published_at = now(), last_error = NULL WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION private.publish_award_release(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.schedule_award_release(p_id uuid, p_items jsonb, p_release_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.award_releases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN RAISE EXCEPTION 'Only instructors can schedule awards.'; END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'A release ID is required.'; END IF;
  -- Serialize retries of this exact request, including a retry after a lost response.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO v_existing FROM public.award_releases WHERE id = p_id;
  IF FOUND THEN
    IF v_existing.created_by <> auth.uid() OR v_existing.items IS DISTINCT FROM p_items
      OR (p_release_at IS NOT NULL AND v_existing.scheduled_at IS DISTINCT FROM p_release_at) THEN
      RAISE EXCEPTION 'This release ID already belongs to a different selection.';
    END IF;
    RETURN p_id;
  END IF;
  PERFORM private.validate_award_release_items(p_items);
  IF p_release_at IS NOT NULL AND p_release_at <= now() THEN RAISE EXCEPTION 'Choose a future release time.'; END IF;
  IF p_release_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-award-releases' AND active) THEN
    RAISE EXCEPTION 'The award scheduler is unavailable. Contact the administrator.';
  END IF;
  INSERT INTO public.award_releases(id,created_by,items,scheduled_at) VALUES(p_id,auth.uid(),p_items,coalesce(p_release_at,now()));
  IF p_release_at IS NULL THEN PERFORM private.publish_award_release(p_id); END IF;
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_award_release(uuid,jsonb,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_award_release(uuid,jsonb,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.change_award_release(p_id uuid, p_release_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_release public.award_releases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN RAISE EXCEPTION 'Only instructors can change award releases.'; END IF;
  SELECT * INTO v_release FROM public.award_releases WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_release.status NOT IN ('scheduled','failed') THEN RAISE EXCEPTION 'This release is no longer pending.'; END IF;
  IF p_release_at IS NOT NULL THEN
    IF p_release_at <= now() THEN RAISE EXCEPTION 'Choose a future release time.'; END IF;
    PERFORM private.validate_award_release_items(v_release.items);
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-circle-award-releases' AND active) THEN
      RAISE EXCEPTION 'The award scheduler is unavailable. Contact the administrator.';
    END IF;
  END IF;
  UPDATE public.award_releases SET scheduled_at = coalesce(p_release_at,scheduled_at),
    status = CASE WHEN p_release_at IS NULL THEN 'cancelled' ELSE 'scheduled' END, last_error = NULL WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.change_award_release(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_award_release(uuid,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION private.publish_due_award_releases()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_release record;
BEGIN
  FOR v_release IN SELECT id FROM public.award_releases
    WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 50 FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM private.publish_award_release(v_release.id);
    EXCEPTION WHEN OTHERS THEN
      -- Roll back this entire batch, but allow unrelated due releases to publish.
      UPDATE public.award_releases SET status = 'failed', last_error = SQLERRM WHERE id = v_release.id;
    END;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.publish_due_award_releases() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Supabase Cron must be enabled before scheduling awards.';
  END IF;
  PERFORM cron.schedule('full-circle-award-releases','* * * * *','SELECT private.publish_due_award_releases();');
END;
$$;
