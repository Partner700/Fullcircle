/*
  First FCX Founder's Gift.

  The first Full Circle Experience falls immediately after Saturday,
  29 August 2026. Restore continuity for every member who had a positive
  published streak on Friday and lost it by not completing Saturday's quiz.

  This is protection, not completion evidence: it preserves the live streak
  but never creates a lifetime Streak achievement or extra Marks.
*/

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;
ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN (
    'denarii', 'payment', 'relic', 'redemption', 'simons_purse', 'simons_coin',
    'thiefs_request', 'game_reward', 'arena_reward', 'founders_gift'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS streak_freezers_first_fcx_founders_gift_uidx
ON public.streak_freezers(user_id, applied_to_date, source)
WHERE source = 'founders_gift';

CREATE TEMP TABLE first_fcx_founders_gift_recipients
ON COMMIT DROP
AS
WITH latest_published_before_saturday AS (
  SELECT DISTINCT ON (snapshot.user_id)
    snapshot.user_id,
    snapshot.snapshot_date,
    snapshot.current_streak::integer AS baseline_streak
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.snapshot_date <= date '2026-08-28'
  ORDER BY
    snapshot.user_id,
    snapshot.snapshot_date DESC,
    snapshot.created_at DESC NULLS LAST,
    snapshot.id DESC
), friday_streaks AS (
  SELECT
    baseline.user_id,
    (
      baseline.baseline_streak
      + coalesce((
        SELECT count(*)::integer
        FROM generate_series(
          baseline.snapshot_date + 1,
          date '2026-08-28',
          interval '1 day'
        ) AS later_day(record_date)
        WHERE public.streak_requirement_met(baseline.user_id, later_day.record_date::date)
          OR public.streak_day_is_restored(baseline.user_id, later_day.record_date::date)
          OR public.streak_day_is_purchased(baseline.user_id, later_day.record_date::date)
      ), 0)
    )::integer AS friday_streak
  FROM latest_published_before_saturday baseline
  WHERE baseline.baseline_streak > 0
    AND NOT EXISTS (
      SELECT 1
      FROM generate_series(
        baseline.snapshot_date + 1,
        date '2026-08-28',
        interval '1 day'
      ) AS later_day(record_date)
      WHERE (
          extract(dow FROM later_day.record_date) BETWEEN 1 AND 5
          OR (
            extract(dow FROM later_day.record_date) = 6
            AND EXISTS (
              SELECT 1
              FROM public.quiz_sessions session
              WHERE session.session_date = later_day.record_date::date
                AND session.quiz_type = 'saturday'
            )
          )
        )
        AND NOT public.streak_requirement_met(baseline.user_id, later_day.record_date::date)
        AND NOT public.streak_day_is_restored(baseline.user_id, later_day.record_date::date)
        AND NOT public.streak_day_is_purchased(baseline.user_id, later_day.record_date::date)
        AND NOT public.streak_day_is_protected(baseline.user_id, later_day.record_date::date)
    )
)
SELECT
  friday.user_id,
  friday.friday_streak
FROM friday_streaks friday
JOIN public.profiles profile ON profile.id = friday.user_id
WHERE EXISTS (
    SELECT 1
    FROM public.quiz_sessions session
    WHERE session.session_date = date '2026-08-29'
      AND session.quiz_type = 'saturday'
  )
  AND NOT public.streak_requirement_met(friday.user_id, date '2026-08-29')
  AND NOT public.streak_day_is_restored(friday.user_id, date '2026-08-29')
  AND NOT public.streak_day_is_purchased(friday.user_id, date '2026-08-29')
  AND NOT public.streak_day_is_protected(friday.user_id, date '2026-08-29')
  AND NOT EXISTS (
    SELECT 1
    FROM public.streak_freezers existing_gift
    WHERE existing_gift.user_id = friday.user_id
      AND existing_gift.applied_to_date = date '2026-08-29'
      AND existing_gift.source = 'founders_gift'
  );

INSERT INTO public.streak_freezers (
  user_id,
  freezer_type,
  source,
  purchased_at,
  used_at,
  applied_to_date,
  activated_at,
  protection_ends_at,
  protected_through_date,
  expires_at
)
SELECT
  recipient.user_id,
  'daily',
  'founders_gift',
  now(),
  now(),
  date '2026-08-29',
  now(),
  now(),
  date '2026-08-29',
  date '2026-08-30'
FROM first_fcx_founders_gift_recipients recipient
ON CONFLICT (user_id, applied_to_date, source)
  WHERE source = 'founders_gift'
DO NOTHING;

DO $$
DECLARE
  v_recipient record;
  v_restored_streak integer;
BEGIN
  FOR v_recipient IN
    SELECT recipient.user_id, recipient.friday_streak
    FROM first_fcx_founders_gift_recipients recipient
    ORDER BY recipient.user_id
  LOOP
    PERFORM public.refresh_user_streak_snapshot(v_recipient.user_id);

    SELECT coalesce(streak.current_streak, v_recipient.friday_streak)::integer
    INTO v_restored_streak
    FROM public.get_authoritative_streak(v_recipient.user_id) streak
    LIMIT 1;

    INSERT INTO public.user_notifications (
      recipient_id,
      actor_id,
      notification_type,
      title,
      body,
      action_key,
      metadata
    )
    SELECT
      v_recipient.user_id,
      NULL,
      'streak',
      'Founder''s Gift',
      format(
        'For the first FCX, the streak you lost on Saturday has been restored. Your streak is now %s.',
        v_restored_streak
      ),
      'streak',
      jsonb_build_object(
        'gift_key', 'first_fcx_founders_gift_2026',
        'gift_date', '2026-08-29',
        'popup', true,
        'previous_streak', v_recipient.friday_streak,
        'restored_streak', v_restored_streak
      )
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_notifications notification
      WHERE notification.recipient_id = v_recipient.user_id
        AND notification.metadata ->> 'gift_key' = 'first_fcx_founders_gift_2026'
    );
  END LOOP;
END;
$$;
