-- Repair the reported membership/streak records and make the underlying
-- actions explicit so page mounts and ambiguous toggles cannot alter state.

CREATE OR REPLACE FUNCTION public.set_daily_quote_reaction(
  p_quote_user_id uuid,
  p_quote_record_date date,
  p_reactor_user_id uuid,
  p_reaction_type text,
  p_reacted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer := 0;
  v_reactor_name text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_reactor_user_id THEN
    RAISE EXCEPTION 'You can only change your own reaction.';
  END IF;
  IF p_reaction_type NOT IN ('amen', 'spark', 'thoughtful') THEN
    RAISE EXCEPTION 'Unsupported reaction type.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_records record
    WHERE record.user_id = p_quote_user_id
      AND record.record_date = p_quote_record_date
      AND nullif(btrim(coalesce(record.daily_quote, '')), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Quote not found.';
  END IF;

  IF coalesce(p_reacted, false) THEN
    INSERT INTO public.daily_quote_reactions(
      quote_user_id, quote_record_date, reactor_user_id, reaction_type
    ) VALUES (
      p_quote_user_id, p_quote_record_date, p_reactor_user_id, p_reaction_type
    )
    ON CONFLICT (quote_user_id, quote_record_date, reactor_user_id, reaction_type)
    DO NOTHING;
    GET DIAGNOSTICS v_changed = ROW_COUNT;

    IF v_changed > 0 AND p_quote_user_id <> p_reactor_user_id THEN
      SELECT profile.display_name INTO v_reactor_name
      FROM public.profiles profile WHERE profile.id = p_reactor_user_id;
      PERFORM public.notify_user(
        p_quote_user_id,
        p_reactor_user_id,
        'social',
        'Quote reaction',
        coalesce(v_reactor_name, 'Someone') || ' reacted to your quote.',
        'dashboard',
        jsonb_build_object(
          'quote_record_date', p_quote_record_date,
          'reaction_type', p_reaction_type
        )
      );
    END IF;
  ELSE
    DELETE FROM public.daily_quote_reactions reaction
    WHERE reaction.quote_user_id = p_quote_user_id
      AND reaction.quote_record_date = p_quote_record_date
      AND reaction.reactor_user_id = p_reactor_user_id
      AND reaction.reaction_type = p_reaction_type;
  END IF;

  RETURN jsonb_build_object('success', true, 'reacted', coalesce(p_reacted, false));
END;
$$;

REVOKE ALL ON FUNCTION public.set_daily_quote_reaction(uuid, date, uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_quote_reaction(uuid, date, uuid, text, boolean)
  TO authenticated;

-- Retire the mount-driven endpoint. Installed clients that still invoke it
-- cannot create a streak merely by opening a screen.
CREATE OR REPLACE FUNCTION public.record_sunday_reading_open(
  p_user_id uuid,
  p_record_date date DEFAULT timezone('Africa/Douala', now())::date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only record your own reading activity.';
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sunday_reading_engagement(
  p_user_id uuid,
  p_record_date date,
  p_engagement text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only record your own reading activity.';
  END IF;
  IF p_engagement IS DISTINCT FROM 'reading_interaction' THEN RETURN false; END IF;
  IF p_record_date <> timezone('Africa/Douala', now())::date
    OR extract(dow FROM p_record_date) <> 0
    OR timezone('Africa/Douala', now())::time >= time '21:00'
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.daily_records(
    user_id, record_date, day_type, attendance_status,
    meditation_submitted, streak_valid, sunday_reading_opened_at
  ) VALUES (
    p_user_id, p_record_date, 'sunday', 'unmarked', false, true, now()
  )
  ON CONFLICT (user_id, record_date) DO UPDATE
  SET day_type = 'sunday',
      streak_valid = true,
      sunday_reading_opened_at = coalesce(
        public.daily_records.sunday_reading_opened_at,
        EXCLUDED.sunday_reading_opened_at
      );

  PERFORM public.synchronize_daily_record_streak_valid(p_user_id, p_record_date);
  PERFORM public.refresh_user_streak_snapshot(p_user_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sunday_reading_open(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_sunday_reading_engagement(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sunday_reading_open(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_sunday_reading_engagement(uuid, date, text) TO authenticated;

DO $$
DECLARE
  v_megan_id uuid;
  v_spades_id uuid;
  v_today date := timezone('Africa/Douala', now())::date;
  v_user_id uuid;
  v_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_count
  FROM public.profiles profile
  WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'megan';

  IF v_count = 1 THEN
    SELECT profile.id INTO v_megan_id
    FROM public.profiles profile
    WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'megan'
    LIMIT 1;

    SELECT tent.id INTO v_spades_id
    FROM public.tents tent
    WHERE tent.tent_house_id = 'spades'
      OR regexp_replace(lower(trim(tent.name)), '[^a-z0-9]+', '', 'g') IN ('spades', 'thespades')
    ORDER BY (tent.tent_house_id = 'spades') DESC, tent.created_at DESC
    LIMIT 1;

    IF v_spades_id IS NOT NULL THEN
      -- This repairs the sentry's accepted assignment, including a stale row
      -- that still points at another tent.
      DELETE FROM public.tent_members member
      WHERE member.user_id = v_megan_id AND member.tent_id <> v_spades_id;

      SELECT count(*)::integer INTO v_count
      FROM public.tent_members member
      WHERE member.tent_id = v_spades_id AND coalesce(member.role, 'cadet') = 'cadet';

      UPDATE public.tents
      SET max_cadets = greatest(coalesce(max_cadets, 10), v_count + 1)
      WHERE id = v_spades_id;

      INSERT INTO public.tent_members(tent_id, user_id, role)
      VALUES (v_spades_id, v_megan_id, 'cadet')
      ON CONFLICT (user_id) DO UPDATE
      SET tent_id = EXCLUDED.tent_id, role = 'cadet';

      UPDATE public.tent_join_requests request
      SET status = CASE WHEN request.tent_id = v_spades_id THEN 'approved' ELSE 'cancelled' END,
          reviewed_at = coalesce(request.reviewed_at, now())
      WHERE request.user_id = v_megan_id AND request.status = 'pending';
    END IF;
  END IF;

  -- Megan and PH completed today's requirements. Preserve their recorded
  -- evidence, synchronize its validity, then publish the authoritative value.
  FOR v_user_id IN
    SELECT profile.id
    FROM public.profiles profile
    WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') IN ('megan', 'ph')
  LOOP
    IF extract(dow FROM v_today) = 0 THEN
      INSERT INTO public.daily_records(
        user_id, record_date, day_type, attendance_status,
        meditation_submitted, streak_valid, sunday_reading_opened_at
      ) VALUES (
        v_user_id, v_today, 'sunday', 'unmarked', false, true, now()
      )
      ON CONFLICT (user_id, record_date) DO UPDATE
      SET day_type = 'sunday', streak_valid = true,
          sunday_reading_opened_at = coalesce(public.daily_records.sunday_reading_opened_at, now());
    END IF;
    PERFORM public.synchronize_daily_record_streak_valid(v_user_id, v_today);
    PERFORM public.refresh_user_streak_snapshot(v_user_id);
  END LOOP;

  -- The reported Young Rabbi increase came from the retired mount-driven
  -- Sunday endpoint. Remove only today's accidental evidence and recompute.
  IF extract(dow FROM v_today) = 0 THEN
    FOR v_user_id IN
      SELECT profile.id
      FROM public.profiles profile
      WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'youngrabbi'
    LOOP
      UPDATE public.daily_records record
      SET sunday_reading_opened_at = NULL, streak_valid = false
      WHERE record.user_id = v_user_id AND record.record_date = v_today;
      PERFORM public.synchronize_daily_record_streak_valid(v_user_id, v_today);
      PERFORM public.refresh_user_streak_snapshot(v_user_id);
    END LOOP;
  END IF;
END;
$$;
