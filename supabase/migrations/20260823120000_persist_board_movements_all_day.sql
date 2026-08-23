/* Keep challenge-board movement and record markers visible until Douala midnight. */

ALTER TABLE public.challenge_board_daily_snapshots
  ADD COLUMN IF NOT EXISTS day_movement integer NOT NULL DEFAULT 0
    CHECK (day_movement IN (-1, 0, 1)),
  ADD COLUMN IF NOT EXISTS day_record boolean NOT NULL DEFAULT false;

UPDATE public.challenge_board_daily_snapshots snapshot
SET day_movement = CASE
      WHEN snapshot.current_value > snapshot.opening_value THEN 1
      WHEN snapshot.current_value < snapshot.opening_value THEN -1
      WHEN snapshot.current_rank < snapshot.opening_rank THEN 1
      WHEN snapshot.current_rank > snapshot.opening_rank THEN -1
      ELSE snapshot.day_movement
    END,
    day_record = snapshot.day_record OR snapshot.current_value >= snapshot.record_value
WHERE snapshot.snapshot_date = timezone('Africa/Douala', now())::date;

ALTER FUNCTION public.get_competitive_board_movements(text)
  RENAME TO compute_competitive_board_movements_live;

REVOKE ALL ON FUNCTION public.compute_competitive_board_movements_live(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_competitive_board_movements_live(text)
  TO service_role;

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
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live AS MATERIALIZED (
    SELECT result.*
    FROM public.compute_competitive_board_movements_live(p_audience) result
  ), latched AS (
    UPDATE public.challenge_board_daily_snapshots snapshot
    SET day_movement = CASE
          -- A genuine opposite movement replaces the earlier direction. A
          -- temporary return to zero does not erase today's visible arrow.
          WHEN live.movement > 0 THEN 1
          WHEN live.movement < 0 THEN -1
          ELSE snapshot.day_movement
        END,
        day_record = snapshot.day_record OR live.is_new_record,
        updated_at = now()
    FROM live
    WHERE snapshot.board_key = live.board_key
      AND snapshot.audience = CASE
        WHEN live.board_key = 'tent' THEN 'all'
        ELSE p_audience
      END
      AND snapshot.subject_id = live.subject_id
      AND snapshot.snapshot_date = timezone('Africa/Douala', now())::date
    RETURNING
      snapshot.board_key,
      snapshot.audience,
      snapshot.subject_id,
      snapshot.day_movement,
      snapshot.day_record
  )
  SELECT
    live.board_key,
    live.subject_id,
    live.row_data,
    live.current_value,
    live.current_rank,
    live.previous_value,
    live.previous_rank,
    coalesce(latched.day_movement, live.movement)::integer AS movement,
    (live.is_new_record OR coalesce(latched.day_record, false))::boolean AS is_new_record
  FROM live
  LEFT JOIN latched
    ON latched.board_key = live.board_key
   AND latched.audience = CASE
      WHEN live.board_key = 'tent' THEN 'all'
      ELSE p_audience
    END
   AND latched.subject_id = live.subject_id
  ORDER BY live.board_key, live.current_rank, live.subject_id;
$$;

REVOKE ALL ON FUNCTION public.get_competitive_board_movements(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitive_board_movements(text)
  TO authenticated, service_role;
