-- Catch late entrants who join before the minute-based cron runs.
-- Charge by first attendance time; joining late must never erase the penalty.
CREATE OR REPLACE FUNCTION private.process_intertent_late_penalties()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  fixture record;
  absent_player uuid;
  processed integer := 0;
  reference_key text;
BEGIN
  FOR fixture IN
    SELECT f.id AS fixture_id, f.player_ids, r.id AS room_id, r.started_at
    FROM private.intertent_fixtures f
    JOIN public.arena_rooms r ON r.id=f.room_id
    WHERE r.status IN ('playing','completed')
      AND r.started_at IS NOT NULL
      AND r.started_at + interval '15 minutes' <= now()
      AND f.result IS DISTINCT FROM '[]'::jsonb
    ORDER BY r.started_at, r.id
  LOOP
    -- Serialize with join_instructor_arena_match, which also locks this room.
    PERFORM 1 FROM public.arena_rooms WHERE id=fixture.room_id FOR UPDATE;
    reference_key := 'intertent-late-final:' || fixture.fixture_id::text;
    FOR absent_player IN
      SELECT player_id
      FROM unnest(fixture.player_ids) AS player_id
      WHERE NOT EXISTS (
        -- This player had NOT entered within the 15-minute grace period.
        -- Covers absentees AND participants who joined after the deadline.
        SELECT 1 FROM public.arena_participants a
        WHERE a.room_id=fixture.room_id AND a.user_id=player_id
          AND a.joined_at <= fixture.started_at + interval '15 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.denarii_ledger_entries d
        WHERE d.user_id=player_id AND d.source_type='admin_adjustment'
          AND d.source_reference=reference_key
      )
    LOOP
      BEGIN
        INSERT INTO public.denarii_ledger_entries
          (user_id, amount, source_type, source_reference, description)
        VALUES (absent_player, -5000, 'admin_adjustment', reference_key,
                'Inter-Tent Championship · joined after 15-minute grace period')
        ON CONFLICT DO NOTHING;
        IF FOUND THEN processed := processed + 1; END IF;
      EXCEPTION WHEN raise_exception THEN
        -- Existing nonnegative-balance safeguard remains authoritative.
        RAISE WARNING 'Late Arena penalty could not be collected for fixture %', fixture.fixture_id;
      END;
    END LOOP;
  END LOOP;
  RETURN processed;
END;
$function$
;
