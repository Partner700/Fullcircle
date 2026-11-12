-- Daily Games are available to every signed-in player with a Full Circle profile.
CREATE OR REPLACE FUNCTION public.start_daily_game_level(p_narrative_date date, p_level integer, p_mode text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_run public.daily_game_runs%ROWTYPE;
  v_question_ids jsonb;
  v_payloads jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF p_level NOT BETWEEN 1 AND 7 OR p_mode NOT IN ('normal', 'practice', 'blitz') THEN RAISE EXCEPTION 'Invalid game level or mode.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_narratives WHERE narrative_date = p_narrative_date) THEN RAISE EXCEPTION 'Narrative not found.'; END IF;
  IF p_level > 1 AND p_mode <> 'practice' AND NOT EXISTS (
    SELECT 1 FROM public.game_attempts previous
    WHERE previous.user_id = v_user_id AND previous.narrative_date = p_narrative_date
      AND previous.level = p_level - 1 AND previous.status = 'passed'
  ) THEN RAISE EXCEPTION 'Complete the previous level first.'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A Full Circle profile is required.'; END IF;
  SELECT * INTO v_run FROM public.daily_game_runs
  WHERE user_id = v_user_id AND narrative_date = p_narrative_date
    AND level = p_level AND mode = p_mode AND status = 'in_progress'
  ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('run_id', v_run.id, 'questions', v_run.question_payloads); END IF;

  WITH ranked AS (
    SELECT question.*,
      row_number() OVER (
        PARTITION BY lower(regexp_replace(btrim(question.question_text), '[^a-zA-Z0-9]+', ' ', 'g'))
        ORDER BY coalesce(question.game_round, 1), question.question_index, question.id
      ) AS duplicate_rank
    FROM public.custom_questions question
    WHERE question.narrative_date = p_narrative_date
      AND question.game_level = p_level
      AND question.is_approved = true
      AND (p_level >= 5 OR coalesce(question.is_bonus, false) = false)
  ), selected AS (
    SELECT * FROM ranked WHERE duplicate_rank = 1
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(question.id::text) ORDER BY coalesce(question.game_round, 1), question.question_index, question.id), '[]'::jsonb),
    coalesce(jsonb_agg(public.build_daily_game_question_payload(question.id, false) ORDER BY coalesce(question.game_round, 1), question.question_index, question.id), '[]'::jsonb)
  INTO v_question_ids, v_payloads
  FROM selected question;

  IF jsonb_array_length(v_question_ids) = 0 THEN RAISE EXCEPTION 'This level has no instructor-approved questions yet.'; END IF;
  INSERT INTO public.daily_game_runs(user_id, narrative_date, level, mode, question_ids, question_payloads)
  VALUES (v_user_id, p_narrative_date, p_level, p_mode, v_question_ids, v_payloads)
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('run_id', v_run.id, 'questions', v_run.question_payloads);
END;
$function$;

REVOKE ALL ON FUNCTION public.start_daily_game_level(date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_daily_game_level(date, integer, text) TO authenticated;
