CREATE SCHEMA valediction_private;
REVOKE ALL ON SCHEMA valediction_private FROM PUBLIC,anon,authenticated;
CREATE TABLE valediction_private.reviews(
 session_id uuid PRIMARY KEY REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
 generated_at timestamptz,validated_at timestamptz,validated_by uuid,
 content_hash text,source_counts jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE valediction_private.reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON valediction_private.reviews FROM PUBLIC,anon,authenticated;

CREATE FUNCTION valediction_private.normalise(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kind text:=lower(coalesce(p->>'type','')); answer text:=btrim(coalesce(p->>'correct_answer','')); opts jsonb;
BEGIN
 IF length(btrim(coalesce(p->>'question','')))<8 OR answer='' THEN RETURN NULL; END IF;
 kind:=CASE kind WHEN 'mcq' THEN 'multiple_choice' WHEN 'text' THEN 'standard_text'
  WHEN 'short_answer' THEN 'standard_text' WHEN 'fill_blank' THEN 'standard_text' ELSE kind END;
 IF kind NOT IN ('multiple_choice','true_false','standard_text','comprehension') THEN RETURN NULL; END IF;
 IF kind IN ('multiple_choice','comprehension') THEN
  IF jsonb_typeof(p->'options') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'options') o WHERE jsonb_typeof(o)<>'string') THEN RETURN NULL; END IF;
  SELECT jsonb_agg(value ORDER BY n) INTO opts FROM (
   SELECT btrim(value) value,min(n) n FROM jsonb_array_elements_text(p->'options') WITH ORDINALITY x(value,n)
   WHERE btrim(value)<>'' GROUP BY btrim(value)) x;
  IF coalesce(jsonb_array_length(opts),0)<2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(opts) o WHERE lower(o)=lower(answer)) THEN RETURN NULL; END IF;
  IF kind='comprehension' AND btrim(coalesce(p->>'passage',''))='' THEN RETURN NULL; END IF;
 ELSIF kind='true_false' THEN
  IF lower(answer) NOT IN ('true','false') THEN RETURN NULL; END IF;
  answer:=initcap(answer);opts:='["True","False"]';
 END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('type',kind,'question',btrim(p->>'question'),
  'correct_answer',answer,'options',opts,'accepted_answers',p->'accepted_answers',
  'reference',coalesce(p->>'reference',p->>'scripture_reference'),'explanation',p->>'explanation',
  'passage',p->>'passage','difficulty_tag',coalesce(p->>'difficulty_tag','moderate')));
END $$;

CREATE FUNCTION valediction_private.pool(p_session uuid)
RETURNS TABLE(source text,source_id text,difficulty text,payload jsonb)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH raw(source,source_id,difficulty,payload) AS (
  SELECT 'Quizzes',q.id::text,q.difficulty_tag,q.question_payload
   FROM public.generated_questions q JOIN public.quiz_sessions s ON s.id=q.quiz_session_id
   WHERE s.id<>p_session AND s.quiz_type<>'valediction' AND s.status IN ('countdown','live','closed')
  UNION ALL
  SELECT 'Daily Trivia / instructor bank',q.id::text,q.difficulty_tag,
   jsonb_build_object('type',q.question_type,'question',q.question_text,'options',q.options,
    'correct_answer',q.correct_answer,'accepted_answers',q.accepted_answers,'explanation',q.explanation,
    'reference',q.scripture_reference,'passage',q.passage)
   FROM public.custom_questions q WHERE q.is_approved AND q.quiz_session_id IS DISTINCT FROM p_session
  UNION ALL
  SELECT 'Journey',q.id::text,q.difficulty_tag,jsonb_build_object('type',q.question_type,
   'question',q.question_text,'options',q.options,'correct_answer',q.correct_answer,
   'accepted_answers',q.accepted_answers,'explanation',q.explanation,'reference',q.source_reference)
   FROM public.arena_journey_questions q WHERE q.review_status='approved' AND q.retired_at IS NULL
  UNION ALL
  SELECT 'Story Mode',q.id,q.difficulty,jsonb_build_object('type',q.question_type,'question',q.prompt,
   'options',q.options,'correct_answer',q.correct_answer,'explanation',q.explanation,'reference',q.scripture_reference)
   FROM public.story_mode_questions q
  UNION ALL
  SELECT 'Dove',q.id::text,'moderate',jsonb_build_object('type',q.question_type,'question',q.question_text,
   'options',to_jsonb(q.options),'correct_answer',q.correct_answer,'accepted_answers',to_jsonb(q.accepted_answers),
   'explanation',q.explanation) FROM public.dove_questions q WHERE q.status IN ('published','live','closed','active')
  UNION ALL
  SELECT 'Arena',d.room_id::text||':'||n,'moderate',q
   FROM public.arena_question_decks d,LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.questions)='array' THEN d.questions ELSE '[]'::jsonb END) WITH ORDINALITY x(q,n)
  UNION ALL
  SELECT 'Prelude',f.id::text,'moderate',jsonb_build_object('type','standard_text',
   'question','Which biblical number is associated with this fact: '||f.meaning||'?',
   'correct_answer',f.number::text,'reference',f.reference,'explanation',f.meaning)
   FROM scripture_games.number_facts f
  UNION ALL
  SELECT 'Puzzle Trivia',p.difficulty||':'||p.level||':'||n,p.difficulty,
   jsonb_build_object('type','standard_text','question','Name the biblical '||coalesce(w->>'category','word')||': '||(w->>'clue'),
    'correct_answer',w->>'word','reference',w->>'reference','explanation',w->>'clue')
   FROM scripture_games.puzzle_catalog p,LATERAL jsonb_array_elements(p.payload->'board'->'words') WITH ORDINALITY x(w,n)
 ) SELECT source,source_id,coalesce(difficulty,'moderate'),valediction_private.normalise(payload)
 FROM raw WHERE valediction_private.normalise(payload) IS NOT NULL;
$$;

CREATE FUNCTION valediction_private.fingerprint(p_session uuid) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT md5(coalesce(string_agg(id::text||':'||question_index||':'||question_payload::text,'|' ORDER BY question_index,id),''))
 FROM public.generated_questions WHERE quiz_session_id=p_session;
$$;

CREATE FUNCTION public.generate_valediction_draft(p_session uuid,p_count integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE session public.quiz_sessions; candidate record; selected jsonb; counts jsonb; total integer; i integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN RAISE EXCEPTION 'Only an active instructor can prepare Valediction.' USING ERRCODE='42501'; END IF;
 IF p_count IS NULL OR p_count<10 OR p_count>100 THEN RAISE EXCEPTION 'Choose 10 to 100 questions.'; END IF;
 SELECT * INTO session FROM public.quiz_sessions WHERE id=p_session FOR UPDATE;
 IF NOT FOUND OR session.quiz_type<>'valediction' OR session.status<>'scheduled' THEN RAISE EXCEPTION 'Choose an unpublished Valediction draft.'; END IF;
 IF EXISTS(SELECT 1 FROM public.quiz_attempts WHERE quiz_session_id=p_session) THEN RAISE EXCEPTION 'A quiz with attempts cannot be regenerated.'; END IF;
 WITH unique_questions AS (
  SELECT *,row_number() OVER(PARTITION BY regexp_replace(lower(payload->>'question'),'[^[:alnum:]]','','g') ORDER BY random()) duplicate_rank
  FROM valediction_private.pool(p_session)
 ), balanced AS (
  SELECT *,row_number() OVER(PARTITION BY source ORDER BY random()) source_rank
  FROM unique_questions WHERE duplicate_rank=1
 ) SELECT jsonb_agg(to_jsonb(chosen)),count(*)::integer INTO selected,total
 FROM (SELECT source,source_id,difficulty,payload FROM balanced ORDER BY source_rank,random() LIMIT p_count) chosen;
 IF total<p_count THEN RAISE EXCEPTION 'Only % suitable unique questions are available; % are required.',total,p_count; END IF;
 DELETE FROM public.generated_questions WHERE quiz_session_id=p_session;
 FOR candidate IN SELECT value FROM jsonb_array_elements(selected) LOOP
  i:=i+1;
  INSERT INTO public.generated_questions(quiz_session_id,question_index,difficulty_tag,mechanic_type,recycled_from_game,question_payload)
  VALUES(p_session,i,CASE candidate.value->>'difficulty' WHEN 'easy' THEN 'easy' WHEN 'hard' THEN 'hard' ELSE 'moderate' END,
   'valediction_bank',true,(candidate.value->'payload')||jsonb_build_object('valediction_source',candidate.value->>'source','valediction_source_id',candidate.value->>'source_id'));
 END LOOP;
 SELECT jsonb_object_agg(source,n) INTO counts FROM (
  SELECT value->>'source' source,count(*) n FROM jsonb_array_elements(selected) GROUP BY value->>'source') c;
 INSERT INTO valediction_private.reviews(session_id,generated_at,source_counts) VALUES(p_session,clock_timestamp(),counts)
 ON CONFLICT(session_id) DO UPDATE SET generated_at=excluded.generated_at,source_counts=excluded.source_counts,
  validated_at=NULL,validated_by=NULL,content_hash=NULL;
 RETURN jsonb_build_object('question_count',total,'sources',counts,'validated',false);
END $$;

CREATE FUNCTION public.get_valediction_draft_review(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE review valediction_private.reviews;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN RAISE EXCEPTION 'Instructor access required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO review FROM valediction_private.reviews WHERE session_id=p_session;
 RETURN jsonb_build_object('generated_at',review.generated_at,'sources',coalesce(review.source_counts,'{}'),
  'validated',coalesce(review.validated_at IS NOT NULL AND review.content_hash=valediction_private.fingerprint(p_session),false),
  'validated_at',review.validated_at);
END $$;

CREATE FUNCTION public.validate_valediction_draft(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE session public.quiz_sessions; total integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_instructor(auth.uid()) THEN RAISE EXCEPTION 'Instructor validation required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO session FROM public.quiz_sessions WHERE id=p_session FOR UPDATE;
 IF NOT FOUND OR session.quiz_type<>'valediction' OR session.status<>'scheduled' THEN RAISE EXCEPTION 'Only a Valediction draft can be validated.'; END IF;
 SELECT count(*) INTO total FROM public.generated_questions WHERE quiz_session_id=p_session;
 IF total<10 THEN RAISE EXCEPTION 'Review at least 10 questions before validating.'; END IF;
 IF EXISTS(SELECT 1 FROM public.generated_questions WHERE quiz_session_id=p_session AND valediction_private.normalise(question_payload) IS NULL)
 THEN RAISE EXCEPTION 'Fix incomplete or unsupported questions before validating.'; END IF;
 IF EXISTS(SELECT 1 FROM public.generated_questions WHERE quiz_session_id=p_session
  GROUP BY regexp_replace(lower(question_payload->>'question'),'[^[:alnum:]]','','g') HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Remove duplicate questions before validating.'; END IF;
 INSERT INTO valediction_private.reviews(session_id,validated_at,validated_by,content_hash)
 VALUES(p_session,clock_timestamp(),auth.uid(),valediction_private.fingerprint(p_session))
 ON CONFLICT(session_id) DO UPDATE SET validated_at=excluded.validated_at,validated_by=excluded.validated_by,content_hash=excluded.content_hash;
 RETURN public.get_valediction_draft_review(p_session);
END $$;

CREATE FUNCTION valediction_private.invalidate_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid; old_sid uuid; candidate uuid; session public.quiz_sessions;
BEGIN
 IF TG_OP<>'DELETE' THEN sid:=NEW.quiz_session_id; END IF;
 IF TG_OP<>'INSERT' THEN old_sid:=OLD.quiz_session_id; END IF;
 FOR candidate IN SELECT DISTINCT x FROM unnest(ARRAY[sid,old_sid]) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT * INTO session FROM public.quiz_sessions WHERE id=candidate FOR UPDATE;
  IF session.quiz_type='valediction' THEN
   IF session.status<>'scheduled' THEN RAISE EXCEPTION 'Valediction questions can only be edited before launch.'; END IF;
   UPDATE valediction_private.reviews SET validated_at=NULL,validated_by=NULL,content_hash=NULL WHERE session_id=candidate;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER invalidate_valediction_review BEFORE INSERT OR UPDATE OR DELETE ON public.generated_questions
 FOR EACH ROW EXECUTE FUNCTION valediction_private.invalidate_review();

CREATE FUNCTION valediction_private.require_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.quiz_type='valediction' AND NEW.status IN ('countdown','live') AND
  (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.quiz_type IS DISTINCT FROM NEW.quiz_type) THEN
  IF NOT EXISTS(SELECT 1 FROM valediction_private.reviews WHERE session_id=NEW.id AND validated_at IS NOT NULL
   AND content_hash=valediction_private.fingerprint(NEW.id)) THEN RAISE EXCEPTION 'An instructor must validate this Valediction quiz before launch.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER require_valediction_review BEFORE INSERT OR UPDATE OF status,quiz_type ON public.quiz_sessions
 FOR EACH ROW EXECUTE FUNCTION valediction_private.require_review();

CREATE FUNCTION valediction_private.require_validated_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.quiz_sessions WHERE id=NEW.quiz_session_id AND quiz_type='valediction')
  AND NOT EXISTS(SELECT 1 FROM public.quiz_sessions s JOIN valediction_private.reviews r ON r.session_id=s.id
   WHERE s.id=NEW.quiz_session_id AND s.status IN ('countdown','live') AND r.validated_at IS NOT NULL
    AND r.content_hash=valediction_private.fingerprint(s.id)) THEN
  RAISE EXCEPTION 'This Valediction quiz has not been validated and released by an instructor.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER require_validated_valediction_attempt BEFORE INSERT ON public.quiz_attempts
 FOR EACH ROW EXECUTE FUNCTION valediction_private.require_validated_attempt();

DO $patch$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('public.get_current_quiz_session_for_type(text)'::regprocedure);
 body:=replace(body,'WHERE session.quiz_type=p_quiz_type',
  'WHERE (session.quiz_type<>''valediction'' OR session.status<>''scheduled'' OR public.is_instructor(auth.uid())) AND session.quiz_type=p_quiz_type');
 EXECUTE body;
END $patch$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA valediction_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.generate_valediction_draft(uuid,integer),public.validate_valediction_draft(uuid),public.get_valediction_draft_review(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_valediction_draft(uuid,integer),public.validate_valediction_draft(uuid),public.get_valediction_draft_review(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
