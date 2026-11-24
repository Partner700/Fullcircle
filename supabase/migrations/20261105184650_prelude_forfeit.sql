-- Prelude has its own turn v_state: remove a forfeiting player atomically from
-- both the Arena roster and the card table, without settling an unfinished deck.
CREATE OR REPLACE FUNCTION public.forfeit_prelude_game(p_room_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 uid uuid := auth.uid();
 room public.arena_rooms;
 game scripture_games.prelude_games;
 v_state jsonb;
 departing jsonb;
 remaining jsonb;
 player jsonb;
 departing_index integer;
 current_turn integer;
 winner text;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to forfeit a Prelude round.'; END IF;
 SELECT * INTO room FROM public.arena_rooms
 WHERE id = p_room_id AND room_name LIKE '%[arena:prelude]%' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prelude room not found.'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id=p_room_id AND user_id=uid) THEN
  RAISE EXCEPTION 'You can only forfeit your own place in this round.';
 END IF;
 IF room.status = 'completed' OR EXISTS (
  SELECT 1 FROM public.arena_participants WHERE room_id=p_room_id AND user_id=uid AND forfeited_at IS NOT NULL
 ) THEN RETURN; END IF;
 IF room.status <> 'playing' THEN RAISE EXCEPTION 'This Prelude round has not started.'; END IF;
 SELECT * INTO game FROM scripture_games.prelude_games WHERE room_id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prelude game not found.'; END IF;
 v_state := game.state;
 SELECT value, ordinality::integer-1 INTO departing, departing_index
 FROM jsonb_array_elements(v_state->'players') WITH ORDINALITY WHERE value->>'id'=uid::text;
 IF departing IS NULL THEN RAISE EXCEPTION 'You are no longer playing this round.'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO remaining
 FROM jsonb_array_elements(v_state->'players') WITH ORDINALITY WHERE value->>'id'<>uid::text;
 UPDATE public.arena_participants SET forfeited_at=clock_timestamp(),forfeit_reason='manual',
  finished_at=clock_timestamp(),correct_count=coalesce((departing->>'correct')::integer,0),
  score=coalesce((departing->>'correct')::integer,0)*CASE WHEN game.difficulty='hard' THEN 5 ELSE 1 END
 WHERE room_id=p_room_id AND user_id=uid;
 current_turn := (v_state->>'turn')::integer;
 v_state := jsonb_set(v_state, '{players}', remaining);
 v_state := jsonb_set(v_state, '{forfeitedPlayers}', coalesce(v_state->'forfeitedPlayers','[]'::jsonb)||jsonb_build_array(departing));
 IF jsonb_array_length(remaining)<=1 THEN
  winner := remaining->0->>'id';
  v_state := v_state||jsonb_build_object('phase','completed','turn',0,'pending',NULL,'deadline',NULL,
   'winnerId',winner,'reward',0,'notice','Round ended by forfeiture. No completion reward is awarded.');
  FOR player IN SELECT value FROM jsonb_array_elements(remaining) LOOP
   IF player->>'id'<>'machine' THEN
    UPDATE public.arena_participants SET correct_count=coalesce((player->>'correct')::integer,0),
     score=coalesce((player->>'correct')::integer,0)*CASE WHEN game.difficulty='hard' THEN 5 ELSE 1 END,
     finished_at=clock_timestamp() WHERE room_id=p_room_id AND user_id=(player->>'id')::uuid;
   END IF;
  END LOOP;
  UPDATE public.arena_rooms SET status='completed',completed_at=clock_timestamp(),
   winner_id=CASE WHEN winner IS NULL OR winner='machine' THEN NULL ELSE winner::uuid END,
   completion_reason='forfeit' WHERE id=p_room_id;
 ELSE
  IF departing_index=current_turn THEN
   v_state := v_state||jsonb_build_object('phase','playing','pending',NULL,
    'turn',current_turn%jsonb_array_length(remaining),'deadline',clock_timestamp()+interval '45 seconds');
  ELSIF departing_index<current_turn THEN
   v_state := jsonb_set(v_state,'{turn}',to_jsonb(current_turn-1));
  END IF;
  v_state := v_state||jsonb_build_object('notice',coalesce(departing->>'name','A player')||' forfeited. The round continues.');
 END IF;
 UPDATE scripture_games.prelude_games SET state=v_state,version=version+1 WHERE room_id=p_room_id;
END $$;
REVOKE ALL ON FUNCTION public.forfeit_prelude_game(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forfeit_prelude_game(uuid) TO authenticated;
