SELECT set_config('app.uid','00000000-0000-4000-8000-000000000001',false);
DO $$
DECLARE t uuid; r uuid; s jsonb; last_slot int; winner uuid:='00000000-0000-4000-8000-000000000002';
BEGIN
 t:=public.create_instructor_arena_tournament_lineups('Prelude Test','prelude',
  ARRAY['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005']::uuid[],
  ARRAY[now()+interval '5 minutes',now()+interval '5 minutes',NULL]::timestamptz[],false,
  '[["00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003"],["00000000-0000-4000-8000-000000000004","00000000-0000-4000-8000-000000000005"],[null,null]]',4,NULL);
 SELECT room_id INTO r FROM arena_tournament_games WHERE tournament_id=t AND round_number=1 AND match_number=1;
 IF (SELECT room_name FROM arena_rooms WHERE id=r) NOT LIKE '%[arena:prelude]%' THEN RAISE EXCEPTION 'Prelude room tag missing'; END IF;
 PERFORM set_config('app.uid',winner::text,false);s:=public.prelude_command('join',r);
 PERFORM set_config('app.uid','00000000-0000-4000-8000-000000000003',false);s:=public.prelude_command('join',r);
 UPDATE arena_scheduled_matches SET starts_at=now()-interval '1 minute' WHERE room_id=r;
 PERFORM set_config('app.uid',winner::text,false);s:=public.prelude_command('start',r);
 IF EXISTS(SELECT 1 FROM arena_match_series WHERE initial_room_id=r) THEN RAISE EXCEPTION 'Prelude must play one 104-card round'; END IF;
 SELECT state INTO s FROM scripture_games.prelude_games WHERE room_id=r;
 SELECT (value->>'slot')::int INTO last_slot FROM jsonb_array_elements(s->'deck') WHERE (value->>'joker')::boolean LIMIT 1;
 s:=jsonb_set(s,'{players,0,cards}','20');s:=jsonb_set(s,'{turn}','0');
 SELECT jsonb_set(s,'{deck}',jsonb_agg(value||jsonb_build_object('drawn',(value->>'slot')::int<>last_slot) ORDER BY (value->>'slot')::int)) INTO s FROM jsonb_array_elements(s->'deck');
 UPDATE scripture_games.prelude_games SET state=s WHERE room_id=r;
 s:=public.prelude_command('flip',r,last_slot,'{}',(SELECT version FROM scripture_games.prelude_games WHERE room_id=r));
 IF s->>'winnerId'<>winner::text THEN RAISE EXCEPTION 'Prelude tournament winner not settled'; END IF;
 IF (SELECT coalesce(sum(amount),0) FROM denarii_ledger_entries WHERE source_reference IN ('scheduled:play:'||r,'scheduled:win:'||r))<>1000 THEN RAISE EXCEPTION 'Prelude round must pay exactly 1000, without legacy participation/5000 prizes'; END IF;
 IF (SELECT left_player_id FROM arena_tournament_games WHERE tournament_id=t AND round_number=2)<>winner THEN RAISE EXCEPTION 'Prelude winner did not advance'; END IF;
END $$;
-- Lifetime FIGS must include new word entries without erasing existing sources.
INSERT INTO scripture_games.fig_entries(user_id,source,amount) VALUES('00000000-0000-4000-8000-000000000002','puzzle:test',5);
DO $$ BEGIN IF public.get_user_lifetime_figs('00000000-0000-4000-8000-000000000002')<5 THEN RAISE EXCEPTION 'Puzzle FIGS missing from lifetime totals'; END IF; END $$;

-- Generic Arena maintenance must not settle a Prelude table before the deck is exhausted.
INSERT INTO arena_rooms(id,creator_id,room_name,status,started_at) VALUES('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Test [arena:prelude]','playing',now()-interval '10 minutes');
INSERT INTO arena_participants(room_id,user_id,last_active_at) VALUES('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',now()-interval '10 minutes');
SELECT public.expire_inactive_arena_participants();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM arena_participants WHERE room_id='20000000-0000-4000-8000-000000000001' AND forfeited_at IS NOT NULL) THEN RAISE EXCEPTION 'Legacy maintenance forfeited Prelude'; END IF; END $$;
