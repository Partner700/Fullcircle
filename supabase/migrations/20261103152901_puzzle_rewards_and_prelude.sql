-- Authoritative Scripture games. Solutions, deck order and correct options never enter public tables.
CREATE SCHEMA IF NOT EXISTS scripture_games;
REVOKE ALL ON SCHEMA scripture_games FROM PUBLIC, anon, authenticated;
CREATE TABLE scripture_games.puzzle_catalog(difficulty text, level int, payload jsonb NOT NULL, PRIMARY KEY(difficulty,level));
CREATE TABLE scripture_games.puzzle_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 difficulty text NOT NULL, level int NOT NULL, deadline timestamptz NOT NULL,
 found text[] NOT NULL DEFAULT '{}', assisted text[] NOT NULL DEFAULT '{}', aids jsonb NOT NULL DEFAULT '{}',
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(difficulty,level) REFERENCES scripture_games.puzzle_catalog(difficulty,level));
CREATE INDEX puzzle_runs_owner_idx ON scripture_games.puzzle_runs(user_id,difficulty,created_at DESC);
CREATE TABLE scripture_games.fig_entries(
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, source text NOT NULL,
 amount int NOT NULL CHECK(amount>0), earned_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,source));
CREATE TABLE scripture_games.rewards(
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, source text NOT NULL,
 amount int NOT NULL CHECK(amount>0), earned_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,source));
CREATE TABLE scripture_games.prelude_games(
 room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
 difficulty text NOT NULL CHECK(difficulty IN ('easy','hard')), state jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 0);
CREATE TABLE scripture_games.number_facts(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, number int NOT NULL, meaning text NOT NULL, reference text NOT NULL);
CREATE INDEX number_facts_number_idx ON scripture_games.number_facts(number);
ALTER TABLE scripture_games.puzzle_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripture_games.puzzle_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripture_games.fig_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripture_games.rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripture_games.prelude_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripture_games.number_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA scripture_games FROM PUBLIC,anon,authenticated;

CREATE FUNCTION scripture_games.award(p_user uuid,p_source text,p_amount int) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 INSERT INTO scripture_games.rewards(user_id,source,amount) VALUES(p_user,p_source,p_amount) ON CONFLICT DO NOTHING;
 IF FOUND THEN
  INSERT INTO public.denarii_ledger_entries(user_id,amount,source_type,source_reference,description)
  VALUES(p_user,p_amount,CASE WHEN p_source LIKE 'puzzle:%' THEN 'game_level' ELSE 'arena_reward' END,p_source,CASE WHEN p_source LIKE 'puzzle:%' THEN 'Puzzle Trivia level cleared' ELSE 'Prelude round won' END);
 END IF;
END $$;
CREATE FUNCTION scripture_games.consume_relic(p_user uuid,p_slug text,p_source text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE relic uuid;
BEGIN
 SELECT id INTO relic FROM public.relic_types WHERE slug=p_slug;
 UPDATE public.relic_inventory SET quantity=quantity-1 WHERE user_id=p_user AND relic_type_id=relic AND quantity>0;
 IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
 INSERT INTO public.relic_usage_log(user_id,relic_type_id,effect_applied) VALUES(p_user,relic,p_source||':'||p_slug);
END $$;
CREATE FUNCTION scripture_games.puzzle_view(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r scripture_games.puzzle_runs; c jsonb; words jsonb; cells jsonb; w jsonb; target text;
BEGIN
 SELECT * INTO r FROM scripture_games.puzzle_runs WHERE id=p_id;
 SELECT payload INTO c FROM scripture_games.puzzle_catalog WHERE difficulty=r.difficulty AND level=r.level;
 SELECT jsonb_agg(jsonb_build_object('word',CASE WHEN value->>'word'=ANY(r.found) THEN value->>'word' ELSE '' END,
  'length',length(value->>'word'),'category',value->>'category','row',value->'row','col',value->'col','vertical',value->'vertical',
  'clue',CASE WHEN r.difficulty<>'hard' OR coalesce(r.aids->(value->>'word')->'used','[]') ? 'hint' THEN value->>'clue' ELSE NULL END,
  'reference',CASE WHEN coalesce(r.aids->(value->>'word')->'used','[]') ? 'reveal-reference' THEN value->>'reference' ELSE NULL END,
  'aid',coalesce(r.aids->(value->>'word'),'{}'))) INTO words FROM jsonb_array_elements(c->'board'->'words');
 SELECT jsonb_agg(value||jsonb_build_object('letter',CASE WHEN EXISTS(
  SELECT 1 FROM jsonb_array_elements_text(value->'wordIndexes') idx WHERE c->'board'->'words'->(idx::int)->>'word'=ANY(r.found))
  THEN value->>'letter' ELSE '' END)) INTO cells FROM jsonb_array_elements(c->'board'->'cells');
 RETURN jsonb_build_object('id',r.id,'level',r.level,'difficulty',r.difficulty,'deadline',r.deadline,'found',r.found,
  'completed',r.completed_at IS NOT NULL,'pack',jsonb_build_object('title',c->'pack'->>'title','letters',c->'pack'->>'letters'),
  'board',jsonb_build_object('rows',c->'board'->'rows','cols',c->'board'->'cols','words',words,'cells',cells),
  'figs',(SELECT coalesce(sum(amount),0) FROM scripture_games.fig_entries WHERE user_id=r.user_id AND source LIKE 'puzzle:'||r.difficulty||':'||r.level||':%'),
  'reward',CASE WHEN r.completed_at IS NOT NULL THEN 500 ELSE 0 END);
END $$;
CREATE FUNCTION public.puzzle_trivia_command(p_action text,p_run_id uuid DEFAULT NULL,p_difficulty text DEFAULT 'easy',p_level int DEFAULT 0,p_word text DEFAULT NULL,p_target int DEFAULT 0,p_relic text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); r scripture_games.puzzle_runs; c jsonb; w jsonb; word text; aid jsonb; msg text; assisted boolean:=false; figs int; pool text; eliminated jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to play Puzzle Trivia.'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=uid FOR UPDATE;
 IF p_action IN ('load','start') THEN
  IF p_difficulty NOT IN ('easy','medium','hard') THEN RAISE EXCEPTION 'Choose a difficulty.'; END IF;
  IF p_action='load' THEN
   SELECT * INTO r FROM scripture_games.puzzle_runs WHERE user_id=uid AND difficulty=p_difficulty ORDER BY created_at DESC LIMIT 1;
   IF FOUND THEN RETURN scripture_games.puzzle_view(r.id); END IF;
   RETURN jsonb_build_object('level',0,'difficulty',p_difficulty,'ready',true);
  END IF;
  SELECT payload INTO c FROM scripture_games.puzzle_catalog WHERE difficulty=p_difficulty AND level=p_level;
  IF c IS NULL THEN RAISE EXCEPTION 'All puzzles in this difficulty are complete. Try another difficulty.'; END IF;
  IF p_level>0 AND NOT EXISTS(SELECT 1 FROM scripture_games.puzzle_runs WHERE user_id=uid AND difficulty=p_difficulty AND level=p_level-1 AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Clear the previous level first.'; END IF;
  SELECT * INTO r FROM scripture_games.puzzle_runs WHERE user_id=uid AND difficulty=p_difficulty AND level=p_level ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND (r.completed_at IS NOT NULL OR r.deadline>clock_timestamp()) THEN RETURN scripture_games.puzzle_view(r.id); END IF;
  INSERT INTO scripture_games.puzzle_runs(user_id,difficulty,level,deadline) VALUES(uid,p_difficulty,p_level,clock_timestamp()+make_interval(secs=>CASE p_difficulty WHEN 'easy' THEN 240 WHEN 'medium' THEN 180 ELSE 120 END)) RETURNING * INTO r;
  RETURN scripture_games.puzzle_view(r.id);
 END IF;
 SELECT * INTO r FROM scripture_games.puzzle_runs WHERE id=p_run_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Puzzle not found.'; END IF;
 SELECT payload INTO c FROM scripture_games.puzzle_catalog WHERE difficulty=r.difficulty AND level=r.level;
 IF p_action='relic' THEN
  IF p_target<0 OR p_target>=jsonb_array_length(c->'board'->'words') THEN RAISE EXCEPTION 'Choose a word.'; END IF;
  w:=c->'board'->'words'->p_target; word:=w->>'word'; aid:=coalesce(r.aids->word,'{"used":[]}');
  IF p_relic IS NULL OR p_relic NOT IN ('hint','eliminate','freeze-timer','skip','reveal-reference','witch-ball-endor') THEN RAISE EXCEPTION 'Choose a puzzle relic.'; END IF;
  IF aid->'used' ? p_relic THEN RETURN scripture_games.puzzle_view(r.id); END IF;
  IF p_relic<>'reveal-reference' AND (r.completed_at IS NOT NULL OR r.deadline<=clock_timestamp()) THEN RAISE EXCEPTION 'This puzzle is no longer active.'; END IF;
  IF p_relic='freeze-timer' AND EXISTS(SELECT 1 FROM jsonb_each(r.aids) e WHERE e.value->'used' ? 'freeze-timer') THEN RAISE EXCEPTION 'Freeze Timer was already used in this round.'; END IF;
  IF word=ANY(r.found) AND p_relic<>'reveal-reference' THEN RAISE EXCEPTION 'This word is already found.'; END IF;
  PERFORM scripture_games.consume_relic(uid,p_relic,'puzzle:'||r.id);
  aid:=aid||jsonb_build_object('used',(aid->'used')||to_jsonb(p_relic));
  IF p_relic='freeze-timer' THEN r.deadline:=r.deadline+interval '60 seconds'; msg:='60 seconds added.';
  ELSIF p_relic='reveal-reference' THEN msg:='Scripture reference unlocked.';
  ELSE
   r.assisted:=array_append(r.assisted,word);
   IF p_relic='skip' THEN r.found:=array_append(r.found,word); msg:='Word completed with Skip. No FIGS for this assisted word.';
   ELSIF p_relic IN ('talking-donkey','witch-ball-endor') THEN aid:=aid||jsonb_build_object('answer',word); msg:='Answer revealed. This word is assisted.';
   ELSIF p_relic='hint' THEN aid:=aid||jsonb_build_object('firstLetter',left(word,1)); msg:='Clue and first letter revealed.';
   ELSE
    SELECT coalesce(jsonb_agg(i),'[]') INTO eliminated FROM generate_series(0,length(c->'pack'->>'letters')-1) i WHERE position(substr(c->'pack'->>'letters',i+1,1) in word)=0;
    aid:=aid||jsonb_build_object('eliminated',eliminated); msg:='Letters outside the selected word dimmed.';
   END IF;
  END IF;
  r.aids:=jsonb_set(r.aids,ARRAY[word],aid,true);
 ELSIF p_action='answer' THEN
  IF r.completed_at IS NOT NULL THEN RETURN scripture_games.puzzle_view(r.id); END IF;
  IF r.deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Time is up. Start a new attempt.'; END IF;
  word:=upper(trim(coalesce(p_word,'')));
  SELECT value INTO w FROM jsonb_array_elements(c->'board'->'words') WHERE value->>'word'=word;
  IF w IS NULL THEN RETURN scripture_games.puzzle_view(r.id)||jsonb_build_object('notice','That is not an answer in this puzzle.'); END IF;
  IF word=ANY(r.found) THEN RETURN scripture_games.puzzle_view(r.id)||jsonb_build_object('notice','Already found.'); END IF;
  r.found:=array_append(r.found,word);
  IF NOT(word=ANY(r.assisted)) THEN
   figs:=CASE r.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 3 ELSE 5 END;
   INSERT INTO scripture_games.fig_entries(user_id,source,amount) VALUES(uid,'puzzle:'||r.difficulty||':'||r.level||':'||word,figs) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.puzzle_trivia_activity(user_id) VALUES(uid) ON CONFLICT DO NOTHING;
  msg:=word||' — found!';
 ELSE RAISE EXCEPTION 'Unknown puzzle action.';
 END IF;
 IF cardinality(r.found)=jsonb_array_length(c->'board'->'words') AND r.completed_at IS NULL THEN
  r.completed_at:=clock_timestamp(); PERFORM scripture_games.award(uid,'puzzle:'||r.difficulty||':'||r.level,500);
 END IF;
 IF cardinality(r.found)>0 THEN INSERT INTO public.puzzle_trivia_activity(user_id) VALUES(uid) ON CONFLICT DO NOTHING; END IF;
 UPDATE scripture_games.puzzle_runs SET found=r.found,assisted=r.assisted,aids=r.aids,deadline=r.deadline,completed_at=r.completed_at WHERE id=r.id;
 RETURN scripture_games.puzzle_view(r.id)||jsonb_build_object('notice',msg);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA scripture_games FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.puzzle_trivia_command(text,uuid,text,int,text,int,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.puzzle_trivia_command(text,uuid,text,int,text,int,text) TO authenticated;

CREATE FUNCTION scripture_games.prelude_view(p_room uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE g scripture_games.prelude_games; s jsonb; q jsonb; room public.arena_rooms;
BEGIN
 SELECT * INTO g FROM scripture_games.prelude_games WHERE room_id=p_room;
 SELECT * INTO room FROM public.arena_rooms WHERE id=p_room;
 s:=g.state; q:=s->'pending';
 RETURN (s-'deck'-'pending')||jsonb_build_object('id',p_room,'name',room.room_name,'creatorId',room.creator_id,'difficulty',g.difficulty,'version',g.version,
  'maxPlayers',room.max_players,'startsAt',(SELECT starts_at FROM public.arena_scheduled_matches WHERE room_id=p_room),
  'cards',(SELECT coalesce(jsonb_agg(jsonb_build_object('slot',value->'slot')),'[]') FROM jsonb_array_elements(coalesce(s->'deck','[]')) WHERE NOT (value->>'drawn')::boolean),
  'pending',CASE WHEN q IS NOT NULL AND q<>'null'::jsonb THEN jsonb_build_object('number',q->'number','options',q->'options','multiple',g.difficulty='hard') ELSE NULL END);
END $$;
CREATE FUNCTION scripture_games.prelude_finish(p_room uuid,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE winner text; player jsonb; amount int; scheduled boolean;
BEGIN
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
CREATE FUNCTION scripture_games.prelude_advance(p_room uuid,p_state jsonb,p_correct boolean,p_joker boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE idx int:=(p_state->>'turn')::int; player jsonb; deck jsonb; center jsonb; capture int;
BEGIN
 player:=p_state->'players'->idx;
 IF p_correct OR p_joker THEN
  capture:=jsonb_array_length(p_state->'board');
  player:=player||jsonb_build_object('cards',(player->>'cards')::int+capture,
   'correct',(player->>'correct')::int+CASE WHEN p_correct AND NOT p_joker THEN 1 ELSE 0 END,
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
CREATE FUNCTION scripture_games.prelude_flip(p_room uuid,p_state jsonb,p_slot int) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE card jsonb; center jsonb; opts jsonb; correct jsonb; v_number int;
BEGIN
 IF p_slot IS NULL OR p_slot<0 OR p_slot>=104 THEN RAISE EXCEPTION 'Choose a closed card.'; END IF;
 card:=p_state->'deck'->p_slot;
 IF card IS NULL OR (card->>'drawn')::boolean THEN RAISE EXCEPTION 'This card is already open.'; END IF;
 center:=p_state->'board'->(jsonb_array_length(p_state->'board')-1);
 p_state:=jsonb_set(p_state,ARRAY['deck',p_slot::text,'drawn'],'true');
 p_state:=p_state||jsonb_build_object('board',(p_state->'board')||jsonb_build_array(card-'drawn'),'serial',(p_state->>'serial')::int+1);
 IF (card->>'joker')::boolean THEN RETURN scripture_games.prelude_advance(p_room,p_state,false,true); END IF;
 IF center IS NOT NULL AND (card->>'number'=center->>'number' OR card->>'symbol'=center->>'symbol') THEN
  v_number:=(card->>'number')::int;
  SELECT jsonb_agg(jsonb_build_object('id',id,'text',meaning) ORDER BY random()),jsonb_agg(to_jsonb(id) ORDER BY id) FILTER(WHERE is_correct) INTO opts,correct
  FROM ((SELECT id,meaning,true is_correct FROM scripture_games.number_facts f WHERE f.number=v_number ORDER BY random() LIMIT CASE WHEN p_state->>'difficulty'='hard' THEN 2 ELSE 1 END)
   UNION ALL (SELECT id,meaning,false FROM scripture_games.number_facts f WHERE f.number<>v_number ORDER BY random() LIMIT CASE WHEN p_state->>'difficulty'='hard' THEN 2 ELSE 3 END)) choices;
  RETURN p_state||jsonb_build_object('phase','question','pending',jsonb_build_object('number',v_number,'options',opts,'correct',correct),'deadline',clock_timestamp()+interval '60 seconds','notice','Match! Answer the Scripture question to collect the board.');
 END IF;
 RETURN scripture_games.prelude_advance(p_room,p_state,false);
END $$;
CREATE FUNCTION public.prelude_command(p_action text,p_room_id uuid DEFAULT NULL,p_slot int DEFAULT NULL,p_answers int[] DEFAULT '{}',p_version int DEFAULT NULL,p_difficulty text DEFAULT 'easy',p_machine boolean DEFAULT false,p_name text DEFAULT 'The Prelude')
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
  IF p_machine THEN players:=players||jsonb_build_array(jsonb_build_object('id','machine','name','The Machine','cards',0,'correct',0)); END IF;
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
  IF (s->>'deadline')::timestamptz<=clock_timestamp() THEN
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
  -- The server chooses and grades the machine's move; clients cannot supply its score.
  IF s->>'phase'='playing' AND s->'players'->((s->>'turn')::int)->>'id'='machine' THEN
   SELECT (value->>'slot')::int INTO slot FROM jsonb_array_elements(s->'deck') WHERE NOT (value->>'drawn')::boolean ORDER BY random() LIMIT 1;
   IF slot IS NOT NULL THEN s:=scripture_games.prelude_flip(p_room_id,s,slot); END IF;
   IF s->>'phase'='question' THEN s:=scripture_games.prelude_advance(p_room_id,s,random()<CASE WHEN g.difficulty='hard' THEN 0.55 ELSE 0.8 END); END IF;
   dirty:=true;
  END IF;
 END IF;
 IF dirty THEN UPDATE scripture_games.prelude_games SET state=s,version=version+1 WHERE room_id=p_room_id; END IF;
 RETURN scripture_games.prelude_view(p_room_id);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA scripture_games FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prelude_command(text,uuid,int,int[],int,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prelude_command(text,uuid,int,int[],int,text,boolean,text) TO authenticated;

INSERT INTO scripture_games.puzzle_catalog(difficulty,level,payload) SELECT value->>'difficulty',(value->>'level')::int,value FROM jsonb_array_elements($catalog$[{"difficulty":"easy","level":0,"pack":{"id":"abraham","title":"Abraham: the promise","letters":"ABRAHAM","words":[{"word":"ABRAHAM","category":"Person","clue":"God promised to make him the father of many nations.","reference":"Genesis 17:5"},{"word":"RAHAB","category":"Person","clue":"She hid the spies in Jericho.","reference":"Joshua 2:1–6"},{"word":"HAM","category":"Person","clue":"One of Noah’s three sons.","reference":"Genesis 9:18"},{"word":"ARAM","category":"Place","clue":"The land where Jacob went to find a wife.","reference":"Genesis 28:5"},{"word":"MARAH","category":"Place","clue":"Israel found bitter water here after crossing the sea.","reference":"Exodus 15:23"},{"word":"RAM","category":"Object","clue":"Abraham offered this in place of Isaac.","reference":"Genesis 22:13"}]},"board":{"cells":[{"row":1,"col":0,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":1,"letter":"R","wordIndexes":[0]},{"row":1,"col":2,"letter":"A","wordIndexes":[0,2]},{"row":1,"col":3,"letter":"M","wordIndexes":[0]},{"row":0,"col":0,"letter":"H","wordIndexes":[1]},{"row":2,"col":0,"letter":"M","wordIndexes":[1]},{"row":0,"col":2,"letter":"R","wordIndexes":[2]},{"row":2,"col":2,"letter":"M","wordIndexes":[2]}],"words":[{"word":"ARAM","category":"Place","clue":"The land where Jacob went to find a wife.","reference":"Genesis 28:5","row":1,"col":0,"vertical":false},{"word":"HAM","category":"Person","clue":"One of Noah’s three sons.","reference":"Genesis 9:18","row":0,"col":0,"vertical":true},{"word":"RAM","category":"Object","clue":"Abraham offered this in place of Isaac.","reference":"Genesis 22:13","row":0,"col":2,"vertical":true}],"rows":3,"cols":4}},{"difficulty":"easy","level":1,"pack":{"id":"jonathan","title":"David: friendship and courage","letters":"JONATHAN","words":[{"word":"JONATHAN","category":"Person","clue":"Saul’s son who made a covenant of friendship with David.","reference":"1 Samuel 18:1–4"},{"word":"NATHAN","category":"Person","clue":"The prophet who confronted David with a story about a lamb.","reference":"2 Samuel 12:1–7"},{"word":"JOHN","category":"Person","clue":"The disciple described as the one Jesus loved.","reference":"John 21:20–24"},{"word":"NOAH","category":"Person","clue":"He built an ark before the flood.","reference":"Genesis 6:13–22"},{"word":"ANNA","category":"Person","clue":"An elderly prophetess who saw the infant Jesus in the temple.","reference":"Luke 2:36–38"},{"word":"JONAH","category":"Person","clue":"A prophet sent to Nineveh.","reference":"Jonah 1:1–2"}]},"board":{"cells":[{"row":1,"col":0,"letter":"J","wordIndexes":[0]},{"row":1,"col":1,"letter":"O","wordIndexes":[0,1]},{"row":1,"col":2,"letter":"H","wordIndexes":[0]},{"row":1,"col":3,"letter":"N","wordIndexes":[0,2]},{"row":0,"col":1,"letter":"N","wordIndexes":[1]},{"row":2,"col":1,"letter":"A","wordIndexes":[1]},{"row":3,"col":1,"letter":"H","wordIndexes":[1]},{"row":0,"col":3,"letter":"A","wordIndexes":[2]},{"row":2,"col":3,"letter":"N","wordIndexes":[2]},{"row":3,"col":3,"letter":"A","wordIndexes":[2]}],"words":[{"word":"JOHN","category":"Person","clue":"The disciple described as the one Jesus loved.","reference":"John 21:20–24","row":1,"col":0,"vertical":false},{"word":"NOAH","category":"Person","clue":"He built an ark before the flood.","reference":"Genesis 6:13–22","row":0,"col":1,"vertical":true},{"word":"ANNA","category":"Person","clue":"An elderly prophetess who saw the infant Jesus in the temple.","reference":"Luke 2:36–38","row":0,"col":3,"vertical":true}],"rows":4,"cols":4}},{"difficulty":"easy","level":2,"pack":{"id":"samaria","title":"Israel: kings and places","letters":"SAMARIA","words":[{"word":"SAMARIA","category":"Place","clue":"Omri built this city as a royal capital.","reference":"1 Kings 16:24"},{"word":"ARAM","category":"Place","clue":"Naaman came from this land.","reference":"2 Kings 5:1"},{"word":"ASIA","category":"Place","clue":"Paul taught so that people throughout this province heard the word.","reference":"Acts 19:10"},{"word":"AMASA","category":"Person","clue":"David appointed him to lead the army instead of Joab.","reference":"2 Samuel 19:13"},{"word":"ASA","category":"Person","clue":"A king of Judah who removed foreign altars.","reference":"2 Chronicles 14:2–3"},{"word":"RAM","category":"Object","clue":"A male sheep used as an offering.","reference":"Leviticus 5:15"}]},"board":{"cells":[{"row":1,"col":0,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":1,"letter":"R","wordIndexes":[0]},{"row":1,"col":2,"letter":"A","wordIndexes":[0,2]},{"row":1,"col":3,"letter":"M","wordIndexes":[0]},{"row":2,"col":0,"letter":"S","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":0,"col":2,"letter":"R","wordIndexes":[2]},{"row":2,"col":2,"letter":"M","wordIndexes":[2]}],"words":[{"word":"ARAM","category":"Place","clue":"Naaman came from this land.","reference":"2 Kings 5:1","row":1,"col":0,"vertical":false},{"word":"ASA","category":"Person","clue":"A king of Judah who removed foreign altars.","reference":"2 Chronicles 14:2–3","row":1,"col":0,"vertical":true},{"word":"RAM","category":"Object","clue":"A male sheep used as an offering.","reference":"Leviticus 5:15","row":0,"col":2,"vertical":true}],"rows":4,"cols":4}},{"difficulty":"easy","level":3,"pack":{"id":"jerusalem","title":"Jesus and the holy city","letters":"JERUSALEM","words":[{"word":"JERUSALEM","category":"Place","clue":"The city where Jesus was crucified and rose again.","reference":"Luke 24:18–24"},{"word":"SAMUEL","category":"Person","clue":"The boy who heard God calling during the night.","reference":"1 Samuel 3:1–10"},{"word":"JAMES","category":"Person","clue":"A son of Zebedee and brother of John.","reference":"Matthew 4:21"},{"word":"SAUL","category":"Person","clue":"Israel’s first king.","reference":"1 Samuel 10:1"},{"word":"ESAU","category":"Person","clue":"Jacob’s older twin brother.","reference":"Genesis 25:24–26"},{"word":"ELAM","category":"Place","clue":"People from this land heard the disciples at Pentecost.","reference":"Acts 2:9"},{"word":"RAM","category":"Object","clue":"The substitute found in a thicket on Mount Moriah.","reference":"Genesis 22:13"}]},"board":{"cells":[{"row":4,"col":1,"letter":"J","wordIndexes":[0]},{"row":4,"col":2,"letter":"E","wordIndexes":[0,1]},{"row":4,"col":3,"letter":"R","wordIndexes":[0]},{"row":4,"col":4,"letter":"U","wordIndexes":[0]},{"row":4,"col":5,"letter":"S","wordIndexes":[0,2]},{"row":4,"col":6,"letter":"A","wordIndexes":[0]},{"row":4,"col":7,"letter":"L","wordIndexes":[0,3]},{"row":4,"col":8,"letter":"E","wordIndexes":[0]},{"row":4,"col":9,"letter":"M","wordIndexes":[0,5]},{"row":0,"col":2,"letter":"S","wordIndexes":[1]},{"row":1,"col":2,"letter":"A","wordIndexes":[1,4]},{"row":2,"col":2,"letter":"M","wordIndexes":[1]},{"row":3,"col":2,"letter":"U","wordIndexes":[1]},{"row":5,"col":2,"letter":"L","wordIndexes":[1]},{"row":0,"col":5,"letter":"J","wordIndexes":[2]},{"row":1,"col":5,"letter":"A","wordIndexes":[2]},{"row":2,"col":5,"letter":"M","wordIndexes":[2]},{"row":3,"col":5,"letter":"E","wordIndexes":[2]},{"row":1,"col":7,"letter":"S","wordIndexes":[3]},{"row":2,"col":7,"letter":"A","wordIndexes":[3]},{"row":3,"col":7,"letter":"U","wordIndexes":[3]},{"row":1,"col":0,"letter":"E","wordIndexes":[4]},{"row":1,"col":1,"letter":"S","wordIndexes":[4]},{"row":1,"col":3,"letter":"U","wordIndexes":[4]},{"row":1,"col":9,"letter":"E","wordIndexes":[5]},{"row":2,"col":9,"letter":"L","wordIndexes":[5]},{"row":3,"col":9,"letter":"A","wordIndexes":[5]}],"words":[{"word":"JERUSALEM","category":"Place","clue":"The city where Jesus was crucified and rose again.","reference":"Luke 24:18–24","row":4,"col":1,"vertical":false},{"word":"SAMUEL","category":"Person","clue":"The boy who heard God calling during the night.","reference":"1 Samuel 3:1–10","row":0,"col":2,"vertical":true},{"word":"JAMES","category":"Person","clue":"A son of Zebedee and brother of John.","reference":"Matthew 4:21","row":0,"col":5,"vertical":true},{"word":"SAUL","category":"Person","clue":"Israel’s first king.","reference":"1 Samuel 10:1","row":1,"col":7,"vertical":true},{"word":"ESAU","category":"Person","clue":"Jacob’s older twin brother.","reference":"Genesis 25:24–26","row":1,"col":0,"vertical":false},{"word":"ELAM","category":"Place","clue":"People from this land heard the disciples at Pentecost.","reference":"Acts 2:9","row":1,"col":9,"vertical":true}],"rows":6,"cols":10}},{"difficulty":"easy","level":4,"pack":{"id":"tabernacle","title":"Moses: worship in the wilderness","letters":"TABERNACLE","words":[{"word":"TABERNACLE","category":"Object","clue":"Israel’s portable sanctuary in the wilderness.","reference":"Exodus 25:8–9"},{"word":"ALTAR","category":"Object","clue":"A structure on which offerings were presented.","reference":"Exodus 27:1"},{"word":"CANA","category":"Place","clue":"Jesus turned water into wine in this village.","reference":"John 2:1–11"},{"word":"ABEL","category":"Person","clue":"He brought an offering from his flock.","reference":"Genesis 4:4"},{"word":"ABNER","category":"Person","clue":"The commander of Saul’s army.","reference":"1 Samuel 14:50"},{"word":"NABAL","category":"Person","clue":"Abigail’s husband who insulted David’s men.","reference":"1 Samuel 25:3–11"},{"word":"BAAL","category":"Object","clue":"The false god represented by idols opposed by Elijah.","reference":"1 Kings 18:21–26"}]},"board":{"cells":[{"row":1,"col":0,"letter":"C","wordIndexes":[0]},{"row":1,"col":1,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":2,"letter":"N","wordIndexes":[0]},{"row":1,"col":3,"letter":"A","wordIndexes":[0,2]},{"row":2,"col":1,"letter":"B","wordIndexes":[1]},{"row":3,"col":1,"letter":"E","wordIndexes":[1]},{"row":4,"col":1,"letter":"L","wordIndexes":[1]},{"row":0,"col":3,"letter":"B","wordIndexes":[2]},{"row":2,"col":3,"letter":"A","wordIndexes":[2]},{"row":3,"col":3,"letter":"L","wordIndexes":[2]}],"words":[{"word":"CANA","category":"Place","clue":"Jesus turned water into wine in this village.","reference":"John 2:1–11","row":1,"col":0,"vertical":false},{"word":"ABEL","category":"Person","clue":"He brought an offering from his flock.","reference":"Genesis 4:4","row":1,"col":1,"vertical":true},{"word":"BAAL","category":"Object","clue":"The false god represented by idols opposed by Elijah.","reference":"1 Kings 18:21–26","row":0,"col":3,"vertical":true}],"rows":5,"cols":4}},{"difficulty":"easy","level":5,"pack":{"id":"jordan","title":"Joshua: crossing into promise","letters":"JORDAN","words":[{"word":"JORDAN","category":"Place","clue":"Israel crossed this river on dry ground.","reference":"Joshua 3:14–17"},{"word":"DAN","category":"Person","clue":"A son of Jacob and Bilhah.","reference":"Genesis 30:6"},{"word":"DOR","category":"Place","clue":"A coastal city mentioned among Manasseh’s towns.","reference":"Joshua 17:11"},{"word":"JAR","category":"Object","clue":"A container the widow used for oil.","reference":"2 Kings 4:2"},{"word":"ROD","category":"Object","clue":"Aaron’s staff blossomed as a sign of God’s choice.","reference":"Numbers 17:8"}]},"board":{"cells":[{"row":0,"col":2,"letter":"D","wordIndexes":[0,1]},{"row":0,"col":3,"letter":"A","wordIndexes":[0]},{"row":0,"col":4,"letter":"N","wordIndexes":[0]},{"row":1,"col":2,"letter":"O","wordIndexes":[1]},{"row":2,"col":2,"letter":"R","wordIndexes":[1,2]},{"row":2,"col":0,"letter":"J","wordIndexes":[2]},{"row":2,"col":1,"letter":"A","wordIndexes":[2]}],"words":[{"word":"DAN","category":"Person","clue":"A son of Jacob and Bilhah.","reference":"Genesis 30:6","row":0,"col":2,"vertical":false},{"word":"DOR","category":"Place","clue":"A coastal city mentioned among Manasseh’s towns.","reference":"Joshua 17:11","row":0,"col":2,"vertical":true},{"word":"JAR","category":"Object","clue":"A container the widow used for oil.","reference":"2 Kings 4:2","row":2,"col":0,"vertical":false}],"rows":3,"cols":5}},{"difficulty":"easy","level":6,"pack":{"id":"goliath","title":"David: the giant and the shepherd","letters":"GOLIATH","words":[{"word":"GOLIATH","category":"Person","clue":"The Philistine champion defeated by David.","reference":"1 Samuel 17:4–50"},{"word":"GATH","category":"Place","clue":"The home city of the Philistine champion.","reference":"1 Samuel 17:4"},{"word":"LOT","category":"Person","clue":"Abraham’s nephew who lived in Sodom.","reference":"Genesis 13:12"}]},"board":{"cells":[{"row":0,"col":0,"letter":"G","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"O","wordIndexes":[0]},{"row":0,"col":2,"letter":"L","wordIndexes":[0,2]},{"row":0,"col":3,"letter":"I","wordIndexes":[0]},{"row":0,"col":4,"letter":"A","wordIndexes":[0]},{"row":0,"col":5,"letter":"T","wordIndexes":[0]},{"row":0,"col":6,"letter":"H","wordIndexes":[0]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"T","wordIndexes":[1]},{"row":3,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":2,"letter":"O","wordIndexes":[2]},{"row":2,"col":2,"letter":"T","wordIndexes":[2]}],"words":[{"word":"GOLIATH","category":"Person","clue":"The Philistine champion defeated by David.","reference":"1 Samuel 17:4–50","row":0,"col":0,"vertical":false},{"word":"GATH","category":"Place","clue":"The home city of the Philistine champion.","reference":"1 Samuel 17:4","row":0,"col":0,"vertical":true},{"word":"LOT","category":"Person","clue":"Abraham’s nephew who lived in Sodom.","reference":"Genesis 13:12","row":0,"col":2,"vertical":true}],"rows":4,"cols":7}},{"difficulty":"easy","level":7,"pack":{"id":"sapphira","title":"Acts: truth and integrity","letters":"SAPPHIRA","words":[{"word":"SAPPHIRA","category":"Person","clue":"She and Ananias lied about the sale of their property.","reference":"Acts 5:1–10"},{"word":"SARAH","category":"Person","clue":"Isaac’s mother.","reference":"Genesis 21:1–3"},{"word":"PARAH","category":"Place","clue":"A town listed in Benjamin’s territory.","reference":"Joshua 18:23"},{"word":"RAPHA","category":"Person","clue":"A son of Benjamin named in his family genealogy.","reference":"1 Chronicles 8:2"},{"word":"SHIP","category":"Object","clue":"Paul travelled in one of these before the wreck near Malta.","reference":"Acts 27:41–44"}]},"board":{"cells":[{"row":1,"col":0,"letter":"S","wordIndexes":[0]},{"row":1,"col":1,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":2,"letter":"R","wordIndexes":[0]},{"row":1,"col":3,"letter":"A","wordIndexes":[0]},{"row":1,"col":4,"letter":"H","wordIndexes":[0,2]},{"row":0,"col":1,"letter":"P","wordIndexes":[1]},{"row":2,"col":1,"letter":"R","wordIndexes":[1]},{"row":3,"col":1,"letter":"A","wordIndexes":[1]},{"row":4,"col":1,"letter":"H","wordIndexes":[1]},{"row":0,"col":4,"letter":"S","wordIndexes":[2]},{"row":2,"col":4,"letter":"I","wordIndexes":[2]},{"row":3,"col":4,"letter":"P","wordIndexes":[2]}],"words":[{"word":"SARAH","category":"Person","clue":"Isaac’s mother.","reference":"Genesis 21:1–3","row":1,"col":0,"vertical":false},{"word":"PARAH","category":"Place","clue":"A town listed in Benjamin’s territory.","reference":"Joshua 18:23","row":0,"col":1,"vertical":true},{"word":"SHIP","category":"Object","clue":"Paul travelled in one of these before the wreck near Malta.","reference":"Acts 27:41–44","row":0,"col":4,"vertical":true}],"rows":5,"cols":5}},{"difficulty":"easy","level":8,"pack":{"id":"rebekah","title":"Isaac: a family of promise","letters":"REBEKAH","words":[{"word":"REBEKAH","category":"Person","clue":"She gave water to Abraham’s servant and his camels.","reference":"Genesis 24:15–20"},{"word":"HEBER","category":"Person","clue":"A Kenite whose wife was Jael.","reference":"Judges 4:17"},{"word":"BEER","category":"Place","clue":"A place where Israel gathered for water.","reference":"Numbers 21:16"},{"word":"ARK","category":"Object","clue":"The sacred chest carried by Israel.","reference":"Joshua 3:6"}]},"board":{"cells":[{"row":1,"col":0,"letter":"H","wordIndexes":[0]},{"row":1,"col":1,"letter":"E","wordIndexes":[0,1]},{"row":1,"col":2,"letter":"B","wordIndexes":[0]},{"row":1,"col":3,"letter":"E","wordIndexes":[0]},{"row":1,"col":4,"letter":"R","wordIndexes":[0,2]},{"row":0,"col":1,"letter":"B","wordIndexes":[1]},{"row":2,"col":1,"letter":"E","wordIndexes":[1]},{"row":3,"col":1,"letter":"R","wordIndexes":[1]},{"row":0,"col":4,"letter":"A","wordIndexes":[2]},{"row":2,"col":4,"letter":"K","wordIndexes":[2]}],"words":[{"word":"HEBER","category":"Person","clue":"A Kenite whose wife was Jael.","reference":"Judges 4:17","row":1,"col":0,"vertical":false},{"word":"BEER","category":"Place","clue":"A place where Israel gathered for water.","reference":"Numbers 21:16","row":0,"col":1,"vertical":true},{"word":"ARK","category":"Object","clue":"The sacred chest carried by Israel.","reference":"Joshua 3:6","row":0,"col":4,"vertical":true}],"rows":4,"cols":5}},{"difficulty":"easy","level":9,"pack":{"id":"mordecai","title":"Esther: courage in exile","letters":"MORDECAI","words":[{"word":"MORDECAI","category":"Person","clue":"Esther’s cousin who raised her as his daughter.","reference":"Esther 2:7"},{"word":"MEDIA","category":"Place","clue":"A kingdom named alongside Persia.","reference":"Esther 1:3"},{"word":"ROME","category":"Place","clue":"Paul arrived here under guard.","reference":"Acts 28:16"},{"word":"DOR","category":"Place","clue":"A coastal town within Manasseh’s allotted territory.","reference":"Joshua 17:11"},{"word":"OMAR","category":"Person","clue":"A son of Eliphaz in Esau’s family.","reference":"Genesis 36:11"},{"word":"ROD","category":"Object","clue":"Moses carried this when God sent him to Egypt.","reference":"Exodus 4:17"}]},"board":{"cells":[{"row":2,"col":2,"letter":"R","wordIndexes":[0,1]},{"row":2,"col":3,"letter":"O","wordIndexes":[0]},{"row":2,"col":4,"letter":"M","wordIndexes":[0]},{"row":2,"col":5,"letter":"E","wordIndexes":[0]},{"row":0,"col":2,"letter":"D","wordIndexes":[1,2]},{"row":1,"col":2,"letter":"O","wordIndexes":[1]},{"row":0,"col":0,"letter":"R","wordIndexes":[2]},{"row":0,"col":1,"letter":"O","wordIndexes":[2]}],"words":[{"word":"ROME","category":"Place","clue":"Paul arrived here under guard.","reference":"Acts 28:16","row":2,"col":2,"vertical":false},{"word":"DOR","category":"Place","clue":"A coastal town within Manasseh’s allotted territory.","reference":"Joshua 17:11","row":0,"col":2,"vertical":true},{"word":"ROD","category":"Object","clue":"Moses carried this when God sent him to Egypt.","reference":"Exodus 4:17","row":0,"col":0,"vertical":false}],"rows":3,"cols":6}},{"difficulty":"easy","level":10,"pack":{"id":"candlestick","title":"The sanctuary: light and service","letters":"CANDLESTICK","words":[{"word":"CANDLESTICK","category":"Object","clue":"The KJV name for the sanctuary’s golden lampstand.","reference":"Exodus 25:31"},{"word":"DANIEL","category":"Person","clue":"He continued praying even when a royal decree forbade it.","reference":"Daniel 6:10"},{"word":"CAIN","category":"Person","clue":"Adam and Eve’s son who killed Abel.","reference":"Genesis 4:1–8"},{"word":"NAILS","category":"Object","clue":"Thomas wanted to see the marks left by these.","reference":"John 20:25"},{"word":"STICK","category":"Object","clue":"Ezekiel joined two of these as a sign for Israel.","reference":"Ezekiel 37:16–17"},{"word":"TACKLE","category":"Object","clue":"The ship’s equipment thrown overboard during Paul’s storm.","reference":"Acts 27:19"},{"word":"DAN","category":"Person","clue":"A son of Jacob whose name means judgment.","reference":"Genesis 30:6"}]},"board":{"cells":[{"row":3,"col":1,"letter":"N","wordIndexes":[0,1]},{"row":3,"col":2,"letter":"A","wordIndexes":[0]},{"row":3,"col":3,"letter":"I","wordIndexes":[0]},{"row":3,"col":4,"letter":"L","wordIndexes":[0]},{"row":3,"col":5,"letter":"S","wordIndexes":[0]},{"row":0,"col":1,"letter":"C","wordIndexes":[1]},{"row":1,"col":1,"letter":"A","wordIndexes":[1,2]},{"row":2,"col":1,"letter":"I","wordIndexes":[1]},{"row":1,"col":0,"letter":"D","wordIndexes":[2]},{"row":1,"col":2,"letter":"N","wordIndexes":[2]}],"words":[{"word":"NAILS","category":"Object","clue":"Thomas wanted to see the marks left by these.","reference":"John 20:25","row":3,"col":1,"vertical":false},{"word":"CAIN","category":"Person","clue":"Adam and Eve’s son who killed Abel.","reference":"Genesis 4:1–8","row":0,"col":1,"vertical":true},{"word":"DAN","category":"Person","clue":"A son of Jacob whose name means judgment.","reference":"Genesis 30:6","row":1,"col":0,"vertical":false}],"rows":4,"cols":6}},{"difficulty":"easy","level":11,"pack":{"id":"pharaoh","title":"Exodus: freedom and deliverance","letters":"PHARAOH","words":[{"word":"PHARAOH","category":"Person","clue":"The ruler who refused Moses’ request to let Israel go.","reference":"Exodus 5:1–2"},{"word":"HARP","category":"Object","clue":"David played this instrument for Saul.","reference":"1 Samuel 16:23"},{"word":"PARAH","category":"Place","clue":"A town included in Benjamin’s inheritance.","reference":"Joshua 18:23"}]},"board":{"cells":[{"row":0,"col":0,"letter":"P","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"H","wordIndexes":[0]},{"row":0,"col":2,"letter":"A","wordIndexes":[0]},{"row":0,"col":3,"letter":"R","wordIndexes":[0]},{"row":0,"col":4,"letter":"A","wordIndexes":[0]},{"row":0,"col":5,"letter":"O","wordIndexes":[0]},{"row":0,"col":6,"letter":"H","wordIndexes":[0,2]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"R","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":6,"letter":"A","wordIndexes":[2]},{"row":2,"col":6,"letter":"R","wordIndexes":[2]},{"row":3,"col":6,"letter":"P","wordIndexes":[2]}],"words":[{"word":"PHARAOH","category":"Person","clue":"The ruler who refused Moses’ request to let Israel go.","reference":"Exodus 5:1–2","row":0,"col":0,"vertical":false},{"word":"PARAH","category":"Place","clue":"A town included in Benjamin’s inheritance.","reference":"Joshua 18:23","row":0,"col":0,"vertical":true},{"word":"HARP","category":"Object","clue":"David played this instrument for Saul.","reference":"1 Samuel 16:23","row":0,"col":6,"vertical":true}],"rows":5,"cols":7}},{"difficulty":"medium","level":0,"pack":{"id":"abraham","title":"Abraham: the promise","letters":"ABRAHAM","words":[{"word":"ABRAHAM","category":"Person","clue":"God promised to make him the father of many nations.","reference":"Genesis 17:5"},{"word":"RAHAB","category":"Person","clue":"She hid the spies in Jericho.","reference":"Joshua 2:1–6"},{"word":"HAM","category":"Person","clue":"One of Noah’s three sons.","reference":"Genesis 9:18"},{"word":"ARAM","category":"Place","clue":"The land where Jacob went to find a wife.","reference":"Genesis 28:5"},{"word":"MARAH","category":"Place","clue":"Israel found bitter water here after crossing the sea.","reference":"Exodus 15:23"},{"word":"RAM","category":"Object","clue":"Abraham offered this in place of Isaac.","reference":"Genesis 22:13"}]},"board":{"cells":[{"row":1,"col":0,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":1,"letter":"B","wordIndexes":[0]},{"row":1,"col":2,"letter":"R","wordIndexes":[0]},{"row":1,"col":3,"letter":"A","wordIndexes":[0,2]},{"row":1,"col":4,"letter":"H","wordIndexes":[0]},{"row":1,"col":5,"letter":"A","wordIndexes":[0,3]},{"row":1,"col":6,"letter":"M","wordIndexes":[0]},{"row":0,"col":0,"letter":"R","wordIndexes":[1]},{"row":2,"col":0,"letter":"H","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"B","wordIndexes":[1]},{"row":0,"col":3,"letter":"M","wordIndexes":[2]},{"row":2,"col":3,"letter":"R","wordIndexes":[2]},{"row":3,"col":3,"letter":"A","wordIndexes":[2]},{"row":4,"col":3,"letter":"H","wordIndexes":[2]},{"row":2,"col":5,"letter":"R","wordIndexes":[3]},{"row":3,"col":5,"letter":"A","wordIndexes":[3]},{"row":4,"col":5,"letter":"M","wordIndexes":[3]}],"words":[{"word":"ABRAHAM","category":"Person","clue":"God promised to make him the father of many nations.","reference":"Genesis 17:5","row":1,"col":0,"vertical":false},{"word":"RAHAB","category":"Person","clue":"She hid the spies in Jericho.","reference":"Joshua 2:1–6","row":0,"col":0,"vertical":true},{"word":"MARAH","category":"Place","clue":"Israel found bitter water here after crossing the sea.","reference":"Exodus 15:23","row":0,"col":3,"vertical":true},{"word":"ARAM","category":"Place","clue":"The land where Jacob went to find a wife.","reference":"Genesis 28:5","row":1,"col":5,"vertical":true}],"rows":5,"cols":7}},{"difficulty":"medium","level":1,"pack":{"id":"jonathan","title":"David: friendship and courage","letters":"JONATHAN","words":[{"word":"JONATHAN","category":"Person","clue":"Saul’s son who made a covenant of friendship with David.","reference":"1 Samuel 18:1–4"},{"word":"NATHAN","category":"Person","clue":"The prophet who confronted David with a story about a lamb.","reference":"2 Samuel 12:1–7"},{"word":"JOHN","category":"Person","clue":"The disciple described as the one Jesus loved.","reference":"John 21:20–24"},{"word":"NOAH","category":"Person","clue":"He built an ark before the flood.","reference":"Genesis 6:13–22"},{"word":"ANNA","category":"Person","clue":"An elderly prophetess who saw the infant Jesus in the temple.","reference":"Luke 2:36–38"},{"word":"JONAH","category":"Person","clue":"A prophet sent to Nineveh.","reference":"Jonah 1:1–2"}]},"board":{"cells":[{"row":2,"col":0,"letter":"J","wordIndexes":[0,2]},{"row":2,"col":1,"letter":"O","wordIndexes":[0]},{"row":2,"col":2,"letter":"N","wordIndexes":[0,1]},{"row":2,"col":3,"letter":"A","wordIndexes":[0]},{"row":2,"col":4,"letter":"T","wordIndexes":[0]},{"row":2,"col":5,"letter":"H","wordIndexes":[0,3]},{"row":2,"col":6,"letter":"A","wordIndexes":[0]},{"row":2,"col":7,"letter":"N","wordIndexes":[0]},{"row":3,"col":2,"letter":"A","wordIndexes":[1]},{"row":4,"col":2,"letter":"T","wordIndexes":[1]},{"row":5,"col":2,"letter":"H","wordIndexes":[1]},{"row":6,"col":2,"letter":"A","wordIndexes":[1]},{"row":7,"col":2,"letter":"N","wordIndexes":[1]},{"row":3,"col":0,"letter":"O","wordIndexes":[2]},{"row":4,"col":0,"letter":"N","wordIndexes":[2]},{"row":5,"col":0,"letter":"A","wordIndexes":[2]},{"row":6,"col":0,"letter":"H","wordIndexes":[2]},{"row":0,"col":5,"letter":"J","wordIndexes":[3]},{"row":1,"col":5,"letter":"O","wordIndexes":[3]},{"row":3,"col":5,"letter":"N","wordIndexes":[3]}],"words":[{"word":"JONATHAN","category":"Person","clue":"Saul’s son who made a covenant of friendship with David.","reference":"1 Samuel 18:1–4","row":2,"col":0,"vertical":false},{"word":"NATHAN","category":"Person","clue":"The prophet who confronted David with a story about a lamb.","reference":"2 Samuel 12:1–7","row":2,"col":2,"vertical":true},{"word":"JONAH","category":"Person","clue":"A prophet sent to Nineveh.","reference":"Jonah 1:1–2","row":2,"col":0,"vertical":true},{"word":"JOHN","category":"Person","clue":"The disciple described as the one Jesus loved.","reference":"John 21:20–24","row":0,"col":5,"vertical":true}],"rows":8,"cols":8}},{"difficulty":"medium","level":2,"pack":{"id":"samaria","title":"Israel: kings and places","letters":"SAMARIA","words":[{"word":"SAMARIA","category":"Place","clue":"Omri built this city as a royal capital.","reference":"1 Kings 16:24"},{"word":"ARAM","category":"Place","clue":"Naaman came from this land.","reference":"2 Kings 5:1"},{"word":"ASIA","category":"Place","clue":"Paul taught so that people throughout this province heard the word.","reference":"Acts 19:10"},{"word":"AMASA","category":"Person","clue":"David appointed him to lead the army instead of Joab.","reference":"2 Samuel 19:13"},{"word":"ASA","category":"Person","clue":"A king of Judah who removed foreign altars.","reference":"2 Chronicles 14:2–3"},{"word":"RAM","category":"Object","clue":"A male sheep used as an offering.","reference":"Leviticus 5:15"}]},"board":{"cells":[{"row":3,"col":0,"letter":"S","wordIndexes":[0,1]},{"row":3,"col":1,"letter":"A","wordIndexes":[0]},{"row":3,"col":2,"letter":"M","wordIndexes":[0,2]},{"row":3,"col":3,"letter":"A","wordIndexes":[0]},{"row":3,"col":4,"letter":"R","wordIndexes":[0]},{"row":3,"col":5,"letter":"I","wordIndexes":[0,3]},{"row":3,"col":6,"letter":"A","wordIndexes":[0]},{"row":0,"col":0,"letter":"A","wordIndexes":[1]},{"row":1,"col":0,"letter":"M","wordIndexes":[1]},{"row":2,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"A","wordIndexes":[1]},{"row":0,"col":2,"letter":"A","wordIndexes":[2]},{"row":1,"col":2,"letter":"R","wordIndexes":[2]},{"row":2,"col":2,"letter":"A","wordIndexes":[2]},{"row":1,"col":5,"letter":"A","wordIndexes":[3]},{"row":2,"col":5,"letter":"S","wordIndexes":[3]},{"row":4,"col":5,"letter":"A","wordIndexes":[3]}],"words":[{"word":"SAMARIA","category":"Place","clue":"Omri built this city as a royal capital.","reference":"1 Kings 16:24","row":3,"col":0,"vertical":false},{"word":"AMASA","category":"Person","clue":"David appointed him to lead the army instead of Joab.","reference":"2 Samuel 19:13","row":0,"col":0,"vertical":true},{"word":"ARAM","category":"Place","clue":"Naaman came from this land.","reference":"2 Kings 5:1","row":0,"col":2,"vertical":true},{"word":"ASIA","category":"Place","clue":"Paul taught so that people throughout this province heard the word.","reference":"Acts 19:10","row":1,"col":5,"vertical":true}],"rows":5,"cols":7}},{"difficulty":"medium","level":3,"pack":{"id":"jerusalem","title":"Jesus and the holy city","letters":"JERUSALEM","words":[{"word":"JERUSALEM","category":"Place","clue":"The city where Jesus was crucified and rose again.","reference":"Luke 24:18–24"},{"word":"SAMUEL","category":"Person","clue":"The boy who heard God calling during the night.","reference":"1 Samuel 3:1–10"},{"word":"JAMES","category":"Person","clue":"A son of Zebedee and brother of John.","reference":"Matthew 4:21"},{"word":"SAUL","category":"Person","clue":"Israel’s first king.","reference":"1 Samuel 10:1"},{"word":"ESAU","category":"Person","clue":"Jacob’s older twin brother.","reference":"Genesis 25:24–26"},{"word":"ELAM","category":"Place","clue":"People from this land heard the disciples at Pentecost.","reference":"Acts 2:9"},{"word":"RAM","category":"Object","clue":"The substitute found in a thicket on Mount Moriah.","reference":"Genesis 22:13"}]},"board":{"cells":[{"row":4,"col":0,"letter":"J","wordIndexes":[0]},{"row":4,"col":1,"letter":"E","wordIndexes":[0,1]},{"row":4,"col":2,"letter":"R","wordIndexes":[0]},{"row":4,"col":3,"letter":"U","wordIndexes":[0]},{"row":4,"col":4,"letter":"S","wordIndexes":[0,2]},{"row":4,"col":5,"letter":"A","wordIndexes":[0]},{"row":4,"col":6,"letter":"L","wordIndexes":[0,3]},{"row":4,"col":7,"letter":"E","wordIndexes":[0]},{"row":4,"col":8,"letter":"M","wordIndexes":[0]},{"row":0,"col":1,"letter":"S","wordIndexes":[1]},{"row":1,"col":1,"letter":"A","wordIndexes":[1]},{"row":2,"col":1,"letter":"M","wordIndexes":[1]},{"row":3,"col":1,"letter":"U","wordIndexes":[1]},{"row":5,"col":1,"letter":"L","wordIndexes":[1]},{"row":0,"col":4,"letter":"J","wordIndexes":[2]},{"row":1,"col":4,"letter":"A","wordIndexes":[2]},{"row":2,"col":4,"letter":"M","wordIndexes":[2]},{"row":3,"col":4,"letter":"E","wordIndexes":[2]},{"row":1,"col":6,"letter":"S","wordIndexes":[3]},{"row":2,"col":6,"letter":"A","wordIndexes":[3]},{"row":3,"col":6,"letter":"U","wordIndexes":[3]}],"words":[{"word":"JERUSALEM","category":"Place","clue":"The city where Jesus was crucified and rose again.","reference":"Luke 24:18–24","row":4,"col":0,"vertical":false},{"word":"SAMUEL","category":"Person","clue":"The boy who heard God calling during the night.","reference":"1 Samuel 3:1–10","row":0,"col":1,"vertical":true},{"word":"JAMES","category":"Person","clue":"A son of Zebedee and brother of John.","reference":"Matthew 4:21","row":0,"col":4,"vertical":true},{"word":"SAUL","category":"Person","clue":"Israel’s first king.","reference":"1 Samuel 10:1","row":1,"col":6,"vertical":true}],"rows":6,"cols":9}},{"difficulty":"medium","level":4,"pack":{"id":"tabernacle","title":"Moses: worship in the wilderness","letters":"TABERNACLE","words":[{"word":"TABERNACLE","category":"Object","clue":"Israel’s portable sanctuary in the wilderness.","reference":"Exodus 25:8–9"},{"word":"ALTAR","category":"Object","clue":"A structure on which offerings were presented.","reference":"Exodus 27:1"},{"word":"CANA","category":"Place","clue":"Jesus turned water into wine in this village.","reference":"John 2:1–11"},{"word":"ABEL","category":"Person","clue":"He brought an offering from his flock.","reference":"Genesis 4:4"},{"word":"ABNER","category":"Person","clue":"The commander of Saul’s army.","reference":"1 Samuel 14:50"},{"word":"NABAL","category":"Person","clue":"Abigail’s husband who insulted David’s men.","reference":"1 Samuel 25:3–11"},{"word":"BAAL","category":"Object","clue":"The false god represented by idols opposed by Elijah.","reference":"1 Kings 18:21–26"}]},"board":{"cells":[{"row":2,"col":0,"letter":"T","wordIndexes":[0,1]},{"row":2,"col":1,"letter":"A","wordIndexes":[0]},{"row":2,"col":2,"letter":"B","wordIndexes":[0,3]},{"row":2,"col":3,"letter":"E","wordIndexes":[0]},{"row":2,"col":4,"letter":"R","wordIndexes":[0]},{"row":2,"col":5,"letter":"N","wordIndexes":[0,2]},{"row":2,"col":6,"letter":"A","wordIndexes":[0]},{"row":2,"col":7,"letter":"C","wordIndexes":[0]},{"row":2,"col":8,"letter":"L","wordIndexes":[0]},{"row":2,"col":9,"letter":"E","wordIndexes":[0]},{"row":0,"col":0,"letter":"A","wordIndexes":[1]},{"row":1,"col":0,"letter":"L","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"R","wordIndexes":[1]},{"row":0,"col":5,"letter":"A","wordIndexes":[2]},{"row":1,"col":5,"letter":"B","wordIndexes":[2]},{"row":3,"col":5,"letter":"E","wordIndexes":[2]},{"row":4,"col":5,"letter":"R","wordIndexes":[2]},{"row":0,"col":2,"letter":"N","wordIndexes":[3]},{"row":1,"col":2,"letter":"A","wordIndexes":[3]},{"row":3,"col":2,"letter":"A","wordIndexes":[3]},{"row":4,"col":2,"letter":"L","wordIndexes":[3]}],"words":[{"word":"TABERNACLE","category":"Object","clue":"Israel’s portable sanctuary in the wilderness.","reference":"Exodus 25:8–9","row":2,"col":0,"vertical":false},{"word":"ALTAR","category":"Object","clue":"A structure on which offerings were presented.","reference":"Exodus 27:1","row":0,"col":0,"vertical":true},{"word":"ABNER","category":"Person","clue":"The commander of Saul’s army.","reference":"1 Samuel 14:50","row":0,"col":5,"vertical":true},{"word":"NABAL","category":"Person","clue":"Abigail’s husband who insulted David’s men.","reference":"1 Samuel 25:3–11","row":0,"col":2,"vertical":true}],"rows":5,"cols":10}},{"difficulty":"medium","level":5,"pack":{"id":"jordan","title":"Joshua: crossing into promise","letters":"JORDAN","words":[{"word":"JORDAN","category":"Place","clue":"Israel crossed this river on dry ground.","reference":"Joshua 3:14–17"},{"word":"DAN","category":"Person","clue":"A son of Jacob and Bilhah.","reference":"Genesis 30:6"},{"word":"DOR","category":"Place","clue":"A coastal city mentioned among Manasseh’s towns.","reference":"Joshua 17:11"},{"word":"JAR","category":"Object","clue":"A container the widow used for oil.","reference":"2 Kings 4:2"},{"word":"ROD","category":"Object","clue":"Aaron’s staff blossomed as a sign of God’s choice.","reference":"Numbers 17:8"}]},"board":{"cells":[{"row":1,"col":0,"letter":"J","wordIndexes":[0]},{"row":1,"col":1,"letter":"O","wordIndexes":[0,2]},{"row":1,"col":2,"letter":"R","wordIndexes":[0]},{"row":1,"col":3,"letter":"D","wordIndexes":[0,1]},{"row":1,"col":4,"letter":"A","wordIndexes":[0]},{"row":1,"col":5,"letter":"N","wordIndexes":[0]},{"row":2,"col":3,"letter":"A","wordIndexes":[1]},{"row":3,"col":3,"letter":"N","wordIndexes":[1]},{"row":0,"col":1,"letter":"D","wordIndexes":[2]},{"row":2,"col":1,"letter":"R","wordIndexes":[2]}],"words":[{"word":"JORDAN","category":"Place","clue":"Israel crossed this river on dry ground.","reference":"Joshua 3:14–17","row":1,"col":0,"vertical":false},{"word":"DAN","category":"Person","clue":"A son of Jacob and Bilhah.","reference":"Genesis 30:6","row":1,"col":3,"vertical":true},{"word":"DOR","category":"Place","clue":"A coastal city mentioned among Manasseh’s towns.","reference":"Joshua 17:11","row":0,"col":1,"vertical":true}],"rows":4,"cols":6}},{"difficulty":"medium","level":6,"pack":{"id":"goliath","title":"David: the giant and the shepherd","letters":"GOLIATH","words":[{"word":"GOLIATH","category":"Person","clue":"The Philistine champion defeated by David.","reference":"1 Samuel 17:4–50"},{"word":"GATH","category":"Place","clue":"The home city of the Philistine champion.","reference":"1 Samuel 17:4"},{"word":"LOT","category":"Person","clue":"Abraham’s nephew who lived in Sodom.","reference":"Genesis 13:12"}]},"board":{"cells":[{"row":0,"col":0,"letter":"G","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"O","wordIndexes":[0]},{"row":0,"col":2,"letter":"L","wordIndexes":[0,2]},{"row":0,"col":3,"letter":"I","wordIndexes":[0]},{"row":0,"col":4,"letter":"A","wordIndexes":[0]},{"row":0,"col":5,"letter":"T","wordIndexes":[0]},{"row":0,"col":6,"letter":"H","wordIndexes":[0]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"T","wordIndexes":[1]},{"row":3,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":2,"letter":"O","wordIndexes":[2]},{"row":2,"col":2,"letter":"T","wordIndexes":[2]}],"words":[{"word":"GOLIATH","category":"Person","clue":"The Philistine champion defeated by David.","reference":"1 Samuel 17:4–50","row":0,"col":0,"vertical":false},{"word":"GATH","category":"Place","clue":"The home city of the Philistine champion.","reference":"1 Samuel 17:4","row":0,"col":0,"vertical":true},{"word":"LOT","category":"Person","clue":"Abraham’s nephew who lived in Sodom.","reference":"Genesis 13:12","row":0,"col":2,"vertical":true}],"rows":4,"cols":7}},{"difficulty":"medium","level":7,"pack":{"id":"sapphira","title":"Acts: truth and integrity","letters":"SAPPHIRA","words":[{"word":"SAPPHIRA","category":"Person","clue":"She and Ananias lied about the sale of their property.","reference":"Acts 5:1–10"},{"word":"SARAH","category":"Person","clue":"Isaac’s mother.","reference":"Genesis 21:1–3"},{"word":"PARAH","category":"Place","clue":"A town listed in Benjamin’s territory.","reference":"Joshua 18:23"},{"word":"RAPHA","category":"Person","clue":"A son of Benjamin named in his family genealogy.","reference":"1 Chronicles 8:2"},{"word":"SHIP","category":"Object","clue":"Paul travelled in one of these before the wreck near Malta.","reference":"Acts 27:41–44"}]},"board":{"cells":[{"row":0,"col":0,"letter":"S","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"A","wordIndexes":[0]},{"row":0,"col":2,"letter":"P","wordIndexes":[0,2]},{"row":0,"col":3,"letter":"P","wordIndexes":[0]},{"row":0,"col":4,"letter":"H","wordIndexes":[0]},{"row":0,"col":5,"letter":"I","wordIndexes":[0]},{"row":0,"col":6,"letter":"R","wordIndexes":[0,3]},{"row":0,"col":7,"letter":"A","wordIndexes":[0]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"R","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":2,"letter":"A","wordIndexes":[2]},{"row":2,"col":2,"letter":"R","wordIndexes":[2]},{"row":3,"col":2,"letter":"A","wordIndexes":[2]},{"row":4,"col":2,"letter":"H","wordIndexes":[2]},{"row":1,"col":6,"letter":"A","wordIndexes":[3]},{"row":2,"col":6,"letter":"P","wordIndexes":[3]},{"row":3,"col":6,"letter":"H","wordIndexes":[3]},{"row":4,"col":6,"letter":"A","wordIndexes":[3]}],"words":[{"word":"SAPPHIRA","category":"Person","clue":"She and Ananias lied about the sale of their property.","reference":"Acts 5:1–10","row":0,"col":0,"vertical":false},{"word":"SARAH","category":"Person","clue":"Isaac’s mother.","reference":"Genesis 21:1–3","row":0,"col":0,"vertical":true},{"word":"PARAH","category":"Place","clue":"A town listed in Benjamin’s territory.","reference":"Joshua 18:23","row":0,"col":2,"vertical":true},{"word":"RAPHA","category":"Person","clue":"A son of Benjamin named in his family genealogy.","reference":"1 Chronicles 8:2","row":0,"col":6,"vertical":true}],"rows":5,"cols":8}},{"difficulty":"medium","level":8,"pack":{"id":"rebekah","title":"Isaac: a family of promise","letters":"REBEKAH","words":[{"word":"REBEKAH","category":"Person","clue":"She gave water to Abraham’s servant and his camels.","reference":"Genesis 24:15–20"},{"word":"HEBER","category":"Person","clue":"A Kenite whose wife was Jael.","reference":"Judges 4:17"},{"word":"BEER","category":"Place","clue":"A place where Israel gathered for water.","reference":"Numbers 21:16"},{"word":"ARK","category":"Object","clue":"The sacred chest carried by Israel.","reference":"Joshua 3:6"}]},"board":{"cells":[{"row":4,"col":0,"letter":"R","wordIndexes":[0,1]},{"row":4,"col":1,"letter":"E","wordIndexes":[0]},{"row":4,"col":2,"letter":"B","wordIndexes":[0]},{"row":4,"col":3,"letter":"E","wordIndexes":[0]},{"row":4,"col":4,"letter":"K","wordIndexes":[0]},{"row":4,"col":5,"letter":"A","wordIndexes":[0,3]},{"row":4,"col":6,"letter":"H","wordIndexes":[0]},{"row":0,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":0,"letter":"E","wordIndexes":[1]},{"row":2,"col":0,"letter":"B","wordIndexes":[1,2]},{"row":3,"col":0,"letter":"E","wordIndexes":[1]},{"row":2,"col":1,"letter":"E","wordIndexes":[2]},{"row":2,"col":2,"letter":"E","wordIndexes":[2]},{"row":2,"col":3,"letter":"R","wordIndexes":[2]},{"row":5,"col":5,"letter":"R","wordIndexes":[3]},{"row":6,"col":5,"letter":"K","wordIndexes":[3]}],"words":[{"word":"REBEKAH","category":"Person","clue":"She gave water to Abraham’s servant and his camels.","reference":"Genesis 24:15–20","row":4,"col":0,"vertical":false},{"word":"HEBER","category":"Person","clue":"A Kenite whose wife was Jael.","reference":"Judges 4:17","row":0,"col":0,"vertical":true},{"word":"BEER","category":"Place","clue":"A place where Israel gathered for water.","reference":"Numbers 21:16","row":2,"col":0,"vertical":false},{"word":"ARK","category":"Object","clue":"The sacred chest carried by Israel.","reference":"Joshua 3:6","row":4,"col":5,"vertical":true}],"rows":7,"cols":7}},{"difficulty":"medium","level":9,"pack":{"id":"mordecai","title":"Esther: courage in exile","letters":"MORDECAI","words":[{"word":"MORDECAI","category":"Person","clue":"Esther’s cousin who raised her as his daughter.","reference":"Esther 2:7"},{"word":"MEDIA","category":"Place","clue":"A kingdom named alongside Persia.","reference":"Esther 1:3"},{"word":"ROME","category":"Place","clue":"Paul arrived here under guard.","reference":"Acts 28:16"},{"word":"DOR","category":"Place","clue":"A coastal town within Manasseh’s allotted territory.","reference":"Joshua 17:11"},{"word":"OMAR","category":"Person","clue":"A son of Eliphaz in Esau’s family.","reference":"Genesis 36:11"},{"word":"ROD","category":"Object","clue":"Moses carried this when God sent him to Egypt.","reference":"Exodus 4:17"}]},"board":{"cells":[{"row":2,"col":0,"letter":"M","wordIndexes":[0,1]},{"row":2,"col":1,"letter":"O","wordIndexes":[0]},{"row":2,"col":2,"letter":"R","wordIndexes":[0,2]},{"row":2,"col":3,"letter":"D","wordIndexes":[0]},{"row":2,"col":4,"letter":"E","wordIndexes":[0]},{"row":2,"col":5,"letter":"C","wordIndexes":[0]},{"row":2,"col":6,"letter":"A","wordIndexes":[0,3]},{"row":2,"col":7,"letter":"I","wordIndexes":[0]},{"row":3,"col":0,"letter":"E","wordIndexes":[1]},{"row":4,"col":0,"letter":"D","wordIndexes":[1]},{"row":5,"col":0,"letter":"I","wordIndexes":[1]},{"row":6,"col":0,"letter":"A","wordIndexes":[1]},{"row":3,"col":2,"letter":"O","wordIndexes":[2]},{"row":4,"col":2,"letter":"M","wordIndexes":[2]},{"row":5,"col":2,"letter":"E","wordIndexes":[2]},{"row":0,"col":6,"letter":"O","wordIndexes":[3]},{"row":1,"col":6,"letter":"M","wordIndexes":[3]},{"row":3,"col":6,"letter":"R","wordIndexes":[3]}],"words":[{"word":"MORDECAI","category":"Person","clue":"Esther’s cousin who raised her as his daughter.","reference":"Esther 2:7","row":2,"col":0,"vertical":false},{"word":"MEDIA","category":"Place","clue":"A kingdom named alongside Persia.","reference":"Esther 1:3","row":2,"col":0,"vertical":true},{"word":"ROME","category":"Place","clue":"Paul arrived here under guard.","reference":"Acts 28:16","row":2,"col":2,"vertical":true},{"word":"OMAR","category":"Person","clue":"A son of Eliphaz in Esau’s family.","reference":"Genesis 36:11","row":0,"col":6,"vertical":true}],"rows":7,"cols":8}},{"difficulty":"medium","level":10,"pack":{"id":"candlestick","title":"The sanctuary: light and service","letters":"CANDLESTICK","words":[{"word":"CANDLESTICK","category":"Object","clue":"The KJV name for the sanctuary’s golden lampstand.","reference":"Exodus 25:31"},{"word":"DANIEL","category":"Person","clue":"He continued praying even when a royal decree forbade it.","reference":"Daniel 6:10"},{"word":"CAIN","category":"Person","clue":"Adam and Eve’s son who killed Abel.","reference":"Genesis 4:1–8"},{"word":"NAILS","category":"Object","clue":"Thomas wanted to see the marks left by these.","reference":"John 20:25"},{"word":"STICK","category":"Object","clue":"Ezekiel joined two of these as a sign for Israel.","reference":"Ezekiel 37:16–17"},{"word":"TACKLE","category":"Object","clue":"The ship’s equipment thrown overboard during Paul’s storm.","reference":"Acts 27:19"},{"word":"DAN","category":"Person","clue":"A son of Jacob whose name means judgment.","reference":"Genesis 30:6"}]},"board":{"cells":[{"row":1,"col":0,"letter":"C","wordIndexes":[0]},{"row":1,"col":1,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":2,"letter":"N","wordIndexes":[0]},{"row":1,"col":3,"letter":"D","wordIndexes":[0]},{"row":1,"col":4,"letter":"L","wordIndexes":[0]},{"row":1,"col":5,"letter":"E","wordIndexes":[0]},{"row":1,"col":6,"letter":"S","wordIndexes":[0]},{"row":1,"col":7,"letter":"T","wordIndexes":[0,2]},{"row":1,"col":8,"letter":"I","wordIndexes":[0]},{"row":1,"col":9,"letter":"C","wordIndexes":[0]},{"row":1,"col":10,"letter":"K","wordIndexes":[0]},{"row":0,"col":1,"letter":"D","wordIndexes":[1]},{"row":2,"col":1,"letter":"N","wordIndexes":[1]},{"row":3,"col":1,"letter":"I","wordIndexes":[1]},{"row":4,"col":1,"letter":"E","wordIndexes":[1]},{"row":5,"col":1,"letter":"L","wordIndexes":[1]},{"row":2,"col":7,"letter":"A","wordIndexes":[2]},{"row":3,"col":7,"letter":"C","wordIndexes":[2]},{"row":4,"col":7,"letter":"K","wordIndexes":[2]},{"row":5,"col":7,"letter":"L","wordIndexes":[2,3]},{"row":6,"col":7,"letter":"E","wordIndexes":[2]},{"row":5,"col":4,"letter":"N","wordIndexes":[3]},{"row":5,"col":5,"letter":"A","wordIndexes":[3]},{"row":5,"col":6,"letter":"I","wordIndexes":[3]},{"row":5,"col":8,"letter":"S","wordIndexes":[3]}],"words":[{"word":"CANDLESTICK","category":"Object","clue":"The KJV name for the sanctuary’s golden lampstand.","reference":"Exodus 25:31","row":1,"col":0,"vertical":false},{"word":"DANIEL","category":"Person","clue":"He continued praying even when a royal decree forbade it.","reference":"Daniel 6:10","row":0,"col":1,"vertical":true},{"word":"TACKLE","category":"Object","clue":"The ship’s equipment thrown overboard during Paul’s storm.","reference":"Acts 27:19","row":1,"col":7,"vertical":true},{"word":"NAILS","category":"Object","clue":"Thomas wanted to see the marks left by these.","reference":"John 20:25","row":5,"col":4,"vertical":false}],"rows":7,"cols":11}},{"difficulty":"medium","level":11,"pack":{"id":"pharaoh","title":"Exodus: freedom and deliverance","letters":"PHARAOH","words":[{"word":"PHARAOH","category":"Person","clue":"The ruler who refused Moses’ request to let Israel go.","reference":"Exodus 5:1–2"},{"word":"HARP","category":"Object","clue":"David played this instrument for Saul.","reference":"1 Samuel 16:23"},{"word":"PARAH","category":"Place","clue":"A town included in Benjamin’s inheritance.","reference":"Joshua 18:23"}]},"board":{"cells":[{"row":0,"col":0,"letter":"P","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"H","wordIndexes":[0]},{"row":0,"col":2,"letter":"A","wordIndexes":[0]},{"row":0,"col":3,"letter":"R","wordIndexes":[0]},{"row":0,"col":4,"letter":"A","wordIndexes":[0]},{"row":0,"col":5,"letter":"O","wordIndexes":[0]},{"row":0,"col":6,"letter":"H","wordIndexes":[0,2]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"R","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":6,"letter":"A","wordIndexes":[2]},{"row":2,"col":6,"letter":"R","wordIndexes":[2]},{"row":3,"col":6,"letter":"P","wordIndexes":[2]}],"words":[{"word":"PHARAOH","category":"Person","clue":"The ruler who refused Moses’ request to let Israel go.","reference":"Exodus 5:1–2","row":0,"col":0,"vertical":false},{"word":"PARAH","category":"Place","clue":"A town included in Benjamin’s inheritance.","reference":"Joshua 18:23","row":0,"col":0,"vertical":true},{"word":"HARP","category":"Object","clue":"David played this instrument for Saul.","reference":"1 Samuel 16:23","row":0,"col":6,"vertical":true}],"rows":5,"cols":7}},{"difficulty":"hard","level":0,"pack":{"id":"abraham","title":"Abraham: the promise","letters":"ABRAHAM","words":[{"word":"ABRAHAM","category":"Person","clue":"God promised to make him the father of many nations.","reference":"Genesis 17:5"},{"word":"RAHAB","category":"Person","clue":"She hid the spies in Jericho.","reference":"Joshua 2:1–6"},{"word":"HAM","category":"Person","clue":"One of Noah’s three sons.","reference":"Genesis 9:18"},{"word":"ARAM","category":"Place","clue":"The land where Jacob went to find a wife.","reference":"Genesis 28:5"},{"word":"MARAH","category":"Place","clue":"Israel found bitter water here after crossing the sea.","reference":"Exodus 15:23"},{"word":"RAM","category":"Object","clue":"Abraham offered this in place of Isaac.","reference":"Genesis 22:13"}]},"board":{"cells":[{"row":2,"col":0,"letter":"A","wordIndexes":[0,1]},{"row":2,"col":1,"letter":"B","wordIndexes":[0]},{"row":2,"col":2,"letter":"R","wordIndexes":[0]},{"row":2,"col":3,"letter":"A","wordIndexes":[0,2]},{"row":2,"col":4,"letter":"H","wordIndexes":[0]},{"row":2,"col":5,"letter":"A","wordIndexes":[0,3]},{"row":2,"col":6,"letter":"M","wordIndexes":[0,5]},{"row":1,"col":0,"letter":"R","wordIndexes":[1]},{"row":3,"col":0,"letter":"H","wordIndexes":[1]},{"row":4,"col":0,"letter":"A","wordIndexes":[1]},{"row":5,"col":0,"letter":"B","wordIndexes":[1]},{"row":1,"col":3,"letter":"M","wordIndexes":[2]},{"row":3,"col":3,"letter":"R","wordIndexes":[2]},{"row":4,"col":3,"letter":"A","wordIndexes":[2]},{"row":5,"col":3,"letter":"H","wordIndexes":[2,4]},{"row":3,"col":5,"letter":"R","wordIndexes":[3]},{"row":4,"col":5,"letter":"A","wordIndexes":[3]},{"row":5,"col":5,"letter":"M","wordIndexes":[3,4]},{"row":5,"col":4,"letter":"A","wordIndexes":[4]},{"row":0,"col":6,"letter":"R","wordIndexes":[5]},{"row":1,"col":6,"letter":"A","wordIndexes":[5]}],"words":[{"word":"ABRAHAM","category":"Person","clue":"God promised to make him the father of many nations.","reference":"Genesis 17:5","row":2,"col":0,"vertical":false},{"word":"RAHAB","category":"Person","clue":"She hid the spies in Jericho.","reference":"Joshua 2:1–6","row":1,"col":0,"vertical":true},{"word":"MARAH","category":"Place","clue":"Israel found bitter water here after crossing the sea.","reference":"Exodus 15:23","row":1,"col":3,"vertical":true},{"word":"ARAM","category":"Place","clue":"The land where Jacob went to find a wife.","reference":"Genesis 28:5","row":2,"col":5,"vertical":true},{"word":"HAM","category":"Person","clue":"One of Noah’s three sons.","reference":"Genesis 9:18","row":5,"col":3,"vertical":false},{"word":"RAM","category":"Object","clue":"Abraham offered this in place of Isaac.","reference":"Genesis 22:13","row":0,"col":6,"vertical":true}],"rows":6,"cols":7}},{"difficulty":"hard","level":1,"pack":{"id":"jonathan","title":"David: friendship and courage","letters":"JONATHAN","words":[{"word":"JONATHAN","category":"Person","clue":"Saul’s son who made a covenant of friendship with David.","reference":"1 Samuel 18:1–4"},{"word":"NATHAN","category":"Person","clue":"The prophet who confronted David with a story about a lamb.","reference":"2 Samuel 12:1–7"},{"word":"JOHN","category":"Person","clue":"The disciple described as the one Jesus loved.","reference":"John 21:20–24"},{"word":"NOAH","category":"Person","clue":"He built an ark before the flood.","reference":"Genesis 6:13–22"},{"word":"ANNA","category":"Person","clue":"An elderly prophetess who saw the infant Jesus in the temple.","reference":"Luke 2:36–38"},{"word":"JONAH","category":"Person","clue":"A prophet sent to Nineveh.","reference":"Jonah 1:1–2"}]},"board":{"cells":[{"row":2,"col":0,"letter":"J","wordIndexes":[0,2]},{"row":2,"col":1,"letter":"O","wordIndexes":[0]},{"row":2,"col":2,"letter":"N","wordIndexes":[0,1]},{"row":2,"col":3,"letter":"A","wordIndexes":[0]},{"row":2,"col":4,"letter":"T","wordIndexes":[0]},{"row":2,"col":5,"letter":"H","wordIndexes":[0,3]},{"row":2,"col":6,"letter":"A","wordIndexes":[0]},{"row":2,"col":7,"letter":"N","wordIndexes":[0,4]},{"row":3,"col":2,"letter":"A","wordIndexes":[1]},{"row":4,"col":2,"letter":"T","wordIndexes":[1]},{"row":5,"col":2,"letter":"H","wordIndexes":[1]},{"row":6,"col":2,"letter":"A","wordIndexes":[1,5]},{"row":7,"col":2,"letter":"N","wordIndexes":[1]},{"row":3,"col":0,"letter":"O","wordIndexes":[2]},{"row":4,"col":0,"letter":"N","wordIndexes":[2]},{"row":5,"col":0,"letter":"A","wordIndexes":[2]},{"row":6,"col":0,"letter":"H","wordIndexes":[2]},{"row":0,"col":5,"letter":"J","wordIndexes":[3]},{"row":1,"col":5,"letter":"O","wordIndexes":[3]},{"row":3,"col":5,"letter":"N","wordIndexes":[3]},{"row":3,"col":7,"letter":"O","wordIndexes":[4]},{"row":4,"col":7,"letter":"A","wordIndexes":[4]},{"row":5,"col":7,"letter":"H","wordIndexes":[4]},{"row":6,"col":3,"letter":"N","wordIndexes":[5]},{"row":6,"col":4,"letter":"N","wordIndexes":[5]},{"row":6,"col":5,"letter":"A","wordIndexes":[5]}],"words":[{"word":"JONATHAN","category":"Person","clue":"Saul’s son who made a covenant of friendship with David.","reference":"1 Samuel 18:1–4","row":2,"col":0,"vertical":false},{"word":"NATHAN","category":"Person","clue":"The prophet who confronted David with a story about a lamb.","reference":"2 Samuel 12:1–7","row":2,"col":2,"vertical":true},{"word":"JONAH","category":"Person","clue":"A prophet sent to Nineveh.","reference":"Jonah 1:1–2","row":2,"col":0,"vertical":true},{"word":"JOHN","category":"Person","clue":"The disciple described as the one Jesus loved.","reference":"John 21:20–24","row":0,"col":5,"vertical":true},{"word":"NOAH","category":"Person","clue":"He built an ark before the flood.","reference":"Genesis 6:13–22","row":2,"col":7,"vertical":true},{"word":"ANNA","category":"Person","clue":"An elderly prophetess who saw the infant Jesus in the temple.","reference":"Luke 2:36–38","row":6,"col":2,"vertical":false}],"rows":8,"cols":8}},{"difficulty":"hard","level":2,"pack":{"id":"samaria","title":"Israel: kings and places","letters":"SAMARIA","words":[{"word":"SAMARIA","category":"Place","clue":"Omri built this city as a royal capital.","reference":"1 Kings 16:24"},{"word":"ARAM","category":"Place","clue":"Naaman came from this land.","reference":"2 Kings 5:1"},{"word":"ASIA","category":"Place","clue":"Paul taught so that people throughout this province heard the word.","reference":"Acts 19:10"},{"word":"AMASA","category":"Person","clue":"David appointed him to lead the army instead of Joab.","reference":"2 Samuel 19:13"},{"word":"ASA","category":"Person","clue":"A king of Judah who removed foreign altars.","reference":"2 Chronicles 14:2–3"},{"word":"RAM","category":"Object","clue":"A male sheep used as an offering.","reference":"Leviticus 5:15"}]},"board":{"cells":[{"row":3,"col":0,"letter":"S","wordIndexes":[0,1]},{"row":3,"col":1,"letter":"A","wordIndexes":[0]},{"row":3,"col":2,"letter":"M","wordIndexes":[0,2]},{"row":3,"col":3,"letter":"A","wordIndexes":[0]},{"row":3,"col":4,"letter":"R","wordIndexes":[0]},{"row":3,"col":5,"letter":"I","wordIndexes":[0,3]},{"row":3,"col":6,"letter":"A","wordIndexes":[0]},{"row":0,"col":0,"letter":"A","wordIndexes":[1,4]},{"row":1,"col":0,"letter":"M","wordIndexes":[1]},{"row":2,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"A","wordIndexes":[1]},{"row":0,"col":2,"letter":"A","wordIndexes":[2,4]},{"row":1,"col":2,"letter":"R","wordIndexes":[2]},{"row":2,"col":2,"letter":"A","wordIndexes":[2]},{"row":1,"col":5,"letter":"A","wordIndexes":[3,5]},{"row":2,"col":5,"letter":"S","wordIndexes":[3]},{"row":4,"col":5,"letter":"A","wordIndexes":[3]},{"row":0,"col":1,"letter":"S","wordIndexes":[4]},{"row":1,"col":4,"letter":"R","wordIndexes":[5]},{"row":1,"col":6,"letter":"M","wordIndexes":[5]}],"words":[{"word":"SAMARIA","category":"Place","clue":"Omri built this city as a royal capital.","reference":"1 Kings 16:24","row":3,"col":0,"vertical":false},{"word":"AMASA","category":"Person","clue":"David appointed him to lead the army instead of Joab.","reference":"2 Samuel 19:13","row":0,"col":0,"vertical":true},{"word":"ARAM","category":"Place","clue":"Naaman came from this land.","reference":"2 Kings 5:1","row":0,"col":2,"vertical":true},{"word":"ASIA","category":"Place","clue":"Paul taught so that people throughout this province heard the word.","reference":"Acts 19:10","row":1,"col":5,"vertical":true},{"word":"ASA","category":"Person","clue":"A king of Judah who removed foreign altars.","reference":"2 Chronicles 14:2–3","row":0,"col":0,"vertical":false},{"word":"RAM","category":"Object","clue":"A male sheep used as an offering.","reference":"Leviticus 5:15","row":1,"col":4,"vertical":false}],"rows":5,"cols":7}},{"difficulty":"hard","level":3,"pack":{"id":"jerusalem","title":"Jesus and the holy city","letters":"JERUSALEM","words":[{"word":"JERUSALEM","category":"Place","clue":"The city where Jesus was crucified and rose again.","reference":"Luke 24:18–24"},{"word":"SAMUEL","category":"Person","clue":"The boy who heard God calling during the night.","reference":"1 Samuel 3:1–10"},{"word":"JAMES","category":"Person","clue":"A son of Zebedee and brother of John.","reference":"Matthew 4:21"},{"word":"SAUL","category":"Person","clue":"Israel’s first king.","reference":"1 Samuel 10:1"},{"word":"ESAU","category":"Person","clue":"Jacob’s older twin brother.","reference":"Genesis 25:24–26"},{"word":"ELAM","category":"Place","clue":"People from this land heard the disciples at Pentecost.","reference":"Acts 2:9"},{"word":"RAM","category":"Object","clue":"The substitute found in a thicket on Mount Moriah.","reference":"Genesis 22:13"}]},"board":{"cells":[{"row":4,"col":1,"letter":"J","wordIndexes":[0]},{"row":4,"col":2,"letter":"E","wordIndexes":[0,1]},{"row":4,"col":3,"letter":"R","wordIndexes":[0]},{"row":4,"col":4,"letter":"U","wordIndexes":[0]},{"row":4,"col":5,"letter":"S","wordIndexes":[0,2]},{"row":4,"col":6,"letter":"A","wordIndexes":[0]},{"row":4,"col":7,"letter":"L","wordIndexes":[0,3]},{"row":4,"col":8,"letter":"E","wordIndexes":[0]},{"row":4,"col":9,"letter":"M","wordIndexes":[0,5]},{"row":0,"col":2,"letter":"S","wordIndexes":[1]},{"row":1,"col":2,"letter":"A","wordIndexes":[1,4]},{"row":2,"col":2,"letter":"M","wordIndexes":[1]},{"row":3,"col":2,"letter":"U","wordIndexes":[1]},{"row":5,"col":2,"letter":"L","wordIndexes":[1]},{"row":0,"col":5,"letter":"J","wordIndexes":[2]},{"row":1,"col":5,"letter":"A","wordIndexes":[2]},{"row":2,"col":5,"letter":"M","wordIndexes":[2]},{"row":3,"col":5,"letter":"E","wordIndexes":[2]},{"row":1,"col":7,"letter":"S","wordIndexes":[3]},{"row":2,"col":7,"letter":"A","wordIndexes":[3]},{"row":3,"col":7,"letter":"U","wordIndexes":[3]},{"row":1,"col":0,"letter":"E","wordIndexes":[4]},{"row":1,"col":1,"letter":"S","wordIndexes":[4]},{"row":1,"col":3,"letter":"U","wordIndexes":[4]},{"row":1,"col":9,"letter":"E","wordIndexes":[5]},{"row":2,"col":9,"letter":"L","wordIndexes":[5]},{"row":3,"col":9,"letter":"A","wordIndexes":[5]}],"words":[{"word":"JERUSALEM","category":"Place","clue":"The city where Jesus was crucified and rose again.","reference":"Luke 24:18–24","row":4,"col":1,"vertical":false},{"word":"SAMUEL","category":"Person","clue":"The boy who heard God calling during the night.","reference":"1 Samuel 3:1–10","row":0,"col":2,"vertical":true},{"word":"JAMES","category":"Person","clue":"A son of Zebedee and brother of John.","reference":"Matthew 4:21","row":0,"col":5,"vertical":true},{"word":"SAUL","category":"Person","clue":"Israel’s first king.","reference":"1 Samuel 10:1","row":1,"col":7,"vertical":true},{"word":"ESAU","category":"Person","clue":"Jacob’s older twin brother.","reference":"Genesis 25:24–26","row":1,"col":0,"vertical":false},{"word":"ELAM","category":"Place","clue":"People from this land heard the disciples at Pentecost.","reference":"Acts 2:9","row":1,"col":9,"vertical":true}],"rows":6,"cols":10}},{"difficulty":"hard","level":4,"pack":{"id":"tabernacle","title":"Moses: worship in the wilderness","letters":"TABERNACLE","words":[{"word":"TABERNACLE","category":"Object","clue":"Israel’s portable sanctuary in the wilderness.","reference":"Exodus 25:8–9"},{"word":"ALTAR","category":"Object","clue":"A structure on which offerings were presented.","reference":"Exodus 27:1"},{"word":"CANA","category":"Place","clue":"Jesus turned water into wine in this village.","reference":"John 2:1–11"},{"word":"ABEL","category":"Person","clue":"He brought an offering from his flock.","reference":"Genesis 4:4"},{"word":"ABNER","category":"Person","clue":"The commander of Saul’s army.","reference":"1 Samuel 14:50"},{"word":"NABAL","category":"Person","clue":"Abigail’s husband who insulted David’s men.","reference":"1 Samuel 25:3–11"},{"word":"BAAL","category":"Object","clue":"The false god represented by idols opposed by Elijah.","reference":"1 Kings 18:21–26"}]},"board":{"cells":[{"row":2,"col":0,"letter":"T","wordIndexes":[0,1]},{"row":2,"col":1,"letter":"A","wordIndexes":[0]},{"row":2,"col":2,"letter":"B","wordIndexes":[0,3]},{"row":2,"col":3,"letter":"E","wordIndexes":[0]},{"row":2,"col":4,"letter":"R","wordIndexes":[0]},{"row":2,"col":5,"letter":"N","wordIndexes":[0,2]},{"row":2,"col":6,"letter":"A","wordIndexes":[0]},{"row":2,"col":7,"letter":"C","wordIndexes":[0]},{"row":2,"col":8,"letter":"L","wordIndexes":[0]},{"row":2,"col":9,"letter":"E","wordIndexes":[0,5]},{"row":0,"col":0,"letter":"A","wordIndexes":[1]},{"row":1,"col":0,"letter":"L","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"R","wordIndexes":[1]},{"row":0,"col":5,"letter":"A","wordIndexes":[2,4]},{"row":1,"col":5,"letter":"B","wordIndexes":[2]},{"row":3,"col":5,"letter":"E","wordIndexes":[2]},{"row":4,"col":5,"letter":"R","wordIndexes":[2]},{"row":0,"col":2,"letter":"N","wordIndexes":[3]},{"row":1,"col":2,"letter":"A","wordIndexes":[3]},{"row":3,"col":2,"letter":"A","wordIndexes":[3]},{"row":4,"col":2,"letter":"L","wordIndexes":[3]},{"row":0,"col":4,"letter":"C","wordIndexes":[4]},{"row":0,"col":6,"letter":"N","wordIndexes":[4]},{"row":0,"col":7,"letter":"A","wordIndexes":[4]},{"row":0,"col":9,"letter":"A","wordIndexes":[5]},{"row":1,"col":9,"letter":"B","wordIndexes":[5]},{"row":3,"col":9,"letter":"L","wordIndexes":[5]}],"words":[{"word":"TABERNACLE","category":"Object","clue":"Israel’s portable sanctuary in the wilderness.","reference":"Exodus 25:8–9","row":2,"col":0,"vertical":false},{"word":"ALTAR","category":"Object","clue":"A structure on which offerings were presented.","reference":"Exodus 27:1","row":0,"col":0,"vertical":true},{"word":"ABNER","category":"Person","clue":"The commander of Saul’s army.","reference":"1 Samuel 14:50","row":0,"col":5,"vertical":true},{"word":"NABAL","category":"Person","clue":"Abigail’s husband who insulted David’s men.","reference":"1 Samuel 25:3–11","row":0,"col":2,"vertical":true},{"word":"CANA","category":"Place","clue":"Jesus turned water into wine in this village.","reference":"John 2:1–11","row":0,"col":4,"vertical":false},{"word":"ABEL","category":"Person","clue":"He brought an offering from his flock.","reference":"Genesis 4:4","row":0,"col":9,"vertical":true}],"rows":5,"cols":10}},{"difficulty":"hard","level":5,"pack":{"id":"jordan","title":"Joshua: crossing into promise","letters":"JORDAN","words":[{"word":"JORDAN","category":"Place","clue":"Israel crossed this river on dry ground.","reference":"Joshua 3:14–17"},{"word":"DAN","category":"Person","clue":"A son of Jacob and Bilhah.","reference":"Genesis 30:6"},{"word":"DOR","category":"Place","clue":"A coastal city mentioned among Manasseh’s towns.","reference":"Joshua 17:11"},{"word":"JAR","category":"Object","clue":"A container the widow used for oil.","reference":"2 Kings 4:2"},{"word":"ROD","category":"Object","clue":"Aaron’s staff blossomed as a sign of God’s choice.","reference":"Numbers 17:8"}]},"board":{"cells":[{"row":1,"col":0,"letter":"J","wordIndexes":[0]},{"row":1,"col":1,"letter":"O","wordIndexes":[0,2]},{"row":1,"col":2,"letter":"R","wordIndexes":[0]},{"row":1,"col":3,"letter":"D","wordIndexes":[0,1]},{"row":1,"col":4,"letter":"A","wordIndexes":[0]},{"row":1,"col":5,"letter":"N","wordIndexes":[0]},{"row":2,"col":3,"letter":"A","wordIndexes":[1]},{"row":3,"col":3,"letter":"N","wordIndexes":[1]},{"row":0,"col":1,"letter":"D","wordIndexes":[2]},{"row":2,"col":1,"letter":"R","wordIndexes":[2]}],"words":[{"word":"JORDAN","category":"Place","clue":"Israel crossed this river on dry ground.","reference":"Joshua 3:14–17","row":1,"col":0,"vertical":false},{"word":"DAN","category":"Person","clue":"A son of Jacob and Bilhah.","reference":"Genesis 30:6","row":1,"col":3,"vertical":true},{"word":"DOR","category":"Place","clue":"A coastal city mentioned among Manasseh’s towns.","reference":"Joshua 17:11","row":0,"col":1,"vertical":true}],"rows":4,"cols":6}},{"difficulty":"hard","level":6,"pack":{"id":"goliath","title":"David: the giant and the shepherd","letters":"GOLIATH","words":[{"word":"GOLIATH","category":"Person","clue":"The Philistine champion defeated by David.","reference":"1 Samuel 17:4–50"},{"word":"GATH","category":"Place","clue":"The home city of the Philistine champion.","reference":"1 Samuel 17:4"},{"word":"LOT","category":"Person","clue":"Abraham’s nephew who lived in Sodom.","reference":"Genesis 13:12"}]},"board":{"cells":[{"row":0,"col":0,"letter":"G","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"O","wordIndexes":[0]},{"row":0,"col":2,"letter":"L","wordIndexes":[0,2]},{"row":0,"col":3,"letter":"I","wordIndexes":[0]},{"row":0,"col":4,"letter":"A","wordIndexes":[0]},{"row":0,"col":5,"letter":"T","wordIndexes":[0]},{"row":0,"col":6,"letter":"H","wordIndexes":[0]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"T","wordIndexes":[1]},{"row":3,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":2,"letter":"O","wordIndexes":[2]},{"row":2,"col":2,"letter":"T","wordIndexes":[2]}],"words":[{"word":"GOLIATH","category":"Person","clue":"The Philistine champion defeated by David.","reference":"1 Samuel 17:4–50","row":0,"col":0,"vertical":false},{"word":"GATH","category":"Place","clue":"The home city of the Philistine champion.","reference":"1 Samuel 17:4","row":0,"col":0,"vertical":true},{"word":"LOT","category":"Person","clue":"Abraham’s nephew who lived in Sodom.","reference":"Genesis 13:12","row":0,"col":2,"vertical":true}],"rows":4,"cols":7}},{"difficulty":"hard","level":7,"pack":{"id":"sapphira","title":"Acts: truth and integrity","letters":"SAPPHIRA","words":[{"word":"SAPPHIRA","category":"Person","clue":"She and Ananias lied about the sale of their property.","reference":"Acts 5:1–10"},{"word":"SARAH","category":"Person","clue":"Isaac’s mother.","reference":"Genesis 21:1–3"},{"word":"PARAH","category":"Place","clue":"A town listed in Benjamin’s territory.","reference":"Joshua 18:23"},{"word":"RAPHA","category":"Person","clue":"A son of Benjamin named in his family genealogy.","reference":"1 Chronicles 8:2"},{"word":"SHIP","category":"Object","clue":"Paul travelled in one of these before the wreck near Malta.","reference":"Acts 27:41–44"}]},"board":{"cells":[{"row":1,"col":0,"letter":"S","wordIndexes":[0,1]},{"row":1,"col":1,"letter":"A","wordIndexes":[0]},{"row":1,"col":2,"letter":"P","wordIndexes":[0,2]},{"row":1,"col":3,"letter":"P","wordIndexes":[0]},{"row":1,"col":4,"letter":"H","wordIndexes":[0,4]},{"row":1,"col":5,"letter":"I","wordIndexes":[0]},{"row":1,"col":6,"letter":"R","wordIndexes":[0,3]},{"row":1,"col":7,"letter":"A","wordIndexes":[0]},{"row":2,"col":0,"letter":"A","wordIndexes":[1]},{"row":3,"col":0,"letter":"R","wordIndexes":[1]},{"row":4,"col":0,"letter":"A","wordIndexes":[1]},{"row":5,"col":0,"letter":"H","wordIndexes":[1]},{"row":2,"col":2,"letter":"A","wordIndexes":[2]},{"row":3,"col":2,"letter":"R","wordIndexes":[2]},{"row":4,"col":2,"letter":"A","wordIndexes":[2]},{"row":5,"col":2,"letter":"H","wordIndexes":[2]},{"row":2,"col":6,"letter":"A","wordIndexes":[3]},{"row":3,"col":6,"letter":"P","wordIndexes":[3]},{"row":4,"col":6,"letter":"H","wordIndexes":[3]},{"row":5,"col":6,"letter":"A","wordIndexes":[3]},{"row":0,"col":4,"letter":"S","wordIndexes":[4]},{"row":2,"col":4,"letter":"I","wordIndexes":[4]},{"row":3,"col":4,"letter":"P","wordIndexes":[4]}],"words":[{"word":"SAPPHIRA","category":"Person","clue":"She and Ananias lied about the sale of their property.","reference":"Acts 5:1–10","row":1,"col":0,"vertical":false},{"word":"SARAH","category":"Person","clue":"Isaac’s mother.","reference":"Genesis 21:1–3","row":1,"col":0,"vertical":true},{"word":"PARAH","category":"Place","clue":"A town listed in Benjamin’s territory.","reference":"Joshua 18:23","row":1,"col":2,"vertical":true},{"word":"RAPHA","category":"Person","clue":"A son of Benjamin named in his family genealogy.","reference":"1 Chronicles 8:2","row":1,"col":6,"vertical":true},{"word":"SHIP","category":"Object","clue":"Paul travelled in one of these before the wreck near Malta.","reference":"Acts 27:41–44","row":0,"col":4,"vertical":true}],"rows":6,"cols":8}},{"difficulty":"hard","level":8,"pack":{"id":"rebekah","title":"Isaac: a family of promise","letters":"REBEKAH","words":[{"word":"REBEKAH","category":"Person","clue":"She gave water to Abraham’s servant and his camels.","reference":"Genesis 24:15–20"},{"word":"HEBER","category":"Person","clue":"A Kenite whose wife was Jael.","reference":"Judges 4:17"},{"word":"BEER","category":"Place","clue":"A place where Israel gathered for water.","reference":"Numbers 21:16"},{"word":"ARK","category":"Object","clue":"The sacred chest carried by Israel.","reference":"Joshua 3:6"}]},"board":{"cells":[{"row":4,"col":0,"letter":"R","wordIndexes":[0,1]},{"row":4,"col":1,"letter":"E","wordIndexes":[0]},{"row":4,"col":2,"letter":"B","wordIndexes":[0]},{"row":4,"col":3,"letter":"E","wordIndexes":[0]},{"row":4,"col":4,"letter":"K","wordIndexes":[0]},{"row":4,"col":5,"letter":"A","wordIndexes":[0,3]},{"row":4,"col":6,"letter":"H","wordIndexes":[0]},{"row":0,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":0,"letter":"E","wordIndexes":[1]},{"row":2,"col":0,"letter":"B","wordIndexes":[1,2]},{"row":3,"col":0,"letter":"E","wordIndexes":[1]},{"row":2,"col":1,"letter":"E","wordIndexes":[2]},{"row":2,"col":2,"letter":"E","wordIndexes":[2]},{"row":2,"col":3,"letter":"R","wordIndexes":[2]},{"row":5,"col":5,"letter":"R","wordIndexes":[3]},{"row":6,"col":5,"letter":"K","wordIndexes":[3]}],"words":[{"word":"REBEKAH","category":"Person","clue":"She gave water to Abraham’s servant and his camels.","reference":"Genesis 24:15–20","row":4,"col":0,"vertical":false},{"word":"HEBER","category":"Person","clue":"A Kenite whose wife was Jael.","reference":"Judges 4:17","row":0,"col":0,"vertical":true},{"word":"BEER","category":"Place","clue":"A place where Israel gathered for water.","reference":"Numbers 21:16","row":2,"col":0,"vertical":false},{"word":"ARK","category":"Object","clue":"The sacred chest carried by Israel.","reference":"Joshua 3:6","row":4,"col":5,"vertical":true}],"rows":7,"cols":7}},{"difficulty":"hard","level":9,"pack":{"id":"mordecai","title":"Esther: courage in exile","letters":"MORDECAI","words":[{"word":"MORDECAI","category":"Person","clue":"Esther’s cousin who raised her as his daughter.","reference":"Esther 2:7"},{"word":"MEDIA","category":"Place","clue":"A kingdom named alongside Persia.","reference":"Esther 1:3"},{"word":"ROME","category":"Place","clue":"Paul arrived here under guard.","reference":"Acts 28:16"},{"word":"DOR","category":"Place","clue":"A coastal town within Manasseh’s allotted territory.","reference":"Joshua 17:11"},{"word":"OMAR","category":"Person","clue":"A son of Eliphaz in Esau’s family.","reference":"Genesis 36:11"},{"word":"ROD","category":"Object","clue":"Moses carried this when God sent him to Egypt.","reference":"Exodus 4:17"}]},"board":{"cells":[{"row":2,"col":0,"letter":"M","wordIndexes":[0,1]},{"row":2,"col":1,"letter":"O","wordIndexes":[0]},{"row":2,"col":2,"letter":"R","wordIndexes":[0,2]},{"row":2,"col":3,"letter":"D","wordIndexes":[0,5]},{"row":2,"col":4,"letter":"E","wordIndexes":[0]},{"row":2,"col":5,"letter":"C","wordIndexes":[0]},{"row":2,"col":6,"letter":"A","wordIndexes":[0,3]},{"row":2,"col":7,"letter":"I","wordIndexes":[0]},{"row":3,"col":0,"letter":"E","wordIndexes":[1]},{"row":4,"col":0,"letter":"D","wordIndexes":[1]},{"row":5,"col":0,"letter":"I","wordIndexes":[1]},{"row":6,"col":0,"letter":"A","wordIndexes":[1]},{"row":3,"col":2,"letter":"O","wordIndexes":[2]},{"row":4,"col":2,"letter":"M","wordIndexes":[2]},{"row":5,"col":2,"letter":"E","wordIndexes":[2]},{"row":0,"col":6,"letter":"O","wordIndexes":[3,4]},{"row":1,"col":6,"letter":"M","wordIndexes":[3]},{"row":3,"col":6,"letter":"R","wordIndexes":[3]},{"row":0,"col":5,"letter":"D","wordIndexes":[4]},{"row":0,"col":7,"letter":"R","wordIndexes":[4]},{"row":0,"col":3,"letter":"R","wordIndexes":[5]},{"row":1,"col":3,"letter":"O","wordIndexes":[5]}],"words":[{"word":"MORDECAI","category":"Person","clue":"Esther’s cousin who raised her as his daughter.","reference":"Esther 2:7","row":2,"col":0,"vertical":false},{"word":"MEDIA","category":"Place","clue":"A kingdom named alongside Persia.","reference":"Esther 1:3","row":2,"col":0,"vertical":true},{"word":"ROME","category":"Place","clue":"Paul arrived here under guard.","reference":"Acts 28:16","row":2,"col":2,"vertical":true},{"word":"OMAR","category":"Person","clue":"A son of Eliphaz in Esau’s family.","reference":"Genesis 36:11","row":0,"col":6,"vertical":true},{"word":"DOR","category":"Place","clue":"A coastal town within Manasseh’s allotted territory.","reference":"Joshua 17:11","row":0,"col":5,"vertical":false},{"word":"ROD","category":"Object","clue":"Moses carried this when God sent him to Egypt.","reference":"Exodus 4:17","row":0,"col":3,"vertical":true}],"rows":7,"cols":8}},{"difficulty":"hard","level":10,"pack":{"id":"candlestick","title":"The sanctuary: light and service","letters":"CANDLESTICK","words":[{"word":"CANDLESTICK","category":"Object","clue":"The KJV name for the sanctuary’s golden lampstand.","reference":"Exodus 25:31"},{"word":"DANIEL","category":"Person","clue":"He continued praying even when a royal decree forbade it.","reference":"Daniel 6:10"},{"word":"CAIN","category":"Person","clue":"Adam and Eve’s son who killed Abel.","reference":"Genesis 4:1–8"},{"word":"NAILS","category":"Object","clue":"Thomas wanted to see the marks left by these.","reference":"John 20:25"},{"word":"STICK","category":"Object","clue":"Ezekiel joined two of these as a sign for Israel.","reference":"Ezekiel 37:16–17"},{"word":"TACKLE","category":"Object","clue":"The ship’s equipment thrown overboard during Paul’s storm.","reference":"Acts 27:19"},{"word":"DAN","category":"Person","clue":"A son of Jacob whose name means judgment.","reference":"Genesis 30:6"}]},"board":{"cells":[{"row":1,"col":1,"letter":"C","wordIndexes":[0]},{"row":1,"col":2,"letter":"A","wordIndexes":[0,1]},{"row":1,"col":3,"letter":"N","wordIndexes":[0]},{"row":1,"col":4,"letter":"D","wordIndexes":[0]},{"row":1,"col":5,"letter":"L","wordIndexes":[0]},{"row":1,"col":6,"letter":"E","wordIndexes":[0]},{"row":1,"col":7,"letter":"S","wordIndexes":[0]},{"row":1,"col":8,"letter":"T","wordIndexes":[0,2]},{"row":1,"col":9,"letter":"I","wordIndexes":[0]},{"row":1,"col":10,"letter":"C","wordIndexes":[0]},{"row":1,"col":11,"letter":"K","wordIndexes":[0]},{"row":0,"col":2,"letter":"D","wordIndexes":[1]},{"row":2,"col":2,"letter":"N","wordIndexes":[1]},{"row":3,"col":2,"letter":"I","wordIndexes":[1,5]},{"row":4,"col":2,"letter":"E","wordIndexes":[1]},{"row":5,"col":2,"letter":"L","wordIndexes":[1]},{"row":2,"col":8,"letter":"A","wordIndexes":[2]},{"row":3,"col":8,"letter":"C","wordIndexes":[2,4]},{"row":4,"col":8,"letter":"K","wordIndexes":[2]},{"row":5,"col":8,"letter":"L","wordIndexes":[2,3]},{"row":6,"col":8,"letter":"E","wordIndexes":[2]},{"row":5,"col":5,"letter":"N","wordIndexes":[3]},{"row":5,"col":6,"letter":"A","wordIndexes":[3]},{"row":5,"col":7,"letter":"I","wordIndexes":[3]},{"row":5,"col":9,"letter":"S","wordIndexes":[3]},{"row":3,"col":5,"letter":"S","wordIndexes":[4]},{"row":3,"col":6,"letter":"T","wordIndexes":[4]},{"row":3,"col":7,"letter":"I","wordIndexes":[4]},{"row":3,"col":9,"letter":"K","wordIndexes":[4]},{"row":3,"col":0,"letter":"C","wordIndexes":[5]},{"row":3,"col":1,"letter":"A","wordIndexes":[5]},{"row":3,"col":3,"letter":"N","wordIndexes":[5]}],"words":[{"word":"CANDLESTICK","category":"Object","clue":"The KJV name for the sanctuary’s golden lampstand.","reference":"Exodus 25:31","row":1,"col":1,"vertical":false},{"word":"DANIEL","category":"Person","clue":"He continued praying even when a royal decree forbade it.","reference":"Daniel 6:10","row":0,"col":2,"vertical":true},{"word":"TACKLE","category":"Object","clue":"The ship’s equipment thrown overboard during Paul’s storm.","reference":"Acts 27:19","row":1,"col":8,"vertical":true},{"word":"NAILS","category":"Object","clue":"Thomas wanted to see the marks left by these.","reference":"John 20:25","row":5,"col":5,"vertical":false},{"word":"STICK","category":"Object","clue":"Ezekiel joined two of these as a sign for Israel.","reference":"Ezekiel 37:16–17","row":3,"col":5,"vertical":false},{"word":"CAIN","category":"Person","clue":"Adam and Eve’s son who killed Abel.","reference":"Genesis 4:1–8","row":3,"col":0,"vertical":false}],"rows":7,"cols":12}},{"difficulty":"hard","level":11,"pack":{"id":"pharaoh","title":"Exodus: freedom and deliverance","letters":"PHARAOH","words":[{"word":"PHARAOH","category":"Person","clue":"The ruler who refused Moses’ request to let Israel go.","reference":"Exodus 5:1–2"},{"word":"HARP","category":"Object","clue":"David played this instrument for Saul.","reference":"1 Samuel 16:23"},{"word":"PARAH","category":"Place","clue":"A town included in Benjamin’s inheritance.","reference":"Joshua 18:23"}]},"board":{"cells":[{"row":0,"col":0,"letter":"P","wordIndexes":[0,1]},{"row":0,"col":1,"letter":"H","wordIndexes":[0]},{"row":0,"col":2,"letter":"A","wordIndexes":[0]},{"row":0,"col":3,"letter":"R","wordIndexes":[0]},{"row":0,"col":4,"letter":"A","wordIndexes":[0]},{"row":0,"col":5,"letter":"O","wordIndexes":[0]},{"row":0,"col":6,"letter":"H","wordIndexes":[0,2]},{"row":1,"col":0,"letter":"A","wordIndexes":[1]},{"row":2,"col":0,"letter":"R","wordIndexes":[1]},{"row":3,"col":0,"letter":"A","wordIndexes":[1]},{"row":4,"col":0,"letter":"H","wordIndexes":[1]},{"row":1,"col":6,"letter":"A","wordIndexes":[2]},{"row":2,"col":6,"letter":"R","wordIndexes":[2]},{"row":3,"col":6,"letter":"P","wordIndexes":[2]}],"words":[{"word":"PHARAOH","category":"Person","clue":"The ruler who refused Moses’ request to let Israel go.","reference":"Exodus 5:1–2","row":0,"col":0,"vertical":false},{"word":"PARAH","category":"Place","clue":"A town included in Benjamin’s inheritance.","reference":"Joshua 18:23","row":0,"col":0,"vertical":true},{"word":"HARP","category":"Object","clue":"David played this instrument for Saul.","reference":"1 Samuel 16:23","row":0,"col":6,"vertical":true}],"rows":5,"cols":7}}]$catalog$::jsonb);
INSERT INTO scripture_games.number_facts(number,meaning,reference) SELECT number,meaning,reference FROM jsonb_to_recordset($facts$[{"number": 1, "meaning": "The number of Gods proclaimed in Deuteronomy's confession", "reference": "Deuteronomy 6:4"}, {"number": 1, "meaning": "The number of faiths in Paul's 'one Lord, one faith' declaration", "reference": "Ephesians 4:5"}, {"number": 2, "meaning": "The stone tablets given to Moses", "reference": "Exodus 31:18"}, {"number": 2, "meaning": "The animals of each kind Noah was told to bring as a pair", "reference": "Genesis 6:19"}, {"number": 3, "meaning": "The days and nights Jonah spent inside the great fish", "reference": "Jonah 1:17"}, {"number": 3, "meaning": "The times Peter denied knowing Jesus", "reference": "Luke 22:61"}, {"number": 4, "meaning": "The rivers into which Eden's river divided", "reference": "Genesis 2:10"}, {"number": 4, "meaning": "The angels standing at the earth's corners", "reference": "Revelation 7:1"}, {"number": 5, "meaning": "The loaves used when Jesus fed the five thousand", "reference": "Matthew 14:17"}, {"number": 5, "meaning": "The wise virgins in Jesus' parable", "reference": "Matthew 25:2"}, {"number": 6, "meaning": "The stone water jars at the wedding in Cana", "reference": "John 2:6"}, {"number": 6, "meaning": "The days of work before the Sabbath rest", "reference": "Exodus 20:9\u201310"}, {"number": 7, "meaning": "The day on which God rested from creation", "reference": "Genesis 2:2"}, {"number": 7, "meaning": "The priests carrying trumpets around Jericho", "reference": "Joshua 6:4"}, {"number": 8, "meaning": "The people saved through the flood in Noah's ark", "reference": "1 Peter 3:20"}, {"number": 8, "meaning": "The day after birth when Jesus was circumcised", "reference": "Luke 2:21"}, {"number": 10, "meaning": "The commandments written on the covenant tablets", "reference": "Exodus 34:28"}, {"number": 10, "meaning": "The lepers who met Jesus and asked for mercy", "reference": "Luke 17:12\u201313"}, {"number": 12, "meaning": "The apostles Jesus called", "reference": "Matthew 10:2\u20134"}, {"number": 12, "meaning": "The baskets of leftovers after the five thousand were fed", "reference": "Matthew 14:20"}, {"number": 20, "meaning": "The pieces of silver paid when Joseph was sold", "reference": "Genesis 37:28"}, {"number": 20, "meaning": "The years Solomon spent building the temple and his palace", "reference": "1 Kings 9:10"}, {"number": 24, "meaning": "The elders seated around the heavenly throne", "reference": "Revelation 4:4"}, {"number": 24, "meaning": "The priestly division whose lot fell to Maaziah", "reference": "1 Chronicles 24:18"}, {"number": 30, "meaning": "The pieces of silver paid to Judas", "reference": "Matthew 26:15"}, {"number": 30, "meaning": "Jesus' approximate age when he began his ministry", "reference": "Luke 3:23"}, {"number": 40, "meaning": "The days and nights Jesus fasted in the wilderness", "reference": "Matthew 4:2"}, {"number": 40, "meaning": "The days and nights rain fell during Noah's flood", "reference": "Genesis 7:12"}, {"number": 50, "meaning": "The year proclaimed as the Jubilee", "reference": "Leviticus 25:10"}, {"number": 50, "meaning": "The days counted to the new-grain offering after the Sabbath", "reference": "Leviticus 23:16"}, {"number": 70, "meaning": "The elders Moses was told to gather", "reference": "Numbers 11:16"}, {"number": 70, "meaning": "The years of Babylonian rule foretold by Jeremiah", "reference": "Jeremiah 25:11"}, {"number": 100, "meaning": "Abraham's age when Isaac was born", "reference": "Genesis 21:5"}, {"number": 100, "meaning": "The sheep in the flock before one was lost in Jesus' parable", "reference": "Luke 15:4"}, {"number": 120, "meaning": "Moses' age when he died", "reference": "Deuteronomy 34:7"}, {"number": 120, "meaning": "The approximate number of believers gathered before Pentecost", "reference": "Acts 1:15"}, {"number": 153, "meaning": "The large fish counted in the disciples' net", "reference": "John 21:11"}, {"number": 300, "meaning": "The men God chose for Gideon's army", "reference": "Judges 7:7"}, {"number": 300, "meaning": "The length of Noah's ark in cubits", "reference": "Genesis 6:15"}]$facts$::jsonb) AS f(number int,meaning text,reference text);

ALTER TABLE public.arena_tournaments DROP CONSTRAINT arena_tournaments_game_type_check;
ALTER TABLE public.arena_tournaments ADD CONSTRAINT arena_tournaments_game_type_check CHECK(game_type IN ('standard','ludo','journey','prelude'));
CREATE OR REPLACE FUNCTION public.get_user_lifetime_figs(p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH quiz_attempt_figs AS (
    SELECT
      attempt.id,
      attempt.user_id,
      attempt.submitted_at,
      coalesce(
        attempt.talents_scored::numeric,
        sum(
          CASE
            WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
              AND NOT coalesce(response.assisted_by_relic, false)
            THEN CASE
              WHEN question.difficulty_tag = 'hard' THEN 5
              WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
              ELSE 1
            END
            ELSE 0
          END
        )::numeric,
        0
      ) AS figs
    FROM public.quiz_attempts attempt
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
    LEFT JOIN public.generated_questions question
      ON question.id = response.question_id
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (p_before IS NULL OR attempt.submitted_at < p_before)
    GROUP BY attempt.id, attempt.user_id, attempt.submitted_at, attempt.talents_scored
  ), fig_sources AS (
    SELECT coalesce(sum(attempt.score), 0)::numeric AS figs
    FROM public.game_attempts attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
      AND (p_before IS NULL OR attempt.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(participant.score), 0)::numeric
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.user_id = p_user_id
      AND participant.finished_at IS NOT NULL
      AND room.status = 'completed'
      AND (p_before IS NULL OR participant.finished_at < p_before)
      AND (p_before IS NULL OR room.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(quiz.figs), 0)::numeric
    FROM quiz_attempt_figs quiz

    UNION ALL

    SELECT coalesce(sum(story.figs), 0)::numeric
    FROM public.story_mode_fig_entries story
    WHERE story.user_id = p_user_id
      AND (p_before IS NULL OR story.earned_at < p_before)

    UNION ALL

    SELECT coalesce(sum(adjustment.amount), 0)::numeric
    FROM public.account_fig_adjustments adjustment
    WHERE adjustment.user_id = p_user_id
      AND (p_before IS NULL OR adjustment.effective_at < p_before)
    UNION ALL
    SELECT coalesce(sum(entry.amount),0)::numeric
    FROM scripture_games.fig_entries entry WHERE entry.user_id=p_user_id
      AND (p_before IS NULL OR entry.earned_at<p_before)
  )
  SELECT coalesce(sum(source.figs), 0)::numeric
  FROM fig_sources source;
$function$;

CREATE OR REPLACE FUNCTION public.create_instructor_arena_tournament_lineups(p_title text, p_game_type text, p_player_ids uuid[], p_game_times timestamp with time zone[], p_has_group_stage boolean, p_game_players jsonb, p_bracket_size integer, p_journey_character_slug text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
  v_group_count integer := 0;
  v_group integer;
  v_pair integer;
  v_choices jsonb;
  v_group_end timestamptz;
  v_expected_games integer;
  v_round integer;
  v_round_count integer;
  v_match_count integer;
  v_offset integer := 0;
  v_slot integer;
  v_index integer;
  v_left_source uuid;
  v_right_source uuid;
  v_left_time timestamptz;
  v_right_time timestamptz;
  v_game_id uuid;
  v_tournament_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id = auth.uid() AND assignment.role = 'instructor'
      AND assignment.status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'Only the instructor can schedule a tournament.'; END IF;
  IF p_game_type IS NULL OR p_game_type NOT IN ('standard', 'ludo', 'journey', 'prelude') THEN RAISE EXCEPTION 'Choose an Arena game.'; END IF;
  IF char_length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 50 THEN
    RAISE EXCEPTION 'Give the tournament a name of 3 to 50 characters.';
  END IF;
  IF p_game_type = 'journey' THEN
    IF p_title ~* '\[(arena|character):' THEN
      RAISE EXCEPTION 'Choose a tournament name without game tags.';
    END IF;
    PERFORM 1 FROM public.arena_journey_characters
    WHERE slug = p_journey_character_slug AND ready FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose a playable Journey narrative.'; END IF;
  ELSIF p_journey_character_slug IS NOT NULL THEN
    RAISE EXCEPTION 'A Journey narrative is only used for Journey Trivia.';
  END IF;
  v_count := coalesce(cardinality(p_player_ids), 0);
  IF p_has_group_stage IS NULL OR
    p_bracket_size IS NULL OR
    (p_has_group_stage AND (p_bracket_size NOT IN (8, 16, 32) OR v_count <> p_bracket_size)) OR
    (NOT p_has_group_stage AND (p_bracket_size NOT IN (2, 4, 8, 16)
      OR v_count < p_bracket_size OR v_count > 4 * (p_bracket_size - 1))) THEN
    RAISE EXCEPTION 'Choose a supported tournament start and number of players.';
  END IF;
  IF p_has_group_stage THEN
    v_group_count := p_bracket_size / 4;
    v_round_count := CASE p_bracket_size WHEN 8 THEN 2 WHEN 16 THEN 3 ELSE 4 END;
    v_expected_games := v_group_count * 6 + (p_bracket_size / 2 - 1);
  ELSE
    v_round_count := CASE p_bracket_size WHEN 2 THEN 1 WHEN 4 THEN 2 WHEN 8 THEN 3 ELSE 4 END;
    v_expected_games := p_bracket_size - 1;
  END IF;
  IF jsonb_typeof(p_game_players) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_game_players) <> v_expected_games THEN
    RAISE EXCEPTION 'Choose the participants for each match.';
  END IF;
  FOR v_choices IN SELECT value FROM jsonb_array_elements(p_game_players) LOOP
    IF jsonb_typeof(v_choices) IS DISTINCT FROM 'array' OR jsonb_array_length(v_choices) NOT BETWEEN 2 AND 4 THEN
      RAISE EXCEPTION 'Choose 2 to 4 player slots for every match.';
    END IF;
  END LOOP;
  IF coalesce(cardinality(p_game_times), 0) <> v_expected_games THEN
    RAISE EXCEPTION 'Provide one schedule entry per tournament match; use null for games to schedule later.';
  END IF;
  IF (SELECT count(DISTINCT chosen.id) FROM unnest(p_player_ids) chosen(id)) <> v_count THEN
    RAISE EXCEPTION 'Select each player only once.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_player_ids) chosen(id) WHERE chosen.id IS NULL OR NOT (
      EXISTS (SELECT 1 FROM public.role_assignments assignment
        WHERE assignment.user_id = chosen.id AND assignment.role IN ('cadet', 'sentry')
          AND assignment.status IN ('active', 'approved'))
      OR EXISTS (SELECT 1 FROM public.tents tent WHERE tent.sentry_id = chosen.id)
      OR EXISTS (SELECT 1 FROM public.tent_members member WHERE member.user_id = chosen.id
        AND member.role IN ('cadet', 'sentry'))
    )
  ) THEN RAISE EXCEPTION 'Every entrant must be an active cadet or sentry.'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_game_times) planned(at_time)
    WHERE planned.at_time IS NOT NULL AND (NOT isfinite(planned.at_time)
      OR planned.at_time < now() + interval '2 minutes'
      OR planned.at_time > now() + interval '90 days')
  ) THEN RAISE EXCEPTION 'Schedule selected games between two minutes and 90 days from now.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM unnest(p_game_times) planned(at_time) WHERE at_time IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose a date and time for at least one selected game.';
  END IF;

  INSERT INTO public.arena_tournaments(title, created_by, game_type, player_ids, has_group_stage, knockout_rounds, journey_character_slug)
  VALUES (btrim(p_title), auth.uid(), p_game_type, p_player_ids, p_has_group_stage, v_round_count, p_journey_character_slug)
  RETURNING id INTO v_tournament_id;

  IF p_has_group_stage THEN
    FOR v_group IN 1..v_group_count LOOP
      FOR v_pair IN 1..6 LOOP
        v_index := (v_group - 1) * 6 + v_pair;
        v_choices := p_game_players->(v_index - 1);
        INSERT INTO public.arena_tournament_games (
          tournament_id, round_number, match_number, group_number, planned_at,
          left_player_id, right_player_id, third_player_id, fourth_player_id
        ) VALUES (
          v_tournament_id, 0, v_index, v_group, p_game_times[v_index],
          (v_choices->>0)::uuid, (v_choices->>1)::uuid, (v_choices->>2)::uuid, (v_choices->>3)::uuid
        ) RETURNING id INTO v_game_id;
      END LOOP;
    END LOOP;
    v_offset := v_group_count * 6;
    SELECT max(scheduled.at_time) INTO v_group_end
    FROM unnest(p_game_times[1:v_offset]) scheduled(at_time);
  END IF;
  v_match_count := CASE WHEN p_has_group_stage THEN p_bracket_size / 4 ELSE p_bracket_size / 2 END;
  FOR v_round IN 1..v_round_count LOOP
    FOR v_slot IN 1..v_match_count LOOP
      v_index := v_offset + v_slot;
      v_left_source := NULL;
      v_right_source := NULL;
      IF v_round = 1 AND p_has_group_stage AND
        p_game_times[v_index] < v_group_end + interval '20 minutes' THEN
        RAISE EXCEPTION 'Allow at least 20 minutes after the group stage for knockout matches.';
      END IF;
      IF v_round > 1 THEN
        SELECT id, planned_at INTO v_left_source, v_left_time
        FROM public.arena_tournament_games
        WHERE tournament_id = v_tournament_id AND round_number = v_round - 1
          AND match_number = v_slot * 2 - 1;
        SELECT id, planned_at INTO v_right_source, v_right_time
        FROM public.arena_tournament_games
        WHERE tournament_id = v_tournament_id AND round_number = v_round - 1
          AND match_number = v_slot * 2;
        IF p_game_times[v_index] < greatest(v_left_time, v_right_time) + interval '20 minutes' THEN
          RAISE EXCEPTION 'Allow at least 20 minutes after both preceding games for the next round.';
        END IF;
      END IF;
      v_choices := p_game_players->(v_index - 1);
      INSERT INTO public.arena_tournament_games (
        tournament_id, round_number, match_number, planned_at,
        left_player_id, right_player_id, left_source_id, right_source_id, left_override_id, right_override_id, third_player_id, fourth_player_id
      ) VALUES (
        v_tournament_id, v_round, v_slot, p_game_times[v_index],
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN (v_choices->>0)::uuid ELSE NULL END,
        CASE WHEN v_round = 1 AND NOT p_has_group_stage THEN (v_choices->>1)::uuid ELSE NULL END,
        v_left_source, v_right_source,
        CASE WHEN v_round > 1 OR p_has_group_stage THEN (v_choices->>0)::uuid ELSE NULL END,
        CASE WHEN v_round > 1 OR p_has_group_stage THEN (v_choices->>1)::uuid ELSE NULL END,
        (v_choices->>2)::uuid, (v_choices->>3)::uuid
      ) RETURNING id INTO v_game_id;
    END LOOP;
    v_offset := v_offset + v_match_count;
    v_match_count := v_match_count / 2;
  END LOOP;
  IF NOT public.arena_tournament_times_valid(v_tournament_id) THEN
    RAISE EXCEPTION 'Allow at least 20 minutes after preceding scheduled games.';
  END IF;
  IF public.arena_tournament_lineup_issue(v_tournament_id) IS NOT NULL THEN
    RAISE EXCEPTION '%', public.arena_tournament_lineup_issue(v_tournament_id);
  END IF;
  FOR v_game_id IN SELECT id FROM public.arena_tournament_games
    WHERE tournament_id = v_tournament_id AND round_number = CASE WHEN p_has_group_stage THEN 0 ELSE 1 END
    ORDER BY match_number LOOP
    PERFORM public.create_arena_tournament_room(v_game_id);
  END LOOP;
  RETURN v_tournament_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_scheduled_arena_series()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_round public.arena_match_series_rounds%ROWTYPE;
  v_series public.arena_match_series%ROWTYPE;
  v_count integer;
  v_next_number integer;
  v_next_room uuid;
  v_top uuid;
  v_top_score integer;
  v_ties integer;
  v_base_name text;
  v_name text;
  v_game_type text;
  v_character_suffix text;
BEGIN
  IF NEW.room_name ILIKE '%[arena:prelude]%' THEN RETURN NEW; END IF;
  IF NEW.status = 'playing' AND OLD.status = 'waiting' THEN
    SELECT round.* INTO v_round
    FROM public.arena_match_series_rounds round WHERE round.room_id = NEW.id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants participant
      WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL;
    IF v_count BETWEEN 2 AND 4 THEN
      UPDATE public.arena_match_series series
      SET player_ids = (SELECT array_agg(participant.user_id ORDER BY participant.joined_at)
        FROM public.arena_participants participant
        WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL),
        required_rounds = CASE WHEN v_count = 4 THEN 3 ELSE 2 END
      WHERE series.id = v_round.series_id AND v_round.round_number = 1;
    END IF;
    SELECT * INTO v_series FROM public.arena_match_series WHERE id = v_round.series_id;
    IF v_round.round_number <= v_series.required_rounds THEN
      v_base_name := regexp_replace(NEW.room_name,
        '\s*\(Round [0-9]+ of [0-9]+\)|\s*\(Rematch [0-9]+\)', '', 'gi');
      v_game_type := CASE WHEN v_base_name ILIKE '%[arena:journey]%' THEN 'journey'
        WHEN v_base_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END;
      v_character_suffix := CASE WHEN v_game_type = 'journey' THEN
        ' [character:' || substring(v_base_name FROM '\[character:([a-z0-9-]+)\]') || ']' ELSE '' END;
      v_base_name := regexp_replace(v_base_name, '\s*\[(arena:(standard|ludo|journey)|character:[a-z0-9-]+)\]', '', 'gi');
      NEW.room_name := left(v_base_name, 60) || ' (Round ' || v_round.round_number ||
        ' of ' || v_series.required_rounds || ') [arena:' || v_game_type || ']' || v_character_suffix;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' OR OLD.status <> 'playing' THEN RETURN NEW; END IF;
  SELECT round.* INTO v_round
  FROM public.arena_match_series_rounds round WHERE round.room_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO v_series FROM public.arena_match_series
    WHERE id = v_round.series_id FOR UPDATE;
  IF v_series.completed_at IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.arena_match_series_scores(room_id, user_id, correct_count, score)
  SELECT NEW.id, participant.user_id,
    greatest(coalesce(participant.correct_count, 0), 0),
    greatest(coalesce(participant.score, 0), 0)
  FROM public.arena_participants participant WHERE participant.room_id = NEW.id
  ON CONFLICT (room_id, user_id) DO NOTHING;
  UPDATE public.arena_match_series_rounds
  SET leg_winner_id = NEW.winner_id, completed_at = now()
  WHERE room_id = NEW.id;

  IF NEW.completion_reason = 'forfeit' THEN
    UPDATE public.arena_match_series
    SET winner_id = NEW.winner_id, completed_at = now() WHERE id = v_series.id;
    PERFORM public.set_arena_series_final_totals(v_series.id, NEW.id);
    RETURN NEW;
  END IF;

  IF v_round.round_number >= v_series.required_rounds THEN
    SELECT summed.user_id, summed.total INTO v_top, v_top_score
    FROM (
      SELECT score.user_id, sum(score.correct_count)::integer AS total
      FROM public.arena_match_series_scores score
      JOIN public.arena_match_series_rounds round ON round.room_id = score.room_id
      WHERE round.series_id = v_series.id
      GROUP BY score.user_id
    ) summed
    ORDER BY summed.total DESC, summed.user_id LIMIT 1;
    SELECT count(*) INTO v_ties FROM (
      SELECT score.user_id
      FROM public.arena_match_series_scores score
      JOIN public.arena_match_series_rounds round ON round.room_id = score.room_id
      WHERE round.series_id = v_series.id
      GROUP BY score.user_id HAVING sum(score.correct_count) = v_top_score
    ) tied;
    IF v_ties = 1 THEN
      NEW.winner_id := v_top;
      UPDATE public.arena_match_series
      SET winner_id = v_top, completed_at = now() WHERE id = v_series.id;
      PERFORM public.set_arena_series_final_totals(v_series.id, NEW.id);
      RETURN NEW;
    END IF;
  END IF;

  v_next_number := v_round.round_number + 1;
  v_game_type := CASE WHEN OLD.room_name ILIKE '%[arena:journey]%' THEN 'journey'
    WHEN OLD.room_name ILIKE '%[arena:ludo]%' THEN 'ludo' ELSE 'standard' END;
  v_character_suffix := CASE WHEN v_game_type = 'journey' THEN
    ' [character:' || substring(OLD.room_name FROM '\[character:([a-z0-9-]+)\]') || ']' ELSE '' END;
  v_base_name := regexp_replace(OLD.room_name,
    '\s*\(Round [0-9]+ of [0-9]+\)|\s*\(Rematch [0-9]+\)', '', 'gi');
  v_base_name := regexp_replace(v_base_name, '\s*\[(arena:(standard|ludo|journey)|character:[a-z0-9-]+)\]', '', 'gi');
  v_name := left(v_base_name, 60) || CASE
    WHEN v_next_number > v_series.required_rounds THEN
      ' (Rematch ' || (v_next_number - v_series.required_rounds) || ')'
    ELSE ' (Round ' || v_next_number || ' of ' || v_series.required_rounds || ')'
  END || ' [arena:' || v_game_type || ']' || v_character_suffix;
  INSERT INTO public.arena_rooms (
    creator_id, room_name, stake_amount, max_players, status,
    tagged_user_ids, game_call_fee, narrative_date, game_type
  ) VALUES (
    OLD.creator_id, v_name, 0, cardinality(v_series.player_ids), 'waiting',
    v_series.player_ids, 0, OLD.narrative_date, OLD.game_type
  ) RETURNING id INTO v_next_room;
  INSERT INTO public.arena_match_series_rounds(room_id, series_id, round_number)
  VALUES (v_next_room, v_series.id, v_next_number);
  UPDATE public.arena_match_series SET current_room_id = v_next_room WHERE id = v_series.id;
  UPDATE public.arena_tournament_games SET room_id = v_next_room WHERE room_id = OLD.id;

  FOREACH v_top IN ARRAY v_series.player_ids LOOP
    INSERT INTO public.arena_participants(room_id, user_id, stake_paid)
    VALUES (v_next_room, v_top, true);
  END LOOP;
  INSERT INTO public.arena_viewers(room_id, user_id, joined_at, last_seen_at)
  SELECT v_next_room, viewer.user_id, viewer.joined_at, now()
  FROM public.arena_viewers viewer
  WHERE viewer.room_id = OLD.id AND viewer.last_seen_at > now() - interval '2 minutes'
  ON CONFLICT (room_id, user_id) DO NOTHING;
  INSERT INTO public.arena_guest_witnesses(room_id, guest_key_hash, last_seen_at)
  SELECT v_next_room, guest.guest_key_hash, now()
  FROM public.arena_guest_witnesses guest
  WHERE guest.room_id = OLD.id AND guest.last_seen_at > now() - interval '2 minutes'
  ON CONFLICT (room_id, guest_key_hash) DO NOTHING;

  UPDATE public.arena_rooms SET status = 'playing', started_at = now()
  WHERE id = v_next_room;
  INSERT INTO public.arena_scheduled_matches(room_id, scheduled_by, starts_at, player_ids)
  VALUES (v_next_room, v_series.scheduled_by, now(), v_series.player_ids);
  NEW.winner_id := NULL;
  NEW.restarted_as_room_id := v_next_room;
  NEW.completion_reason := CASE WHEN v_round.round_number >= v_series.required_rounds
    THEN 'draw' ELSE 'round' END;
  FOREACH v_top IN ARRAY v_series.player_ids LOOP
    PERFORM public.notify_user(v_top, v_series.scheduled_by, 'arena',
      CASE WHEN NEW.completion_reason = 'draw' THEN 'Arena rematch' ELSE 'Next Arena round' END,
      'Your match continues in ' || v_name || '.', 'arena',
      jsonb_build_object('room_id', v_next_room, 'previous_room_id', OLD.id));
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_instructor_arena_match_awards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_schedule public.arena_scheduled_matches%ROWTYPE;
  v_game public.arena_tournament_games%ROWTYPE;
  v_tournament public.arena_tournaments%ROWTYPE;
  v_next public.arena_tournament_games%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_house_id text;
  v_total integer;
  v_recipient record;
  v_match_name text;
  v_group integer;
  v_qualifiers uuid[];
  v_first_match integer;
  v_second_match integer;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO v_schedule FROM public.arena_scheduled_matches WHERE room_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.status = 'playing' AND OLD.status = 'waiting' THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    SELECT participant.user_id, 1000, 'arena_reward', 'scheduled:play:' || NEW.id::text,
      'Instructor scheduled match participation: ' || NEW.room_name
    FROM public.arena_participants participant
    WHERE participant.room_id = NEW.id AND participant.forfeited_at IS NULL
      AND participant.user_id = ANY(v_schedule.player_ids)
      AND NEW.room_name NOT ILIKE '%[arena:prelude]%'
    ON CONFLICT DO NOTHING;
    UPDATE public.arena_tournaments SET status = 'playing'
    WHERE id = (SELECT game.tournament_id FROM public.arena_tournament_games game WHERE game.room_id = NEW.id)
      AND status = 'scheduled';
  END IF;

  IF NEW.status <> 'completed' OR OLD.status <> 'playing' THEN RETURN NEW; END IF;
  SELECT * INTO v_game FROM public.arena_tournament_games WHERE room_id = NEW.id;
  IF FOUND THEN
    SELECT * INTO v_tournament FROM public.arena_tournaments WHERE id = v_game.tournament_id FOR UPDATE;
  END IF;
  IF NEW.winner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = NEW.id AND participant.user_id = NEW.winner_id
      AND NEW.winner_id = ANY(v_schedule.player_ids)
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
  VALUES (NEW.winner_id, CASE WHEN NEW.room_name ILIKE '%[arena:prelude]%' THEN 1000 ELSE 5000 END, 'arena_reward', 'scheduled:win:' || NEW.id::text,
    'Instructor scheduled match winner: ' || NEW.room_name)
  ON CONFLICT DO NOTHING;
  v_total := CASE WHEN NEW.room_name ILIKE '%[arena:prelude]%' THEN 1000 ELSE 6000 END;

  IF v_game.id IS NOT NULL THEN
    UPDATE public.arena_tournament_games SET winner_id = NEW.winner_id WHERE id = v_game.id;
    IF v_game.round_number = 0 THEN
      v_group := v_game.group_number;
      IF NOT EXISTS (
        SELECT 1 FROM public.arena_tournament_games game
        WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group
          AND game.winner_id IS NULL
      ) THEN
        SELECT array_agg(standing.id ORDER BY standing.wins DESC,
          standing.answers DESC, standing.points DESC, standing.seed)
        INTO v_qualifiers
        FROM (
          SELECT selected.id, selected.seed,
            (SELECT count(*) FROM public.arena_tournament_games game
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group
                AND game.winner_id = selected.id) AS wins,
            (SELECT coalesce(sum(participant.correct_count), 0)
              FROM public.arena_tournament_games game
              JOIN public.arena_participants participant
                ON participant.room_id = game.room_id AND participant.user_id = selected.id
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group) AS answers,
            (SELECT coalesce(sum(participant.score), 0)
              FROM public.arena_tournament_games game
              JOIN public.arena_participants participant
                ON participant.room_id = game.room_id AND participant.user_id = selected.id
              WHERE game.tournament_id = v_tournament.id AND game.group_number = v_group) AS points
          FROM unnest(v_tournament.player_ids) WITH ORDINALITY selected(id, seed)
          WHERE selected.seed BETWEEN (v_group - 1) * 4 + 1 AND v_group * 4
          ORDER BY wins DESC, answers DESC, points DESC, selected.seed
          LIMIT 2
        ) standing;
        v_first_match := ((v_group - 1) / 2) * 2 + 1;
        v_second_match := v_first_match + 1;
        IF v_group % 2 = 1 THEN
          UPDATE public.arena_tournament_games SET left_player_id = v_qualifiers[1]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_first_match;
          UPDATE public.arena_tournament_games SET right_player_id = v_qualifiers[2]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_second_match;
        ELSE
          UPDATE public.arena_tournament_games SET right_player_id = v_qualifiers[2]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_first_match;
          UPDATE public.arena_tournament_games SET left_player_id = v_qualifiers[1]
          WHERE tournament_id = v_tournament.id AND round_number = 1 AND match_number = v_second_match;
        END IF;
        FOR v_next IN SELECT * FROM public.arena_tournament_games game
          WHERE game.tournament_id = v_tournament.id AND game.round_number = 1
            AND game.match_number IN (v_first_match, v_second_match)
        LOOP
          IF v_next.left_player_id IS NOT NULL AND v_next.right_player_id IS NOT NULL
            AND v_next.room_id IS NULL THEN
            PERFORM public.create_arena_tournament_room(v_next.id);
          END IF;
        END LOOP;
      END IF;
    ELSIF v_game.round_number = v_tournament.knockout_rounds THEN
      INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
      VALUES (NEW.winner_id, 25000, 'arena_reward', 'scheduled:champion:' || v_tournament.id::text,
        'Arena tournament champion: ' || v_tournament.title)
      ON CONFLICT DO NOTHING;
      v_total := CASE WHEN NEW.room_name ILIKE '%[arena:prelude]%' THEN 26000 ELSE 31000 END;
      UPDATE public.arena_tournaments
      SET status = 'completed', champion_id = NEW.winner_id, completed_at = now()
      WHERE id = v_tournament.id;
    ELSE
      SELECT * INTO v_next FROM public.arena_tournament_games
      WHERE left_source_id = v_game.id OR right_source_id = v_game.id FOR UPDATE;
      IF FOUND THEN
        IF v_next.left_source_id = v_game.id THEN
          UPDATE public.arena_tournament_games SET left_player_id = NEW.winner_id WHERE id = v_next.id;
        ELSE
          UPDATE public.arena_tournament_games SET right_player_id = NEW.winner_id WHERE id = v_next.id;
        END IF;
        SELECT * INTO v_next FROM public.arena_tournament_games WHERE id = v_next.id;
        IF v_next.left_player_id IS NOT NULL AND v_next.right_player_id IS NOT NULL AND v_next.room_id IS NULL THEN
          PERFORM public.create_arena_tournament_room(v_next.id);
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.winner_id;
  SELECT tent.tent_house_id INTO v_house_id FROM public.tents tent
  WHERE tent.sentry_id = NEW.winner_id OR EXISTS (
    SELECT 1 FROM public.tent_members member WHERE member.tent_id = tent.id AND member.user_id = NEW.winner_id
  ) ORDER BY CASE WHEN tent.sentry_id = NEW.winner_id THEN 0 ELSE 1 END LIMIT 1;
  v_match_name := regexp_replace(NEW.room_name, '\s*\[arena:(standard|ludo)\]', '', 'gi');
  FOR v_recipient IN SELECT id FROM public.profiles LOOP
    PERFORM public.notify_user(v_recipient.id, NEW.winner_id, 'arena_scheduled_result',
      CASE WHEN v_total = 31000 THEN 'Tournament champion' ELSE 'Scheduled match result' END,
      coalesce(v_profile.display_name, 'A player') || ' won ' || v_total::text ||
        ' Denarii in ' || v_match_name || '.',
      'arena', jsonb_build_object(
        'room_id', NEW.id, 'tournament_id', v_game.tournament_id,
        'winner_id', NEW.winner_id, 'winner_name', v_profile.display_name,
        'winner_avatar_url', v_profile.avatar_url, 'winner_tent_house_id', v_house_id,
        'winner_amount', v_total));
  END LOOP;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.register_scheduled_arena_series()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_series_id uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = NEW.room_id;
  IF v_room.room_name ILIKE '%[arena:prelude]%' THEN RETURN NEW; END IF;
  v_count := cardinality(NEW.player_ids);
  IF v_room.status <> 'waiting' OR v_room.play_mode = 'machine'
    OR v_count NOT BETWEEN 2 AND 4 THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.arena_match_series (
    initial_room_id, current_room_id, scheduled_by, player_ids, required_rounds
  ) VALUES (
    NEW.room_id, NEW.room_id, NEW.scheduled_by, NEW.player_ids,
    CASE WHEN v_count = 4 THEN 3 ELSE 2 END
  ) ON CONFLICT (initial_room_id) DO NOTHING
  RETURNING id INTO v_series_id;
  IF v_series_id IS NOT NULL THEN
    INSERT INTO public.arena_match_series_rounds(room_id, series_id, round_number)
    VALUES (NEW.room_id, v_series_id, 1);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_orphaned_arena_matches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_room record;
  v_remaining integer;
  v_unfinished integer;
  v_total integer;
  v_has_forfeit boolean;
  v_winner uuid;
  v_winner_name text;
  v_total_stake integer;
  v_repaired integer := 0;
  v_participant record;
BEGIN
  PERFORM public.expire_inactive_arena_participants();

  FOR v_room IN
    SELECT room.*
    FROM public.arena_rooms room
    WHERE room.status = 'playing'
      AND room.room_name NOT ILIKE '%[arena:prelude]%'
      AND room.started_at IS NOT NULL
      AND room.completed_at IS NULL
    ORDER BY room.started_at
  LOOP
    SELECT
      count(*) FILTER (WHERE participant.forfeited_at IS NULL),
      count(*) FILTER (WHERE participant.forfeited_at IS NULL AND participant.finished_at IS NULL),
      count(*),
      COALESCE(bool_or(participant.forfeited_at IS NOT NULL), false)
    INTO v_remaining, v_unfinished, v_total, v_has_forfeit
    FROM public.arena_participants participant
    WHERE participant.room_id = v_room.id;

    IF v_room.room_name NOT ILIKE '%[arena:ludo]%'
      AND v_has_forfeit
      AND v_remaining <= 1
    THEN
      PERFORM public.settle_standard_arena_forfeit(v_room.id);
      IF EXISTS (
        SELECT 1 FROM public.arena_rooms settled
        WHERE settled.id = v_room.id AND settled.status = 'completed'
      ) THEN
        v_repaired := v_repaired + 1;
      END IF;
      CONTINUE;
    END IF;

    IF (v_has_forfeit AND v_remaining <= 1) OR (v_total > 0 AND v_unfinished = 0) THEN
      SELECT participant.user_id
      INTO v_winner
      FROM public.arena_participants participant
      WHERE participant.room_id = v_room.id
        AND participant.forfeited_at IS NULL
      ORDER BY participant.score DESC, participant.correct_count DESC,
        participant.finished_at NULLS LAST, participant.joined_at
      LIMIT 1;

      IF v_room.play_mode = 'machine' THEN v_winner := NULL; END IF;
      v_total_stake := COALESCE(v_room.stake_amount, 0) * GREATEST(v_total, 1) * 10;

      IF v_winner IS NOT NULL AND v_total_stake > 0 AND NOT EXISTS (
        SELECT 1 FROM public.denarii_ledger_entries entry
        WHERE entry.source_type = 'arena_reward'
          AND entry.source_reference = v_room.id::text
      ) THEN
        INSERT INTO public.denarii_ledger_entries (
          user_id, amount, source_type, source_reference, description
        ) VALUES (
          v_winner, v_total_stake, 'arena_reward', v_room.id::text,
          'Arena tenfold winner reward after forfeiture for ' || v_room.room_name
        );
      END IF;

      UPDATE public.arena_rooms
      SET status = 'completed',
          winner_id = v_winner,
          completed_at = now(),
          completion_reason = CASE WHEN v_has_forfeit THEN 'forfeit' ELSE 'finished' END
      WHERE id = v_room.id
        AND status = 'playing';

      IF FOUND THEN
        v_repaired := v_repaired + 1;
        SELECT profile.display_name INTO v_winner_name
        FROM public.profiles profile
        WHERE profile.id = v_winner;

        FOR v_participant IN
          SELECT participant.user_id
          FROM public.arena_participants participant
          WHERE participant.room_id = v_room.id
        LOOP
          IF NOT EXISTS (
            SELECT 1
            FROM public.user_notifications notification
            WHERE notification.recipient_id = v_participant.user_id
              AND notification.notification_type = 'arena'
              AND notification.action_key = 'arena'
              AND notification.metadata ->> 'room_id' = v_room.id::text
              AND notification.metadata ->> 'repair' = 'orphaned_match'
          ) THEN
            PERFORM public.notify_user(
              v_participant.user_id,
              v_winner,
              'arena',
              CASE WHEN v_participant.user_id = v_winner THEN 'You won the Arena' ELSE 'Arena match ended' END,
              CASE
                WHEN v_winner IS NULL THEN 'The abandoned match "' || v_room.room_name || '" has been closed.'
                WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
                ELSE COALESCE(v_winner_name, 'The remaining player') || ' won "' || v_room.room_name || '".'
              END,
              'arena',
              jsonb_build_object(
                'room_id', v_room.id,
                'status', 'completed',
                'winner_id', v_winner,
                'completion_reason', CASE WHEN v_has_forfeit THEN 'forfeit' ELSE 'finished' END,
                'repair', 'orphaned_match'
              )
            );
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.arena_viewers viewer
  USING public.arena_rooms room
  WHERE room.id = viewer.room_id
    AND (room.status NOT IN ('waiting', 'playing')
      OR room.completed_at IS NOT NULL
      OR (room.status = 'playing' AND room.started_at IS NULL));

  RETURN v_repaired;
END;
$function$;


CREATE OR REPLACE FUNCTION public.expire_inactive_arena_participants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_room record;
BEGIN
  WITH expired AS (
    UPDATE public.arena_participants participant
    SET forfeited_at = now(), forfeit_reason = 'inactive', finished_at = COALESCE(finished_at, now())
    FROM public.arena_rooms room
    WHERE participant.room_id = room.id
      AND room.status = 'playing'
      AND room.room_name NOT ILIKE '%[arena:prelude]%'
      AND participant.forfeited_at IS NULL
      AND participant.finished_at IS NULL
      AND participant.last_active_at < now() - interval '3 minutes'
    RETURNING participant.room_id
  )
  SELECT count(*) INTO v_count FROM expired;

  FOR v_room IN
    SELECT DISTINCT participant.room_id
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE room.status = 'playing' AND room.room_name NOT ILIKE '%[arena:prelude]%' AND participant.forfeited_at IS NOT NULL
  LOOP
    PERFORM public.settle_standard_arena_forfeit(v_room.room_id);
  END LOOP;
  RETURN v_count;
END;
$$;

