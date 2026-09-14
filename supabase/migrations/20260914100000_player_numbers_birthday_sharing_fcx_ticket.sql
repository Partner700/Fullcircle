/*
  Resident / Player Numbers, public birthday sharing, and the FCX Market contact.

  Player numbers are globally unique, are assigned in first-FCX registration
  order for existing app members, and remain reserved until one full month
  after subscription access ends. Paid claims are settled atomically against
  the Denarii ledger so two devices cannot purchase the same number.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS player_number integer,
  ADD COLUMN IF NOT EXISTS player_number_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS player_number_assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS player_number_source text,
  ADD COLUMN IF NOT EXISTS player_number_grace_until timestamptz;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_player_number_range_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_player_number_range_check
  CHECK (player_number IS NULL OR player_number BETWEEN 1 AND 999);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_player_number_source_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_player_number_source_check
  CHECK (
    player_number_source IS NULL
    OR player_number_source IN ('fcx_registration', 'self_claim', 'instructor')
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_player_number_unique_idx
  ON public.profiles(player_number)
  WHERE player_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.player_number_catalog (
  player_number integer PRIMARY KEY CHECK (player_number BETWEEN 1 AND 999),
  denarii_price integer NOT NULL DEFAULT 0 CHECK (denarii_price >= 0),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.player_number_catalog(player_number, denarii_price)
SELECT number,
  CASE
    WHEN number <= 99 THEN 0
    WHEN number <= 199 THEN 250
    WHEN number <= 399 THEN 500
    WHEN number <= 699 THEN 1000
    WHEN number <= 899 THEN 1500
    ELSE 2000
  END
FROM generate_series(1, 999) AS number
ON CONFLICT (player_number) DO NOTHING;

ALTER TABLE public.player_number_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_number_catalog_read_authenticated ON public.player_number_catalog;
CREATE POLICY player_number_catalog_read_authenticated
  ON public.player_number_catalog FOR SELECT TO authenticated
  USING (is_enabled = true);
REVOKE INSERT, UPDATE, DELETE ON public.player_number_catalog FROM anon, authenticated;
GRANT SELECT ON public.player_number_catalog TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.player_number_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  player_number integer NOT NULL CHECK (player_number BETWEEN 1 AND 999),
  action text NOT NULL CHECK (action IN ('assigned', 'released')),
  source text NOT NULL,
  denarii_price integer NOT NULL DEFAULT 0 CHECK (denarii_price >= 0),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_number_history_user_idx
  ON public.player_number_history(user_id, created_at DESC);

ALTER TABLE public.player_number_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_number_history_read_owner_or_instructor ON public.player_number_history;
CREATE POLICY player_number_history_read_owner_or_instructor
  ON public.player_number_history FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_instructor(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.player_number_history FROM anon, authenticated;
GRANT SELECT ON public.player_number_history TO authenticated, service_role;

ALTER TABLE public.denarii_ledger_entries
  DROP CONSTRAINT IF EXISTS denarii_ledger_entries_source_type_check;
ALTER TABLE public.denarii_ledger_entries
  ADD CONSTRAINT denarii_ledger_entries_source_type_check
  CHECK (source_type IN (
    'game_level', 'game_blitz', 'quiz_reward', 'fortune_quiz_reward',
    'relic_purchase', 'relic_reward', 'admin_adjustment',
    'hint_purchase', 'answer_reveal', 'freezer_daily', 'freezer_weekly',
    'attendance', 'arena_stake', 'arena_fee', 'arena_reward',
    'mobile_money', 'campay_payment', 'notification_opt_in',
    'challenge_submission', 'dove_question_cost', 'dove_question_reward',
    'hidden_item_purchase', 'treasure_escrow', 'treasure_reward',
    'treasure_refund', 'mine_penalty', 'mine_reward',
    'player_number_purchase'
  ));

CREATE OR REPLACE FUNCTION private.player_number_grace_deadline(p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT greatest(
    now(),
    coalesce(
      CASE
        WHEN subscription.status = 'active' THEN subscription.current_period_end
        WHEN subscription.status = 'trial' THEN subscription.trial_ends_at
        WHEN subscription.status = 'grace' THEN subscription.current_period_end
        ELSE greatest(subscription.current_period_end, subscription.trial_ends_at)
      END,
      now()
    )
  ) + interval '1 month'
  FROM (SELECT p_user_id AS user_id) requested
  LEFT JOIN public.subscriptions subscription ON subscription.user_id = requested.user_id;
$$;

REVOKE ALL ON FUNCTION private.player_number_grace_deadline(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.release_expired_player_numbers(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_profile record;
  v_released integer := 0;
BEGIN
  FOR v_profile IN
    SELECT profile.id, profile.player_number, profile.player_number_source,
           profile.player_number_grace_until
    FROM public.profiles profile
    WHERE profile.player_number IS NOT NULL
      AND profile.player_number_grace_until IS NOT NULL
      AND profile.player_number_grace_until <= now()
      AND NOT public.has_current_subscription_access(profile.id)
      AND (p_user_id IS NULL OR profile.id = p_user_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.player_number_history(
      user_id, player_number, action, source, details
    ) VALUES (
      v_profile.id,
      v_profile.player_number,
      'released',
      'subscription_lapse',
      jsonb_build_object('grace_until', v_profile.player_number_grace_until)
    );

    UPDATE public.profiles
    SET player_number = NULL,
        player_number_assigned_at = NULL,
        player_number_assigned_by = NULL,
        player_number_source = NULL,
        player_number_grace_until = NULL
    WHERE id = v_profile.id;
    v_released := v_released + 1;
  END LOOP;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION private.release_expired_player_numbers(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.refresh_player_number_grace_after_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  UPDATE public.profiles
  SET player_number_grace_until = private.player_number_grace_deadline(NEW.user_id)
  WHERE id = NEW.user_id
    AND player_number IS NOT NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_player_number_grace_after_subscription() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refresh_player_number_grace_after_subscription ON public.subscriptions;
CREATE TRIGGER refresh_player_number_grace_after_subscription
AFTER INSERT OR UPDATE OF status, trial_ends_at, current_period_end
ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION private.refresh_player_number_grace_after_subscription();

/* Existing app members from the first FCX receive numbers in registration
   order. Linda Karen is explicitly anchored at #001 as requested; external
   guests are excluded because only Full Circle accounts own player numbers. */
WITH selected_event AS (
  SELECT event.id
  FROM public.fcx_events event
  WHERE EXISTS (
    SELECT 1 FROM public.fcx_registrations registration
    WHERE registration.event_id = event.id AND registration.user_id IS NOT NULL
  )
  ORDER BY
    CASE WHEN coalesce(event.event_date, event.event_month) <= timezone('Africa/Douala', now())::date THEN 0 ELSE 1 END,
    coalesce(event.event_date, event.event_month) ASC,
    event.created_at ASC
  LIMIT 1
),
ranked_registration AS (
  SELECT registration.user_id,
         row_number() OVER (
           ORDER BY
             CASE
               WHEN regexp_replace(lower(profile.display_name), '[^a-z0-9]', '', 'g') = 'lindakaren' THEN 0
               ELSE 1
             END,
             registration.created_at,
             registration.id
         )::integer AS assigned_number
  FROM public.fcx_registrations registration
  JOIN selected_event event ON event.id = registration.event_id
  JOIN public.profiles profile ON profile.id = registration.user_id
),
assigned AS (
  UPDATE public.profiles profile
  SET player_number = ranked.assigned_number,
      player_number_assigned_at = now(),
      player_number_source = 'fcx_registration',
      player_number_grace_until = private.player_number_grace_deadline(profile.id)
  FROM ranked_registration ranked
  WHERE profile.id = ranked.user_id
    AND ranked.assigned_number BETWEEN 1 AND 999
    AND profile.player_number IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles occupied
      WHERE occupied.player_number = ranked.assigned_number
    )
  RETURNING profile.id, profile.player_number
)
INSERT INTO public.player_number_history(user_id, player_number, action, source)
SELECT assigned.id, assigned.player_number, 'assigned', 'fcx_registration'
FROM assigned;

CREATE OR REPLACE FUNCTION public.get_player_number_options()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  PERFORM private.release_expired_player_numbers();

  SELECT jsonb_build_object(
    'current_number', profile.player_number,
    'assigned_at', profile.player_number_assigned_at,
    'grace_until', profile.player_number_grace_until,
    'wallet_denarii', coalesce(public.get_user_denarii_total(v_user_id), 0),
    'options', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'player_number', catalog.player_number,
        'denarii_price', catalog.denarii_price
      ) ORDER BY catalog.player_number)
      FROM public.player_number_catalog catalog
      WHERE catalog.is_enabled = true
        AND NOT EXISTS (
          SELECT 1 FROM public.profiles owner
          WHERE owner.player_number = catalog.player_number
        )
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_player_number(p_player_number integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_price integer;
  v_balance bigint;
  v_deadline timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Subscribe before choosing a player number.';
  END IF;
  IF p_player_number IS NULL OR p_player_number NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION 'Choose a player number from #001 to #999.';
  END IF;

  PERFORM private.release_expired_player_numbers();
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number:' || p_player_number::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-wallet:' || v_user_id::text, 0));

  SELECT * INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;

  IF v_profile.player_number = p_player_number THEN
    RETURN jsonb_build_object(
      'player_number', v_profile.player_number,
      'denarii_charged', 0,
      'grace_until', v_profile.player_number_grace_until
    );
  END IF;
  IF v_profile.player_number IS NOT NULL THEN
    RAISE EXCEPTION 'You already own player number #% and can only have one.', lpad(v_profile.player_number::text, 3, '0');
  END IF;

  SELECT catalog.denarii_price INTO v_price
  FROM public.player_number_catalog catalog
  WHERE catalog.player_number = p_player_number
    AND catalog.is_enabled = true
  FOR UPDATE;
  IF v_price IS NULL THEN RAISE EXCEPTION 'That player number is unavailable.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles owner
    WHERE owner.player_number = p_player_number
  ) THEN
    RAISE EXCEPTION 'Player number #% has already been taken.', lpad(p_player_number::text, 3, '0');
  END IF;

  v_balance := coalesce(public.get_user_denarii_total(v_user_id), 0);
  IF v_balance < v_price THEN
    RAISE EXCEPTION 'You need % Denarii for #% but currently have %.', v_price, lpad(p_player_number::text, 3, '0'), v_balance;
  END IF;

  IF v_price > 0 THEN
    INSERT INTO public.denarii_ledger_entries(
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id,
      -v_price,
      'player_number_purchase',
      'player-number-' || lpad(p_player_number::text, 3, '0') || '-' || v_user_id::text,
      'Purchased Resident / Player Number #' || lpad(p_player_number::text, 3, '0')
    );
  END IF;

  v_deadline := private.player_number_grace_deadline(v_user_id);
  UPDATE public.profiles
  SET player_number = p_player_number,
      player_number_assigned_at = now(),
      player_number_assigned_by = v_user_id,
      player_number_source = 'self_claim',
      player_number_grace_until = v_deadline
  WHERE id = v_user_id;

  INSERT INTO public.player_number_history(
    user_id, player_number, action, source, denarii_price, actor_id
  ) VALUES (
    v_user_id, p_player_number, 'assigned', 'self_claim', v_price, v_user_id
  );

  RETURN jsonb_build_object(
    'player_number', p_player_number,
    'denarii_charged', v_price,
    'grace_until', v_deadline
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_player_number(p_user_id uuid, p_player_number integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_deadline timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only the instructor can assign player numbers.' USING ERRCODE = '42501';
  END IF;
  IF p_player_number IS NULL OR p_player_number NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION 'Choose a player number from #001 to #999.';
  END IF;

  PERFORM private.release_expired_player_numbers();
  PERFORM pg_advisory_xact_lock(hashtextextended('full-circle-player-number:' || p_player_number::text, 0));
  SELECT * INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That app member was not found.'; END IF;
  IF v_profile.player_number = p_player_number THEN
    RETURN jsonb_build_object('player_number', p_player_number, 'grace_until', v_profile.player_number_grace_until);
  END IF;
  IF v_profile.player_number IS NOT NULL THEN
    RAISE EXCEPTION '% already owns player number #%.', v_profile.display_name, lpad(v_profile.player_number::text, 3, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles owner WHERE owner.player_number = p_player_number) THEN
    RAISE EXCEPTION 'Player number #% has already been taken.', lpad(p_player_number::text, 3, '0');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.player_number_catalog catalog
    WHERE catalog.player_number = p_player_number AND catalog.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'That player number is unavailable.';
  END IF;

  v_deadline := private.player_number_grace_deadline(p_user_id);
  UPDATE public.profiles
  SET player_number = p_player_number,
      player_number_assigned_at = now(),
      player_number_assigned_by = v_actor,
      player_number_source = 'instructor',
      player_number_grace_until = v_deadline
  WHERE id = p_user_id;

  INSERT INTO public.player_number_history(
    user_id, player_number, action, source, actor_id
  ) VALUES (
    p_user_id, p_player_number, 'assigned', 'instructor', v_actor
  );

  RETURN jsonb_build_object('player_number', p_player_number, 'grace_until', v_deadline);
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_number_options() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_player_number(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_player_number(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_number_options() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_player_number(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_player_number(uuid, integer) TO authenticated, service_role;

/* Keep release automatic when Supabase Cron is present, while remaining
   deployable in local and recovery databases where the extension is absent. */
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR v_job_id IN
      SELECT jobid FROM cron.job WHERE jobname = 'full-circle-player-number-release'
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;
    PERFORM cron.schedule(
      'full-circle-player-number-release',
      '17 * * * *',
      'SELECT private.release_expired_player_numbers();'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_fcx_ticket_contact()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_contact jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT jsonb_build_object(
    'user_id', profile.id,
    'display_name', profile.display_name,
    'whatsapp_number', CASE
      WHEN upper(coalesce(profile.country_code, 'CM')) = 'CM'
           AND length(regexp_replace(profile.whatsapp_number, '[^0-9]', '', 'g')) = 9
        THEN '237' || regexp_replace(profile.whatsapp_number, '[^0-9]', '', 'g')
      ELSE regexp_replace(profile.whatsapp_number, '[^0-9]', '', 'g')
    END
  )
  INTO v_contact
  FROM public.profiles profile
  LEFT JOIN public.role_assignments assignment
    ON assignment.user_id = profile.id
   AND assignment.role = 'sentry'
   AND assignment.status IN ('active', 'approved', 'promoted')
  WHERE regexp_replace(lower(profile.display_name), '[^a-z0-9]', '', 'g') LIKE '%vedette%'
    AND nullif(regexp_replace(coalesce(profile.whatsapp_number, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
  ORDER BY (assignment.user_id IS NOT NULL) DESC, profile.created_at
  LIMIT 1;

  RETURN v_contact;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fcx_ticket_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fcx_ticket_contact() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_birthday_announcement(
  p_celebration_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH candidate AS (
    SELECT announcement.id,
           announcement.content,
           announcement.publish_at,
           coalesce(announcement.metadata, '{}'::jsonb) AS metadata,
           0 AS priority
    FROM public.scheduled_announcements announcement
    WHERE announcement.id = p_celebration_id
      AND announcement.announcement_type = 'birthday'
      AND announcement.is_active = true
      AND (announcement.publish_at AT TIME ZONE 'Africa/Douala')::date = p_date

    UNION ALL

    SELECT profile.id,
           'Celebrate ' || profile.display_name || '''s birthday today!',
           (p_date::timestamp AT TIME ZONE 'Africa/Douala'),
           jsonb_build_object(
             'user_id', profile.id,
             'display_name', profile.display_name,
             'avatar_url', profile.avatar_url,
             'kind', 'birthday'
           ),
           1 AS priority
    FROM public.profiles profile
    WHERE profile.id = p_celebration_id
      AND profile.birth_month = extract(month FROM p_date)::integer
      AND profile.birth_day = extract(day FROM p_date)::integer
  ),
  selected AS (
    SELECT * FROM candidate ORDER BY priority LIMIT 1
  ),
  artwork AS (
    SELECT jsonb_build_object(
      'content', image.content,
      'image_position_x', image.image_position_x,
      'image_position_y', image.image_position_y
    ) AS value
    FROM public.scheduled_announcements image
    WHERE image.announcement_type = 'panel_image_birthday'
      AND image.is_active = true
      AND image.publish_at <= now()
      AND image.audience IN ('all', 'cadets', 'sentries')
    ORDER BY CASE WHEN image.audience = 'all' THEN 0 ELSE 1 END, image.publish_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'id', selected.id,
    'date', p_date,
    'content', selected.content,
    'publish_at', selected.publish_at,
    'metadata', selected.metadata,
    'artwork', artwork.value
  )
  FROM selected
  LEFT JOIN artwork ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_birthday_announcement(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_birthday_announcement(uuid, date) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_profile_cv(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, private
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_result jsonb;
BEGIN
  IF v_caller IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND v_caller IS DISTINCT FROM v_target
     AND NOT public.is_instructor(v_caller)
     AND NOT EXISTS (
       SELECT 1
       FROM public.tents tent
       JOIN public.tent_members member ON member.tent_id = tent.id
       WHERE tent.sentry_id = v_caller
         AND member.user_id = v_target
     )
  THEN
    RAISE EXCEPTION 'You cannot view this profile.';
  END IF;

  PERFORM private.release_expired_player_numbers(v_target);

  SELECT jsonb_build_object(
    'user_id', profile.id,
    'display_name', profile.display_name,
    'avatar_url', profile.avatar_url,
    'role', coalesce(active_role.role, 'cadet'),
    'tent_id', home_tent.id,
    'tent_name', home_tent.name,
    'tent_house_id', home_tent.tent_house_id,
    'member_since', profile.created_at,
    'player_number', profile.player_number,
    'player_number_grace_until', profile.player_number_grace_until,
    'total_denarii', stats.total_denarii,
    'current_streak', stats.current_streak,
    'longest_streak', stats.longest_streak,
    'total_figs', stats.total_figs,
    'rhudes', stats.rhudes,
    'marks', stats.marks,
    'completed_challenges', (SELECT count(*) FROM public.challenge_submissions challenge
      WHERE challenge.user_id = profile.id AND challenge.status = 'approved')
  )
  INTO v_result
  FROM public.profiles profile
  CROSS JOIN LATERAL public.get_user_live_stats(profile.id) stats
  LEFT JOIN LATERAL (
    SELECT assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.user_id = profile.id
      AND assignment.status IN ('active', 'approved', 'promoted')
      AND (assignment.end_date IS NULL OR assignment.end_date >= timezone('Africa/Douala', now())::date)
    ORDER BY CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
             assignment.created_at DESC
    LIMIT 1
  ) active_role ON true
  LEFT JOIN LATERAL (
    SELECT tent.id, tent.name, tent.tent_house_id
    FROM public.tents tent
    LEFT JOIN public.tent_members member
      ON member.tent_id = tent.id
     AND member.user_id = profile.id
    WHERE member.user_id IS NOT NULL OR tent.sentry_id = profile.id
    ORDER BY coalesce(member.joined_at, tent.created_at) DESC
    LIMIT 1
  ) home_tent ON true
  WHERE profile.id = v_target;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'This Full Circle profile does not exist.';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_cv(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_cv(uuid) TO authenticated, service_role;
