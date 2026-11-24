-- Keep per-match journeys and solo scheduled starts consistent across installations.
-- Existing active championship story assignments are intentionally managed in production.
ALTER TABLE private.intertent_fixtures ADD COLUMN IF NOT EXISTS journey_character_slug text REFERENCES public.arena_journey_characters(slug);

CREATE OR REPLACE FUNCTION private.intertent_assign_story()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.journey_character_slug IS NOT NULL THEN RETURN NEW; END IF;
  SELECT c.slug INTO NEW.journey_character_slug
  FROM public.arena_journey_characters c
  WHERE c.ready=true
  ORDER BY (SELECT count(*) FROM private.intertent_fixtures f WHERE f.championship_id=NEW.championship_id AND f.journey_character_slug=c.slug), random()
  LIMIT 1;
  IF NEW.journey_character_slug IS NULL THEN RAISE EXCEPTION 'No ready Journey Trivia stories.'; END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS assign_intertent_story ON private.intertent_fixtures;
CREATE TRIGGER assign_intertent_story BEFORE INSERT ON private.intertent_fixtures
FOR EACH ROW EXECUTE FUNCTION private.intertent_assign_story();
REVOKE ALL ON FUNCTION private.intertent_assign_story() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.intertent_create_room(p_fixture uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE f private.intertent_fixtures%ROWTYPE; c private.intertent_championships%ROWTYPE; rid uuid;
  label text; starts timestamptz; player uuid;
BEGIN
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture FOR UPDATE;
  IF f.room_id IS NOT NULL THEN RETURN f.room_id; END IF;
  SELECT * INTO STRICT c FROM private.intertent_championships WHERE id=f.championship_id;
  IF c.status NOT IN ('scheduled','playing') OR cardinality(f.player_ids)<>(CASE f.stage WHEN 'group' THEN 4 WHEN 'semi' THEN 3 ELSE 2 END) THEN RAISE EXCEPTION 'The championship fixture is not ready.'; END IF;
  -- Never schedule an already elapsed fixture automatically.
  IF f.planned_at<=now() THEN RAISE EXCEPTION 'This fixture needs rescheduling.'; END IF;
  starts:=f.planned_at;
  label:=CASE f.stage WHEN 'group' THEN 'Group '||f.group_key||' Series '||ceil(f.leg/2.0)::integer::text||' '||CASE WHEN f.leg%2=1 THEN 'Home' ELSE 'Away' END WHEN 'semi' THEN 'Semifinal '||CASE WHEN f.leg=1 THEN 'Home' ELSE 'Away' END ELSE 'Grand final' END;
  INSERT INTO public.arena_rooms(creator_id,room_name,stake_amount,max_players,status,tagged_user_ids,game_call_fee,expires_at)
  VALUES(f.player_ids[1],(CASE WHEN f.sequence>=18 THEN 'Mystery Inter-Tent · ' ELSE 'Journey Inter-Tent · ' END)||label||' [arena:journey]'||(CASE WHEN f.sequence>=18 THEN '' ELSE ' [character:'||coalesce(f.journey_character_slug,'david')||']' END)||' [intertent]',0,cardinality(f.player_ids),'waiting',f.player_ids,0,starts+interval '3 hours') RETURNING id INTO rid;
  INSERT INTO public.arena_scheduled_matches(room_id,scheduled_by,starts_at,player_ids,is_intertent_match)
  VALUES(rid,c.created_by,starts,f.player_ids,true);
  UPDATE private.intertent_fixtures SET room_id=rid WHERE id=p_fixture;
  FOREACH player IN ARRAY f.player_ids LOOP
    PERFORM public.notify_user(player,c.created_by,'arena','Inter-Tent Championship match scheduled',label||' · '||(CASE WHEN f.sequence>=18 THEN 'Mystery' ELSE coalesce((SELECT display_name FROM public.arena_journey_characters WHERE slug=f.journey_character_slug),'Journey') END)||' Journey Trivia','arena',jsonb_build_object('room_id',rid,'starts_at',starts));
  END LOOP;
  RETURN rid;
END; $function$;

CREATE OR REPLACE FUNCTION private.intertent_before_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE f private.intertent_fixtures%ROWTYPE;
BEGIN
 IF NEW.status<>'playing' OR OLD.status='playing' THEN RETURN NEW; END IF;
 SELECT * INTO f FROM private.intertent_fixtures WHERE room_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM 1 FROM private.intertent_championships WHERE id=f.championship_id FOR UPDATE;
 IF (SELECT count(*) FROM public.arena_participants a WHERE a.room_id=NEW.id AND a.user_id=ANY(f.player_ids) AND a.forfeited_at IS NULL)<1 THEN RAISE EXCEPTION 'At least one scheduled player must be present.'; END IF;
 IF EXISTS (SELECT 1 FROM private.intertent_fixtures x JOIN public.arena_rooms r ON r.id=x.room_id WHERE x.championship_id=f.championship_id AND x.id<>f.id AND r.status='playing') THEN RAISE EXCEPTION 'Another championship match is still being played.'; END IF;
 IF EXISTS (SELECT 1 FROM private.intertent_fixtures x WHERE x.championship_id=f.championship_id AND x.planned_at<f.planned_at AND (x.planned_at AT TIME ZONE 'Africa/Douala')::date=(f.planned_at AT TIME ZONE 'Africa/Douala')::date AND x.result IS NULL) THEN RAISE EXCEPTION 'The preceding match must be completed first.'; END IF;
 IF f.sequence>=18 THEN NEW.room_name:=regexp_replace(NEW.room_name,'^Mystery Inter-Tent','Journey Inter-Tent')||' [character:'||f.journey_character_slug||']'; END IF;
 -- Wait-room attendance can predate the start by many minutes. Give joined
 -- players the ordinary presence grace measured from actual game start.
 UPDATE public.arena_participants SET last_active_at=coalesce(NEW.started_at,now()) WHERE room_id=NEW.id AND user_id=ANY(f.player_ids) AND forfeited_at IS NULL;
 UPDATE private.intertent_championships SET status='playing' WHERE id=f.championship_id AND status='scheduled';
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_intertent_championships()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); camp bigint; manager boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to view the championship.'; END IF;
  camp:=private.scripture_question_camp(actor); manager:=public.is_instructor(actor);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'opening_at',c.opening_at,'can_manage',manager,
    'champion',(SELECT display_name FROM public.profiles WHERE id=c.champion_id),
    'eligibility',CASE WHEN manager AND c.status='draft' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.display_name,'qualified',private.intertent_qualified(p.id)) ORDER BY p.display_name),'[]') FROM public.profiles p WHERE p.id IN (SELECT DISTINCT u FROM private.intertent_fixtures f CROSS JOIN LATERAL unnest(f.player_ids) u WHERE f.championship_id=c.id)) ELSE '[]'::jsonb END,
    'standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_id',r.tent_id,'tent_name',t.name,'matches',r.matches,'points',r.points,'average',round(r.average,3)) ORDER BY r.average DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'group') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'semifinal_standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_name',t.name,'matches',r.matches,'points',r.points) ORDER BY r.points DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'semi') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'fixtures',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'sequence',f.sequence,'stage',f.stage,'group_key',f.group_key,'leg',f.leg,'planned_at',f.planned_at,'room_id',f.room_id,'room_status',room.status,'journey_character_slug',CASE WHEN f.sequence>=18 AND room.status IS DISTINCT FROM 'playing' AND f.result IS NULL THEN NULL ELSE f.journey_character_slug END,'journey_secret',f.sequence>=18 AND room.status IS DISTINCT FROM 'playing' AND f.result IS NULL,'result',f.result,
      'sides',(SELECT coalesce(jsonb_agg(jsonb_build_object('tent_id',s.tent_id,'tent_name',s.tent_name,'players',s.players) ORDER BY s.first_slot),'[]') FROM (SELECT t.id tent_id,t.name tent_name,min(u.slot) first_slot,jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'player_number',p.player_number) ORDER BY u.slot) players FROM unnest(f.player_ids) WITH ORDINALITY u(uid,slot) JOIN public.profiles p ON p.id=u.uid JOIN public.tents t ON t.id=(f.sides->>u.uid::text)::uuid GROUP BY t.id,t.name) s)) ORDER BY f.sequence),'[]') FROM private.intertent_fixtures f LEFT JOIN public.arena_rooms room ON room.id=f.room_id WHERE f.championship_id=c.id)
  ) ORDER BY c.created_at DESC) FROM (SELECT * FROM private.intertent_championships WHERE camp_id=camp ORDER BY created_at DESC LIMIT 4) c),'[]');
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_instructor_arena_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_starts_at timestamptz;
BEGIN
  SELECT starts_at INTO v_starts_at FROM public.arena_scheduled_matches WHERE room_id = NEW.id;
  IF v_starts_at IS NOT NULL THEN
    IF NEW.status = 'waiting' THEN
      NEW.expires_at := greatest(coalesce(NEW.expires_at, v_starts_at + interval '2 hours'), v_starts_at + interval '2 hours');
    ELSIF NEW.status = 'playing' AND OLD.status <> 'playing' THEN
      IF now() < v_starts_at THEN RAISE EXCEPTION 'The scheduled match has not begun yet.'; END IF;
      IF (SELECT count(*) FROM public.arena_participants WHERE room_id = NEW.id AND forfeited_at IS NULL) < 1 THEN
        RAISE EXCEPTION 'At least one selected player must enter before the match starts.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_intertent_david_championship(p_groups jsonb, p_first_tuesday date, p_existing uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); camp bigint; cid uuid; groups text[]:=ARRAY['A','B','C','D'];
  g integer; w integer; ids uuid[]; side_map jsonb; player uuid; tent uuid; n integer; prior_tent text;
  all_sides jsonb:='{}'; day_offset integer; slot_time time; first_at timestamptz;
BEGIN
  IF actor IS NULL OR NOT public.is_instructor(actor) THEN RAISE EXCEPTION 'Only an instructor can create this championship.'; END IF;
  camp:=private.scripture_question_camp(actor);
  IF p_first_tuesday IS NULL OR extract(isodow FROM p_first_tuesday)<>2 THEN RAISE EXCEPTION 'Choose a Tuesday for the first group fixtures.'; END IF;
  first_at:=((p_first_tuesday-2)+time '19:00') AT TIME ZONE 'Africa/Douala';
  IF first_at<=now()+interval '2 minutes' OR first_at>now()+interval '55 days' THEN RAISE EXCEPTION 'Choose a future first match within 55 days.'; END IF;
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_groups))<>4 THEN RAISE EXCEPTION 'Choose four groups.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_journey_characters WHERE slug='david' AND ready) THEN RAISE EXCEPTION 'David is not ready to play.'; END IF;
  IF p_existing IS NULL THEN
    INSERT INTO private.intertent_championships(title,camp_id,created_by,opening_at)
    VALUES('Journey Inter-Tent Championship',camp,actor,((p_first_tuesday-2)+time '19:00') AT TIME ZONE 'Africa/Douala') RETURNING id INTO cid;
  ELSE
    SELECT id INTO STRICT cid FROM private.intertent_championships WHERE id=p_existing AND camp_id=camp AND status='draft' FOR UPDATE;
    IF EXISTS(SELECT 1 FROM private.intertent_fixtures WHERE championship_id=cid AND room_id IS NOT NULL) THEN RAISE EXCEPTION 'Activated fixtures cannot be replaced.'; END IF;
    DELETE FROM private.intertent_fixtures WHERE championship_id=cid;
    UPDATE private.intertent_championships SET opening_at=((p_first_tuesday-2)+time '19:00') AT TIME ZONE 'Africa/Douala' WHERE id=cid;
  END IF;
  FOR g IN 1..4 LOOP
    IF jsonb_typeof(p_groups->groups[g]) IS DISTINCT FROM 'array' OR jsonb_array_length(p_groups->groups[g])<>4 THEN RAISE EXCEPTION 'Choose four players in each group.'; END IF;
    SELECT array_agg(value::uuid ORDER BY ord) INTO ids FROM jsonb_array_elements_text(p_groups->groups[g]) WITH ORDINALITY x(value,ord);
    IF (SELECT count(DISTINCT x) FROM unnest(ids) x)<>4 THEN RAISE EXCEPTION 'Every group needs four distinct players.'; END IF;
    side_map:='{}';
    FOREACH player IN ARRAY ids LOOP
      tent:=private.intertent_cadet_tent(player,camp);
      IF tent IS NULL THEN RAISE EXCEPTION 'All entrants must be cadets from this camp.'; END IF;
      prior_tent:=all_sides->>player::text;
      IF prior_tent IS NOT NULL AND prior_tent<>tent::text THEN RAISE EXCEPTION 'A cadet must represent the same tent throughout.'; END IF;
      side_map:=side_map||jsonb_build_object(player::text,tent::text);
      all_sides:=all_sides||jsonb_build_object(player::text,tent::text);
    END LOOP;
    SELECT count(DISTINCT value) INTO n FROM jsonb_each_text(side_map);
    IF n<>3 THEN RAISE EXCEPTION 'Each group must represent exactly three tents.'; END IF;
    FOR w IN 1..4 LOOP
      day_offset:=(w-1)*7+CASE WHEN g>2 THEN 2 ELSE 0 END;
      slot_time:=CASE WHEN g%2=1 THEN time '18:00' ELSE time '18:30' END;
      INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,group_key,leg,planned_at,player_ids,sides)
      VALUES(cid,(w-1)*4+g,'group',groups[g],w,CASE WHEN w=1 AND g=1 THEN first_at ELSE ((p_first_tuesday+day_offset)+slot_time) AT TIME ZONE 'Africa/Douala' END,ids,side_map);
    END LOOP;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_each_text(all_sides))<>3 THEN RAISE EXCEPTION 'Use the same three tents throughout.'; END IF;
  INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,leg,planned_at) VALUES
    (cid,17,'semi',1,((p_first_tuesday+28)+time '18:00') AT TIME ZONE 'Africa/Douala'),
    (cid,18,'semi',2,((p_first_tuesday+30)+time '18:00') AT TIME ZONE 'Africa/Douala'),
    (cid,19,'final',1,((p_first_tuesday+35)+time '18:00') AT TIME ZONE 'Africa/Douala');
  RETURN cid;
END; $function$;
