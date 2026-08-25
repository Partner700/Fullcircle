/* Make every challenge-board direction deterministic and keep it visible for
   the full Douala day. The previous data-modifying CTE could return a zero
   latch even when the live row itself contained changed values. */

UPDATE public.challenge_board_daily_snapshots snapshot
SET day_movement = CASE
      WHEN snapshot.current_value > snapshot.opening_value THEN 1
      WHEN snapshot.current_value < snapshot.opening_value THEN -1
      WHEN snapshot.current_rank < snapshot.opening_rank THEN 1
      WHEN snapshot.current_rank > snapshot.opening_rank THEN -1
      ELSE snapshot.day_movement
    END,
    day_record = snapshot.day_record OR snapshot.current_value > snapshot.record_value,
    updated_at = now()
WHERE snapshot.snapshot_date = timezone('Africa/Douala', now())::date;

CREATE OR REPLACE FUNCTION public.get_competitive_board_movements(p_audience text)
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
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live record;
  v_snapshot_audience text;
  v_detected_movement integer;
  v_latched_movement integer;
  v_latched_record boolean;
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  FOR v_live IN
    SELECT result.*
    FROM public.compute_competitive_board_movements_live(p_audience) result
    ORDER BY result.board_key, result.current_rank, result.subject_id
  LOOP
    v_latched_movement := NULL;
    v_latched_record := false;
    v_snapshot_audience := CASE
      WHEN v_live.board_key = 'tent' THEN 'all'
      ELSE p_audience
    END;

    v_detected_movement := CASE
      WHEN v_live.current_value > v_live.previous_value THEN 1
      WHEN v_live.current_value < v_live.previous_value THEN -1
      WHEN v_live.current_rank < v_live.previous_rank THEN 1
      WHEN v_live.current_rank > v_live.previous_rank THEN -1
      ELSE 0
    END;

    UPDATE public.challenge_board_daily_snapshots snapshot
    SET current_value = v_live.current_value,
        current_rank = v_live.current_rank,
        record_value = GREATEST(snapshot.record_value, v_live.current_value),
        day_movement = CASE
          WHEN v_detected_movement <> 0 THEN v_detected_movement
          ELSE snapshot.day_movement
        END,
        day_record = snapshot.day_record OR COALESCE(v_live.is_new_record, false),
        updated_at = now()
    WHERE snapshot.board_key = v_live.board_key
      AND snapshot.audience = v_snapshot_audience
      AND snapshot.subject_id = v_live.subject_id
      AND snapshot.snapshot_date = v_today
    RETURNING snapshot.day_movement, snapshot.day_record
    INTO v_latched_movement, v_latched_record;

    IF NOT FOUND THEN
      INSERT INTO public.challenge_board_daily_snapshots (
        board_key,
        audience,
        subject_id,
        snapshot_date,
        opening_value,
        opening_rank,
        current_value,
        current_rank,
        record_value,
        day_movement,
        day_record,
        updated_at
      )
      VALUES (
        v_live.board_key,
        v_snapshot_audience,
        v_live.subject_id,
        v_today,
        v_live.previous_value,
        v_live.previous_rank,
        v_live.current_value,
        v_live.current_rank,
        GREATEST(v_live.current_value, v_live.previous_value),
        v_detected_movement,
        COALESCE(v_live.is_new_record, false),
        now()
      )
      ON CONFLICT ON CONSTRAINT challenge_board_daily_snapshots_pkey DO UPDATE
        SET current_value = EXCLUDED.current_value,
            current_rank = EXCLUDED.current_rank,
            record_value = GREATEST(
              public.challenge_board_daily_snapshots.record_value,
              EXCLUDED.current_value
            ),
            day_movement = CASE
              WHEN EXCLUDED.day_movement <> 0 THEN EXCLUDED.day_movement
              ELSE public.challenge_board_daily_snapshots.day_movement
            END,
            day_record = public.challenge_board_daily_snapshots.day_record OR EXCLUDED.day_record,
            updated_at = now()
      RETURNING
        challenge_board_daily_snapshots.day_movement,
        challenge_board_daily_snapshots.day_record
      INTO v_latched_movement, v_latched_record;
    END IF;

    board_key := v_live.board_key;
    subject_id := v_live.subject_id;
    row_data := v_live.row_data;
    current_value := v_live.current_value;
    current_rank := v_live.current_rank;
    previous_value := v_live.previous_value;
    previous_rank := v_live.previous_rank;
    movement := COALESCE(NULLIF(v_latched_movement, 0), NULLIF(v_detected_movement, 0), 0);
    is_new_record := COALESCE(v_live.is_new_record, false) OR COALESCE(v_latched_record, false);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_competitive_board_movements(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitive_board_movements(text)
  TO authenticated, service_role;
