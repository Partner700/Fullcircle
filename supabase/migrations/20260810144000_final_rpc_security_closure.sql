/* Close the remaining legacy SECURITY DEFINER entry points that still trusted
 * browser-supplied actor IDs or client-supplied game scores. */

CREATE OR REPLACE FUNCTION public.mark_cadet_attendance(
  p_sentry_id uuid,
  p_cadet_id uuid,
  p_record_date text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_record_date date;
  v_day_type text;
  v_attendance_late boolean;
  v_record public.daily_records%ROWTYPE;
  v_reward_awarded boolean := false;
  v_reward_removed boolean := false;
  v_reward_id uuid;
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only mark attendance from your own account.';
  END IF;
  IF p_record_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid attendance date.';
  END IF;
  v_record_date := p_record_date::date;
  IF v_record_date IS DISTINCT FROM v_local_now::date THEN
    RAISE EXCEPTION 'Attendance can only be marked for today.';
  END IF;
  IF p_status NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'Attendance status must be present or absent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tent_members cadet_member
    JOIN public.tents tent ON tent.id = cadet_member.tent_id
    LEFT JOIN public.tent_members sentry_member
      ON sentry_member.tent_id = tent.id
      AND sentry_member.user_id = v_caller
      AND sentry_member.role = 'sentry'
    WHERE cadet_member.user_id = p_cadet_id
      AND cadet_member.role = 'cadet'
      AND (tent.sentry_id = v_caller OR sentry_member.id IS NOT NULL)
  )
  AND NOT public.is_instructor(v_caller) THEN
    RAISE EXCEPTION 'You can only mark attendance for cadets in your assigned tent.';
  END IF;

  v_day_type := CASE
    WHEN extract(dow FROM v_record_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  v_attendance_late := v_local_now::time >= time '12:00';

  INSERT INTO public.daily_records (
    user_id, record_date, day_type, attendance_status,
    attendance_marked_at, attendance_marked_by, attendance_late,
    meditation_submitted, streak_valid
  ) VALUES (
    p_cadet_id, v_record_date, v_day_type, p_status,
    now(), v_caller, v_attendance_late, false,
    CASE WHEN v_day_type = 'sunday' THEN NULL ELSE false END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    attendance_status = EXCLUDED.attendance_status,
    attendance_marked_at = EXCLUDED.attendance_marked_at,
    attendance_marked_by = EXCLUDED.attendance_marked_by,
    attendance_late = EXCLUDED.attendance_late,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'sunday' THEN NULL
      WHEN EXCLUDED.day_type = 'weekday' THEN
        EXCLUDED.attendance_status = 'present'
        AND coalesce(public.daily_records.meditation_submitted, false)
        AND (
          public.daily_records.meditation_submitted_at IS NULL
          OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
        )
      ELSE coalesce(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  -- Marking at least one cadet before midday supplies the sentry's attendance
  -- half. Their own meditation completes the weekday streak immediately.
  IF v_day_type = 'weekday' AND NOT v_attendance_late AND public.is_sentry(v_caller) THEN
    INSERT INTO public.daily_records (
      user_id, record_date, day_type, attendance_status,
      attendance_marked_at, attendance_marked_by, attendance_late,
      meditation_submitted, streak_valid
    ) VALUES (
      v_caller, v_record_date, v_day_type, 'present',
      now(), v_caller, false, false, false
    )
    ON CONFLICT (user_id, record_date) DO UPDATE SET
      day_type = EXCLUDED.day_type,
      attendance_status = CASE
        WHEN coalesce(public.daily_records.attendance_status, 'unmarked') <> 'absent' THEN 'present'
        ELSE public.daily_records.attendance_status
      END,
      attendance_marked_at = coalesce(public.daily_records.attendance_marked_at, EXCLUDED.attendance_marked_at),
      attendance_marked_by = EXCLUDED.attendance_marked_by,
      attendance_late = false,
      streak_valid = CASE
        WHEN coalesce(public.daily_records.attendance_status, 'unmarked') <> 'absent'
          AND coalesce(public.daily_records.meditation_submitted, false)
          AND (
            public.daily_records.meditation_submitted_at IS NULL
            OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
          )
        THEN true
        ELSE coalesce(public.daily_records.streak_valid, false)
      END;
  END IF;

  IF p_status = 'present' THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id, amount, source_type, source_reference, description
    )
    SELECT p_cadet_id, 200, 'attendance', v_record_date::text, 'Attendance reward'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = p_cadet_id
        AND entry.source_type = 'attendance'
        AND entry.source_reference = v_record_date::text
        AND entry.amount = 200
    )
    RETURNING id INTO v_reward_id;
    v_reward_awarded := v_reward_id IS NOT NULL;
  ELSE
    WITH deleted AS (
      DELETE FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = p_cadet_id
        AND entry.source_type = 'attendance'
        AND entry.source_reference = v_record_date::text
        AND entry.amount = 200
      RETURNING entry.id
    )
    SELECT EXISTS(SELECT 1 FROM deleted) INTO v_reward_removed;
  END IF;

  RETURN jsonb_build_object(
    'record_id', v_record.id,
    'attendance_status', v_record.attendance_status,
    'attendance_late', v_record.attendance_late,
    'reward_awarded', v_reward_awarded,
    'reward_removed', v_reward_removed,
    'devotion_submitted', coalesce(v_record.meditation_submitted, false),
    'streak_valid', v_record.streak_valid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.react_to_daily_quote(
  p_quote_user_id uuid,
  p_quote_record_date date,
  p_reactor_user_id uuid,
  p_reaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reactor_id uuid := auth.uid();
  v_quote text;
  v_reactor_name text;
BEGIN
  IF v_reactor_id IS NULL OR v_reactor_id IS DISTINCT FROM p_reactor_user_id THEN
    RAISE EXCEPTION 'You can only react as yourself.';
  END IF;
  IF p_reaction_type NOT IN ('amen', 'spark', 'thoughtful') THEN
    RAISE EXCEPTION 'Unsupported reaction type.';
  END IF;

  SELECT daily_quote INTO v_quote
  FROM public.daily_records
  WHERE user_id = p_quote_user_id
    AND record_date = p_quote_record_date
    AND nullif(btrim(coalesce(daily_quote, '')), '') IS NOT NULL;
  IF v_quote IS NULL THEN RAISE EXCEPTION 'Quote not found.'; END IF;

  INSERT INTO public.daily_quote_reactions (
    quote_user_id, quote_record_date, reactor_user_id, reaction_type
  ) VALUES (
    p_quote_user_id, p_quote_record_date, v_reactor_id, p_reaction_type
  )
  ON CONFLICT (quote_user_id, quote_record_date, reactor_user_id, reaction_type)
  DO NOTHING;

  IF p_quote_user_id <> v_reactor_id THEN
    SELECT display_name INTO v_reactor_name
    FROM public.profiles WHERE id = v_reactor_id;
    PERFORM public.notify_user(
      p_quote_user_id, v_reactor_id, 'social', 'Quote reaction',
      coalesce(v_reactor_name, 'Someone') || ' reacted to your quote.',
      'dashboard',
      jsonb_build_object(
        'quote_record_date', p_quote_record_date,
        'reaction_type', p_reaction_type
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

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
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_sentry_id THEN
    RAISE EXCEPTION 'You can only update a tent image from your own account.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tents tent
    LEFT JOIN public.tent_members membership
      ON membership.tent_id = tent.id
      AND membership.user_id = v_caller
      AND membership.role = 'sentry'
    WHERE tent.id = p_tent_id
      AND (tent.sentry_id = v_caller OR membership.id IS NOT NULL)
  )
  AND NOT public.is_instructor(v_caller) THEN
    RAISE EXCEPTION 'You can only update the profile picture for your assigned tent.';
  END IF;

  UPDATE public.tents
  SET profile_image_url = nullif(btrim(p_profile_image_url), '')
  WHERE id = p_tent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tent not found.'; END IF;
END;
$$;

-- Browser callers use the newer run/question RPCs. This legacy endpoint trusted
-- a client-supplied score and must not remain executable.
REVOKE ALL ON FUNCTION public.complete_daily_game_level(date, integer, text, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_game_assist(date, integer, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_cadet_attendance(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.react_to_daily_quote(uuid, date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comment_on_daily_quote(uuid, date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_tent_profile_image(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.use_relic(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_relic_for_cadet(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_daily_freezer_for_cadet(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_cadet_to_tent(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_mobile_money_settings(text, text, text, text, boolean, text, text, text, integer)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mark_cadet_attendance(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.react_to_daily_quote(uuid, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comment_on_daily_quote(uuid, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tent_profile_image(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_relic_for_cadet(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_daily_freezer_for_cadet(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_cadet_to_tent(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_cadet_to_tent(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_mobile_money_settings(text, text, text, text, boolean, text, text, text, integer)
  TO authenticated;
