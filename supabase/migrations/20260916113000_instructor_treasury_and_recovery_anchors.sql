/*
  Instructor treasury and durable recovery-relic anchors.

  Resource grants are server-authoritative, repeatable, and fully audited.
  Recovery relic adjustments are also written into the forward-state chain so
  a later snapshot cannot fall back to the pre-recovery opening streak.
*/

CREATE TABLE IF NOT EXISTS public.instructor_resource_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  denarii_amount integer NOT NULL DEFAULT 0 CHECK (denarii_amount >= 0),
  relic_type_id uuid REFERENCES public.relic_types(id) ON DELETE RESTRICT,
  relic_quantity integer NOT NULL DEFAULT 0 CHECK (relic_quantity >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (denarii_amount > 0 OR relic_quantity > 0),
  CHECK (
    (relic_quantity = 0 AND relic_type_id IS NULL)
    OR (relic_quantity > 0 AND relic_type_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS instructor_resource_grants_recipient_idx
  ON public.instructor_resource_grants(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS instructor_resource_grants_instructor_idx
  ON public.instructor_resource_grants(instructor_id, created_at DESC);

ALTER TABLE public.instructor_resource_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instructor_resource_grants_read ON public.instructor_resource_grants;
CREATE POLICY instructor_resource_grants_read
  ON public.instructor_resource_grants
  FOR SELECT TO authenticated
  USING (
    recipient_id = auth.uid()
    OR public.is_instructor(auth.uid())
  );

REVOKE ALL ON TABLE public.instructor_resource_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.instructor_resource_grants TO authenticated, service_role;
GRANT ALL ON TABLE public.instructor_resource_grants TO service_role;

CREATE OR REPLACE FUNCTION public.grant_instructor_resources(
  p_recipient_id uuid,
  p_denarii_amount integer DEFAULT 0,
  p_relic_type_id uuid DEFAULT NULL,
  p_relic_quantity integer DEFAULT 0,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_grant_id uuid;
  v_recipient_name text;
  v_relic_name text;
  v_current_relic_quantity integer := 0;
  v_wallet bigint := 0;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 240), '');
BEGIN
  IF v_actor IS NULL OR NOT public.is_instructor(v_actor) THEN
    RAISE EXCEPTION 'Only the instructor can grant camp resources.' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'Choose a recipient.';
  END IF;
  IF coalesce(p_denarii_amount, 0) < 0 OR coalesce(p_relic_quantity, 0) < 0 THEN
    RAISE EXCEPTION 'Grant quantities cannot be negative.';
  END IF;
  IF coalesce(p_denarii_amount, 0) = 0 AND coalesce(p_relic_quantity, 0) = 0 THEN
    RAISE EXCEPTION 'Enter Denarii or a relic quantity to grant.';
  END IF;
  IF coalesce(p_relic_quantity, 0) > 0 AND p_relic_type_id IS NULL THEN
    RAISE EXCEPTION 'Choose a relic to grant.';
  END IF;

  SELECT profile.display_name
  INTO v_recipient_name
  FROM public.profiles profile
  WHERE profile.id = p_recipient_id
    AND EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = profile.id
        AND assignment.status IN ('active', 'approved')
    )
  FOR UPDATE;

  IF v_recipient_name IS NULL THEN
    RAISE EXCEPTION 'That active camp member was not found.';
  END IF;

  IF coalesce(p_relic_quantity, 0) > 0 THEN
    SELECT relic.name
    INTO v_relic_name
    FROM public.relic_types relic
    WHERE relic.id = p_relic_type_id;

    IF v_relic_name IS NULL THEN
      RAISE EXCEPTION 'That relic was not found.';
    END IF;

    SELECT coalesce(inventory.quantity, 0)
    INTO v_current_relic_quantity
    FROM public.relic_inventory inventory
    WHERE inventory.user_id = p_recipient_id
      AND inventory.relic_type_id = p_relic_type_id
    FOR UPDATE;

    IF coalesce(v_current_relic_quantity, 0)::bigint + p_relic_quantity::bigint > 2147483647 THEN
      RAISE EXCEPTION 'That relic inventory has reached the database maximum.';
    END IF;
  END IF;

  INSERT INTO public.instructor_resource_grants (
    instructor_id,
    recipient_id,
    denarii_amount,
    relic_type_id,
    relic_quantity,
    note
  ) VALUES (
    v_actor,
    p_recipient_id,
    coalesce(p_denarii_amount, 0),
    CASE WHEN coalesce(p_relic_quantity, 0) > 0 THEN p_relic_type_id ELSE NULL END,
    coalesce(p_relic_quantity, 0),
    v_note
  )
  RETURNING id INTO v_grant_id;

  IF coalesce(p_denarii_amount, 0) > 0 THEN
    INSERT INTO public.denarii_ledger_entries (
      user_id,
      amount,
      source_type,
      source_reference,
      description
    ) VALUES (
      p_recipient_id,
      p_denarii_amount,
      'admin_adjustment',
      'instructor-grant:' || v_grant_id::text,
      'Instructor grant' || CASE WHEN v_note IS NULL THEN '' ELSE ': ' || v_note END
    );
  END IF;

  IF coalesce(p_relic_quantity, 0) > 0 THEN
    INSERT INTO public.relic_inventory AS inventory (
      user_id,
      relic_type_id,
      quantity,
      source_description
    ) VALUES (
      p_recipient_id,
      p_relic_type_id,
      p_relic_quantity,
      'Instructor grant ' || v_grant_id::text
    )
    ON CONFLICT (user_id, relic_type_id) DO UPDATE
    SET quantity = inventory.quantity + EXCLUDED.quantity,
        source_description = EXCLUDED.source_description;
  END IF;

  SELECT coalesce(sum(entry.amount), 0)
  INTO v_wallet
  FROM public.denarii_ledger_entries entry
  WHERE entry.user_id = p_recipient_id;

  RETURN jsonb_build_object(
    'success', true,
    'grant_id', v_grant_id,
    'recipient_id', p_recipient_id,
    'recipient_name', v_recipient_name,
    'denarii_granted', coalesce(p_denarii_amount, 0),
    'wallet_denarii', v_wallet,
    'relic_type_id', CASE WHEN coalesce(p_relic_quantity, 0) > 0 THEN p_relic_type_id ELSE NULL END,
    'relic_name', v_relic_name,
    'relic_quantity_granted', coalesce(p_relic_quantity, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_instructor_resources(uuid, integer, uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_instructor_resources(uuid, integer, uuid, integer, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rebase_forward_streak_from_manual_anchor(
  p_user_id uuid,
  p_effective_date date,
  p_current_streak integer,
  p_longest_streak integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_baseline_date date;
  v_state public.streak_forward_daily_states%ROWTYPE;
  v_later public.streak_forward_daily_states%ROWTYPE;
  v_current integer := greatest(coalesce(p_current_streak, 0), 0);
  v_longest integer := greatest(coalesce(p_longest_streak, 0), coalesce(p_current_streak, 0), 0);
  v_consecutive integer := 0;
  v_cumulative integer := 0;
  v_opening integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_effective_date IS NULL OR p_effective_date > v_today THEN
    RETURN jsonb_build_object('rebased', false, 'reason', 'invalid_anchor');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('full-circle-recovery-anchor:' || p_user_id::text, 0)
  );

  SELECT baseline.baseline_date
  INTO v_baseline_date
  FROM public.streak_forward_baselines baseline
  WHERE baseline.user_id = p_user_id
  FOR UPDATE;

  IF v_baseline_date IS NULL OR p_effective_date <= v_baseline_date THEN
    RETURN jsonb_build_object('rebased', false, 'reason', 'anchor_precedes_forward_engine');
  END IF;

  SELECT state.*
  INTO v_state
  FROM public.streak_forward_daily_states state
  WHERE state.user_id = p_user_id
    AND state.record_date = p_effective_date
  FOR UPDATE;

  IF FOUND THEN
    v_cumulative := v_state.cumulative_inactive;
    v_opening := greatest(v_current - 1, 0);
    UPDATE public.streak_forward_daily_states state
    SET opening_streak = v_opening,
        current_streak = v_current,
        longest_streak = greatest(state.longest_streak, v_longest, v_current),
        consecutive_inactive = 0,
        outcome = 'restored',
        restored = true,
        settled = true,
        evaluated_at = clock_timestamp()
    WHERE state.user_id = p_user_id
      AND state.record_date = p_effective_date;
  ELSE
    SELECT coalesce(previous.cumulative_inactive, baseline.cumulative_inactive, 0)
    INTO v_cumulative
    FROM public.streak_forward_baselines baseline
    LEFT JOIN LATERAL (
      SELECT state.cumulative_inactive
      FROM public.streak_forward_daily_states state
      WHERE state.user_id = p_user_id
        AND state.record_date < p_effective_date
      ORDER BY state.record_date DESC
      LIMIT 1
    ) previous ON true
    WHERE baseline.user_id = p_user_id;

    v_opening := greatest(v_current - 1, 0);
    INSERT INTO public.streak_forward_daily_states (
      user_id,
      record_date,
      opening_streak,
      current_streak,
      longest_streak,
      consecutive_inactive,
      cumulative_inactive,
      outcome,
      requirement_met,
      purchased,
      restored,
      protected,
      settled,
      evaluated_at
    ) VALUES (
      p_user_id,
      p_effective_date,
      v_opening,
      v_current,
      v_longest,
      0,
      v_cumulative,
      'restored',
      false,
      false,
      true,
      false,
      true,
      clock_timestamp()
    );
  END IF;

  FOR v_later IN
    SELECT state.*
    FROM public.streak_forward_daily_states state
    WHERE state.user_id = p_user_id
      AND state.record_date > p_effective_date
      AND state.record_date <= v_today
    ORDER BY state.record_date
    FOR UPDATE
  LOOP
    v_opening := v_current;
    v_cumulative := greatest(v_cumulative, v_later.cumulative_inactive);

    IF v_later.outcome IN ('earned', 'purchased', 'restored') THEN
      v_current := v_current + 1;
      v_consecutive := 0;
    ELSIF v_later.outcome = 'missed' THEN
      v_current := 0;
      v_consecutive := v_consecutive + 1;
    ELSIF v_later.outcome = 'frozen' THEN
      v_consecutive := 0;
    ELSIF v_later.outcome = 'pending' THEN
      v_consecutive := v_later.consecutive_inactive;
    END IF;

    v_longest := greatest(v_longest, v_later.longest_streak, v_current);
    UPDATE public.streak_forward_daily_states state
    SET opening_streak = v_opening,
        current_streak = v_current,
        longest_streak = v_longest,
        consecutive_inactive = v_consecutive,
        cumulative_inactive = v_cumulative,
        evaluated_at = clock_timestamp()
    WHERE state.user_id = p_user_id
      AND state.record_date = v_later.record_date;
  END LOOP;

  PERFORM public.refresh_user_streak_snapshot(p_user_id);
  RETURN jsonb_build_object(
    'rebased', true,
    'user_id', p_user_id,
    'effective_date', p_effective_date,
    'current_streak', v_current,
    'longest_streak', v_longest
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rebase_forward_streak_from_manual_anchor(uuid, date, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebase_forward_streak_from_manual_anchor(uuid, date, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_recovery_manual_adjustment_to_forward_states()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.reason, '') ILIKE '%Redemption Coin%'
    OR coalesce(NEW.reason, '') ILIKE '%Revival relic%'
    OR coalesce(NEW.reason, '') ILIKE '%Thief''s Request%'
  THEN
    PERFORM public.rebase_forward_streak_from_manual_anchor(
      NEW.user_id,
      NEW.effective_date,
      NEW.current_streak,
      NEW.longest_streak
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_recovery_manual_adjustment_to_forward_states()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_recovery_manual_adjustment_to_forward_states
  ON public.streak_manual_adjustments;
CREATE TRIGGER sync_recovery_manual_adjustment_to_forward_states
AFTER INSERT OR UPDATE OF effective_date, current_streak, longest_streak, reason
ON public.streak_manual_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.sync_recovery_manual_adjustment_to_forward_states();

/* Repair every recovery relic already affected by the stale-state gap. This
   includes Courage's September 14 Redemption Coin and replays only the stored
   outcomes after the recovery date. */
DO $$
DECLARE
  v_adjustment record;
BEGIN
  FOR v_adjustment IN
    SELECT adjustment.*
    FROM public.streak_manual_adjustments adjustment
    WHERE coalesce(adjustment.reason, '') ILIKE '%Redemption Coin%'
       OR coalesce(adjustment.reason, '') ILIKE '%Revival relic%'
       OR coalesce(adjustment.reason, '') ILIKE '%Thief''s Request%'
    ORDER BY adjustment.effective_date, adjustment.user_id
  LOOP
    PERFORM public.rebase_forward_streak_from_manual_anchor(
      v_adjustment.user_id,
      v_adjustment.effective_date,
      v_adjustment.current_streak,
      v_adjustment.longest_streak
    );
  END LOOP;
END;
$$;
