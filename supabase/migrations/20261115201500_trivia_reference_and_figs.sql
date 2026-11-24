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
   INSERT INTO scripture_games.fig_entries(user_id,source,amount)
   SELECT uid,'puzzle:'||r.difficulty||':'||r.level||':'||(value->>'word'),1
   FROM jsonb_array_elements(c->'board'->'words')
   WHERE NOT ((value->>'word')=ANY(r.found)) ON CONFLICT DO NOTHING;
   SELECT array_agg(value->>'word') INTO r.found FROM jsonb_array_elements(c->'board'->'words');
   r.assisted:=r.found;
   msg:='Sword of Goliath completed the puzzle. Each newly completed word earns 1 Fig.';
  ELSIF p_relic='freeze-timer' THEN r.deadline:=r.deadline+interval '60 seconds'; msg:='60 seconds added.';
  ELSIF p_relic='reveal-reference' THEN
   IF nullif(w->>'reference','') IS NULL THEN RAISE EXCEPTION 'This word has no Scripture reference.'; END IF;
   IF r.completed_at IS NULL AND r.deadline>clock_timestamp() THEN r.deadline:=r.deadline+interval '10 seconds'; END IF;
   msg:='Scripture reference revealed.';
  ELSE
   r.assisted:=array_append(r.assisted,word);
   IF p_relic='skip' THEN
    r.found:=array_append(r.found,word);
    INSERT INTO scripture_games.fig_entries(user_id,source,amount)
    VALUES(uid,'puzzle:'||r.difficulty||':'||r.level||':'||word,1) ON CONFLICT DO NOTHING;
    msg:='Word completed with Skip for 1 Fig.';
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
  figs:=CASE r.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 3 ELSE 5 END;
  IF word=ANY(r.assisted) OR coalesce(r.aids->word->'used','[]') ? 'freeze-timer' THEN figs:=1;
  ELSIF coalesce(r.aids->word->'used','[]') ? 'reveal-reference' THEN figs:=greatest(figs-1,0);
  END IF;
  IF figs>0 THEN
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

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt_secure(p_attempt_id uuid, p_status text DEFAULT 'submitted'::text, p_use_goliath boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_figs integer := 0;
  v_reward integer := 0;
  v_perfect boolean := false;
  v_source_type text;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_day_type text;
  v_release_at timestamptz;
  v_results_released boolean := true;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_status NOT IN ('submitted', 'timed_out') THEN RAISE EXCEPTION 'Invalid completion status.'; END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz attempt not found.'; END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz session not found.'; END IF;

  IF v_session.quiz_type = 'saturday' THEN
    v_release_at := (v_session.session_date + time '16:00') AT TIME ZONE 'Africa/Douala';
    v_results_released := now() >= v_release_at;
  END IF;

  IF v_attempt.status IN ('submitted', 'timed_out') THEN
    IF v_session.quiz_type = 'saturday' AND v_results_released THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'attempt', to_jsonb(v_attempt),
      'already_submitted', true,
      'results_released', v_results_released,
      'release_at', v_release_at
    );
  END IF;
  IF v_attempt.status <> 'in_progress' THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE public.quiz_answer_is_correct(response.answer, question.question_payload)
    )::integer,
    coalesce(sum(CASE
      WHEN v_session.quiz_type <> 'valediction' AND aids.skipped AND response.answer IS NULL THEN 1
      WHEN NOT coalesce(public.quiz_answer_is_correct(response.answer, question.question_payload),false) THEN 0
      WHEN v_session.quiz_type <> 'valediction' AND (aids.other_relic OR response.assisted_by_relic) THEN 1
      ELSE greatest((CASE question.difficulty_tag WHEN 'hard' THEN 5 WHEN 'moderate' THEN 3 ELSE 1 END)
        - CASE WHEN v_session.quiz_type <> 'valediction' AND aids.reference_used THEN 1 ELSE 0 END,0)
    END), 0)::integer
  INTO v_question_count, v_correct_count, v_figs
  FROM public.generated_questions question
  LEFT JOIN public.question_responses response
    ON response.question_id = question.id
    AND response.quiz_attempt_id = v_attempt.id
  LEFT JOIN LATERAL (
    SELECT bool_or(effect_applied = 'skip') AS skipped,
      bool_or(effect_applied = 'reveal-reference') AS reference_used,
      bool_or(effect_applied <> 'reveal-reference') AS other_relic
    FROM public.relic_usage_log
    WHERE quiz_attempt_id=v_attempt.id AND question_id=question.id
  ) aids ON true
  WHERE question.quiz_session_id = v_attempt.quiz_session_id;
  IF v_question_count = 0 THEN RAISE EXCEPTION 'This quiz has no questions.'; END IF;

  IF v_session.quiz_type = 'valediction' AND p_use_goliath THEN
    RAISE EXCEPTION 'Relics cannot be used in the Valediction quiz.';
  END IF;
  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory
    FROM public.relic_inventory
    WHERE user_id = v_user_id
      AND relic_type_id = v_relic.id
      AND quantity > 0
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;

    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, quiz_attempt_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_attempt.id, v_relic.id, 'perfect_quiz');
    v_correct_count := v_question_count;
    v_figs := v_question_count;
  END IF;

  v_perfect := v_correct_count = v_question_count;
  v_reward := CASE
    WHEN v_perfect THEN coalesce(v_session.reward_perfect, 6000)
    WHEN v_correct_count > 0 THEN coalesce(v_session.reward_partial, 1000)
    ELSE 0
  END;
  IF v_session.quiz_type = 'valediction' THEN v_reward := 0; END IF;
  v_source_type := CASE
    WHEN v_session.quiz_type = 'fortune' THEN 'fortune_quiz_reward'
    ELSE 'quiz_reward'
  END;

  UPDATE public.quiz_attempts
  SET status = p_status,
      talents_scored = CASE WHEN v_session.quiz_type = 'saturday' THEN 0 ELSE v_figs END,
      highest_question_reached = greatest(highest_question_reached, v_question_count),
      submitted_at = now(),
      relics_used = CASE WHEN p_use_goliath
        THEN coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('slug', 'sword-goliath', 'used_at', now())
        )
        ELSE relics_used
      END
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_session.quiz_type = 'saturday' THEN
    INSERT INTO public.weekly_quiz_result_releases(
      attempt_id, user_id, quiz_session_id, correct_count, question_count,
      figs_earned, perfect, denarii_award, release_at
    ) VALUES (
      v_attempt.id, v_user_id, v_session.id, v_correct_count, v_question_count,
      v_figs, v_perfect, v_reward, v_release_at
    )
    ON CONFLICT (attempt_id) DO UPDATE
      SET correct_count = EXCLUDED.correct_count,
          question_count = EXCLUDED.question_count,
          figs_earned = EXCLUDED.figs_earned,
          perfect = EXCLUDED.perfect,
          denarii_award = EXCLUDED.denarii_award,
          release_at = EXCLUDED.release_at,
          released_at = NULL;

    IF v_results_released THEN
      PERFORM public.release_due_weekly_quiz_results(v_attempt.id);
      SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = v_attempt.id;
    END IF;
  ELSIF v_reward > 0 AND NOT EXISTS (
    SELECT 1
    FROM public.denarii_ledger_entries
    WHERE user_id = v_user_id
      AND source_type = v_source_type
      AND source_reference = v_attempt.id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries(
      user_id, amount, source_type, source_reference, description
    ) VALUES (
      v_user_id,
      v_reward,
      v_source_type,
      v_attempt.id::text,
      (CASE WHEN v_perfect
        THEN 'Perfect quiz score'
        ELSE v_correct_count || '/' || v_question_count || ' correct'
      END) || ' · ' || v_figs || ' figs'
    );
  END IF;

  IF v_session.quiz_type <> 'valediction' THEN
  v_day_type := CASE
    WHEN extract(dow FROM v_session.session_date) = 0 THEN 'sunday'
    WHEN extract(dow FROM v_session.session_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  INSERT INTO public.daily_records(user_id, record_date, day_type, quiz_attempt_id, streak_valid)
  VALUES (
    v_user_id,
    v_session.session_date,
    v_day_type,
    v_attempt.id,
    CASE WHEN v_day_type = 'saturday' THEN true ELSE NULL END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE
    SET quiz_attempt_id = EXCLUDED.quiz_attempt_id,
        streak_valid = CASE
          WHEN EXCLUDED.day_type = 'saturday' THEN true
          ELSE public.daily_records.streak_valid
        END;

  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'attempt', to_jsonb(v_attempt),
    'results_released', v_results_released,
    'release_at', v_release_at,
    'correct_count', CASE WHEN v_results_released THEN v_correct_count ELSE NULL END,
    'question_count', CASE WHEN v_results_released THEN v_question_count ELSE NULL END,
    'figs', CASE WHEN v_results_released THEN v_figs ELSE NULL END,
    'perfect', CASE WHEN v_results_released THEN v_perfect ELSE NULL END,
    'denarii_awarded', CASE WHEN v_results_released THEN v_reward ELSE NULL END
  ));
END;
$function$;

CREATE FUNCTION private.score_classic_trivia_relic_answer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT NEW.is_correct THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM private.classic_trivia_relics
    WHERE room_id=NEW.room_id AND user_id=NEW.user_id AND (
      (question_index=NEW.question_index AND slug='witch-ball-endor')
      OR (slug='freeze-timer' AND personal_question <= (
        SELECT count(*) FROM public.arena_trivia_responses
        WHERE room_id=NEW.room_id AND user_id=NEW.user_id
      ) AND personal_question + 6 > (
        SELECT count(*) FROM public.arena_trivia_responses
        WHERE room_id=NEW.room_id AND user_id=NEW.user_id
      ))
    )) THEN
    NEW.figs_earned:=1;
  ELSIF EXISTS (SELECT 1 FROM private.classic_trivia_relics
    WHERE room_id=NEW.room_id AND user_id=NEW.user_id AND question_index=NEW.question_index AND slug='reveal-reference') THEN
    NEW.figs_earned:=greatest(0,NEW.figs_earned-1);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.score_classic_trivia_relic_answer() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER score_classic_trivia_relic_answer BEFORE INSERT ON public.arena_trivia_responses
FOR EACH ROW EXECUTE FUNCTION private.score_classic_trivia_relic_answer();

CREATE FUNCTION private.quiz_relic_closes_at(p_session public.quiz_sessions,p_attempt public.quiz_attempts)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_session.quiz_type='saturday' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_attempt.relics_used,'[]')) used WHERE used->>'slug'='lazarus-coin')
    THEN greatest(p_session.live_closes_at,(p_session.session_date+time '14:45') AT TIME ZONE 'Africa/Douala')
    ELSE p_session.live_closes_at END
    + make_interval(secs=>10*(SELECT count(DISTINCT used->>'question_id')::int
      FROM jsonb_array_elements(coalesce(p_attempt.relics_used,'[]')) used WHERE used->>'slug'='reveal-reference'));
$$;
REVOKE ALL ON FUNCTION private.quiz_relic_closes_at(public.quiz_sessions,public.quiz_attempts) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.save_quiz_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question public.generated_questions%ROWTYPE;
  v_donkey_active boolean := false;
  v_correct boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This quiz attempt is not active.';
  END IF;

  SELECT * INTO v_session FROM public.quiz_sessions WHERE id = v_attempt.quiz_session_id;
  IF now() >= private.quiz_relic_closes_at(v_session,v_attempt) THEN
    RAISE EXCEPTION 'Quiz time has ended.';
  END IF;

  SELECT * INTO v_question FROM public.generated_questions
  WHERE id = p_question_id AND quiz_session_id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this quiz.'; END IF;

  v_correct := public.quiz_answer_is_correct(p_answer, v_question.question_payload);
  v_donkey_active := EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_attempt.relics_used, '[]'::jsonb)) used
    WHERE used->>'slug' = 'talking-donkey'
      AND used->>'question_id' = p_question_id::text
  );

  IF v_donkey_active AND NOT v_correct THEN
    UPDATE public.quiz_attempts
    SET relics_used = coalesce((
      SELECT jsonb_agg(used)
      FROM jsonb_array_elements(coalesce(relics_used, '[]'::jsonb)) used
      WHERE NOT (
        used->>'slug' = 'talking-donkey'
        AND used->>'question_id' = p_question_id::text
      )
    ), '[]'::jsonb)
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
      'accepted', false,
      'warning', 'The Talking Donkey warns that this answer is not right. Try another answer.'
    );
  END IF;

  INSERT INTO public.question_responses (
    quiz_attempt_id, question_id, answer, submitted_at, last_edited_at
  ) VALUES (
    v_attempt.id, p_question_id, p_answer, now(), now()
  )
  ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE SET
    answer = EXCLUDED.answer,
    last_edited_at = now();

  UPDATE public.quiz_attempts
  SET highest_question_reached = greatest(highest_question_reached, v_question.question_index)
  WHERE id = v_attempt.id;

  RETURN jsonb_build_object('accepted', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_quiz_runtime_state(
  p_quiz_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.quiz_sessions%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_attempt_found boolean := false;
  v_lazarus_active boolean := false;
  v_server_now timestamptz := clock_timestamp();
  v_effective_closes_at timestamptz;
  v_lazarus_opens_at timestamptz;
  v_lazarus_closes_at timestamptz;
  v_can_play boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz session not found.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = v_user_id
    AND quiz_session_id = p_quiz_session_id;
  v_attempt_found := FOUND;

  IF v_attempt_found THEN
    v_lazarus_active := EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(v_attempt.relics_used, '[]'::jsonb)) used
      WHERE used->>'slug' = 'lazarus-coin'
    );
  END IF;

  v_lazarus_opens_at := v_session.session_date::timestamp AT TIME ZONE 'Africa/Douala';
  v_lazarus_closes_at := (v_session.session_date + time '14:45') AT TIME ZONE 'Africa/Douala';
  v_effective_closes_at := private.quiz_relic_closes_at(v_session,v_attempt);

  v_can_play := v_attempt_found
    AND v_attempt.status = 'in_progress'
    AND v_session.status <> 'scheduled'
    AND (
      (
        v_server_now >= v_session.live_opens_at
        AND v_server_now < v_effective_closes_at
      )
      OR (
        v_session.quiz_type = 'saturday'
        AND v_lazarus_active
        AND v_server_now >= v_lazarus_opens_at
        AND v_server_now < v_effective_closes_at
      )
    );

  RETURN jsonb_build_object(
    'server_now', v_server_now,
    'effective_closes_at', v_effective_closes_at,
    'can_play', v_can_play,
    'attempt', CASE WHEN v_attempt_found THEN to_jsonb(v_attempt) ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.use_quiz_question_relic(
  p_attempt_id uuid,
  p_question_id uuid,
  p_relic_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_reference text;
  v_passage text;
  v_question public.generated_questions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_eliminated jsonb := '[]'::jsonb;
  v_effect jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_relic_slug NOT IN ('hint', 'eliminate', 'skip', 'reveal-reference', 'witch-ball-endor', 'talking-donkey') THEN
    RAISE EXCEPTION 'This relic cannot be used on an individual quiz question.';
  END IF;
  SELECT * INTO v_attempt FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = v_user_id AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This quiz attempt is not active.'; END IF;
  SELECT * INTO v_question FROM public.generated_questions
  WHERE id = p_question_id AND quiz_session_id = v_attempt.quiz_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question does not belong to this quiz.'; END IF;
  SELECT * INTO v_session FROM public.quiz_sessions WHERE id=v_attempt.quiz_session_id;
  IF v_session.quiz_type='valediction' THEN RAISE EXCEPTION 'Relics cannot be used in the Valediction quiz.'; END IF;
  IF now() >= private.quiz_relic_closes_at(v_session,v_attempt) THEN RAISE EXCEPTION 'Quiz time has ended.'; END IF;
  IF p_relic_slug='reveal-reference' THEN
    v_reference:=nullif(btrim(v_question.question_payload->>'reference'),'');
    v_passage:=nullif(btrim(v_question.question_payload->>'passage'),'');
    IF coalesce(v_reference,v_passage) IS NULL THEN RAISE EXCEPTION 'This question has no Scripture reference.'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_attempt.relics_used,'[]')) item
      WHERE item->>'slug'='reveal-reference' AND item->>'question_id'=p_question_id::text)
    THEN RAISE EXCEPTION 'Reveal Reference was already used on this question.'; END IF;
  END IF;
  SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;
  SELECT * INTO v_inventory FROM public.relic_inventory
  WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;

  UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
  INSERT INTO public.relic_usage_log(user_id, quiz_attempt_id, relic_type_id, question_id, effect_applied)
  VALUES (v_user_id, v_attempt.id, v_relic.id, v_question.id, p_relic_slug);

  IF p_relic_slug = 'hint' THEN
    v_effect := jsonb_build_object('notice', coalesce(nullif(v_question.question_payload->>'hint', ''),
      'Read the question and passage again for the detail that distinguishes the choices.'));
  ELSIF p_relic_slug = 'eliminate' THEN
    SELECT coalesce(jsonb_agg(option_value), '[]'::jsonb) INTO v_eliminated
    FROM (SELECT option_value
      FROM jsonb_array_elements_text(coalesce(v_question.question_payload->'options', '[]'::jsonb)) options(option_value)
      WHERE option_value <> v_question.question_payload->>'correct_answer'
      ORDER BY random() LIMIT 2) wrong;
    v_effect := jsonb_build_object('eliminated_options', v_eliminated, 'notice', 'Wrong options have been removed.');
  ELSIF p_relic_slug = 'skip' THEN
    INSERT INTO public.question_responses(quiz_attempt_id, question_id, answer, submitted_at, last_edited_at, assisted_by_relic)
    VALUES (v_attempt.id, v_question.id, NULL, now(), now(), true)
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE
      SET answer = NULL, last_edited_at = now(), assisted_by_relic = true;
    v_effect := jsonb_build_object('skipped', true, 'notice', 'Question skipped. It will not add to your score.');
  ELSIF p_relic_slug = 'reveal-reference' THEN
    UPDATE public.quiz_attempts SET relics_used=coalesce(relics_used,'[]')||jsonb_build_array(
      jsonb_build_object('slug','reveal-reference','question_id',p_question_id,'used_at',now()))
    WHERE id=v_attempt.id RETURNING * INTO v_attempt;
    v_effect:=jsonb_build_object('reference',coalesce(v_reference,'Scripture passage'),
      'passage',v_passage,'effective_closes_at',private.quiz_relic_closes_at(v_session,v_attempt));
  ELSIF p_relic_slug = 'witch-ball-endor' THEN
    INSERT INTO public.question_responses(quiz_attempt_id, question_id, answer, submitted_at, last_edited_at, assisted_by_relic)
    VALUES (v_attempt.id, v_question.id, v_question.question_payload->'correct_answer', now(), now(), true)
    ON CONFLICT (quiz_attempt_id, question_id) DO UPDATE
      SET answer = EXCLUDED.answer, last_edited_at = now(), assisted_by_relic = true;
    v_effect := jsonb_build_object('auto_answered', true, 'figs_earned', 1,
      'notice', 'The answer has been secured for this question. This assisted answer earns 1 Fig.');
  ELSIF p_relic_slug = 'talking-donkey' THEN
    UPDATE public.quiz_attempts SET relics_used = coalesce(relics_used, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('slug', p_relic_slug, 'question_id', p_question_id, 'used_at', now()))
    WHERE id = v_attempt.id;
    v_effect := jsonb_build_object('donkey_active', true, 'notice', 'The Talking Donkey is listening.');
  END IF;
  RETURN jsonb_build_object('success', true, 'slug', p_relic_slug) || v_effect;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_arena_trivia_answer(
  p_room_id uuid,
  p_user_id uuid,
  p_question_index integer,
  p_answer text
)
RETURNS TABLE(
  is_correct boolean,
  figs_earned integer,
  total_figs integer,
  correct_count integer,
  machine_question_index integer,
  machine_answer text,
  machine_correct boolean,
  machine_figs integer,
  machine_total_figs integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_questions jsonb;
  v_question jsonb;
  v_correct text;
  v_is_correct boolean;
  v_figs integer;
  v_expected_index integer;
  v_expected_user uuid;
  v_participant_count integer;
  v_machine_question jsonb;
  v_machine_correct boolean;
  v_machine_answer text;
  v_machine_figs integer := 0;
  v_machine_accuracy numeric;
  v_existing public.arena_trivia_responses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only submit an Arena answer as yourself.';
  END IF;

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Arena game is not active.';
  END IF;
  IF v_room.room_name ILIKE '%[arena:ludo]%' THEN
    RAISE EXCEPTION 'Road Home answers are handled by its authoritative game engine.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id = p_user_id AND forfeited_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You are not an active participant in this Arena room.';
  END IF;

  SELECT * INTO v_existing
  FROM public.arena_trivia_responses
  WHERE room_id = p_room_id AND user_id = p_user_id AND question_index = p_question_index;
  IF FOUND THEN
    RETURN QUERY
    SELECT v_existing.is_correct, v_existing.figs_earned,
      COALESCE(sum(response.figs_earned), 0)::integer,
      count(*) FILTER (WHERE response.is_correct)::integer,
      NULL::integer, NULL::text, NULL::boolean, 0,
      COALESCE((SELECT sum(machine.figs_earned) FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id), 0)::integer
    FROM public.arena_trivia_responses response
    WHERE response.room_id = p_room_id AND response.user_id = p_user_id;
    RETURN;
  END IF;

  SELECT deck.questions INTO v_questions
  FROM public.arena_question_decks deck
  WHERE deck.room_id = p_room_id;
  IF v_questions IS NULL THEN
    RAISE EXCEPTION 'Arena question deck is unavailable.';
  END IF;

  IF v_room.play_mode = 'machine' THEN
    SELECT count(*) * 2 INTO v_expected_index
    FROM public.arena_trivia_responses
    WHERE room_id = p_room_id AND user_id = p_user_id;
    IF p_question_index <> v_expected_index THEN
      RAISE EXCEPTION 'That is not your current Arena question.';
    END IF;
  ELSE
    SELECT count(*) INTO v_expected_index
    FROM public.arena_trivia_responses
    WHERE room_id = p_room_id;
    IF p_question_index <> v_expected_index THEN
      RAISE EXCEPTION 'That Arena turn has already moved.';
    END IF;
    SELECT count(*) INTO v_participant_count
    FROM public.arena_participants
    WHERE room_id = p_room_id AND forfeited_at IS NULL;
    SELECT participant.user_id INTO v_expected_user
    FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id AND participant.forfeited_at IS NULL
    ORDER BY participant.joined_at, participant.user_id
    OFFSET (p_question_index % GREATEST(v_participant_count, 1)) LIMIT 1;
    IF v_expected_user IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'It is another player''s turn.';
    END IF;
  END IF;

  v_question := v_questions -> p_question_index;
  IF v_question IS NULL OR trim(COALESCE(v_question ->> 'correct_answer', '')) = '' THEN
    RAISE EXCEPTION 'This Arena question is unavailable.';
  END IF;
  v_correct := v_question ->> 'correct_answer';
  v_is_correct := public.normalise_arena_answer(p_answer) = public.normalise_arena_answer(v_correct);
  v_figs := CASE WHEN v_is_correct THEN CASE WHEN COALESCE((v_question ->> 'is_bonus')::boolean, false) THEN 2 ELSE 1 END ELSE 0 END;

  INSERT INTO public.arena_trivia_responses (room_id, user_id, question_index, submitted_answer, is_correct, figs_earned)
  VALUES (p_room_id, p_user_id, p_question_index, COALESCE(p_answer, ''), v_is_correct, v_figs)
  RETURNING arena_trivia_responses.figs_earned INTO v_figs;

  machine_question_index := NULL;
  machine_answer := NULL;
  machine_correct := NULL;
  machine_figs := 0;

  IF v_room.play_mode = 'machine' AND p_question_index + 1 < jsonb_array_length(v_questions) THEN
    machine_question_index := p_question_index + 1;
    v_machine_question := v_questions -> machine_question_index;
    v_machine_accuracy := CASE
      WHEN v_room.room_name ILIKE '%[difficulty:easy]%' THEN 0.35
      WHEN v_room.room_name ILIKE '%[difficulty:hard]%' THEN 0.82
      ELSE 0.58
    END;
    v_machine_correct := random() < v_machine_accuracy;
    IF v_machine_correct THEN
      v_machine_answer := v_machine_question ->> 'correct_answer';
    ELSE
      SELECT option INTO v_machine_answer
      FROM jsonb_array_elements_text(COALESCE(v_machine_question -> 'options', '[]'::jsonb)) AS options(option)
      WHERE public.normalise_arena_answer(option) <> public.normalise_arena_answer(v_machine_question ->> 'correct_answer')
      ORDER BY random() LIMIT 1;
      v_machine_answer := COALESCE(v_machine_answer, 'No answer');
    END IF;
    v_machine_figs := CASE WHEN v_machine_correct THEN CASE WHEN COALESCE((v_machine_question ->> 'is_bonus')::boolean, false) THEN 2 ELSE 1 END ELSE 0 END;
    INSERT INTO public.arena_machine_trivia_responses (room_id, question_index, submitted_answer, is_correct, figs_earned)
    VALUES (p_room_id, machine_question_index, v_machine_answer, v_machine_correct, v_machine_figs)
    ON CONFLICT (room_id, question_index) DO NOTHING;
    SELECT response.submitted_answer, response.is_correct, response.figs_earned
    INTO machine_answer, machine_correct, machine_figs
    FROM public.arena_machine_trivia_responses response
    WHERE response.room_id = p_room_id AND response.question_index = machine_question_index;
  END IF;

  RETURN QUERY
  SELECT v_is_correct, v_figs,
    COALESCE(sum(response.figs_earned), 0)::integer,
    count(*) FILTER (WHERE response.is_correct)::integer,
    machine_question_index, machine_answer, machine_correct, machine_figs,
    COALESCE((SELECT sum(machine.figs_earned) FROM public.arena_machine_trivia_responses machine WHERE machine.room_id = p_room_id), 0)::integer
  FROM public.arena_trivia_responses response
  WHERE response.room_id = p_room_id AND response.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION scripture_games.prelude_advance(p_room uuid,p_state jsonb,p_correct boolean,p_joker boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE idx int:=(p_state->>'turn')::int; player jsonb; deck jsonb; center jsonb; capture int;
  base_figs int:=CASE WHEN p_state->>'difficulty'='hard' THEN 5 ELSE 1 END;
  used_relics jsonb:=coalesce(p_state->'pending'->'relics','[]');
BEGIN
 player:=p_state->'players'->idx;
 IF p_correct OR p_joker THEN
  capture:=jsonb_array_length(p_state->'board');
  player:=player||jsonb_build_object('cards',(player->>'cards')::int+capture,
   'correct',(player->>'correct')::int+CASE WHEN p_correct AND NOT p_joker THEN 1 ELSE 0 END,
   'figs',coalesce((player->>'figs')::int,(player->>'correct')::int*base_figs)
     + CASE WHEN p_joker OR NOT p_correct THEN 0
            WHEN used_relics ?| ARRAY['freeze-timer','witch-ball-endor'] THEN 1
            WHEN used_relics ? 'reveal-reference' THEN greatest(base_figs-1,0)
            ELSE base_figs END,
   'collected',coalesce(player->'collected','[]'::jsonb)||(p_state->'board'),
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

CREATE OR REPLACE FUNCTION scripture_games.prelude_finish(p_room uuid,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE winner text; player jsonb; amount int; scheduled boolean;
BEGIN
 IF coalesce(jsonb_typeof(p_state->'deck'),'null')<>'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'deck') WHERE NOT (value->>'drawn')::boolean) THEN
  RAISE EXCEPTION 'Use every closed card before ending the round.';
 END IF;
 SELECT value->>'id' INTO winner FROM jsonb_array_elements(p_state->'players') ORDER BY (value->>'cards')::int DESC,(value->>'correct')::int DESC,coalesce((value->>'firstCapture')::int,2147483647) ASC,(value->>'id') LIMIT 1;
 p_state:=p_state||jsonb_build_object('phase','completed','reward',CASE WHEN winner='machine' THEN 0 ELSE 1000 END,'winnerId',winner,'pending',NULL,'notice','Round complete. Most cards wins; ties use correct answers, then earliest capture.');
 SELECT EXISTS(SELECT 1 FROM public.arena_scheduled_matches WHERE room_id=p_room) INTO scheduled;
 FOR player IN SELECT value FROM jsonb_array_elements(p_state->'players') LOOP
  IF player->>'id'<>'machine' THEN
   UPDATE public.arena_participants SET score=coalesce((player->>'figs')::int,(player->>'correct')::int * CASE WHEN p_state->>'difficulty'='hard' THEN 5 ELSE 1 END),
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
