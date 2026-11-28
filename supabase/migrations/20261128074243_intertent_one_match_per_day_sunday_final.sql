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
  first_at:=(p_first_tuesday+time '18:00') AT TIME ZONE 'Africa/Douala';
  IF first_at<=now()+interval '2 minutes' OR first_at>now()+interval '55 days' THEN RAISE EXCEPTION 'Choose a future first match within 55 days.'; END IF;
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_groups))<>4 THEN RAISE EXCEPTION 'Choose four groups.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_journey_characters WHERE slug='david' AND ready) THEN RAISE EXCEPTION 'David is not ready to play.'; END IF;
  IF p_existing IS NULL THEN
    INSERT INTO private.intertent_championships(title,camp_id,created_by,opening_at)
    VALUES('Journey Inter-Tent Championship',camp,actor,(p_first_tuesday+time '18:00') AT TIME ZONE 'Africa/Douala') RETURNING id INTO cid;
  ELSE
    SELECT id INTO STRICT cid FROM private.intertent_championships WHERE id=p_existing AND camp_id=camp AND status='draft' FOR UPDATE;
    IF EXISTS(SELECT 1 FROM private.intertent_fixtures WHERE championship_id=cid AND room_id IS NOT NULL) THEN RAISE EXCEPTION 'Activated fixtures cannot be replaced.'; END IF;
    DELETE FROM private.intertent_fixtures WHERE championship_id=cid;
    UPDATE private.intertent_championships SET opening_at=(p_first_tuesday+time '18:00') AT TIME ZONE 'Africa/Douala' WHERE id=cid;
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
      day_offset:=(w-1)*7+(g-1);
      slot_time:=time '18:00';
      INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,group_key,leg,planned_at,player_ids,sides)
      VALUES(cid,(w-1)*4+g,'group',groups[g],w,CASE WHEN w=1 AND g=1 THEN first_at ELSE ((p_first_tuesday+day_offset)+slot_time) AT TIME ZONE 'Africa/Douala' END,ids,side_map);
    END LOOP;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_each_text(all_sides))<>3 THEN RAISE EXCEPTION 'Use the same three tents throughout.'; END IF;
  INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,leg,planned_at) VALUES
    (cid,17,'semi',1,((p_first_tuesday+28)+time '18:00') AT TIME ZONE 'Africa/Douala'),
    (cid,18,'semi',2,((p_first_tuesday+30)+time '18:00') AT TIME ZONE 'Africa/Douala'),
    (cid,19,'final',1,((p_first_tuesday+33)+time '18:00') AT TIME ZONE 'Africa/Douala');
  RETURN cid;
END; $function$
;
