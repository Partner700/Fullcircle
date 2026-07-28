/*
# Quote comments, relic correction, and market panel imagery

- Ensure quote comments remain available to every authenticated role.
- Redefine Simon's Purse as five dated absence-protection days, excluding Sundays
  and stopping before the Saturday quiz validation.
- Make The Thief's Request find a lost streak caused by missed morning attendance
  or missed devotion, not only missing devotion text.
- Add a Market panel image announcement type.
*/

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call',
      'midday_reminder',
      'evening_reminder',
      'quote_of_day',
      'streakboard_release',
      'general',
      'weekly_background',
      'panel_image_welcome',
      'panel_image_verse',
      'panel_image_announcement',
      'panel_image_quote',
      'panel_image_market'
    )
  );

DROP POLICY IF EXISTS "daily_quote_comments_insert_own" ON public.daily_quote_comments;
CREATE POLICY "daily_quote_comments_insert_own"
  ON public.daily_quote_comments FOR INSERT TO authenticated
  WITH CHECK (commenter_user_id = auth.uid());

UPDATE public.relic_types
SET
  description = 'Keeps your streak earning during five absent weekdays. It does not work on Sunday and the Saturday quiz turns it off.',
  effect = 'streak_shield_week',
  effect_type = 'streak_shield_week'
WHERE slug = 'simons-purse';

CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_relic RECORD;
  v_result jsonb;
  v_days_on_platform integer := 0;
  v_retroactive_denarii integer := 0;
  v_talent_denarii integer := 6000;
  v_first_record_date date;
  v_lost_streak_date date;
  v_saturday_date date;
  v_protected_date date;
  v_inserted_days integer := 0;
BEGIN
  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relic not found';
  END IF;

  SELECT * INTO v_inv
  FROM public.relic_inventory
  WHERE user_id = p_user_id AND relic_type_id = v_relic.id AND quantity > 0
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this relic';
  END IF;

  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inv.id;

  IF v_relic.effect_type = 'revive_lost_streak' THEN
    SELECT MIN(record_date::date) INTO v_first_record_date
    FROM public.daily_records
    WHERE user_id = p_user_id;

    IF v_first_record_date IS NOT NULL THEN
      v_days_on_platform := CURRENT_DATE - v_first_record_date;
      v_retroactive_denarii := GREATEST(v_days_on_platform, 0) * 650;
    END IF;

    IF v_retroactive_denarii > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (
        p_user_id,
        v_retroactive_denarii,
        'relic_reward',
        v_relic.name || ': retroactive ' || v_days_on_platform || ' days at perfect score'
      );
    END IF;

    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', v_relic.name || ': one talent awarded');

    SELECT MAX(d.record_date::date) INTO v_lost_streak_date
    FROM public.daily_records d
    WHERE d.user_id = p_user_id
      AND COALESCE(d.day_type, 'weekday') <> 'sunday'
      AND (
        COALESCE(d.meditation_submitted, false) = false
        OR COALESCE(d.attendance_status, 'unmarked') <> 'present'
        OR COALESCE(d.streak_valid, false) = false
      )
      AND EXISTS (
        SELECT 1
        FROM public.daily_records prior
        WHERE prior.user_id = p_user_id
          AND prior.record_date < d.record_date
          AND (
            (
              COALESCE(prior.day_type, 'weekday') = 'weekday'
              AND COALESCE(prior.attendance_status, 'unmarked') = 'present'
              AND COALESCE(prior.meditation_submitted, false) = true
            )
            OR COALESCE(prior.streak_valid, false) = true
          )
      );

    IF v_lost_streak_date IS NOT NULL THEN
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', v_lost_streak_date);
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'revive_lost_streak',
      'retroactive_denarii', v_retroactive_denarii,
      'talent_denarii', v_talent_denarii,
      'denarii_awarded', v_retroactive_denarii + v_talent_denarii,
      'days_on_platform', v_days_on_platform,
      'streak_revived', v_lost_streak_date IS NOT NULL,
      'revived_date', v_lost_streak_date,
      'message',
        CASE
          WHEN v_lost_streak_date IS NOT NULL THEN v_relic.name || ' revived a lost streak and awarded one talent.'
          ELSE v_relic.name || ' awarded one talent. No lost streak was found to revive.'
        END
    );

  ELSIF v_relic.effect_type = 'resurrect_lost_streak' THEN
    SELECT MAX(d.record_date::date) INTO v_lost_streak_date
    FROM public.daily_records d
    WHERE d.user_id = p_user_id
      AND COALESCE(d.day_type, 'weekday') <> 'sunday'
      AND (
        COALESCE(d.meditation_submitted, false) = false
        OR COALESCE(d.attendance_status, 'unmarked') <> 'present'
        OR COALESCE(d.streak_valid, false) = false
      )
      AND EXISTS (
        SELECT 1
        FROM public.daily_records prior
        WHERE prior.user_id = p_user_id
          AND prior.record_date < d.record_date
          AND (
            (
              COALESCE(prior.day_type, 'weekday') = 'weekday'
              AND COALESCE(prior.attendance_status, 'unmarked') = 'present'
              AND COALESCE(prior.meditation_submitted, false) = true
            )
            OR COALESCE(prior.streak_valid, false) = true
          )
      );

    IF v_lost_streak_date IS NOT NULL THEN
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', v_lost_streak_date);
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'resurrect_lost_streak',
      'streak_revived', v_lost_streak_date IS NOT NULL,
      'revived_date', v_lost_streak_date,
      'message',
        CASE
          WHEN v_lost_streak_date IS NOT NULL THEN 'The Lazarus Coin resurrected a lost streak.'
          ELSE 'The Lazarus Coin was used, but no lost streak was found to resurrect.'
        END
    );

  ELSIF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := CURRENT_DATE + ((6 - EXTRACT(DOW FROM CURRENT_DATE)::int + 7) % 7);
    IF v_saturday_date = CURRENT_DATE THEN
      v_saturday_date := CURRENT_DATE + 7;
    END IF;

    v_protected_date := CURRENT_DATE;
    WHILE v_inserted_days < 5 LOOP
      v_protected_date := v_protected_date + 1;
      EXIT WHEN v_protected_date >= v_saturday_date;

      IF EXTRACT(DOW FROM v_protected_date) <> 0 THEN
        INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date, expires_at)
        VALUES (p_user_id, 'daily', 'relic', v_protected_date, v_saturday_date)
        ON CONFLICT DO NOTHING;
        v_inserted_days := v_inserted_days + 1;
      END IF;
    END LOOP;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'streak_shield_week',
      'protected_days', v_inserted_days,
      'expires_on', v_saturday_date::text,
      'message', 'Simon''s Purse will earn streak protection for up to five absent weekdays, ending before the Saturday quiz.'
    );

  ELSIF v_relic.effect_type = 'grant_one_talent' THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Master''s Reward: one talent awarded');

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'grant_one_talent',
      'denarii_awarded', v_talent_denarii,
      'message', 'The Master''s Reward awarded one talent.'
    );

  ELSE
    v_result := jsonb_build_object('success', true, 'effect', v_relic.effect_type);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
