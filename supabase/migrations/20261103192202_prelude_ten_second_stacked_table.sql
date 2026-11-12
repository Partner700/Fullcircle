-- Prelude-only changes: ten-second questions, replayable flip events, captured stacks and exhaustion guard.
CREATE OR REPLACE FUNCTION scripture_games.prelude_flip(p_room uuid,p_state jsonb,p_slot int) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE card jsonb; center jsonb; opts jsonb; correct jsonb; v_number int; moves jsonb;
BEGIN
 IF p_slot IS NULL OR p_slot<0 OR p_slot>=104 THEN RAISE EXCEPTION 'Choose a closed card.'; END IF;
 card:=p_state->'deck'->p_slot;
 IF card IS NULL OR (card->>'drawn')::boolean THEN RAISE EXCEPTION 'This card is already open.'; END IF;
 center:=p_state->'board'->(jsonb_array_length(p_state->'board')-1);
 p_state:=jsonb_set(p_state,ARRAY['deck',p_slot::text,'drawn'],'true');
 p_state:=p_state||jsonb_build_object('board',(p_state->'board')||jsonb_build_array(card-'drawn'),'serial',(p_state->>'serial')::int+1);
 -- Retain a short public animation log; only already-flipped card faces are recorded.
 moves:=coalesce(p_state->'moves','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
  'id',p_state->'serial','playerId',p_state->'players'->((p_state->>'turn')::int)->>'id',
  'card',card-'drawn','at',clock_timestamp()));
 SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO moves
 FROM jsonb_array_elements(moves) WITH ORDINALITY e(value,ordinal)
 WHERE ordinal>greatest(jsonb_array_length(moves)-8,0);
 p_state:=jsonb_set(p_state,'{moves}',moves);
 IF (card->>'joker')::boolean THEN RETURN scripture_games.prelude_advance(p_room,p_state,false,true); END IF;
 IF center IS NOT NULL AND (card->>'number'=center->>'number' OR card->>'symbol'=center->>'symbol') THEN
  v_number:=(card->>'number')::int;
  SELECT jsonb_agg(jsonb_build_object('id',id,'text',meaning) ORDER BY random()),jsonb_agg(to_jsonb(id) ORDER BY id) FILTER(WHERE is_correct) INTO opts,correct
  FROM ((SELECT id,meaning,true is_correct FROM scripture_games.number_facts f WHERE f.number=v_number ORDER BY random() LIMIT CASE WHEN p_state->>'difficulty'='hard' THEN 2 ELSE 1 END)
   UNION ALL (SELECT id,meaning,false FROM scripture_games.number_facts f WHERE f.number<>v_number ORDER BY random() LIMIT CASE WHEN p_state->>'difficulty'='hard' THEN 2 ELSE 3 END)) choices;
  RETURN p_state||jsonb_build_object('phase','question','pending',jsonb_build_object('number',v_number,'options',opts,'correct',correct),'deadline',clock_timestamp()+interval '10 seconds','notice','Match! Answer the Scripture question to collect the board.');
 END IF;
 RETURN scripture_games.prelude_advance(p_room,p_state,false);
END $$;

CREATE OR REPLACE FUNCTION scripture_games.prelude_advance(p_room uuid,p_state jsonb,p_correct boolean,p_joker boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE idx int:=(p_state->>'turn')::int; player jsonb; deck jsonb; center jsonb; capture int;
BEGIN
 player:=p_state->'players'->idx;
 IF p_correct OR p_joker THEN
  capture:=jsonb_array_length(p_state->'board');
  player:=player||jsonb_build_object('cards',(player->>'cards')::int+capture,
   'correct',(player->>'correct')::int+CASE WHEN p_correct AND NOT p_joker THEN 1 ELSE 0 END,
   'collected',coalesce(player->'collected','[]'::jsonb)||(p_state->'board'),
   'firstCapture',coalesce(player->'firstCapture',p_state->'serial'));
  p_state:=jsonb_set(p_state,ARRAY['players',idx::text],player);
  p_state:=p_state||jsonb_build_object('board','[]'::jsonb,'notice',CASE WHEN p_joker THEN 'Joker! The player collects the board.' ELSE 'Correct! The player collects the board.' END);
  SELECT value INTO center FROM jsonb_array_elements(p_state->'deck') WHERE NOT (value->>'drawn')::boolean AND NOT (value->>'joker')::boolean ORDER BY random() LIMIT 1;
  IF center IS NOT NULL THEN
   p_state:=jsonb_set(p_state,ARRAY['deck',center->>'slot','drawn'],'true');
   p_state:=p_state||jsonb_build_object('board',jsonb_build_array(center-'drawn'));
  END IF;
 ELSE p_state:=p_state||jsonb_build_object('notice','No capture. The flipped card is now the card to match.');
 END IF;
 p_state:=p_state||jsonb_build_object('pending',NULL,'phase','playing','turn',(idx+1)%jsonb_array_length(p_state->'players'),'deadline',clock_timestamp()+interval '45 seconds');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'deck') WHERE NOT (value->>'drawn')::boolean) THEN p_state:=scripture_games.prelude_finish(p_room,p_state); END IF;
 RETURN p_state;
END $$;

CREATE OR REPLACE FUNCTION scripture_games.prelude_finish(p_room uuid,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE winner text; player jsonb; amount int; scheduled boolean;
BEGIN
 IF coalesce(jsonb_typeof(p_state->'deck'),'null')<>'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'deck') WHERE NOT (value->>'drawn')::boolean) THEN
  RAISE EXCEPTION 'Use every closed card before ending the round.';
 END IF;
 SELECT value->>'id' INTO winner FROM jsonb_array_elements(p_state->'players') ORDER BY (value->>'cards')::int DESC,(value->>'correct')::int DESC,coalesce((value->>'firstCapture')::int,2147483647) ASC,(value->>'id') LIMIT 1;
 p_state:=p_state||jsonb_build_object('phase','completed','reward',CASE WHEN winner='machine' THEN 0 ELSE 1000 END,'winnerId',winner,'pending',NULL,'notice','Round complete. Most cards wins; ties use correct answers, then earliest capture.');
 SELECT EXISTS(SELECT 1 FROM public.arena_scheduled_matches WHERE room_id=p_room) INTO scheduled;
 FOR player IN SELECT value FROM jsonb_array_elements(p_state->'players') LOOP
  IF player->>'id'<>'machine' THEN
   UPDATE public.arena_participants SET score=(player->>'correct')::int * CASE WHEN p_state->>'difficulty'='hard' THEN 5 ELSE 1 END,
    correct_count=(player->>'correct')::int,finished_at=clock_timestamp() WHERE room_id=p_room AND user_id=(player->>'id')::uuid;
  END IF;
 END LOOP;
 -- The scheduled-match trigger awards its one round prize and advances the bracket.
 IF winner<>'machine' AND NOT scheduled THEN PERFORM scripture_games.award(winner::uuid,'prelude:'||p_room,1000); END IF;
 UPDATE public.arena_rooms SET status='completed',completed_at=clock_timestamp(),winner_id=CASE WHEN winner='machine' THEN NULL ELSE winner::uuid END,
  machine_score=CASE WHEN p_state->>'machine'='true' THEN (SELECT (value->>'cards')::int FROM jsonb_array_elements(p_state->'players') WHERE value->>'id'='machine') ELSE NULL END
 WHERE id=p_room AND status='playing';
 RETURN p_state;
END $$;
