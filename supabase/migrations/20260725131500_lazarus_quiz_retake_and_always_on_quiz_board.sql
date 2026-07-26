-- Lazarus Coin is now a Saturday quiz late/retake relic, not a streak relic.
UPDATE public.relic_types
SET
  description = 'Use before 2:45 PM on Saturday to take the quiz late or retake it before the Quiz Board locks.',
  effect = 'quiz_late_retake',
  effect_type = 'quiz_late_retake',
  effect_scope = 'saturday_quiz',
  money_price_usd = NULL,
  money_price_xaf = NULL,
  denarii_cost = 60000
WHERE slug = 'lazarus-coin';

CREATE OR REPLACE FUNCTION public.reset_quiz_attempt_with_lazarus(
  p_user_id uuid,
  p_quiz_session_id uuid
)
RETURNS public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_inventory public.relic_inventory%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_local_now timestamp := timezone('Africa/Douala', now());
  v_deadline timestamp;
BEGIN
  SELECT * INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_quiz_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz session not found';
  END IF;

  IF v_session.quiz_type <> 'saturday' THEN
    RAISE EXCEPTION 'The Lazarus Coin only applies to Saturday quizzes.';
  END IF;

  v_deadline := v_session.session_date::timestamp + time '15:00';

  IF v_local_now::date <> v_session.session_date OR v_local_now >= v_deadline THEN
    RAISE EXCEPTION 'The Lazarus Coin can only be used before 2:45 PM on quiz day.';
  END IF;

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = 'lazarus-coin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Lazarus Coin is not configured.';
  END IF;

  SELECT * INTO v_inventory
  FROM public.relic_inventory
  WHERE user_id = p_user_id
    AND relic_type_id = v_relic.id
    AND quantity > 0
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You need a Lazarus Coin to take or retake the quiz before 2:45 PM.';
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inventory.id;

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE user_id = p_user_id
    AND quiz_session_id = p_quiz_session_id
  LIMIT 1;

  IF FOUND THEN
    DELETE FROM public.question_responses
    WHERE quiz_attempt_id = v_attempt.id;

    DELETE FROM public.denarii_ledger_entries
    WHERE source_reference = v_attempt.id::text
      AND source_type IN ('quiz_reward', 'fortune_quiz_reward');

    UPDATE public.quiz_attempts
    SET
      status = 'in_progress',
      talents_scored = 0,
      highest_question_reached = 1,
      relics_used = COALESCE(relics_used, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('slug', 'lazarus-coin', 'used_at', now())),
      forfeited_at = NULL,
      submitted_at = NULL
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  ELSE
    INSERT INTO public.quiz_attempts (
      user_id,
      quiz_session_id,
      status,
      highest_question_reached,
      relics_used
    )
    VALUES (
      p_user_id,
      p_quiz_session_id,
      'in_progress',
      1,
      jsonb_build_array(jsonb_build_object('slug', 'lazarus-coin', 'used_at', now()))
    )
    RETURNING * INTO v_attempt;
  END IF;

  RETURN v_attempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_quiz_attempt_with_lazarus(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_quiz_scoreboard();
CREATE OR REPLACE FUNCTION public.get_quiz_scoreboard()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  tent_house_id text,
  daily_game_score bigint,
  random_quiz_score numeric,
  saturday_quiz_score numeric,
  total_score numeric,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now()) AS local_now
  ),
  release AS (
    SELECT
      local_now,
      (local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::date AS week_start,
      (
        (local_now::date - ((EXTRACT(DOW FROM local_now)::int - 6 + 7) % 7))::timestamp
        + time '15:00'
      ) AS released_at
    FROM clock
  ),
  cadets AS (
    SELECT DISTINCT ON (p.id)
      p.id AS user_id,
      p.display_name,
      t.tent_house_id
    FROM public.role_assignments ra
    JOIN public.profiles p ON p.id = ra.user_id
    LEFT JOIN public.tent_members tm ON tm.user_id = p.id AND tm.role = 'cadet'
    LEFT JOIN public.tents t ON t.id = tm.tent_id
    WHERE ra.role = 'cadet'
      AND ra.status IN ('active', 'approved')
    ORDER BY p.id, tm.joined_at DESC NULLS LAST
  ),
  game_scores AS (
    SELECT
      ga.user_id,
      COALESCE(SUM(ga.score), 0)::bigint AS score
    FROM public.game_attempts ga
    CROSS JOIN release r
    WHERE ga.completed_at IS NOT NULL
      AND ga.status IN ('passed', 'failed')
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (ga.completed_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY ga.user_id
  ),
  quiz_scores AS (
    SELECT
      qa.user_id,
      COALESCE(SUM(CASE WHEN qs.quiz_type = 'fortune' THEN qa.talents_scored ELSE 0 END), 0)::numeric AS random_score,
      COALESCE(SUM(CASE WHEN qs.quiz_type = 'saturday' AND r.local_now >= r.released_at THEN qa.talents_scored ELSE 0 END), 0)::numeric AS saturday_score
    FROM public.quiz_attempts qa
    JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
    CROSS JOIN release r
    WHERE qa.status IN ('submitted', 'timed_out')
      AND qa.submitted_at IS NOT NULL
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date >= r.week_start
      AND (qa.submitted_at AT TIME ZONE 'Africa/Douala')::date < (r.week_start + 7)
    GROUP BY qa.user_id
  ),
  totals AS (
    SELECT
      c.user_id,
      c.display_name,
      c.tent_house_id,
      COALESCE(gs.score, 0)::bigint AS daily_game_score,
      COALESCE(qs.random_score, 0)::numeric AS random_quiz_score,
      COALESCE(qs.saturday_score, 0)::numeric AS saturday_quiz_score,
      (COALESCE(gs.score, 0)::numeric + COALESCE(qs.random_score, 0) + COALESCE(qs.saturday_score, 0))::numeric AS total_score
    FROM cadets c
    LEFT JOIN game_scores gs ON gs.user_id = c.user_id
    LEFT JOIN quiz_scores qs ON qs.user_id = c.user_id
  )
  SELECT
    totals.user_id,
    totals.display_name,
    totals.tent_house_id,
    totals.daily_game_score,
    totals.random_quiz_score,
    totals.saturday_quiz_score,
    totals.total_score,
    RANK() OVER (ORDER BY totals.total_score DESC, totals.display_name ASC)::integer AS rank
  FROM totals
  ORDER BY total_score DESC, display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_quiz_scoreboard() TO authenticated;
