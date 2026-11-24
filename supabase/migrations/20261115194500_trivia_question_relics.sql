-- Record Classic Trivia activations independently of the public witness feed.
CREATE TABLE private.classic_trivia_relics (
  room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_index int NOT NULL,
  personal_question int NOT NULL,
  slug text NOT NULL,
  PRIMARY KEY (room_id, user_id, question_index, slug)
);

CREATE FUNCTION public.classic_trivia_relic(p_room_id uuid, p_question_index int, p_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid();
  room public.arena_rooms;
  live public.arena_live_trivia_states;
  question jsonb;
  v_personal_question int;
  used_slugs jsonb;
  extended boolean;
  reference text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to use relics.'; END IF;
  SELECT * INTO room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT * INTO live FROM public.arena_live_trivia_states WHERE room_id = p_room_id;
  IF room.status IS DISTINCT FROM 'playing' OR room.room_name ~* '\[arena:(prelude|journey|ludo)\]' OR live.player_id IS DISTINCT FROM uid
    OR live.actor_kind <> 'player' OR live.phase <> 'question'
    OR live.question_index IS DISTINCT FROM p_question_index
    OR NOT EXISTS (SELECT 1 FROM public.arena_participants
      WHERE room_id=p_room_id AND user_id=uid AND forfeited_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.arena_trivia_responses WHERE room_id=p_room_id AND question_index=p_question_index)
  THEN RAISE EXCEPTION 'Relics are available during your current question.'; END IF;

  SELECT questions->p_question_index INTO question FROM public.arena_question_decks WHERE room_id=p_room_id;
  IF question IS NULL THEN RAISE EXCEPTION 'This question is unavailable.'; END IF;
  SELECT count(*) INTO v_personal_question FROM public.arena_trivia_responses WHERE room_id=p_room_id AND user_id=uid;
  SELECT coalesce(jsonb_agg(slug),'[]') INTO used_slugs FROM private.classic_trivia_relics
  WHERE room_id=p_room_id AND user_id=uid AND question_index=p_question_index;
  SELECT EXISTS (SELECT 1 FROM private.classic_trivia_relics a
    WHERE room_id=p_room_id AND user_id=uid AND slug='freeze-timer'
      AND v_personal_question >= a.personal_question AND v_personal_question < a.personal_question + 6) INTO extended;
  reference := coalesce(nullif(question->>'reference',''),nullif(question->>'passage',''));

  IF p_slug IS NOT NULL THEN
    IF live.opened_at + make_interval(secs => coalesce(nullif((question->>'round_timer_seconds')::int,0),
      CASE WHEN (question->>'game_round')::int=1 OR question->>'difficulty_tag'='easy' THEN 17
           WHEN (question->>'game_round')::int=2 OR question->>'difficulty_tag'='moderate' THEN 14 ELSE 11 END)
      + CASE WHEN extended THEN 10 ELSE 0 END
      + CASE WHEN used_slugs ? 'reveal-reference' THEN 10 ELSE 0 END) <= clock_timestamp()
    THEN RAISE EXCEPTION 'This question has timed out.'; END IF;
    IF p_slug NOT IN ('freeze-timer','reveal-reference','witch-ball-endor') THEN RAISE EXCEPTION 'Choose a Classic Trivia relic.'; END IF;
    IF NOT (used_slugs ? p_slug) THEN
      IF p_slug='freeze-timer' AND extended THEN RAISE EXCEPTION 'Freeze Timer is already active.'; END IF;
      IF p_slug='reveal-reference' AND reference IS NULL THEN RAISE EXCEPTION 'This question has no Scripture reference.'; END IF;
      IF p_slug='witch-ball-endor' AND nullif(question->>'correct_answer','') IS NULL THEN RAISE EXCEPTION 'This question has no answer to reveal.'; END IF;
      PERFORM scripture_games.consume_relic(uid,p_slug,'classic:'||p_room_id||':'||p_question_index);
      INSERT INTO private.classic_trivia_relics VALUES (p_room_id,uid,p_question_index,v_personal_question,p_slug);
      used_slugs := used_slugs || to_jsonb(p_slug);
      extended := extended OR p_slug='freeze-timer';
    END IF;
  END IF;
  RETURN jsonb_build_object('used',used_slugs,'extended',extended,'hasReference',reference IS NOT NULL,
    'reference',CASE WHEN used_slugs ? 'reveal-reference' THEN reference END,
    'answer',CASE WHEN used_slugs ? 'witch-ball-endor' THEN question->>'correct_answer' END);
END $$;
REVOKE ALL ON FUNCTION public.classic_trivia_relic(uuid,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classic_trivia_relic(uuid,int,text) TO authenticated;

CREATE FUNCTION public.prelude_question_relic(p_room_id uuid,p_version int,p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid();
  room public.arena_rooms;
  game scripture_games.prelude_games;
  v_state jsonb;
  pending jsonb;
  used_slugs jsonb;
  reference text;
  answer text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to use relics.'; END IF;
  SELECT * INTO room FROM public.arena_rooms WHERE id=p_room_id FOR UPDATE;
  SELECT * INTO game FROM scripture_games.prelude_games WHERE room_id=p_room_id FOR UPDATE;
  v_state := game.state;
  pending := v_state->'pending';
  IF room.status IS DISTINCT FROM 'playing' OR v_state->>'phase' IS DISTINCT FROM 'question'
    OR v_state->'players'->((v_state->>'turn')::int)->>'id' IS DISTINCT FROM uid::text
    OR game.version IS DISTINCT FROM p_version OR (v_state->>'deadline')::timestamptz <= clock_timestamp()
  THEN RAISE EXCEPTION 'Relics are available during your current question.'; END IF;

  used_slugs := coalesce(pending->'relics','[]'::jsonb);
  IF p_slug IN ('witch-ball-endor','reveal-reference') THEN
    SELECT string_agg(f.reference, ' · ' ORDER BY f.id), string_agg(f.meaning, ' · ' ORDER BY f.id)
    INTO reference, answer FROM scripture_games.number_facts f
    WHERE pending->'correct' @> jsonb_build_array(f.id);
    IF p_slug='reveal-reference' AND reference IS NULL THEN RAISE EXCEPTION 'This question has no Scripture reference.'; END IF;
    IF p_slug='witch-ball-endor' AND answer IS NULL THEN RAISE EXCEPTION 'This question has no answer to reveal.'; END IF;
  ELSIF p_slug IS DISTINCT FROM 'freeze-timer' THEN
    RAISE EXCEPTION 'Choose a Prelude relic.';
  END IF;

  IF NOT (used_slugs ? p_slug) THEN
    IF p_slug='freeze-timer' AND coalesce((v_state->'relicTimerTurns'->>uid::text)::int,0)>0 THEN
      RAISE EXCEPTION 'Freeze Timer is already active.';
    END IF;
    PERFORM scripture_games.consume_relic(uid,p_slug,'prelude:'||p_room_id||':'||(v_state->>'serial'));
    used_slugs := used_slugs || to_jsonb(p_slug);
    v_state := jsonb_set(v_state,'{pending,relics}',used_slugs);
    IF p_slug='freeze-timer' THEN
      v_state := jsonb_set(v_state,'{relicTimerTurns}',coalesce(v_state->'relicTimerTurns','{}'::jsonb)||jsonb_build_object(uid::text,5));
    END IF;
    IF p_slug IN ('freeze-timer','reveal-reference') THEN
      v_state := jsonb_set(v_state,'{deadline}',to_jsonb((v_state->>'deadline')::timestamptz+interval '10 seconds'));
    END IF;
    -- A relic does not replace the question or invalidate a selected answer.
    UPDATE scripture_games.prelude_games SET state=v_state WHERE room_id=p_room_id;
  END IF;
  RETURN jsonb_build_object('used',used_slugs,'deadline',v_state->'deadline',
    'reference',CASE WHEN p_slug='reveal-reference' THEN reference END,
    'answer',CASE WHEN p_slug='witch-ball-endor' THEN answer END);
END $$;
REVOKE ALL ON FUNCTION public.prelude_question_relic(uuid,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prelude_question_relic(uuid,int,text) TO authenticated;

CREATE OR REPLACE FUNCTION scripture_games.prelude_flip(p_room uuid,p_state jsonb,p_slot int) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE card jsonb; center jsonb; opts jsonb; correct jsonb; v_number int; moves jsonb; actor text; extra_turns int;
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
  actor := p_state->'players'->((p_state->>'turn')::int)->>'id';
  extra_turns := coalesce((p_state->'relicTimerTurns'->>actor)::int,0);
  IF extra_turns > 0 THEN
   p_state := jsonb_set(p_state,ARRAY['relicTimerTurns',actor],to_jsonb(extra_turns-1));
  END IF;
  RETURN p_state||jsonb_build_object('phase','question','pending',jsonb_build_object('number',v_number,'options',opts,'correct',correct,'relics',CASE WHEN extra_turns>0 THEN '["freeze-timer"]'::jsonb ELSE '[]'::jsonb END),'deadline',clock_timestamp()+make_interval(secs=>CASE WHEN extra_turns>0 THEN 20 ELSE 10 END),'notice','Match! Answer the Scripture question to collect the board.');
 END IF;
 RETURN scripture_games.prelude_advance(p_room,p_state,false);
END $$;

CREATE OR REPLACE FUNCTION scripture_games.prelude_view(p_room uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE g scripture_games.prelude_games; s jsonb; q jsonb; room public.arena_rooms;
BEGIN
 SELECT * INTO g FROM scripture_games.prelude_games WHERE room_id=p_room;
 SELECT * INTO room FROM public.arena_rooms WHERE id=p_room;
 s:=g.state; q:=s->'pending';
 RETURN (s-'deck'-'pending'-'relicTimerTurns')||jsonb_build_object('id',p_room,'name',room.room_name,'creatorId',room.creator_id,'difficulty',g.difficulty,'version',g.version,
  'maxPlayers',room.max_players,'startsAt',(SELECT starts_at FROM public.arena_scheduled_matches WHERE room_id=p_room),
  'cards',(SELECT coalesce(jsonb_agg(jsonb_build_object('slot',value->'slot')),'[]') FROM jsonb_array_elements(coalesce(s->'deck','[]')) WHERE NOT (value->>'drawn')::boolean),
  'pending',CASE WHEN q IS NOT NULL AND q<>'null'::jsonb THEN jsonb_build_object('number',q->'number','options',q->'options','multiple',g.difficulty='hard','relics',CASE WHEN s->'players'->((s->>'turn')::int)->>'id'=auth.uid()::text THEN q->'relics' END,'scribeSelection',q->'scribeSelection','scribeCorrect',CASE WHEN q ? 'scribeSelection' THEN q->'scribeSelection'=q->'correct' ELSE NULL END) ELSE NULL END);
END $$;
