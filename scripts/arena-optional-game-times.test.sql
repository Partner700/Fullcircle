-- Run after the Journey fixture and regression suite; no production data is used.
DO $$
DECLARE
  ids uuid[] := ARRAY(SELECT id FROM profiles ORDER BY id);
  host uuid := ids[1]; a uuid := ids[2]; b uuid := ids[3]; c uuid := ids[4]; d uuid := ids[5];
  cup uuid; second_game uuid; final_game uuid; room uuid;
  lineups jsonb := jsonb_build_array(jsonb_build_array(a,b),jsonb_build_array(c,d),jsonb_build_array(null,null));
  denied boolean; category text; roster uuid[]; game uuid;
BEGIN
  PERFORM set_config('app.uid', host::text, false);
  FOREACH category IN ARRAY ARRAY['standard','ludo','journey'] LOOP
    cup := create_instructor_arena_tournament_lineups('Selected games only',category,ARRAY[a,b,c,d],
      ARRAY[now()+interval '1 day',NULL,NULL]::timestamptz[],false,lineups,4,
      CASE WHEN category='journey' THEN 'elisha' ELSE NULL END);
    PERFORM pg_temp.check_true((SELECT count(*)=3 FROM arena_tournament_games WHERE tournament_id=cup),'Bracket fixtures lost');
    PERFORM pg_temp.check_true((SELECT count(*)=1 FROM arena_tournament_games WHERE tournament_id=cup AND room_id IS NOT NULL),'Undated game created a room');
    PERFORM pg_temp.check_true((SELECT count(*)=2 FROM arena_tournament_games WHERE tournament_id=cup AND planned_at IS NULL),'Blank dates were filled automatically');
    SELECT id INTO second_game FROM arena_tournament_games WHERE tournament_id=cup AND round_number=1 AND match_number=2;
    SELECT id INTO final_game FROM arena_tournament_games WHERE tournament_id=cup AND round_number=2;
    PERFORM set_config('app.uid', a::text, false);
    denied:=false;
    BEGIN PERFORM reschedule_arena_tournament_game(second_game,now()+interval '1 day');
    EXCEPTION WHEN OTHERS THEN denied:=true; END;
    PERFORM pg_temp.check_true(denied,'Non-instructor scheduled an undated fixture');
    PERFORM set_config('app.uid', host::text, false);
    denied:=false;
    BEGIN PERFORM reschedule_arena_tournament_game(second_game,NULL);
    EXCEPTION WHEN OTHERS THEN denied:=true; END;
    PERFORM pg_temp.check_true(denied,'Null schedule accepted');
    PERFORM reschedule_arena_tournament_game(final_game,now()+interval '2 days');
    PERFORM pg_temp.check_true((SELECT room_id IS NULL AND planned_at IS NOT NULL FROM arena_tournament_games WHERE id=final_game),'Unqualified final started early');
    denied:=false;
    BEGIN PERFORM reschedule_arena_tournament_game(second_game,now()+interval '3 days');
    EXCEPTION WHEN OTHERS THEN denied:=true; END;
    PERFORM pg_temp.check_true(denied,'Preceding game scheduled after its final');
    PERFORM pg_temp.check_true((SELECT planned_at IS NULL FROM arena_tournament_games WHERE id=second_game),'Failed change was not rolled back');
    PERFORM reschedule_arena_tournament_game(second_game,now()+interval '1 day');
    PERFORM pg_temp.check_true((SELECT room_id IS NOT NULL FROM arena_tournament_games WHERE id=second_game),'Scheduling a ready fixture did not create its room');
  END LOOP;
  denied:=false;
  BEGIN PERFORM create_instructor_arena_tournament_lineups('No selected games','standard',ARRAY[a,b,c,d],
    ARRAY[NULL,NULL,NULL]::timestamptz[],false,lineups,4,NULL);
  EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.check_true(denied,'All-empty schedule accepted');

  -- Completing both semi-finals must leave an undated final waiting for the instructor.
  cup := create_instructor_arena_tournament_lineups('Undated final','journey',ARRAY[a,b,c,d],
    ARRAY[now()+interval '1 day',now()+interval '1 day',NULL]::timestamptz[],false,lineups,4,'elisha');
  FOR game,room IN SELECT id,room_id FROM arena_tournament_games WHERE tournament_id=cup AND round_number=1 ORDER BY match_number LOOP
    SELECT player_ids INTO roster FROM arena_scheduled_matches WHERE room_id=room;
    INSERT INTO arena_participants(room_id,user_id) SELECT room,unnest(roster);
    UPDATE arena_rooms SET status='playing' WHERE id=room;
    room:=pg_temp.finish_leg(room,roster[1],roster[2],4,1);
    PERFORM pg_temp.finish_leg(room,roster[1],roster[2],4,1);
  END LOOP;
  SELECT id INTO final_game FROM arena_tournament_games WHERE tournament_id=cup AND round_number=2;
  PERFORM pg_temp.check_true((SELECT left_player_id=a AND right_player_id=c AND planned_at IS NULL AND room_id IS NULL
    FROM arena_tournament_games WHERE id=final_game),'Undated final launched on advancement or lost qualifiers');
  PERFORM reschedule_arena_tournament_game(final_game,now()+interval '2 days');
  PERFORM pg_temp.check_true((SELECT room_id IS NOT NULL FROM arena_tournament_games WHERE id=final_game),'Later final scheduling failed');
  PERFORM pg_temp.check_true(NOT has_function_privilege('authenticated','public.arena_tournament_times_valid(uuid)','EXECUTE'), 'Internal helper exposed');
END;
$$;
