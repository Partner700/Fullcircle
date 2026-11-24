-- Show the Scribe’s question and answer before settling the turn.
CREATE OR REPLACE FUNCTION scripture_games.prelude_view(p_room uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE g scripture_games.prelude_games; s jsonb; q jsonb; room public.arena_rooms;
BEGIN
 SELECT * INTO g FROM scripture_games.prelude_games WHERE room_id=p_room;
 SELECT * INTO room FROM public.arena_rooms WHERE id=p_room;
 s:=g.state; q:=s->'pending';
 RETURN (s-'deck'-'pending')||jsonb_build_object('id',p_room,'name',room.room_name,'creatorId',room.creator_id,'difficulty',g.difficulty,'version',g.version,
  'maxPlayers',room.max_players,'startsAt',(SELECT starts_at FROM public.arena_scheduled_matches WHERE room_id=p_room),
  'cards',(SELECT coalesce(jsonb_agg(jsonb_build_object('slot',value->'slot')),'[]') FROM jsonb_array_elements(coalesce(s->'deck','[]')) WHERE NOT (value->>'drawn')::boolean),
  'pending',CASE WHEN q IS NOT NULL AND q<>'null'::jsonb THEN jsonb_build_object('number',q->'number','options',q->'options','multiple',g.difficulty='hard','scribeSelection',q->'scribeSelection','scribeCorrect',CASE WHEN q ? 'scribeSelection' THEN q->'scribeSelection'=q->'correct' ELSE NULL END) ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.prelude_command(p_action text,p_room_id uuid DEFAULT NULL,p_slot int DEFAULT NULL,p_answers int[] DEFAULT '{}',p_version int DEFAULT NULL,p_difficulty text DEFAULT 'easy',p_machine boolean DEFAULT false,p_name text DEFAULT 'The Prelude')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); room public.arena_rooms; g scripture_games.prelude_games; s jsonb; players jsonb; deck jsonb; idx int; slot int; correct boolean; selected jsonb; v_room uuid; scheduled public.arena_scheduled_matches; dirty boolean:=false; member boolean;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to play Prelude.'; END IF;
 IF p_action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.room_name,'phase',r.status,'players',g.state->'players','difficulty',g.difficulty,'creatorId',r.creator_id) ORDER BY r.created_at DESC)
   FROM public.arena_rooms r JOIN scripture_games.prelude_games g ON g.room_id=r.id
   WHERE (r.status='waiting' AND r.created_at>now()-interval '1 day' AND r.play_mode<>'machine')
    OR (r.status='playing' AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.state->'players') v WHERE v->>'id'=uid::text))),'[]');
 END IF;
 IF p_action='create' THEN
  IF p_name ~* '\[(arena|character):' THEN RAISE EXCEPTION 'Choose a room name without game tags.'; END IF;
  IF p_difficulty IS NULL OR p_difficulty NOT IN ('easy','hard') THEN RAISE EXCEPTION 'Choose Easy or Hard.'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=uid FOR UPDATE;
  IF (SELECT count(*) FROM public.arena_rooms WHERE creator_id=uid AND room_name LIKE '%[arena:prelude]%' AND status IN ('waiting','playing') AND created_at>now()-interval '1 day')>=3 THEN RAISE EXCEPTION 'Finish one of your existing Prelude rooms first.'; END IF;
  INSERT INTO public.arena_rooms(creator_id,room_name,stake_amount,max_players,status,game_call_fee,play_mode,expires_at)
   VALUES(uid,left(coalesce(nullif(trim(p_name),''),'The Prelude'),50)||' [arena:prelude]',0,CASE WHEN p_machine THEN 2 ELSE 10 END,'waiting',0,CASE WHEN p_machine THEN 'machine' ELSE 'versus' END,now()+interval '1 day') RETURNING * INTO room;
  INSERT INTO public.arena_participants(room_id,user_id,stake_paid) VALUES(room.id,uid,true);
  SELECT jsonb_build_array(jsonb_build_object('id',id,'name',display_name,'avatar',avatar_url,'cards',0,'correct',0)) INTO players FROM public.profiles WHERE id=uid;
  IF p_machine THEN players:=players||jsonb_build_array(jsonb_build_object('id','machine','name','The Scribe','cards',0,'correct',0)); END IF;
  INSERT INTO scripture_games.prelude_games(room_id,difficulty,state) VALUES(room.id,p_difficulty,jsonb_build_object('phase','waiting','players',players,'machine',p_machine,'difficulty',p_difficulty,'board','[]'::jsonb,'deck','[]'::jsonb,'turn',0,'serial',0));
  RETURN scripture_games.prelude_view(room.id);
 END IF;
 SELECT * INTO room FROM public.arena_rooms WHERE id=p_room_id AND room_name LIKE '%[arena:prelude]%' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prelude room not found.'; END IF;
 SELECT * INTO scheduled FROM public.arena_scheduled_matches WHERE room_id=p_room_id;
 IF scheduled.room_id IS NOT NULL AND uid<>ALL(scheduled.player_ids) AND p_action<>'state' THEN RAISE EXCEPTION 'This tournament match is reserved for its selected players.'; END IF;
 SELECT * INTO g FROM scripture_games.prelude_games WHERE room_id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN
  IF scheduled.room_id IS NULL THEN RAISE EXCEPTION 'Prelude game not found.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'avatar',p.avatar_url,'cards',0,'correct',0) ORDER BY ap.joined_at),'[]') INTO players FROM public.arena_participants ap JOIN public.profiles p ON p.id=ap.user_id WHERE ap.room_id=p_room_id AND ap.forfeited_at IS NULL;
  INSERT INTO scripture_games.prelude_games(room_id,difficulty,state) VALUES(p_room_id,'easy',jsonb_build_object('phase','waiting','players',players,'machine',false,'difficulty','easy','board','[]'::jsonb,'deck','[]'::jsonb,'turn',0,'serial',0)) RETURNING * INTO g;
 END IF;
 s:=g.state;
 IF scheduled.room_id IS NOT NULL AND s->>'phase'='waiting' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'avatar',p.avatar_url,'cards',0,'correct',0) ORDER BY ap.joined_at),'[]') INTO players
  FROM public.arena_participants ap JOIN public.profiles p ON p.id=ap.user_id WHERE ap.room_id=p_room_id AND ap.forfeited_at IS NULL;
  IF s->'players' IS DISTINCT FROM players THEN s:=jsonb_set(s,'{players}',players);dirty:=true; END IF;
 END IF;
 IF room.status NOT IN ('waiting','playing') AND s->>'phase'<>'completed' THEN
  s:=s||jsonb_build_object('phase','completed','reward',0,'winnerId',room.winner_id,'pending',NULL,'notice','This room has closed.');dirty:=true;
 END IF;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'players') WHERE value->>'id'=uid::text) INTO member;
 IF p_action='join' THEN
  IF NOT member THEN
   IF room.status<>'waiting' OR room.expires_at<now() OR jsonb_array_length(s->'players')>=room.max_players THEN RAISE EXCEPTION 'This room is no longer accepting players.'; END IF;
   SELECT jsonb_build_object('id',id,'name',display_name,'avatar',avatar_url,'cards',0,'correct',0) INTO players FROM public.profiles WHERE id=uid;
   s:=jsonb_set(s,'{players}',(s->'players')||jsonb_build_array(players));
   INSERT INTO public.arena_participants(room_id,user_id,stake_paid) VALUES(p_room_id,uid,true) ON CONFLICT DO NOTHING;
   dirty:=true; member:=true;
  END IF;
 ELSIF NOT member THEN
  IF p_action='state' AND room.status IN ('waiting','playing','completed') THEN RETURN scripture_games.prelude_view(p_room_id); END IF;
  RAISE EXCEPTION 'Join this Prelude room first.';
 END IF;
 IF (p_action='start' AND room.status IN ('waiting','playing')) OR (s->>'phase'='waiting' AND room.status='playing') THEN
  IF room.creator_id<>uid AND scheduled.room_id IS NULL THEN RAISE EXCEPTION 'Only the host can start.'; END IF;
  IF scheduled.room_id IS NOT NULL AND scheduled.starts_at>clock_timestamp() THEN RAISE EXCEPTION 'The scheduled countdown is still running.'; END IF;
  IF jsonb_array_length(s->'players')<2 THEN RAISE EXCEPTION 'At least two players are needed.'; END IF;
  IF s->>'phase'='waiting' THEN
   SELECT jsonb_agg(card||jsonb_build_object('slot',ordinal-1,'drawn',false) ORDER BY ordinal) INTO deck FROM (
    SELECT card,row_number() OVER(ORDER BY random()) ordinal FROM (
     SELECT jsonb_build_object('number',n,'symbol',symbol,'joker',false) card FROM (SELECT DISTINCT number n FROM scripture_games.number_facts) numbers CROSS JOIN unnest(ARRAY['squares','spades','darics','rudes','laureats']) symbol
     UNION ALL SELECT jsonb_build_object('number',NULL,'symbol',NULL,'joker',true) FROM generate_series(1,4)) cards) shuffled;
   IF jsonb_array_length(deck)<>104 THEN RAISE EXCEPTION 'Prelude requires exactly 104 cards.'; END IF;
   s:=s||jsonb_build_object('deck',deck,'phase','playing','deadline',clock_timestamp()+interval '45 seconds');
   SELECT (value->>'slot')::int INTO slot FROM jsonb_array_elements(deck) WHERE NOT (value->>'joker')::boolean LIMIT 1;
   s:=jsonb_set(s,ARRAY['deck',slot::text,'drawn'],'true'); s:=s||jsonb_build_object('board',jsonb_build_array((deck->slot)-'drawn'));
   UPDATE public.arena_rooms SET status='playing',started_at=coalesce(started_at,clock_timestamp()),expires_at=NULL WHERE id=p_room_id AND status='waiting';
   dirty:=true;
  END IF;
 END IF;
 IF s->>'phase' IN ('playing','question') THEN
  -- Any member may advance an expired turn, but cannot act early for another human.
  IF s->>'phase'='question' AND s->'players'->((s->>'turn')::int)->>'id'='machine' THEN
   IF s->'pending' ? 'scribeSelection' THEN
    IF (s->'pending'->>'scribeRevealUntil')::timestamptz<=clock_timestamp() THEN
     s:=scripture_games.prelude_advance(p_room_id,s,s->'pending'->'scribeSelection'=s->'pending'->'correct');
     dirty:=true;
    END IF;
   ELSIF coalesce((s->'pending'->>'scribeAnswerAt')::timestamptz,clock_timestamp())<=clock_timestamp() THEN
    -- The same visible options are used for the Scribe's answer. It deliberately
    -- models an imperfect opponent, with no dependence on the score or deck.
    IF random()<0.5 THEN
     selected:=s->'pending'->'correct';
    ELSE
     SELECT jsonb_build_array(option->'id') INTO selected
     FROM jsonb_array_elements(s->'pending'->'options') AS choice(option)
     WHERE NOT (s->'pending'->'correct' @> jsonb_build_array(option->'id'))
     ORDER BY random() LIMIT 1;
    END IF;
    s:=jsonb_set(s,'{pending}',(s->'pending')||jsonb_build_object(
     'scribeSelection',selected,'scribeRevealUntil',clock_timestamp()+interval '2 seconds'));
    dirty:=true;
   END IF;
  ELSIF (s->>'deadline')::timestamptz<=clock_timestamp() THEN
   IF s->>'phase'='question' THEN s:=scripture_games.prelude_advance(p_room_id,s,false);
   ELSE s:=s||jsonb_build_object('turn',((s->>'turn')::int+1)%jsonb_array_length(s->'players'),'deadline',clock_timestamp()+interval '45 seconds','notice','Turn timed out. Next player.'); END IF;
   dirty:=true;
  ELSIF p_action IN ('flip','answer') THEN
   IF p_version IS DISTINCT FROM g.version THEN RETURN scripture_games.prelude_view(p_room_id)||jsonb_build_object('notice','The turn changed. The board has refreshed.'); END IF;
   IF s->'players'->((s->>'turn')::int)->>'id'<>uid::text THEN RAISE EXCEPTION 'Wait for your turn.'; END IF;
   IF p_action='flip' AND s->>'phase'='playing' THEN s:=scripture_games.prelude_flip(p_room_id,s,p_slot); dirty:=true;
   ELSIF p_action='answer' AND s->>'phase'='question' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v),'[]') INTO selected FROM (SELECT DISTINCT unnest(p_answers) v) a;
    correct:=selected=s->'pending'->'correct'; s:=scripture_games.prelude_advance(p_room_id,s,correct); dirty:=true;
   ELSE RAISE EXCEPTION 'This action is not available now.'; END IF;
  END IF;
  -- Human and Scribe both draw only the top card from a nonempty stack.
  IF s->>'phase'='playing' AND s->'players'->((s->>'turn')::int)->>'id'='machine' THEN
   SELECT top_slot INTO slot
   FROM (
    SELECT min((value->>'slot')::int) AS top_slot
    FROM jsonb_array_elements(s->'deck')
    WHERE NOT (value->>'drawn')::boolean
    GROUP BY (value->>'slot')::int % 8
   ) stacks
   ORDER BY random() LIMIT 1;
   IF slot IS NOT NULL THEN s:=scripture_games.prelude_flip(p_room_id,s,slot); END IF;
   IF s->>'phase'='question' THEN
    s:=jsonb_set(s,'{pending,scribeAnswerAt}',to_jsonb(clock_timestamp()+interval '5 seconds'));
   END IF;
   dirty:=true;
  END IF;
 END IF;
 IF dirty THEN UPDATE scripture_games.prelude_games SET state=s,version=version+1 WHERE room_id=p_room_id; END IF;
 RETURN scripture_games.prelude_view(p_room_id);
END $$;
