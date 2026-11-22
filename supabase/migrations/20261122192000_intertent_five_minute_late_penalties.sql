-- Only two scheduled players are required; penalties become due only after grace.
CREATE OR REPLACE FUNCTION private.intertent_before_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE f private.intertent_fixtures%ROWTYPE;
BEGIN
 IF NEW.status<>'playing' OR OLD.status='playing' THEN RETURN NEW; END IF;
 SELECT * INTO f FROM private.intertent_fixtures WHERE room_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM 1 FROM private.intertent_championships WHERE id=f.championship_id FOR UPDATE;
 IF (SELECT count(*) FROM public.arena_participants a WHERE a.room_id=NEW.id AND a.user_id=ANY(f.player_ids) AND a.forfeited_at IS NULL)<2 THEN RAISE EXCEPTION 'At least two scheduled players must be present.'; END IF;
 IF EXISTS (SELECT 1 FROM private.intertent_fixtures x JOIN public.arena_rooms r ON r.id=x.room_id WHERE x.championship_id=f.championship_id AND x.id<>f.id AND r.status='playing') THEN RAISE EXCEPTION 'Another championship match is still being played.'; END IF;
 IF EXISTS (SELECT 1 FROM private.intertent_fixtures x WHERE x.championship_id=f.championship_id AND x.planned_at<f.planned_at AND (x.planned_at AT TIME ZONE 'Africa/Douala')::date=(f.planned_at AT TIME ZONE 'Africa/Douala')::date AND x.result IS NULL) THEN RAISE EXCEPTION 'The preceding match must be completed first.'; END IF;
 -- Wait-room attendance can predate the start by many minutes. Give joined
 -- players the ordinary presence grace measured from actual game start.
 UPDATE public.arena_participants SET last_active_at=coalesce(NEW.started_at,now()) WHERE room_id=NEW.id AND user_id=ANY(f.player_ids) AND forfeited_at IS NULL;
 UPDATE private.intertent_championships SET status='playing' WHERE id=f.championship_id AND status='scheduled';
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION private.process_intertent_late_penalties()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $late$
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
      AND r.started_at + interval '5 minutes' <= now()
      AND f.result IS DISTINCT FROM '[]'::jsonb
    ORDER BY r.started_at, r.id
  LOOP
    -- Serialize with join_instructor_arena_match, which also locks this room.
    PERFORM 1 FROM public.arena_rooms WHERE id=fixture.room_id FOR UPDATE;
    reference_key := 'intertent-late:' || fixture.fixture_id::text;
    FOR absent_player IN
      SELECT player_id
      FROM unnest(fixture.player_ids) AS player_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.arena_participants a
        WHERE a.room_id=fixture.room_id AND a.user_id=player_id AND a.forfeited_at IS NULL
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
                'Inter-Tent Championship · missed five-minute join window')
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
$late$;

REVOKE ALL ON FUNCTION private.process_intertent_late_penalties() FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS intertent_single_late_penalty_per_player
  ON public.denarii_ledger_entries (user_id,source_type,source_reference)
  WHERE source_type='admin_adjustment' AND source_reference LIKE 'intertent-late:%';

DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='fullcircle-intertent-late-penalties') THEN
    PERFORM cron.schedule('fullcircle-intertent-late-penalties', '* * * * *',
      'SELECT private.process_intertent_late_penalties()');
  END IF;
END;
$schedule$;
