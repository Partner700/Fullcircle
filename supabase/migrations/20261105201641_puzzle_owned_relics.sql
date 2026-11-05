-- Enable the owned puzzle-compatible relics, including Sword and Talking Donkey.
CREATE OR REPLACE FUNCTION public.puzzle_trivia_command(p_action text,p_run_id uuid DEFAULT NULL,p_difficulty text DEFAULT 'easy',p_level int DEFAULT 0,p_word text DEFAULT NULL,p_target int DEFAULT 0,p_relic text DEFAULT NULL)
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
  IF p_relic IS NULL OR p_relic NOT IN ('hint','eliminate','freeze-timer','skip','reveal-reference','witch-ball-endor','talking-donkey','sword-goliath') THEN RAISE EXCEPTION 'Choose a puzzle relic.'; END IF;
  IF aid->'used' ? p_relic THEN RETURN scripture_games.puzzle_view(r.id); END IF;
  IF p_relic<>'reveal-reference' AND (r.completed_at IS NOT NULL OR r.deadline<=clock_timestamp()) THEN RAISE EXCEPTION 'This puzzle is no longer active.'; END IF;
  IF p_relic='freeze-timer' AND EXISTS(SELECT 1 FROM jsonb_each(r.aids) e WHERE e.value->'used' ? 'freeze-timer') THEN RAISE EXCEPTION 'Freeze Timer was already used in this round.'; END IF;
  IF word=ANY(r.found) AND p_relic NOT IN ('reveal-reference','freeze-timer','sword-goliath') THEN RAISE EXCEPTION 'This word is already found.'; END IF;
  IF p_relic='talking-donkey' AND nullif(trim(p_word),'') IS NULL THEN RAISE EXCEPTION 'Connect letters before using the Talking Donkey.'; END IF;
  PERFORM scripture_games.consume_relic(uid,p_relic,'puzzle:'||r.id);
  aid:=aid||jsonb_build_object('used',(aid->'used')||to_jsonb(p_relic));
  IF p_relic='sword-goliath' THEN
   SELECT array_agg(value->>'word') INTO r.found FROM jsonb_array_elements(c->'board'->'words');
   r.assisted:=r.found;
   msg:='Sword of Goliath completed the puzzle. No FIGS for assisted words.';
  ELSIF p_relic='freeze-timer' THEN r.deadline:=r.deadline+interval '60 seconds'; msg:='60 seconds added.';
  ELSIF p_relic='reveal-reference' THEN msg:='Scripture reference unlocked.';
  ELSE
   r.assisted:=array_append(r.assisted,word);
   IF p_relic='skip' THEN r.found:=array_append(r.found,word); msg:='Word completed with Skip. No FIGS for this assisted word.';
   ELSIF p_relic='talking-donkey' THEN msg:=CASE WHEN upper(trim(p_word))=word THEN 'The Talking Donkey confirms your selected word. Submit it when ready.' ELSE 'The Talking Donkey warns: these letters do not match the selected word. Change them before submitting.' END;
   ELSIF p_relic IN ('witch-ball-endor') THEN aid:=aid||jsonb_build_object('answer',word); msg:='Answer revealed. This word is assisted.';
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
