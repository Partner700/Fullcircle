CREATE FUNCTION pg_temp.check_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END;
$$;
CREATE FUNCTION pg_temp.create_cup(players uuid[], lineups jsonb, category text DEFAULT 'journey', narrative text DEFAULT 'elisha')
RETURNS uuid LANGUAGE sql AS $$
  SELECT public.create_instructor_arena_tournament_lineups(
    repeat('Journey ',6), category, players,
    ARRAY(SELECT now() + make_interval(days => n) FROM generate_series(1,jsonb_array_length(lineups)) n),
    false, lineups, jsonb_array_length(lineups)+1, narrative);
$$;
CREATE FUNCTION pg_temp.finish_leg(room uuid, first_player uuid, second_player uuid, first_count int, second_count int)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE successor uuid;
BEGIN
  INSERT INTO arena_journey_games(room_id,character_slug,state) VALUES (room,'elisha',jsonb_build_object('game',jsonb_build_object(
    'winnerId',second_player,'players',jsonb_build_array(
      jsonb_build_object('id',first_player,'score',first_count*2,'correctAnswers',first_count),
      jsonb_build_object('id',second_player,'score',second_count*2,'correctAnswers',second_count)))))
    ON CONFLICT(room_id) DO UPDATE SET state=excluded.state;
  UPDATE arena_participants SET correct_count=CASE WHEN user_id=first_player THEN first_count
    WHEN user_id=second_player THEN second_count ELSE 0 END, score=0 WHERE room_id=room;
  UPDATE arena_rooms SET status='completed',winner_id=second_player,completed_at=now() WHERE id=room;
  SELECT restarted_as_room_id INTO successor FROM arena_rooms WHERE id=room;
  RETURN successor;
END;
$$;
DO $$
DECLARE
  ids uuid[] := ARRAY(SELECT id FROM profiles ORDER BY id);
  host uuid := ids[1]; a uuid := ids[2]; b uuid := ids[3]; c uuid := ids[4]; d uuid := ids[5];
  cup uuid; room uuid; next_room uuid; initial_room uuid; game uuid; roster uuid[];
  denied boolean; n int; leg int; item jsonb; final_card jsonb; reward_count int; legacy uuid;
BEGIN
  PERFORM set_config('app.uid', host::text, false);
  PERFORM pg_temp.check_true(NOT has_function_privilege('anon',
    'public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text)','EXECUTE'),
    'Anonymous tournament creation was allowed');
  PERFORM pg_temp.check_true(has_function_privilege('authenticated',
    'public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text)','EXECUTE'),
    'Authenticated function permission missing');
  FOREACH item IN ARRAY ARRAY['null'::jsonb,'"missing"'::jsonb,'"abraham"'::jsonb] LOOP
    denied:=false;
    BEGIN PERFORM pg_temp.create_cup(ARRAY[a,b],jsonb_build_array(jsonb_build_array(a,b)),'journey',item#>>'{}');
    EXCEPTION WHEN OTHERS THEN denied:=true; END;
    PERFORM pg_temp.check_true(denied,'Missing or unapproved narrative accepted');
  END LOOP;
  PERFORM set_config('app.uid', a::text, false);
  denied:=false;
  BEGIN PERFORM pg_temp.create_cup(ARRAY[a,b],jsonb_build_array(jsonb_build_array(a,b)));
  EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.check_true(denied,'A cadet scheduled a tournament');
  PERFORM set_config('app.uid', host::text, false);

  -- Old clients keep the seven-argument route.
  FOREACH item IN ARRAY ARRAY['"standard"'::jsonb,'"ludo"'::jsonb] LOOP
    legacy:=create_instructor_arena_tournament_lineups('Legacy',item#>>'{}',ARRAY[a,b],
      ARRAY[now()+interval '1 day'],false,jsonb_build_array(jsonb_build_array(a,b)),2);
    PERFORM pg_temp.check_true((SELECT journey_character_slug IS NULL FROM arena_tournaments WHERE id=legacy),
      'Legacy tournament received a Journey narrative');
  END LOOP;

  FOR n IN 2..4 LOOP
    roster:=ids[2:n+1];
    cup:=pg_temp.create_cup(roster,jsonb_build_array(to_jsonb(roster)));
    SELECT g.id,g.room_id INTO game,room FROM arena_tournament_games g WHERE tournament_id=cup;
    initial_room:=room;
    SELECT value INTO item FROM jsonb_array_elements(get_arena_tournaments()) WHERE value->>'id'=cup::text;
    PERFORM pg_temp.check_true(item->>'game_type'='journey' AND item->>'journey_character_name'='Elisha','Catalog identity lost');
    PERFORM pg_temp.check_true((SELECT max_players=n FROM arena_rooms WHERE id=room),'Incorrect match capacity');
    PERFORM pg_temp.check_true((SELECT required_rounds=CASE WHEN n=4 THEN 3 ELSE 2 END FROM arena_match_series WHERE initial_room_id=room),
      'Incorrect configured rounds');
    denied:=false;
    BEGIN INSERT INTO arena_participants(room_id,user_id) VALUES(room,ids[10]);
    EXCEPTION WHEN OTHERS THEN denied:=true; END;
    PERFORM pg_temp.check_true(denied,'Non-selected witness could join as a player');
    INSERT INTO arena_participants(room_id,user_id) SELECT room,unnest(roster);
    INSERT INTO arena_viewers VALUES(room,ids[10],now(),now());
    INSERT INTO arena_guest_witnesses VALUES(room,'guest-hash',now());
    UPDATE arena_rooms SET status='playing' WHERE id=room;
    FOR leg IN 1..CASE WHEN n=4 THEN 3 ELSE 2 END LOOP
      PERFORM pg_temp.check_true((SELECT room_name LIKE '%[arena:journey]%[character:elisha]%' FROM arena_rooms WHERE id=room),
        'Journey identity lost on round transition');
      next_room:=pg_temp.finish_leg(room,a,b,CASE WHEN leg=1 THEN 10 ELSE 1 END,CASE WHEN leg=1 THEN 0 ELSE 2 END);
      IF next_room IS NOT NULL THEN
        PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM arena_viewers WHERE room_id=next_room AND user_id=ids[10]),'Witness not carried forward');
        PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM arena_guest_witnesses WHERE room_id=next_room),'Guest not carried forward');
        room:=next_room;
      END IF;
    END LOOP;
    PERFORM pg_temp.check_true(next_room IS NULL,'Tournament did not finish');
    PERFORM pg_temp.check_true((SELECT champion_id=a FROM arena_tournaments WHERE id=cup),'Aggregate champion incorrect');
    final_card:=get_public_arena_final_scorecard(room);
    PERFORM pg_temp.check_true(final_card->>'game_type'='journey','Final card lost the Journey category');
    PERFORM pg_temp.check_true(final_card->>'winner_id'=a::text,'Last Journey leg replaced overall winner');
    SELECT value INTO item FROM jsonb_array_elements(final_card->'players') WHERE value->>'user_id'=a::text;
    PERFORM pg_temp.check_true((item->>'correct_count')::int=CASE WHEN n=4 THEN 12 ELSE 11 END,'Final card lost cumulative correct answers');
    PERFORM pg_temp.check_true((item->>'score')::int=CASE WHEN n=4 THEN 24 ELSE 22 END,'Final card lost cumulative points');
    PERFORM pg_temp.check_true((SELECT score=CASE WHEN n=4 THEN 24 ELSE 22 END FROM arena_participants WHERE room_id=room AND user_id=a),
      'Journey trigger overwrote final points with last leg');
    item:=journey_private.add_journey_scores(room,jsonb_build_array(jsonb_build_object('user_id',a,'score',22,'correct_count',11)));
    PERFORM pg_temp.check_true((item->0->>'score')::int=CASE WHEN n=4 THEN 24 ELSE 22 END,'Score enrichment lost totals');
    PERFORM pg_temp.check_true((SELECT sum(amount)=31000 FROM denarii_ledger_entries WHERE user_id=a
      AND source_reference IN ('scheduled:champion:'||cup, 'scheduled:play:'||initial_room, 'scheduled:win:'||room)),
      'Final winner rewards must total 31000');
    SELECT count(*) INTO reward_count FROM denarii_ledger_entries;
    UPDATE arena_rooms SET status='completed' WHERE id=room;
    PERFORM pg_temp.check_true((SELECT count(*)=reward_count FROM denarii_ledger_entries),'Duplicate rewards paid');
  END LOOP;

  -- Equal totals create a fresh Journey round, not Classic Trivia.
  cup:=pg_temp.create_cup(ARRAY[a,b],jsonb_build_array(jsonb_build_array(a,b)));
  SELECT room_id INTO room FROM arena_tournament_games WHERE tournament_id=cup;
  INSERT INTO arena_participants(room_id,user_id) VALUES(room,a),(room,b);
  UPDATE arena_rooms SET status='playing' WHERE id=room;
  room:=pg_temp.finish_leg(room,a,b,2,1);
  room:=pg_temp.finish_leg(room,a,b,1,2);
  PERFORM pg_temp.check_true((SELECT room_name LIKE '%(Rematch 1) [arena:journey] [character:elisha]' FROM arena_rooms WHERE id=room),'Tie did not create Journey rematch');
  PERFORM pg_temp.finish_leg(room,a,b,2,1);
  PERFORM pg_temp.check_true((SELECT champion_id=a FROM arena_tournaments WHERE id=cup),'Rematch champion incorrect');

  -- Later bracket fixtures retain the category, narrative, and manual choices.
  cup:=pg_temp.create_cup(ARRAY[a,b,c,d],jsonb_build_array(jsonb_build_array(a,b),jsonb_build_array(c,d),jsonb_build_array(b,null)));
  FOR game,room IN SELECT id,room_id FROM arena_tournament_games WHERE tournament_id=cup AND round_number=1 ORDER BY match_number LOOP
    SELECT player_ids INTO roster FROM arena_scheduled_matches WHERE room_id=room;
    INSERT INTO arena_participants(room_id,user_id) SELECT room,unnest(roster);
    UPDATE arena_rooms SET status='playing' WHERE id=room;
    room:=pg_temp.finish_leg(room,roster[1],roster[2],4,1);
    PERFORM pg_temp.finish_leg(room,roster[1],roster[2],4,1);
  END LOOP;
  SELECT room_id INTO room FROM arena_tournament_games WHERE tournament_id=cup AND round_number=2;
  PERFORM pg_temp.check_true((SELECT room_name LIKE '%[arena:journey]%[character:elisha]' FROM arena_rooms WHERE id=room),'Final fixture lost narrative');
  PERFORM pg_temp.check_true((SELECT player_ids=ARRAY[b,c] FROM arena_scheduled_matches WHERE room_id=room),'Instructor override was lost');

  -- Standalone machine Journey keeps its own winner and score.
  INSERT INTO arena_rooms(creator_id,room_name,status,play_mode,winner_id,completed_at)
    VALUES(a,'Elisha [arena:journey] [character:elisha]','completed','machine',b,now()) RETURNING id INTO room;
  INSERT INTO arena_participants(room_id,user_id,score,correct_count) VALUES(room,a,0,0);
  INSERT INTO arena_journey_games(room_id,character_slug,state) VALUES(room,'elisha',jsonb_build_object('game',jsonb_build_object('winnerId',a,
    'players',jsonb_build_array(jsonb_build_object('id',a,'score',8,'correctAnswers',5)))));
  final_card:=get_public_arena_final_scorecard(room);
  PERFORM pg_temp.check_true(final_card->>'winner_id'=a::text,'Machine Journey winner changed');
  SELECT value INTO item FROM jsonb_array_elements(final_card->'players') WHERE value->>'user_id'=a::text;
  PERFORM pg_temp.check_true(item->>'score'='8' AND item->>'correct_count'='5','Standalone Journey scores changed');
END;
$$;
