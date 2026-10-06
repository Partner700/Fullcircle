/*
  Complete instructor camp totals, one durable grant celebration, and stable
  standing Vallum/Centurion avatar badges.
*/

CREATE OR REPLACE FUNCTION public.get_instructor_competitive_boards()
RETURNS TABLE (
  board_key text,
  subject_id uuid,
  row_data jsonb,
  current_value numeric,
  current_rank integer,
  previous_value numeric,
  previous_rank integer,
  movement integer,
  is_new_record boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', statement_timestamp())::date;
  v_midnight timestamptz := v_today::timestamp AT TIME ZONE 'Africa/Douala';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can view instructor competition boards.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH instructors AS MATERIALIZED (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      profile.display_name,
      profile.avatar_url
    FROM public.role_assignments assignment
    JOIN public.profiles profile ON profile.id = assignment.user_id
    WHERE assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), members AS MATERIALIZED (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      profile.created_at AS resident_since
    FROM public.role_assignments assignment
    JOIN public.profiles profile ON profile.id = assignment.user_id
    WHERE assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
    ORDER BY assignment.user_id, assignment.created_at DESC
  ), components AS MATERIALIZED (
    SELECT component.*
    FROM public.get_member_mark_components() component
  ), camp_totals AS MATERIALIZED (
    SELECT
      (SELECT count(*)::numeric FROM public.daily_narratives) AS narratives,
      (SELECT count(*)::numeric FROM public.daily_narratives narrative
        WHERE narrative.created_at < v_midnight) AS previous_narratives,
      (SELECT count(*)::numeric FROM members) AS residents,
      (SELECT count(*)::numeric FROM members member
        WHERE member.resident_since < v_midnight) AS previous_residents,
      coalesce((SELECT sum(component.wallet_denarii)::numeric FROM components component), 0)::numeric AS total_denarii,
      coalesce((
        SELECT sum(entry.amount)::numeric
        FROM public.denarii_ledger_entries entry
        JOIN members member ON member.user_id = entry.user_id
        WHERE entry.created_at < v_midnight
      ), 0)::numeric AS previous_denarii,
      coalesce((SELECT sum(component.total_figs)::numeric FROM components component), 0)::numeric AS total_figs,
      coalesce((
        SELECT sum(public.get_user_lifetime_figs(member.user_id, v_midnight))::numeric
        FROM members member
      ), 0)::numeric AS previous_figs,
      coalesce((SELECT sum(component.marks)::numeric FROM components component), 0)::numeric AS member_marks,
      coalesce((
        SELECT sum(public.calculate_normalized_marks(
          public.get_lifetime_qualifying_streak_days(member.user_id, v_today)::numeric,
          public.get_qualifying_denarii_total(member.user_id, v_midnight)::numeric,
          coalesce((
            SELECT count(*)::numeric
            FROM public.arena_rooms room
            WHERE room.winner_id = member.user_id
              AND room.status = 'completed'
              AND room.completed_at < v_midnight
          ), 0),
          public.get_user_lifetime_figs(member.user_id, v_midnight)::numeric
        ))::numeric
        FROM members member
      ), 0)::numeric AS previous_member_marks
  ), complete_totals AS (
    SELECT
      camp.*,
      (camp.member_marks + camp.narratives + camp.residents * 5)::numeric AS marks,
      (camp.previous_member_marks + camp.previous_narratives + camp.previous_residents * 5)::numeric AS previous_marks
    FROM camp_totals camp
  ), metric_rows AS (
    SELECT
      instructor.user_id,
      instructor.display_name,
      instructor.avatar_url,
      totals.*,
      metric.board_key,
      metric.current_value,
      metric.previous_value
    FROM instructors instructor
    CROSS JOIN complete_totals totals
    CROSS JOIN LATERAL (VALUES
      ('instructor_narratives'::text, totals.narratives, totals.previous_narratives),
      ('instructor_residents'::text, totals.residents, totals.previous_residents),
      ('instructor_marks'::text, totals.marks, totals.previous_marks),
      ('instructor_denarii'::text, totals.total_denarii, totals.previous_denarii),
      ('instructor_figs'::text, totals.total_figs, totals.previous_figs)
    ) metric(board_key, current_value, previous_value)
  ), ranked AS (
    SELECT
      metric.*,
      rank() OVER (PARTITION BY metric.board_key ORDER BY metric.current_value DESC)::integer AS current_position,
      rank() OVER (PARTITION BY metric.board_key ORDER BY metric.previous_value DESC)::integer AS previous_position
    FROM metric_rows metric
  )
  SELECT
    ranked.board_key,
    ranked.user_id,
    jsonb_build_object(
      'user_id', ranked.user_id,
      'display_name', ranked.display_name,
      'avatar_url', ranked.avatar_url,
      'narratives', ranked.narratives,
      'residents', ranked.residents,
      'marks', ranked.marks,
      'total_denarii', ranked.total_denarii,
      'total_figs', ranked.total_figs,
      'rank', ranked.current_position
    ),
    ranked.current_value,
    ranked.current_position,
    ranked.previous_value,
    ranked.previous_position,
    CASE
      WHEN ranked.current_value > ranked.previous_value THEN 1
      WHEN ranked.current_value < ranked.previous_value THEN -1
      WHEN ranked.current_position < ranked.previous_position THEN 1
      WHEN ranked.current_position > ranked.previous_position THEN -1
      ELSE 0
    END::integer,
    ranked.current_value > ranked.previous_value
  FROM ranked
  ORDER BY ranked.board_key, ranked.current_position, ranked.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_instructor_competitive_boards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_competitive_boards() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_instructor_resource_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instructor_name text;
  v_relic_name text;
  v_resource_summary text;
BEGIN
  SELECT profile.display_name
  INTO v_instructor_name
  FROM public.profiles profile
  WHERE profile.id = NEW.instructor_id;

  IF NEW.relic_type_id IS NOT NULL AND NEW.relic_quantity > 0 THEN
    SELECT relic.name
    INTO v_relic_name
    FROM public.relic_types relic
    WHERE relic.id = NEW.relic_type_id;
  END IF;

  v_resource_summary := concat_ws(
    ' and ',
    CASE WHEN NEW.denarii_amount > 0 THEN NEW.denarii_amount::text || ' Denarii' END,
    CASE WHEN NEW.relic_quantity > 0 THEN NEW.relic_quantity::text || ' x ' || coalesce(v_relic_name, 'relic') END
  );

  PERFORM public.notify_user(
    NEW.recipient_id,
    NEW.instructor_id,
    'resource_grant',
    'A gift from ' || coalesce(nullif(btrim(v_instructor_name), ''), 'your instructor'),
    'You received ' || v_resource_summary || '.',
    'store',
    jsonb_build_object(
      'grant_id', NEW.id,
      'instructor_id', NEW.instructor_id,
      'instructor_name', v_instructor_name,
      'instructor_message', NEW.note,
      'denarii_amount', NEW.denarii_amount,
      'relic_type_id', NEW.relic_type_id,
      'relic_name', v_relic_name,
      'relic_quantity', NEW.relic_quantity,
      'resource_summary', v_resource_summary
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_instructor_resource_grant ON public.instructor_resource_grants;
CREATE TRIGGER notify_instructor_resource_grant
AFTER INSERT ON public.instructor_resource_grants
FOR EACH ROW EXECUTE FUNCTION public.notify_instructor_resource_grant();

REVOKE ALL ON FUNCTION public.notify_instructor_resource_grant() FROM PUBLIC, anon, authenticated;

-- Instructor grants receive the single composed celebration above instead of
-- separate generic Denarii and relic notices.
CREATE OR REPLACE FUNCTION public.notify_denarii_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text;
  v_body text;
  v_action text := 'dashboard';
BEGIN
  IF coalesce(NEW.amount, 0) = 0
    OR coalesce(NEW.source_reference, '') LIKE 'instructor-grant:%' THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type IN ('relic_purchase', 'freezer_daily', 'freezer_weekly') THEN
    v_action := 'store';
  ELSIF NEW.source_type IN ('arena_stake', 'arena_fee', 'arena_reward') THEN
    v_action := 'arena';
  ELSIF NEW.source_type IN ('quiz_reward', 'fortune_quiz_reward') THEN
    v_action := 'quiz';
  ELSIF NEW.source_type IN ('game_level', 'game_blitz') THEN
    v_action := 'game';
  END IF;

  IF NEW.amount > 0 THEN
    v_title := 'Denarii added';
    v_body := 'You received ' || NEW.amount::text || ' denarii'
      || CASE WHEN NEW.description IS NOT NULL THEN ': ' || NEW.description ELSE '.' END;
  ELSE
    v_title := 'Denarii spent';
    v_body := abs(NEW.amount)::text || ' denarii was spent'
      || CASE WHEN NEW.description IS NOT NULL THEN ': ' || NEW.description ELSE '.' END;
  END IF;

  PERFORM public.notify_user(
    NEW.user_id,
    NULL,
    'economy',
    v_title,
    v_body,
    v_action,
    jsonb_build_object(
      'ledger_id', NEW.id,
      'source_type', NEW.source_type,
      'source_reference', NEW.source_reference,
      'amount', NEW.amount
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_relic_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relic_name text;
  v_delta integer;
BEGIN
  IF TG_OP = 'INSERT'
    AND coalesce(NEW.source_description, '') LIKE 'Instructor grant %' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND coalesce(NEW.source_description, '') LIKE 'Instructor grant %'
    AND NEW.source_description IS DISTINCT FROM OLD.source_description THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := coalesce(NEW.quantity, 0);
  ELSE
    v_delta := coalesce(NEW.quantity, 0) - coalesce(OLD.quantity, 0);
  END IF;
  IF v_delta = 0 THEN RETURN NEW; END IF;

  SELECT relic.name INTO v_relic_name
  FROM public.relic_types relic
  WHERE relic.id = NEW.relic_type_id;

  IF v_delta > 0 THEN
    PERFORM public.notify_user(
      NEW.user_id,
      NULL,
      'purchase',
      'Relic added',
      coalesce(v_relic_name, 'A relic') || ' was added to your inventory.',
      'store',
      jsonb_build_object('relic_type_id', NEW.relic_type_id, 'quantity_delta', v_delta)
    );
  ELSE
    PERFORM public.notify_user(
      NEW.user_id,
      NULL,
      'relic',
      'Relic used',
      coalesce(v_relic_name, 'A relic') || ' was used.',
      CASE WHEN coalesce(v_relic_name, '') ILIKE '%goliath%' THEN 'game' ELSE 'store' END,
      jsonb_build_object('relic_type_id', NEW.relic_type_id, 'quantity_delta', v_delta)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_denarii_ledger_entry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_relic_inventory_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_current_avatar_awards()
RETURNS TABLE (user_id uuid, award_type text, title text, cadence text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', statement_timestamp())::date AS today
  ), classified AS (
    SELECT
      award.id,
      award.created_at,
      award.award_month,
      award.title,
      CASE
        WHEN lower(btrim(coalesce(award.award_type, ''))) = 'vallum'
          OR (
            lower(btrim(coalesce(award.title, ''))) LIKE '%vallum%'
            AND lower(btrim(coalesce(award.title, ''))) NOT LIKE '%grand vallum%'
          ) THEN 'vallum'
        WHEN lower(btrim(coalesce(award.award_type, ''))) = 'centurion'
          OR lower(btrim(coalesce(award.title, ''))) LIKE '%centurion%'
          THEN 'centurion'
        ELSE NULL
      END AS avatar_type,
      coalesce(
        award.user_id,
        CASE
          WHEN coalesce(award.award_target_type, 'cadet') <> 'tent' THEN award.award_target_id
        END
      ) AS recipient_id
    FROM public.awards award
    WHERE coalesce(award.award_target_type, 'cadet') <> 'tent'
  ), latest_cycles AS (
    SELECT
      classified.avatar_type,
      max(classified.award_month) AS award_month
    FROM classified
    CROSS JOIN clock
    WHERE classified.avatar_type IN ('vallum', 'centurion')
      AND classified.recipient_id IS NOT NULL
      AND classified.award_month ~ '^[0-9]{4}-[0-9]{2}$'
      AND classified.award_month <= to_char(clock.today, 'YYYY-MM')
    GROUP BY classified.avatar_type
  ), current_holders AS (
    SELECT
      classified.recipient_id,
      classified.avatar_type,
      classified.title,
      row_number() OVER (
        PARTITION BY classified.avatar_type
        ORDER BY classified.created_at DESC, classified.id DESC
      ) AS holder_rank
    FROM classified
    JOIN latest_cycles
      ON latest_cycles.avatar_type = classified.avatar_type
     AND latest_cycles.award_month = classified.award_month
  )
  SELECT
    current_holders.recipient_id,
    current_holders.avatar_type,
    current_holders.title,
    'monthly'::text
  FROM current_holders
  WHERE current_holders.holder_rank = 1
  ORDER BY CASE current_holders.avatar_type WHEN 'vallum' THEN 1 ELSE 2 END;
$$;

REVOKE ALL ON FUNCTION public.get_current_avatar_awards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_avatar_awards() TO anon, authenticated, service_role;
