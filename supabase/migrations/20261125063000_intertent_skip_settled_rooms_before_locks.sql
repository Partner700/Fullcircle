-- Skip fully settled Inter-Tent fixtures before acquiring row locks.
-- Preserve the 15-minute join cutoff, stalled-match guard and one-penalty-per-player key.
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
    JOIN public.arena_journey_games g ON g.room_id=r.id
    WHERE r.status IN ('playing','completed')
      AND r.started_at IS NOT NULL
      AND r.started_at + interval '15 minutes' <= now()
      AND f.result IS DISTINCT FROM '[]'::jsonb
      AND (g.turn_number > 0 OR EXISTS (
        SELECT 1 FROM public.arena_journey_commands c WHERE c.room_id=r.id
      ))
      AND (r.status='completed' OR EXISTS (
        SELECT 1 FROM public.arena_journey_commands c
        WHERE c.room_id=r.id AND c.created_at >= now() - interval '10 minutes'
      ))
      -- Ignore fully settled rooms before taking any locks. A repeated cron
      -- execution must not revisit rooms without an outstanding late player.
      AND EXISTS (
        SELECT 1
        FROM unnest(f.player_ids) AS scheduled(player_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.arena_participants a
          WHERE a.room_id=r.id AND a.user_id=scheduled.player_id
            AND a.joined_at <= r.started_at + interval '15 minutes'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.denarii_ledger_entries d
          WHERE d.user_id=scheduled.player_id AND d.source_type='admin_adjustment'
            AND d.source_reference='intertent-late-final:' || r.id::text
        )
      )
    ORDER BY r.started_at, r.id
  LOOP
    PERFORM 1 FROM public.arena_rooms WHERE id=fixture.room_id FOR UPDATE;
    reference_key := 'intertent-late-final:' || fixture.room_id::text;
    FOR absent_player IN
      SELECT player_id
      FROM unnest(fixture.player_ids) AS player_id
      WHERE NOT EXISTS (
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
          (user_id,amount,source_type,source_reference,description)
        VALUES (absent_player,-5000,'admin_adjustment',reference_key,
                'Inter-Tent Championship · joined after 15-minute grace period')
        ON CONFLICT DO NOTHING;
        IF FOUND THEN processed := processed + 1; END IF;
      EXCEPTION WHEN raise_exception THEN
        RAISE WARNING 'Late Arena penalty could not be collected for fixture %',fixture.fixture_id;
      END;
    END LOOP;
  END LOOP;
  RETURN processed;
END;
$function$
;
REVOKE ALL ON FUNCTION private.process_intertent_late_penalties() FROM PUBLIC, anon, authenticated;
