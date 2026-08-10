/* Server-authoritative daily game delivery, answers, aids, scoring, and rewards. */

DROP POLICY IF EXISTS "instructor_select_custom_questions" ON public.custom_questions;
CREATE POLICY "instructor_select_custom_questions"
ON public.custom_questions FOR SELECT TO authenticated
USING (public.is_instructor(auth.uid()));

CREATE TABLE IF NOT EXISTS public.daily_game_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  narrative_date date NOT NULL,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 7),
  mode text NOT NULL CHECK (mode IN ('normal', 'practice', 'blitz')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  question_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_payloads jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_game_runs_one_active_level
ON public.daily_game_runs(user_id, narrative_date, level, mode)
WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS public.daily_game_responses (
  run_id uuid NOT NULL REFERENCES public.daily_game_runs(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.custom_questions(id) ON DELETE CASCADE,
  submitted_answer text NOT NULL DEFAULT '',
  is_correct boolean NOT NULL,
  figs_earned integer NOT NULL DEFAULT 0 CHECK (figs_earned >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.daily_game_question_aids (
  run_id uuid NOT NULL REFERENCES public.daily_game_runs(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.custom_questions(id) ON DELETE CASCADE,
  aid_type text NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id, aid_type)
);

ALTER TABLE public.daily_game_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_game_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_game_question_aids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_game_runs, public.daily_game_responses, public.daily_game_question_aids FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.daily_game_question_type(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(p_raw, 'multiple_choice')
    WHEN 'fill_blank' THEN 'cloze'
    WHEN 'cloze' THEN 'cloze'
    WHEN 'word_to_meaning' THEN 'matching'
    WHEN 'matching' THEN 'matching'
    WHEN 'first_letter' THEN 'scriptorium'
    WHEN 'scriptorium' THEN 'scriptorium'
    WHEN 'build_verse' THEN 'order_sequence'
    WHEN 'order_sequence' THEN 'order_sequence'
    WHEN 'written' THEN 'standard_text'
    WHEN 'short_answer' THEN 'standard_text'
    ELSE coalesce(p_raw, 'multiple_choice')
  END;
$$;

CREATE OR REPLACE FUNCTION public.daily_game_answer_is_correct(p_answer text, p_question_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question public.custom_questions%ROWTYPE;
  v_type text;
  v_expected text;
  v_item text;
  v_parts text[];
  v_expected_parts text[] := '{}'::text[];
BEGIN
  SELECT * INTO v_question FROM public.custom_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_type := public.daily_game_question_type(v_question.question_type);
  v_expected := v_question.correct_answer;
  IF v_type IN ('matching', 'category_sort') THEN
    FOR v_item IN SELECT jsonb_array_elements_text(coalesce(v_question.options, '[]'::jsonb))
    LOOP
      v_parts := string_to_array(replace(v_item, '—', '|'), '|');
      IF cardinality(v_parts) >= 2 THEN
        v_expected_parts := array_append(
          v_expected_parts,
          CASE WHEN v_type = 'category_sort'
            THEN btrim(v_parts[1]) || ':' || btrim(v_parts[2])
            ELSE btrim(v_parts[2]) END
        );
      END IF;
    END LOOP;
    v_expected := array_to_string(v_expected_parts, '|');
  END IF;
  IF v_type IN ('standard_text', 'scriptorium') THEN
    RETURN btrim(coalesce(p_answer, '')) = btrim(coalesce(v_expected, ''));
  END IF;
  RETURN lower(btrim(coalesce(p_answer, ''))) = lower(btrim(coalesce(v_expected, '')));
END;
$$;

CREATE OR REPLACE FUNCTION public.build_daily_game_question_payload(p_question_id uuid, p_reveal boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question public.custom_questions%ROWTYPE;
  v_type text;
  v_options jsonb;
  v_payload jsonb;
  v_item text;
  v_parts text[];
  v_lefts text[] := '{}'::text[];
  v_rights text[] := '{}'::text[];
  v_answers text[] := '{}'::text[];
  v_empty_answers jsonb := '[]'::jsonb;
  v_pairs jsonb := '[]'::jsonb;
  v_sort_items jsonb := '[]'::jsonb;
  v_revealed_answer text;
BEGIN
  SELECT * INTO v_question FROM public.custom_questions WHERE id = p_question_id;
  IF NOT FOUND OR NOT coalesce(v_question.is_approved, false) THEN
    RAISE EXCEPTION 'Approved game question not found.';
  END IF;

  v_type := public.daily_game_question_type(v_question.question_type);
  v_options := CASE WHEN jsonb_typeof(v_question.options) = 'array' THEN v_question.options ELSE '[]'::jsonb END;
  v_payload := jsonb_build_object(
    'id', v_question.id,
    'type', v_type,
    'question', v_question.question_text,
    'passage', v_question.passage,
    'game_round', coalesce(v_question.game_round, 1),
    'round_timer_seconds', v_question.round_timer_seconds,
    'passage_display_seconds', v_question.passage_display_seconds,
    'is_bonus', coalesce(v_question.is_bonus, false),
    'difficulty_tag', coalesce(v_question.difficulty_tag, 'moderate')
  );

  IF v_type = 'true_false' THEN
    v_payload := v_payload || jsonb_build_object('options', jsonb_build_array('True', 'False'));
  ELSIF v_type = 'matching' THEN
    FOR v_item IN SELECT jsonb_array_elements_text(v_options)
    LOOP
      v_parts := string_to_array(replace(v_item, '—', '|'), '|');
      IF cardinality(v_parts) >= 2 AND btrim(v_parts[1]) <> '' AND btrim(v_parts[2]) <> '' THEN
        v_lefts := array_append(v_lefts, btrim(v_parts[1]));
        v_rights := array_append(v_rights, btrim(v_parts[2]));
      END IF;
    END LOOP;
    SELECT coalesce(jsonb_agg(jsonb_build_object('left', value, 'right', '') ORDER BY position), '[]'::jsonb)
    INTO v_pairs FROM unnest(v_lefts) WITH ORDINALITY AS left_item(value, position);
    SELECT coalesce(jsonb_agg(value ORDER BY random()), '[]'::jsonb)
    INTO v_options FROM unnest(v_rights) AS right_item(value);
    v_payload := v_payload || jsonb_build_object('pairs', v_pairs, 'options', v_options);
  ELSIF v_type = 'category_sort' THEN
    FOR v_item IN SELECT jsonb_array_elements_text(v_options)
    LOOP
      v_parts := string_to_array(replace(v_item, '—', '|'), '|');
      IF cardinality(v_parts) >= 2 AND btrim(v_parts[1]) <> '' AND btrim(v_parts[2]) <> '' THEN
        v_lefts := array_append(v_lefts, btrim(v_parts[1]));
        v_rights := array_append(v_rights, btrim(v_parts[2]));
      END IF;
    END LOOP;
    SELECT coalesce(jsonb_agg(jsonb_build_object('text', value, 'bucket', '') ORDER BY position), '[]'::jsonb)
    INTO v_sort_items FROM unnest(v_lefts) WITH ORDINALITY AS sort_item(value, position);
    SELECT coalesce(jsonb_agg(DISTINCT value), '[]'::jsonb)
    INTO v_options FROM unnest(v_rights) AS bucket(value);
    v_payload := v_payload || jsonb_build_object('sort_items', v_sort_items, 'buckets', v_options);
  ELSIF v_type = 'cloze' THEN
    v_answers := array_remove(regexp_split_to_array(coalesce(v_question.correct_answer, ''), E'\\s*[|,]\\s*'), '');
    SELECT coalesce(jsonb_agg(''::text ORDER BY position), '[]'::jsonb)
    INTO v_empty_answers FROM generate_series(1, cardinality(v_answers)) AS position;
    IF jsonb_array_length(v_options) = 0 THEN
      SELECT coalesce(jsonb_agg(value ORDER BY random()), '[]'::jsonb)
      INTO v_options FROM unnest(v_answers) AS answer(value);
    END IF;
    v_payload := v_payload || jsonb_build_object(
      'blanked_text', coalesce(v_question.passage, v_question.question_text),
      'blanks', v_empty_answers,
      'items', v_options
    );
  ELSIF v_type = 'order_sequence' THEN
    IF jsonb_array_length(v_options) = 0 THEN
      v_answers := array_remove(regexp_split_to_array(coalesce(v_question.correct_answer, ''), E'\\s*[|,]\\s*'), '');
      SELECT coalesce(jsonb_agg(value ORDER BY random()), '[]'::jsonb)
      INTO v_options FROM unnest(v_answers) AS answer(value);
    ELSE
      SELECT coalesce(jsonb_agg(value ORDER BY random()), '[]'::jsonb)
      INTO v_options FROM jsonb_array_elements_text(v_options) AS option(value);
    END IF;
    v_payload := v_payload || jsonb_build_object('items', v_options);
  ELSIF v_type = 'scriptorium' THEN
    v_payload := v_payload || jsonb_build_object('blanked_text', coalesce(v_question.passage, v_question.question_text));
  ELSIF v_type IN ('multiple_choice', 'comprehension') THEN
    v_payload := v_payload || jsonb_build_object('options', v_options);
  END IF;

  IF p_reveal THEN
    v_revealed_answer := v_question.correct_answer;
    IF v_type = 'matching' THEN
      v_revealed_answer := array_to_string(v_rights, '|');
    ELSIF v_type = 'category_sort' THEN
      SELECT array_to_string(array_agg(v_lefts[position] || ':' || v_rights[position] ORDER BY position), '|')
      INTO v_revealed_answer FROM generate_subscripts(v_lefts, 1) AS position;
    END IF;
    v_payload := v_payload || jsonb_build_object(
      'correct_answer', v_revealed_answer,
      'explanation', v_question.explanation
    );
    IF v_type = 'matching' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('left', v_lefts[position], 'right', v_rights[position]) ORDER BY position), '[]'::jsonb)
      INTO v_pairs FROM generate_subscripts(v_lefts, 1) AS position;
      v_payload := v_payload || jsonb_build_object('pairs', v_pairs);
    ELSIF v_type = 'category_sort' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('text', v_lefts[position], 'bucket', v_rights[position]) ORDER BY position), '[]'::jsonb)
      INTO v_sort_items FROM generate_subscripts(v_lefts, 1) AS position;
      v_payload := v_payload || jsonb_build_object('sort_items', v_sort_items);
    ELSIF v_type = 'cloze' THEN
      v_payload := v_payload || jsonb_build_object('blanks', to_jsonb(v_answers));
    END IF;
  END IF;

  RETURN jsonb_strip_nulls(v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_daily_game_level(
  p_narrative_date date,
  p_level integer,
  p_mode text DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_question_ids jsonb;
  v_payloads jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_level NOT BETWEEN 1 AND 7 OR p_mode NOT IN ('normal', 'practice', 'blitz') THEN
    RAISE EXCEPTION 'Invalid game level or mode.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments role
    WHERE role.user_id = v_user_id AND role.role IN ('cadet', 'sentry')
      AND role.status IN ('active', 'approved')
  ) THEN RAISE EXCEPTION 'Only active cadets and sentries can play the daily game.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives WHERE narrative_date = p_narrative_date) THEN
    RAISE EXCEPTION 'Narrative not found.';
  END IF;
  IF p_level > 1 AND p_mode <> 'practice' AND NOT EXISTS (
    SELECT 1 FROM public.game_attempts previous
    WHERE previous.user_id = v_user_id AND previous.narrative_date = p_narrative_date
      AND previous.level = p_level - 1 AND previous.status = 'passed'
  ) THEN RAISE EXCEPTION 'Complete the previous level first.'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT * INTO v_run FROM public.daily_game_runs
  WHERE user_id = v_user_id AND narrative_date = p_narrative_date
    AND level = p_level AND mode = p_mode AND status = 'in_progress'
  ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('run_id', v_run.id, 'questions', v_run.question_payloads);
  END IF;

  SELECT
    coalesce(jsonb_agg(to_jsonb(question.id::text) ORDER BY coalesce(question.game_round, 1), question.question_index, question.id), '[]'::jsonb),
    coalesce(jsonb_agg(public.build_daily_game_question_payload(question.id, false) ORDER BY coalesce(question.game_round, 1), question.question_index, question.id), '[]'::jsonb)
  INTO v_question_ids, v_payloads
  FROM public.custom_questions question
  WHERE question.narrative_date = p_narrative_date
    AND question.game_level = p_level
    AND question.is_approved = true
    AND (p_level >= 5 OR coalesce(question.is_bonus, false) = false);

  IF jsonb_array_length(v_question_ids) = 0 THEN
    RAISE EXCEPTION 'This level has no instructor-approved questions yet.';
  END IF;

  INSERT INTO public.daily_game_runs(user_id, narrative_date, level, mode, question_ids, question_payloads)
  VALUES (v_user_id, p_narrative_date, p_level, p_mode, v_question_ids, v_payloads)
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('run_id', v_run.id, 'questions', v_run.question_payloads);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_daily_game_answer(
  p_run_id uuid,
  p_question_id uuid,
  p_answer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_response public.daily_game_responses%ROWTYPE;
  v_correct boolean;
  v_figs integer;
  v_total_figs integer;
  v_correct_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.user_id IS DISTINCT FROM v_user_id OR v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;
  IF NOT (v_run.question_ids ? p_question_id::text) THEN RAISE EXCEPTION 'Question is not part of this run.'; END IF;

  SELECT * INTO v_response FROM public.daily_game_responses
  WHERE run_id = p_run_id AND question_id = p_question_id;
  IF FOUND THEN
    SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
    INTO v_total_figs, v_correct_count FROM public.daily_game_responses WHERE run_id = p_run_id;
    RETURN jsonb_build_object(
      'correct', v_response.is_correct,
      'figs_earned', v_response.figs_earned,
      'total_figs', v_total_figs,
      'correct_count', v_correct_count,
      'answer_payload', public.build_daily_game_question_payload(p_question_id, true)
    );
  END IF;

  v_correct := public.daily_game_answer_is_correct(p_answer, p_question_id);
  IF NOT v_correct AND EXISTS (
    SELECT 1 FROM public.daily_game_question_aids
    WHERE run_id = p_run_id AND question_id = p_question_id
      AND aid_type = 'talking-donkey' AND consumed_at IS NULL
  ) THEN
    UPDATE public.daily_game_question_aids SET consumed_at = now()
    WHERE run_id = p_run_id AND question_id = p_question_id AND aid_type = 'talking-donkey';
    RETURN jsonb_build_object('protected', true, 'correct', false, 'notice', 'The Talking Donkey stopped that answer. Try once more.');
  END IF;

  SELECT CASE
    WHEN NOT v_correct THEN 0
    WHEN coalesce(question.difficulty_tag, 'moderate') = 'hard' THEN 5
    WHEN coalesce(question.difficulty_tag, 'moderate') IN ('moderate', 'medium') THEN 3
    ELSE 1 END
  INTO v_figs FROM public.custom_questions question WHERE question.id = p_question_id;

  INSERT INTO public.daily_game_responses(run_id, question_id, submitted_answer, is_correct, figs_earned)
  VALUES (p_run_id, p_question_id, coalesce(p_answer, ''), v_correct, v_figs)
  RETURNING * INTO v_response;
  SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
  INTO v_total_figs, v_correct_count FROM public.daily_game_responses WHERE run_id = p_run_id;

  RETURN jsonb_build_object(
    'correct', v_correct,
    'figs_earned', v_figs,
    'total_figs', v_total_figs,
    'correct_count', v_correct_count,
    'answer_payload', public.build_daily_game_question_payload(p_question_id, true)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.use_daily_game_question_aid(
  p_run_id uuid,
  p_question_id uuid,
  p_aid_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_question public.custom_questions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_cost integer := 0;
  v_wrong_options jsonb := '[]'::jsonb;
  v_result jsonb := '{}'::jsonb;
  v_submit_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.user_id IS DISTINCT FROM v_user_id OR v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;
  IF NOT (v_run.question_ids ? p_question_id::text) THEN RAISE EXCEPTION 'Question is not part of this run.'; END IF;
  IF EXISTS (SELECT 1 FROM public.daily_game_responses WHERE run_id = p_run_id AND question_id = p_question_id) THEN
    RAISE EXCEPTION 'This question has already been answered.';
  END IF;
  SELECT * INTO v_question FROM public.custom_questions WHERE id = p_question_id;

  IF p_aid_type = 'paid-hint' THEN
    v_cost := 50;
  ELSIF p_aid_type = 'paid-reveal' THEN
    v_cost := 100;
  ELSE
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = p_aid_type;
    IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_relic.id, 'daily_game_question:' || p_question_id::text);
  END IF;

  IF v_cost > 0 THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (
      v_user_id, -v_cost,
      CASE WHEN p_aid_type = 'paid-hint' THEN 'hint_purchase' ELSE 'answer_reveal' END,
      p_run_id::text || ':' || p_question_id::text,
      CASE WHEN p_aid_type = 'paid-hint' THEN 'Daily game hint' ELSE 'Daily game answer reveal' END
    );
    INSERT INTO public.denarii_purchases(user_id, purchase_type, amount, reference_id)
    VALUES (v_user_id, CASE WHEN p_aid_type = 'paid-hint' THEN 'hint' ELSE 'answer_reveal' END, v_cost, p_run_id::text);
  END IF;

  IF p_aid_type IN ('paid-reveal', 'witch-ball-endor') THEN
    v_submit_result := public.submit_daily_game_answer(
      p_run_id,
      p_question_id,
      public.build_daily_game_question_payload(p_question_id, true)->>'correct_answer'
    );
    RETURN v_submit_result || jsonb_build_object('auto_answered', true, 'cost', v_cost);
  ELSIF p_aid_type = 'skip' THEN
    v_submit_result := public.submit_daily_game_answer(p_run_id, p_question_id, '');
    RETURN v_submit_result || jsonb_build_object('skipped', true);
  ELSIF p_aid_type = 'talking-donkey' THEN
    INSERT INTO public.daily_game_question_aids(run_id, question_id, aid_type)
    VALUES (p_run_id, p_question_id, p_aid_type)
    ON CONFLICT (run_id, question_id, aid_type) DO UPDATE SET consumed_at = NULL, created_at = now();
    RETURN jsonb_build_object('donkey_active', true, 'notice', 'The Talking Donkey will stop one wrong answer.');
  ELSIF p_aid_type = 'freeze-timer' THEN
    RETURN jsonb_build_object('extra_seconds', 60, 'notice', 'Your current round received 60 extra seconds.');
  ELSIF p_aid_type = 'reveal-reference' THEN
    RETURN jsonb_build_object('reference', v_question.narrative_date, 'notice', 'Return to the reading dated ' || v_question.narrative_date::text || '.');
  ELSIF p_aid_type = 'eliminate' THEN
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO v_wrong_options
    FROM (
      SELECT value FROM jsonb_array_elements_text(coalesce(v_question.options, '[]'::jsonb)) option(value)
      WHERE lower(btrim(value)) <> lower(btrim(v_question.correct_answer))
      ORDER BY random() LIMIT 2
    ) wrong;
    RETURN jsonb_build_object('eliminated_options', v_wrong_options, 'notice', 'Wrong options have been removed.');
  END IF;

  v_result := jsonb_build_object(
    'hint', coalesce(nullif(v_question.explanation, ''), 'Read the question and passage again for the detail that changes the answer.'),
    'cost', v_cost
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_daily_game_run(p_run_id uuid, p_use_goliath boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_question_count integer;
  v_answered_count integer;
  v_correct_count integer;
  v_score integer;
  v_max_score integer;
  v_passed boolean;
  v_level_max integer;
  v_reward integer := 0;
  v_earned_today integer;
  v_attempt public.game_attempts%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.user_id IS DISTINCT FROM v_user_id OR v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This game run is not active for your account.';
  END IF;

  v_question_count := jsonb_array_length(v_run.question_ids);
  SELECT count(*), count(*) FILTER (WHERE response.is_correct), coalesce(sum(response.figs_earned), 0)
  INTO v_answered_count, v_correct_count, v_score
  FROM public.daily_game_responses response WHERE response.run_id = p_run_id;
  SELECT coalesce(sum(CASE
    WHEN coalesce(question.difficulty_tag, 'moderate') = 'hard' THEN 5
    WHEN coalesce(question.difficulty_tag, 'moderate') IN ('moderate', 'medium') THEN 3
    ELSE 1 END), 0)
  INTO v_max_score
  FROM public.custom_questions question
  WHERE v_run.question_ids ? question.id::text;

  IF p_use_goliath THEN
    SELECT * INTO v_relic FROM public.relic_types WHERE slug = 'sword-goliath';
    SELECT * INTO v_inventory FROM public.relic_inventory
    WHERE user_id = v_user_id AND relic_type_id = v_relic.id AND quantity > 0 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own the Sword of Goliath.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
    VALUES (v_user_id, v_relic.id, 'perfect_game_level_' || v_run.level);
    v_correct_count := v_question_count;
    v_score := v_max_score;
  END IF;

  v_passed := v_question_count > 0 AND v_correct_count >= ceil(v_question_count * 0.60);
  v_level_max := CASE WHEN v_run.level <= 3 THEN 50 WHEN v_run.level <= 6 THEN 100 ELSE 200 END;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT coalesce(sum(reward), 0)::integer INTO v_earned_today
  FROM public.game_attempts WHERE user_id = v_user_id AND narrative_date = v_run.narrative_date;
  IF v_passed AND v_run.mode <> 'practice' AND NOT EXISTS (
    SELECT 1 FROM public.game_attempts earned
    WHERE earned.user_id = v_user_id AND earned.narrative_date = v_run.narrative_date
      AND earned.level = v_run.level AND earned.reward > 0
  ) THEN
    v_reward := least(round(v_level_max * (v_score::numeric / greatest(v_max_score, 1)))::integer,
      greatest(1000 - v_earned_today, 0));
  END IF;

  INSERT INTO public.game_attempts(user_id, narrative_date, level, mode, score, max_score, reward, status, completed_at)
  VALUES (v_user_id, v_run.narrative_date, v_run.level, v_run.mode, v_score, v_max_score, v_reward,
    CASE WHEN v_passed THEN 'passed' ELSE 'failed' END, now())
  RETURNING * INTO v_attempt;
  UPDATE public.daily_game_runs SET status = 'completed', completed_at = now() WHERE id = p_run_id;
  IF v_reward > 0 THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (v_user_id, v_reward, 'game_level', v_attempt.id::text,
      'Level ' || v_run.level || ' · ' || v_score || '/' || v_max_score || ' figs');
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'passed', v_passed, 'score', v_score, 'max_score', v_max_score,
    'correct_count', v_correct_count, 'question_count', v_question_count, 'reward', v_reward
  );
END;
$$;

REVOKE ALL ON FUNCTION public.daily_game_question_type(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_game_answer_is_correct(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_daily_game_question_payload(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_daily_game_level(date, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_daily_game_answer(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.use_daily_game_question_aid(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_daily_game_run(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_daily_game_level(date, integer, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_game_assist(date, integer, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_daily_game_level(date, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_daily_game_answer(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_daily_game_question_aid(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_game_run(uuid, boolean) TO authenticated;
