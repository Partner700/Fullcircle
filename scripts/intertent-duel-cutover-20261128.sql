-- Run only after the duel transaction layer, Edge function and client tests have passed.
-- The previous four completed fixtures remain historical; no scores or ledgers are deleted.
BEGIN;
DO $$
DECLARE old_id uuid:='67160077-2931-4bcc-bafd-e41c0a677a1d'; old_event private.intertent_championships%ROWTYPE; new_id uuid; fixture uuid; f record; tents uuid[]; h uuid; a uuid; i integer; home_offset integer; away_offset integer; leg_number integer; starts timestamptz; first_day date:='2026-12-01';
  h_indexes integer[]:=ARRAY[1,2,3,2,3,1,1,2,3,2,3,1]; a_indexes integer[]:=ARRAY[2,3,1,1,2,3,2,3,1,1,2,3];
  -- Tournament owner explicitly selected Gloire, Courage and Rudy for Square.
  -- Their competition roster is independent of ordinary tent memberships.
  unqualified_tents uuid[]:=ARRAY['b6209344-ba05-4a85-a916-5d5f9ca1c62e']::uuid[];
  rosters jsonb:='{"b6209344-ba05-4a85-a916-5d5f9ca1c62e":["f176f6f1-e40c-4b00-b9dd-ce8f0a726ca8","d4460de6-a108-4a6e-8326-715a1bbc76fa","a5c2a6f0-e721-4c4f-82e9-2f5ad9229202"]}'::jsonb;
  excluded_players uuid[]:=ARRAY['a70cc97a-7957-4ef8-90f7-b43b6584d111','bcbb4a09-b02d-41ed-a2bc-2f63f3fe3115']::uuid[];
BEGIN
  SELECT * INTO STRICT old_event FROM private.intertent_championships WHERE id=old_id AND status='playing' FOR UPDATE;
  IF (SELECT count(*) FROM private.intertent_fixtures WHERE championship_id=old_id AND result IS NOT NULL)<>4 THEN RAISE EXCEPTION 'The historical championship changed; review before cutover.'; END IF;
  IF EXISTS(SELECT 1 FROM private.intertent_fixtures x JOIN public.arena_rooms r ON r.id=x.room_id WHERE x.championship_id=old_id AND x.result IS NULL AND (r.status<>'waiting' OR r.started_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.arena_journey_games g WHERE g.room_id=r.id))) THEN RAISE EXCEPTION 'An unfinished match is already active; do not replace it.'; END IF;
  SELECT array_agg(t.id ORDER BY t.name,t.id) INTO tents FROM public.tents t WHERE t.camp_id=old_event.camp_id AND t.sentry_id IS NOT NULL AND t.id IN(SELECT DISTINCT value::uuid FROM private.intertent_fixtures x CROSS JOIN LATERAL jsonb_each_text(x.sides) WHERE x.championship_id=old_id);
  IF cardinality(tents) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'Three active tents required.'; END IF;
  FOR f IN SELECT x.room_id FROM private.intertent_fixtures x JOIN public.arena_rooms r ON r.id=x.room_id WHERE x.championship_id=old_id AND x.result IS NULL FOR UPDATE OF r LOOP
    UPDATE public.arena_rooms SET status='cancelled' WHERE id=f.room_id AND status='waiting' AND started_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fixture changed during cutover.'; END IF;
  END LOOP;
  UPDATE private.intertent_championships SET status='completed',title=title||' (archived)' WHERE id=old_id;
  INSERT INTO private.intertent_championships(title,camp_id,created_by,opening_at,status) VALUES('Journey Inter-Tent 1v1 Championship',old_event.camp_id,old_event.created_by,(first_day+time '18:00') AT TIME ZONE 'Africa/Douala','scheduled') RETURNING id INTO new_id;
  INSERT INTO private.intertent_duel_competitions(championship_id,source_championship_id,excluded_player_ids,unqualified_tent_ids,representative_rosters) VALUES(new_id,old_id,excluded_players,unqualified_tents,rosters);
  FOR i IN 1..12 LOOP
    h:=tents[h_indexes[i]];a:=tents[a_indexes[i]];
    starts:=((first_day+((i-1)/4)*7+((i-1)%4))+time '18:00') AT TIME ZONE 'Africa/Douala';
    SELECT count(*) INTO home_offset FROM private.intertent_duel_roles d JOIN private.intertent_fixtures x ON x.id=d.fixture_id WHERE x.championship_id=new_id AND h IN(d.home_tent_id,d.away_tent_id);
    SELECT count(*) INTO away_offset FROM private.intertent_duel_roles d JOIN private.intertent_fixtures x ON x.id=d.fixture_id WHERE x.championship_id=new_id AND a IN(d.home_tent_id,d.away_tent_id);
    SELECT count(*)+1 INTO leg_number FROM private.intertent_duel_roles d JOIN private.intertent_fixtures x ON x.id=d.fixture_id WHERE x.championship_id=new_id AND ((d.home_tent_id=h AND d.away_tent_id=a) OR (d.home_tent_id=a AND d.away_tent_id=h));
    INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,group_key,leg,planned_at) VALUES(new_id,i,'group',CASE WHEN least(h_indexes[i],a_indexes[i])=1 AND greatest(h_indexes[i],a_indexes[i])=2 THEN 'A' WHEN least(h_indexes[i],a_indexes[i])=2 THEN 'B' ELSE 'C' END,leg_number,starts) RETURNING id INTO fixture;
    PERFORM private.intertent_duel_seed(fixture,h,a,home_offset,away_offset);
    PERFORM private.intertent_create_room(fixture);
  END LOOP;
  INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,leg,planned_at) VALUES(new_id,13,'semi',1,'2026-12-22 18:00+01'),(new_id,14,'semi',2,'2026-12-24 18:00+01'),(new_id,15,'final',1,'2026-12-27 18:00+01');
  IF (SELECT count(*) FROM private.intertent_fixtures x JOIN private.intertent_duel_roles d ON d.fixture_id=x.id WHERE x.championship_id=new_id AND x.stage='group' AND cardinality(x.player_ids)=2 AND x.room_id IS NOT NULL)<>12 THEN RAISE EXCEPTION 'Duel calendar is incomplete.'; END IF;
END $$;
COMMIT;
