-- Forward-only match score transfers. Correct-answer counts and rewards are separate.
-- Match the engine's lock order (room, then participant) on manual forfeits.
DO $patch$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('public.forfeit_arena_game(uuid,uuid)'::regprocedure);
 body:=replace(body,'UPDATE public.arena_participants participant',
  'PERFORM 1 FROM public.arena_rooms WHERE id=p_room_id FOR UPDATE;
  UPDATE public.arena_participants participant');
 EXECUTE body;
END $patch$;

CREATE TABLE scripture_games.arena_forfeit_scores (
 room_id uuid NOT NULL REFERENCES public.arena_rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 score integer NOT NULL CHECK(score >= 0),
 recipient text,
 PRIMARY KEY(room_id,user_id)
);
ALTER TABLE scripture_games.arena_forfeit_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scripture_games.arena_forfeit_scores FROM PUBLIC,anon,authenticated;

CREATE FUNCTION scripture_games.capture_forfeit_score() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE points integer; player jsonb; room_name text;
BEGIN
 IF NEW.forfeited_at IS NULL THEN RETURN NEW; END IF;
 IF OLD.forfeited_at IS NULL THEN
  -- Serialize against settlement and other forfeits in this room.
  SELECT r.room_name INTO room_name FROM public.arena_rooms r WHERE r.id=NEW.room_id FOR UPDATE;
  points:=greatest(0,coalesce(NEW.score,OLD.score,0));
  IF room_name LIKE '%[arena:prelude]%' THEN
   SELECT p INTO player FROM scripture_games.prelude_games g,
    LATERAL jsonb_array_elements(g.state->'players') p
    WHERE g.room_id=NEW.room_id AND p->>'id'=NEW.user_id::text;
   points:=coalesce((player->>'cards')::integer,points);
  ELSIF room_name ILIKE '%[arena:ludo]%' THEN
   SELECT p INTO player FROM public.arena_ludo_games g,
    LATERAL jsonb_array_elements(g.private_state->'players') p
    WHERE g.room_id=NEW.room_id AND p->>'id'=NEW.user_id::text;
   points:=greatest(points,coalesce((player->'stats'->>'totalMovement')::integer,0)
    +coalesce((player->'stats'->>'correct')::integer,0));
  ELSIF room_name ILIKE '%[arena:journey]%' THEN
   SELECT p INTO player FROM public.arena_journey_games g,
    LATERAL jsonb_array_elements(g.state->'game'->'players') p
    WHERE g.room_id=NEW.room_id AND p->>'id'=NEW.user_id::text;
   points:=greatest(points,coalesce((player->>'score')::integer,(player->>'correctAnswers')::integer,0));
  END IF;
  INSERT INTO scripture_games.arena_forfeit_scores(room_id,user_id,score)
   VALUES(NEW.room_id,NEW.user_id,greatest(0,points)) ON CONFLICT DO NOTHING;
 END IF;
 NEW.score:=0;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scripture_games.capture_forfeit_score() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_arena_capture_forfeit_score BEFORE UPDATE OF score,forfeited_at ON public.arena_participants
 FOR EACH ROW EXECUTE FUNCTION scripture_games.capture_forfeit_score();

CREATE FUNCTION scripture_games.award_forfeit_scores(p_room uuid,p_recipient text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE points integer;
BEGIN
 IF p_recipient IS NULL THEN RETURN 0; END IF;
 PERFORM 1 FROM public.arena_rooms WHERE id=p_room FOR UPDATE;
 IF p_recipient<>'machine' AND NOT EXISTS(SELECT 1 FROM public.arena_participants
  WHERE room_id=p_room AND user_id::text=p_recipient AND forfeited_at IS NULL) THEN RETURN 0; END IF;
 WITH claimed AS (
  UPDATE scripture_games.arena_forfeit_scores SET recipient=p_recipient
  WHERE room_id=p_room AND recipient IS NULL RETURNING score
 ) SELECT coalesce(sum(score),0)::integer INTO points FROM claimed;
 IF p_recipient='machine' THEN
  UPDATE public.arena_rooms SET machine_score=coalesce(machine_score,0)+points WHERE id=p_room;
 ELSE
  UPDATE public.arena_participants SET score=coalesce(score,0)+points
   WHERE room_id=p_room AND user_id::text=p_recipient;
 END IF;
 RETURN points;
END $$;
REVOKE ALL ON FUNCTION scripture_games.award_forfeit_scores(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION scripture_games.settle_room_forfeit_scores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
  AND NEW.room_name NOT LIKE '%[arena:prelude]%' THEN
  PERFORM scripture_games.award_forfeit_scores(NEW.id,
   CASE WHEN NEW.winner_id IS NOT NULL THEN NEW.winner_id::text
    WHEN NEW.play_mode='machine' THEN 'machine' ELSE NULL END);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scripture_games.settle_room_forfeit_scores() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER arena_settle_forfeit_scores AFTER UPDATE OF status ON public.arena_rooms
 FOR EACH ROW EXECUTE FUNCTION scripture_games.settle_room_forfeit_scores();

-- Score is the number of collected cards, in easy and hard modes alike.
DO $patch$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('scripture_games.prelude_finish(uuid,jsonb)'::regprocedure);
 body:=replace(body,'(player->>''correct'')::int * CASE WHEN p_state->>''difficulty''=''hard'' THEN 5 ELSE 1 END',
  'coalesce((player->>''cards'')::int,0)');
 IF body LIKE '%score=(player->>''correct''%' THEN RAISE EXCEPTION 'Prelude score replacement failed'; END IF;
 EXECUTE body;
END $patch$;

-- Scorecards must use the settled scores rather than reconstructing a forfeiter's
-- old points from the engine's archived correct answers.
CREATE OR REPLACE FUNCTION journey_private.add_journey_scores(p_room_id uuid,p_players jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(player || CASE
  WHEN participant.user_id IS NOT NULL AND (room.status='completed'
    OR room.room_name LIKE '%[arena:prelude]%' OR participant.forfeited_at IS NOT NULL)
   THEN jsonb_build_object('score',greatest(0,coalesce(participant.score,0)),
    'correct_count',participant.correct_count)
  WHEN player->>'user_id'='00000000-0000-0000-0000-000000000000' AND room.status='completed'
   THEN jsonb_build_object('score',coalesce(room.machine_score,0))
  WHEN saved.value ? 'score' THEN jsonb_build_object('score',greatest(0,(saved.value->>'score')::integer),
   'correct_count',(saved.value->>'correctAnswers')::integer)
  ELSE '{}'::jsonb END ORDER BY ordinal),'[]'::jsonb)
 FROM jsonb_array_elements(p_players) WITH ORDINALITY entry(player,ordinal)
 LEFT JOIN public.arena_rooms room ON room.id=p_room_id
 LEFT JOIN public.arena_journey_games game ON game.room_id=p_room_id
 LEFT JOIN public.arena_participants participant ON participant.room_id=p_room_id
  AND participant.user_id::text=player->>'user_id'
 LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(game.state->'game'->'players')
  WHERE value->>'id'=player->>'user_id') saved ON true;
$$;
REVOKE ALL ON FUNCTION journey_private.add_journey_scores(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION scripture_games.sync_prelude_card_scores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE player jsonb; winner text; points integer; next_players jsonb; cards jsonb;
BEGIN
 IF NEW.state->>'phase'='waiting' THEN RETURN NEW; END IF;
 FOR player IN SELECT value FROM jsonb_array_elements(NEW.state->'players') LOOP
  IF player->>'id'<>'machine' THEN
   UPDATE public.arena_participants SET score=coalesce((player->>'cards')::integer,0)
    WHERE room_id=NEW.room_id AND user_id::text=player->>'id' AND forfeited_at IS NULL;
  ELSIF NEW.state->>'phase'='completed' THEN
   UPDATE public.arena_rooms SET machine_score=coalesce((player->>'cards')::integer,0) WHERE id=NEW.room_id;
  END IF;
 END LOOP;
 IF NEW.state->>'phase'='completed' THEN
  winner:=NEW.state->>'winnerId';
  points:=scripture_games.award_forfeit_scores(NEW.room_id,winner);
  IF points>0 THEN
   SELECT coalesce(jsonb_agg(card),'[]'::jsonb) INTO cards
   FROM jsonb_array_elements(coalesce(NEW.state->'forfeitedPlayers','[]')) departed,
    LATERAL jsonb_array_elements(coalesce(departed->'collected','[]')) card;
   SELECT jsonb_agg(CASE WHEN p->>'id'=winner THEN p||jsonb_build_object(
    'cards',coalesce((p->>'cards')::integer,0)+points,
    'collected',coalesce(p->'collected','[]'::jsonb)||cards) ELSE p END ORDER BY n)
   INTO next_players FROM jsonb_array_elements(NEW.state->'players') WITH ORDINALITY AS x(p,n);
   UPDATE scripture_games.prelude_games SET state=jsonb_set(state,'{players}',next_players)
    WHERE room_id=NEW.room_id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scripture_games.sync_prelude_card_scores() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER prelude_sync_card_scores AFTER INSERT OR UPDATE OF state ON scripture_games.prelude_games
 FOR EACH ROW EXECUTE FUNCTION scripture_games.sync_prelude_card_scores();

-- Journey maintains its own authoritative score. Include awarded transfers there
-- so its existing sync trigger cannot replace the zero or the winner's credit.
DO $patch$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('journey_private.sync_journey_points()'::regprocedure);
 body:=replace(body, 'IF TG_TABLE_NAME = ''arena_participants'' THEN',
  'IF TG_TABLE_NAME = ''arena_participants'' THEN
    IF NEW.forfeited_at IS NOT NULL THEN NEW.score := 0; RETURN NEW; END IF;');
 body:=replace(body,
  'NEW.score := greatest(0, (v_player->>''score'')::integer);',
  'NEW.score := greatest(0, (v_player->>''score'')::integer) + coalesce((SELECT sum(credit.score)::integer FROM scripture_games.arena_forfeit_scores credit WHERE credit.room_id=NEW.room_id AND credit.recipient=NEW.user_id::text),0);');
 body:=replace(body,
  'NEW.machine_score := greatest(0, (v_player->>''score'')::integer);',
  'NEW.machine_score := greatest(0, (v_player->>''score'')::integer) + coalesce((SELECT sum(credit.score)::integer FROM scripture_games.arena_forfeit_scores credit WHERE credit.room_id=NEW.id AND credit.recipient=''machine''),0);');
 IF position('arena_forfeit_scores' in body)=0 THEN RAISE EXCEPTION 'Journey score sync replacement failed'; END IF;
 EXECUTE body;
END $patch$;
