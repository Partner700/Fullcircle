DO $$
DECLARE f record; new_time timestamptz; player uuid; cid uuid := '67160077-2931-4bcc-bafd-e41c0a677a1d';
BEGIN
  PERFORM 1 FROM private.intertent_championships WHERE id=cid AND status='playing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Championship not active'; END IF;
  IF (SELECT count(*) FROM private.intertent_fixtures WHERE championship_id=cid AND sequence BETWEEN 5 AND 19 AND result IS NULL) <> 15 THEN RAISE EXCEPTION 'Fixture set changed'; END IF;
  FOR f IN SELECT x.*,c.created_by FROM private.intertent_fixtures x JOIN private.intertent_championships c ON c.id=x.championship_id WHERE x.championship_id=cid AND x.sequence BETWEEN 5 AND 19 ORDER BY x.sequence FOR UPDATE OF x LOOP
    IF f.result IS NOT NULL THEN RAISE EXCEPTION 'Fixture was completed'; END IF;
    new_time := CASE WHEN f.sequence BETWEEN 5 AND 16 THEN ((date '2026-12-01'+((f.sequence-5)/4)*7+((f.sequence-5)%4))+time '18:00') AT TIME ZONE 'Africa/Douala'
    WHEN f.sequence=17 THEN '2026-12-22 18:00:00+01'::timestamptz
    WHEN f.sequence=18 THEN '2026-12-24 18:00:00+01'::timestamptz
    ELSE '2026-12-27 18:00:00+01'::timestamptz END;
    IF f.room_id IS NOT NULL THEN
      PERFORM 1 FROM public.arena_rooms WHERE id=f.room_id AND status='waiting' AND started_at IS NULL FOR UPDATE;
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.arena_journey_games WHERE room_id=f.room_id) THEN RAISE EXCEPTION 'Fixture % already started',f.sequence; END IF;
      UPDATE public.arena_scheduled_matches SET starts_at=new_time WHERE room_id=f.room_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Missing room schedule'; END IF;
      UPDATE public.arena_rooms SET expires_at=new_time+interval '3 hours' WHERE id=f.room_id;
      IF new_time IS DISTINCT FROM f.planned_at THEN
        FOREACH player IN ARRAY f.player_ids LOOP
          PERFORM public.notify_user(player,f.created_by,'arena','Inter-Tent match rescheduled','The fixture now follows the one-match-per-day calendar.','arena',jsonb_build_object('room_id',f.room_id,'starts_at',new_time));
        END LOOP;
      END IF;
    END IF;
    UPDATE private.intertent_fixtures SET planned_at=new_time WHERE id=f.id;
  END LOOP;
END $$;
