DO $$
DECLARE original_id uuid:='67160077-2931-4bcc-bafd-e41c0a677a1d'; replacement_id uuid:='51c0f7cd-db0c-4a38-8c93-12380bd4da36'; affected integer;
BEGIN
  PERFORM 1 FROM private.intertent_championships WHERE id IN(original_id,replacement_id) ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM private.intertent_championships WHERE id=original_id AND status='completed') OR NOT EXISTS(SELECT 1 FROM private.intertent_championships WHERE id=replacement_id AND status='scheduled') THEN RAISE EXCEPTION 'Championship state changed'; END IF;
  IF (SELECT count(*) FROM private.intertent_fixtures WHERE championship_id=original_id AND result IS NOT NULL AND sequence BETWEEN 1 AND 4)<>4 OR (SELECT count(*) FROM private.intertent_fixtures WHERE championship_id=original_id AND result IS NULL AND sequence BETWEEN 5 AND 19)<>15 OR (SELECT count(*) FROM private.intertent_fixtures WHERE championship_id=replacement_id AND result IS NULL AND sequence BETWEEN 1 AND 15)<>15 THEN RAISE EXCEPTION 'Fixture count changed'; END IF;
  IF EXISTS(SELECT 1 FROM private.intertent_fixtures f JOIN public.arena_rooms r ON r.id=f.room_id WHERE f.championship_id=replacement_id AND (r.status<>'waiting' OR r.started_at IS NOT NULL)) THEN RAISE EXCEPTION 'An active duel cannot be moved'; END IF;
  IF EXISTS(SELECT 1 FROM private.intertent_fixtures f JOIN public.arena_rooms r ON r.id=f.room_id WHERE f.championship_id=original_id AND f.result IS NULL AND r.status<>'cancelled') THEN RAISE EXCEPTION 'Old unresolved rooms were not cancelled'; END IF;
  -- The replacement shell retains the superseded fixtures for audit. Temporary
  -- offsets avoid uniqueness collisions with the replacement calendar.
  UPDATE private.intertent_fixtures SET championship_id=replacement_id,sequence=sequence+1000,planned_at=planned_at+interval '1000 days' WHERE championship_id=original_id AND result IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>15 THEN RAISE EXCEPTION 'Expected 15 superseded fixtures'; END IF;
  UPDATE private.intertent_fixtures SET championship_id=original_id,sequence=sequence+4 WHERE championship_id=replacement_id AND sequence BETWEEN 1 AND 15;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>15 THEN RAISE EXCEPTION 'Expected 15 new fixtures'; END IF;
  UPDATE private.intertent_fixtures SET sequence=sequence-1000,planned_at=planned_at-interval '1000 days' WHERE championship_id=replacement_id AND sequence>=1000;
  UPDATE private.intertent_duel_competitions SET championship_id=original_id,source_championship_id=NULL WHERE championship_id=replacement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing duel competition settings'; END IF;
  UPDATE private.intertent_championships SET status='completed',title='Superseded fixture schedule (archived)' WHERE id=replacement_id;
  UPDATE private.intertent_championships SET status='playing',title='Journey Inter-Tent Championship' WHERE id=original_id;
END $$;
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
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'opening_at',c.opening_at,'can_manage',manager,'duel',EXISTS(SELECT 1 FROM private.intertent_duel_competitions d WHERE d.championship_id=c.id),
    'champion',coalesce((SELECT t.name FROM private.intertent_duel_competitions d JOIN public.tents t ON t.id=d.champion_tent_id WHERE d.championship_id=c.id),(SELECT display_name FROM public.profiles WHERE id=c.champion_id)),
    'finalist_tent_name',(SELECT t.name FROM private.intertent_duel_competitions d JOIN public.tents t ON t.id=d.finalist_tent_id WHERE d.championship_id=c.id),
    'eligibility',CASE WHEN manager AND c.status='draft' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.display_name,'qualified',private.intertent_qualified(p.id)) ORDER BY p.display_name),'[]') FROM public.profiles p WHERE p.id IN (SELECT DISTINCT u FROM private.intertent_fixtures f CROSS JOIN LATERAL unnest(f.player_ids) u WHERE f.championship_id=c.id)) ELSE '[]'::jsonb END,
    'standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_id',r.tent_id,'tent_name',t.name,'matches',r.matches,'points',r.points,'average',round(r.average,3)) ORDER BY r.average DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'group') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'semifinal_standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_id',r.tent_id,'tent_name',t.name,'matches',r.matches,'points',r.points) ORDER BY r.points DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'semi') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'fixtures',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'sequence',f.sequence,'stage',f.stage,'group_key',f.group_key,'leg',f.leg,'planned_at',f.planned_at,'room_id',f.room_id,'room_status',room.status,'journey_character_slug',CASE WHEN f.sequence>=18 AND room.status IS DISTINCT FROM 'playing' AND f.result IS NULL THEN NULL ELSE f.journey_character_slug END,'journey_secret',f.sequence>=18 AND room.status IS DISTINCT FROM 'playing' AND f.result IS NULL,'result',f.result,'home_tent_id',(SELECT d.home_tent_id FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id),'away_tent_id',(SELECT d.away_tent_id FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id),
      'sides',(SELECT coalesce(jsonb_agg(jsonb_build_object('tent_id',s.tent_id,'tent_name',s.tent_name,'players',s.players) ORDER BY s.first_slot),'[]') FROM (SELECT t.id tent_id,t.name tent_name,min(u.slot) first_slot,jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'player_number',p.player_number) ORDER BY u.slot) players FROM unnest(f.player_ids) WITH ORDINALITY u(uid,slot) JOIN public.profiles p ON p.id=u.uid JOIN public.tents t ON t.id=(f.sides->>u.uid::text)::uuid GROUP BY t.id,t.name) s)) ORDER BY f.sequence),'[]') FROM private.intertent_fixtures f LEFT JOIN public.arena_rooms room ON room.id=f.room_id WHERE f.championship_id=c.id AND (c.title NOT LIKE '%(archived)%' OR f.result IS NOT NULL))
  ) ORDER BY c.created_at DESC) FROM (SELECT * FROM private.intertent_championships WHERE camp_id=camp AND title<>'Superseded fixture schedule (archived)' ORDER BY created_at DESC LIMIT 4) c),'[]');
END; $function$
;
