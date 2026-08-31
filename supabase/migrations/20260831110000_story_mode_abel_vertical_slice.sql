/* Story Mode Phase 3A: server-authoritative Abel Offering vertical slice. */

CREATE TABLE IF NOT EXISTS public.story_mode_levels (
  slug text PRIMARY KEY,
  book_slug text NOT NULL,
  chapter_slug text NOT NULL,
  title text NOT NULL,
  level_order integer NOT NULL CHECK (level_order > 0),
  unlock_after_level_slug text REFERENCES public.story_mode_levels(slug),
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_slug, chapter_slug, level_order)
);

CREATE TABLE IF NOT EXISTS public.story_mode_questions (
  id text PRIMARY KEY,
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug) ON DELETE CASCADE,
  checkpoint_id text NOT NULL,
  question_order integer NOT NULL CHECK (question_order > 0),
  question_type text NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false')),
  prompt text NOT NULL,
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array'),
  correct_answer text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  timer_seconds integer NOT NULL CHECK (timer_seconds IN (5, 7, 10)),
  scripture_reference text NOT NULL,
  explanation text NOT NULL DEFAULT '',
  correct_action_id text NOT NULL,
  wrong_action_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level_slug, question_order)
);

CREATE TABLE IF NOT EXISTS public.story_mode_checkpoints (
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug) ON DELETE CASCADE,
  checkpoint_id text NOT NULL,
  checkpoint_order integer NOT NULL CHECK (checkpoint_order >= 0),
  state_hint text NOT NULL,
  PRIMARY KEY (level_slug, checkpoint_id),
  UNIQUE (level_slug, checkpoint_order)
);

ALTER TABLE public.story_mode_questions
  ADD CONSTRAINT story_mode_questions_checkpoint_fkey
  FOREIGN KEY (level_slug, checkpoint_id)
  REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id);

CREATE TABLE IF NOT EXISTS public.story_mode_progress (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_book_slug text NOT NULL,
  current_chapter_slug text NOT NULL,
  current_level_slug text NOT NULL REFERENCES public.story_mode_levels(slug),
  checkpoint_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (current_level_slug, checkpoint_id)
    REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS public.story_mode_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  checkpoint_id text NOT NULL,
  is_replay boolean NOT NULL DEFAULT false,
  active_question_id text REFERENCES public.story_mode_questions(id),
  question_started_at timestamptz,
  paused_at timestamptz,
  answer_count integer NOT NULL DEFAULT 0 CHECK (answer_count >= 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS story_mode_one_active_attempt_per_user
  ON public.story_mode_attempts(user_id)
  WHERE status = 'in_progress';

ALTER TABLE public.story_mode_attempts
  ADD CONSTRAINT story_mode_attempts_checkpoint_fkey
  FOREIGN KEY (level_slug, checkpoint_id)
  REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id);

CREATE TABLE IF NOT EXISTS public.story_mode_answer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.story_mode_attempts(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES public.story_mode_questions(id),
  submission_id uuid NOT NULL UNIQUE,
  selected_answer text,
  timed_out boolean NOT NULL DEFAULT false,
  is_correct boolean NOT NULL,
  figs_earned integer NOT NULL DEFAULT 0 CHECK (figs_earned >= 0),
  response_payload jsonb NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_mode_answers_attempt_idx
  ON public.story_mode_answer_events(attempt_id, answered_at);

CREATE TABLE IF NOT EXISTS public.story_mode_fig_entries (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug),
  question_id text NOT NULL REFERENCES public.story_mode_questions(id),
  attempt_id uuid NOT NULL REFERENCES public.story_mode_attempts(id) ON DELETE CASCADE,
  figs integer NOT NULL CHECK (figs IN (1, 3, 5)),
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS story_mode_fig_entries_user_earned_idx
  ON public.story_mode_fig_entries(user_id, earned_at);

CREATE TABLE IF NOT EXISTS public.story_mode_level_completions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug),
  first_completed_at timestamptz NOT NULL DEFAULT now(),
  last_completed_at timestamptz NOT NULL DEFAULT now(),
  times_completed integer NOT NULL DEFAULT 1 CHECK (times_completed > 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  figs_earned integer NOT NULL DEFAULT 0 CHECK (figs_earned >= 0),
  denarii_earned integer NOT NULL DEFAULT 0 CHECK (denarii_earned >= 0),
  PRIMARY KEY (user_id, level_slug)
);

ALTER TABLE public.story_mode_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_answer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_fig_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_level_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.story_mode_levels,
  public.story_mode_questions,
  public.story_mode_checkpoints,
  public.story_mode_progress,
  public.story_mode_attempts,
  public.story_mode_answer_events,
  public.story_mode_fig_entries,
  public.story_mode_level_completions
FROM PUBLIC, anon, authenticated;

INSERT INTO public.story_mode_levels (
  slug,
  book_slug,
  chapter_slug,
  title,
  level_order,
  unlock_after_level_slug,
  is_published
)
VALUES ('abel-offering', 'beginnings', 'brothers', 'Abel Offering', 1, NULL, true)
ON CONFLICT (slug) DO UPDATE SET
  book_slug = EXCLUDED.book_slug,
  chapter_slug = EXCLUDED.chapter_slug,
  title = EXCLUDED.title,
  level_order = EXCLUDED.level_order,
  unlock_after_level_slug = EXCLUDED.unlock_after_level_slug,
  is_published = EXCLUDED.is_published;

INSERT INTO public.story_mode_checkpoints (
  level_slug,
  checkpoint_id,
  checkpoint_order,
  state_hint
)
VALUES
  ('abel-offering', 'abel-field-start', 0, 'intro'),
  ('abel-offering', 'abel-offering-question', 1, 'question_approach'),
  ('abel-offering', 'abel-offering-complete', 2, 'level_complete')
ON CONFLICT (level_slug, checkpoint_id) DO UPDATE SET
  checkpoint_order = EXCLUDED.checkpoint_order,
  state_hint = EXCLUDED.state_hint;

INSERT INTO public.story_mode_questions (
  id,
  level_slug,
  checkpoint_id,
  question_order,
  question_type,
  prompt,
  options,
  correct_answer,
  difficulty,
  timer_seconds,
  scripture_reference,
  explanation,
  correct_action_id,
  wrong_action_id
)
VALUES (
  'abel-offering-firstborn',
  'abel-offering',
  'abel-offering-question',
  1,
  'multiple_choice',
  'What did Abel bring as an offering to the Lord?',
  '["The firstborn of his flock and their fat portions", "The fruit of the ground he had harvested", "Bread and wine from his table", "Gold and incense from his possessions"]'::jsonb,
  'The firstborn of his flock and their fat portions',
  'moderate',
  7,
  'Genesis 4:4',
  'Genesis 4:4 names the firstborn of Abel''s flock and their fat portions.',
  'offer-firstborn',
  'offering-misdirection'
)
ON CONFLICT (id) DO UPDATE SET
  level_slug = EXCLUDED.level_slug,
  checkpoint_id = EXCLUDED.checkpoint_id,
  question_order = EXCLUDED.question_order,
  question_type = EXCLUDED.question_type,
  prompt = EXCLUDED.prompt,
  options = EXCLUDED.options,
  correct_answer = EXCLUDED.correct_answer,
  difficulty = EXCLUDED.difficulty,
  timer_seconds = EXCLUDED.timer_seconds,
  scripture_reference = EXCLUDED.scripture_reference,
  explanation = EXCLUDED.explanation,
  correct_action_id = EXCLUDED.correct_action_id,
  wrong_action_id = EXCLUDED.wrong_action_id;

CREATE OR REPLACE FUNCTION public.story_mode_require_player()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT public.has_current_subscription_access(v_user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Your subscription or free trial has expired.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = v_user_id
      AND assignment.role IN ('cadet', 'sentry')
      AND assignment.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Only active cadets and sentries can enter Story Mode.';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.story_mode_question_payload(p_question_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', question.id,
    'level_slug', question.level_slug,
    'type', question.question_type,
    'prompt', question.prompt,
    'options', CASE
      WHEN question.question_type = 'true_false' THEN '["True", "False"]'::jsonb
      ELSE question.options
    END,
    'difficulty', question.difficulty,
    'timer_seconds', question.timer_seconds,
    'scripture_reference', question.scripture_reference
  )
  FROM public.story_mode_questions question
  WHERE question.id = p_question_id;
$$;

CREATE OR REPLACE FUNCTION public.story_mode_fig_value(p_difficulty text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_difficulty
    WHEN 'hard' THEN 5
    WHEN 'moderate' THEN 3
    ELSE 1
  END;
$$;

REVOKE ALL ON FUNCTION public.story_mode_require_player() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_mode_question_payload(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_mode_fig_value(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.story_mode_require_player() TO service_role;
GRANT EXECUTE ON FUNCTION public.story_mode_question_payload(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.story_mode_fig_value(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_story_mode_progress()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_progress public.story_mode_progress%ROWTYPE;
  v_levels jsonb;
  v_active_attempt_id uuid;
BEGIN
  INSERT INTO public.story_mode_progress (
    user_id,
    current_book_slug,
    current_chapter_slug,
    current_level_slug,
    checkpoint_id
  )
  SELECT
    v_user_id,
    level.book_slug,
    level.chapter_slug,
    level.slug,
    checkpoint.checkpoint_id
  FROM public.story_mode_levels level
  JOIN LATERAL (
    SELECT candidate.checkpoint_id
    FROM public.story_mode_checkpoints candidate
    WHERE candidate.level_slug = level.slug
    ORDER BY candidate.checkpoint_order
    LIMIT 1
  ) checkpoint ON true
  WHERE level.is_published = true
    AND level.unlock_after_level_slug IS NULL
  ORDER BY level.level_order
  LIMIT 1
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_progress
  FROM public.story_mode_progress
  WHERE user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story Mode has no published starting level.';
  END IF;

  SELECT attempt.id INTO v_active_attempt_id
  FROM public.story_mode_attempts attempt
  WHERE attempt.user_id = v_user_id
    AND attempt.status = 'in_progress'
  ORDER BY attempt.started_at DESC
  LIMIT 1;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'level_slug', level.slug,
      'completed', completion.user_id IS NOT NULL,
      'unlocked', level.unlock_after_level_slug IS NULL OR EXISTS (
        SELECT 1
        FROM public.story_mode_level_completions prerequisite
        WHERE prerequisite.user_id = v_user_id
          AND prerequisite.level_slug = level.unlock_after_level_slug
      ),
      'times_completed', coalesce(completion.times_completed, 0),
      'first_completed_at', completion.first_completed_at,
      'figs_earned', coalesce(completion.figs_earned, 0),
      'denarii_earned', coalesce(completion.denarii_earned, 0)
    ) ORDER BY level.level_order
  ), '[]'::jsonb)
  INTO v_levels
  FROM public.story_mode_levels level
  LEFT JOIN public.story_mode_level_completions completion
    ON completion.user_id = v_user_id
   AND completion.level_slug = level.slug
  WHERE level.is_published = true;

  RETURN jsonb_build_object(
    'current_book_slug', v_progress.current_book_slug,
    'current_chapter_slug', v_progress.current_chapter_slug,
    'current_level_slug', v_progress.current_level_slug,
    'checkpoint_id', v_progress.checkpoint_id,
    'completed_level_count', (
      SELECT count(*)
      FROM public.story_mode_level_completions completion
      JOIN public.story_mode_levels level ON level.slug = completion.level_slug
      WHERE completion.user_id = v_user_id AND level.is_published = true
    ),
    'total_level_count', (
      SELECT count(*) FROM public.story_mode_levels WHERE is_published = true
    ),
    'active_attempt_id', v_active_attempt_id,
    'levels', v_levels
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_story_mode_level(p_level_slug text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_level public.story_mode_levels%ROWTYPE;
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_question public.story_mode_questions%ROWTYPE;
  v_restored boolean := false;
  v_is_replay boolean;
  v_start_checkpoint text;
  v_checkpoint_state text;
  v_deadline timestamptz;
BEGIN
  SELECT * INTO v_level
  FROM public.story_mode_levels
  WHERE slug = p_level_slug AND is_published = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This Story Mode level is locked or unavailable.';
  END IF;

  IF v_level.unlock_after_level_slug IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.story_mode_level_completions completion
    WHERE completion.user_id = v_user_id
      AND completion.level_slug = v_level.unlock_after_level_slug
  ) THEN
    RAISE EXCEPTION 'Complete the previous Story Mode level first.';
  END IF;

  /* The profile row is the per-player Story Mode mutex. It makes concurrent
     start requests settle on one active attempt before the partial unique
     index becomes the final line of defence. */
  PERFORM 1
  FROM public.profiles profile
  WHERE profile.id = v_user_id
  FOR UPDATE;

  SELECT checkpoint.checkpoint_id INTO v_start_checkpoint
  FROM public.story_mode_checkpoints checkpoint
  WHERE checkpoint.level_slug = p_level_slug
  ORDER BY checkpoint.checkpoint_order
  LIMIT 1;
  IF v_start_checkpoint IS NULL THEN
    RAISE EXCEPTION 'This Story Mode level has no starting checkpoint.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.story_mode_attempts attempt
  WHERE attempt.user_id = v_user_id
    AND attempt.status = 'in_progress'
  ORDER BY attempt.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempt.level_slug <> p_level_slug THEN
      RAISE EXCEPTION 'Resume your active Story Mode level before opening another.';
    END IF;
    v_restored := true;
  ELSE
    v_is_replay := EXISTS (
      SELECT 1 FROM public.story_mode_level_completions completion
      WHERE completion.user_id = v_user_id AND completion.level_slug = p_level_slug
    );
    INSERT INTO public.story_mode_attempts (
      user_id,
      level_slug,
      checkpoint_id,
      is_replay
    )
    VALUES (v_user_id, p_level_slug, v_start_checkpoint, v_is_replay)
    RETURNING * INTO v_attempt;
  END IF;

  INSERT INTO public.story_mode_progress (
    user_id,
    current_book_slug,
    current_chapter_slug,
    current_level_slug,
    checkpoint_id,
    updated_at
  )
  VALUES (
    v_user_id,
    v_level.book_slug,
    v_level.chapter_slug,
    v_level.slug,
    v_attempt.checkpoint_id,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    current_book_slug = EXCLUDED.current_book_slug,
    current_chapter_slug = EXCLUDED.current_chapter_slug,
    current_level_slug = EXCLUDED.current_level_slug,
    checkpoint_id = EXCLUDED.checkpoint_id,
    updated_at = now();

  SELECT * INTO v_question
  FROM public.story_mode_questions question
  WHERE question.level_slug = p_level_slug
    AND NOT EXISTS (
      SELECT 1
      FROM public.story_mode_answer_events answer
      WHERE answer.attempt_id = v_attempt.id
        AND answer.question_id = question.id
        AND answer.is_correct = true
    )
  ORDER BY question.question_order
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This Story Mode level has no active question.';
  END IF;

  SELECT checkpoint.state_hint INTO v_checkpoint_state
  FROM public.story_mode_checkpoints checkpoint
  WHERE checkpoint.level_slug = v_attempt.level_slug
    AND checkpoint.checkpoint_id = v_attempt.checkpoint_id;

  IF v_attempt.question_started_at IS NOT NULL THEN
    v_deadline := v_attempt.question_started_at + make_interval(secs => v_question.timer_seconds);
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'level_slug', v_attempt.level_slug,
    'checkpoint_id', v_attempt.checkpoint_id,
    'checkpoint_state', coalesce(v_checkpoint_state, 'intro'),
    'is_replay', v_attempt.is_replay,
    'restored', v_restored,
    'paused', v_attempt.paused_at IS NOT NULL,
    'question_started_at', v_attempt.question_started_at,
    'question_deadline', v_deadline,
    'server_now', now(),
    'question', public.story_mode_question_payload(v_question.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_story_mode_checkpoint(
  p_attempt_id uuid,
  p_checkpoint_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_current_order integer;
  v_next_order integer;
  v_next_state_hint text;
BEGIN
  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'Resume Story Mode before saving a checkpoint.';
  END IF;

  SELECT checkpoint_order INTO v_current_order
  FROM public.story_mode_checkpoints
  WHERE level_slug = v_attempt.level_slug AND checkpoint_id = v_attempt.checkpoint_id;
  SELECT checkpoint_order, state_hint INTO v_next_order, v_next_state_hint
  FROM public.story_mode_checkpoints
  WHERE level_slug = v_attempt.level_slug AND checkpoint_id = p_checkpoint_id;
  IF v_next_order IS NULL THEN
    RAISE EXCEPTION 'Unknown Story Mode checkpoint.';
  END IF;
  IF v_current_order IS NOT NULL AND v_next_order > v_current_order + 1 THEN
    RAISE EXCEPTION 'Story Mode checkpoints must be reached in order.';
  END IF;
  IF v_current_order IS NOT NULL AND v_next_order < v_current_order THEN
    RAISE EXCEPTION 'Story Mode checkpoints cannot be moved backward.';
  END IF;
  IF v_next_state_hint = 'level_complete' THEN
    RAISE EXCEPTION 'Level completion must be settled by the Story Mode answer service.';
  END IF;

  UPDATE public.story_mode_attempts
  SET checkpoint_id = p_checkpoint_id, updated_at = now()
  WHERE id = p_attempt_id;
  UPDATE public.story_mode_progress
  SET checkpoint_id = p_checkpoint_id, updated_at = now()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('checkpoint_id', p_checkpoint_id, 'saved_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_story_mode_question(
  p_attempt_id uuid,
  p_question_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_question public.story_mode_questions%ROWTYPE;
  v_expected_question_id text;
BEGIN
  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'Resume Story Mode before starting the question.';
  END IF;
  SELECT * INTO v_question
  FROM public.story_mode_questions
  WHERE id = p_question_id AND level_slug = v_attempt.level_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question is not part of this Story Mode attempt.';
  END IF;

  SELECT question.id INTO v_expected_question_id
  FROM public.story_mode_questions question
  WHERE question.level_slug = v_attempt.level_slug
    AND NOT EXISTS (
      SELECT 1
      FROM public.story_mode_answer_events answer
      WHERE answer.attempt_id = v_attempt.id
        AND answer.question_id = question.id
        AND answer.is_correct = true
    )
  ORDER BY question.question_order
  LIMIT 1;
  IF v_expected_question_id IS DISTINCT FROM p_question_id THEN
    RAISE EXCEPTION 'This Story Mode question is not unlocked yet.';
  END IF;
  IF v_attempt.checkpoint_id IS DISTINCT FROM v_question.checkpoint_id THEN
    RAISE EXCEPTION 'Reach the Story Mode question checkpoint first.';
  END IF;

  IF v_attempt.question_started_at IS NULL
    OR v_attempt.active_question_id IS DISTINCT FROM p_question_id THEN
    UPDATE public.story_mode_attempts
    SET
      active_question_id = p_question_id,
      question_started_at = now(),
      updated_at = now()
    WHERE id = p_attempt_id
    RETURNING * INTO v_attempt;
  END IF;

  RETURN jsonb_build_object(
    'deadline', v_attempt.question_started_at + make_interval(secs => v_question.timer_seconds),
    'server_now', now(),
    'paused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_story_mode_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_timer integer;
  v_deadline timestamptz;
BEGIN
  SELECT * INTO v_attempt FROM public.story_mode_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NULL THEN
    UPDATE public.story_mode_attempts SET paused_at = now(), updated_at = now()
    WHERE id = p_attempt_id RETURNING * INTO v_attempt;
  END IF;
  SELECT timer_seconds INTO v_timer
  FROM public.story_mode_questions
  WHERE id = v_attempt.active_question_id;
  IF v_attempt.question_started_at IS NOT NULL AND v_timer IS NOT NULL THEN
    v_deadline := v_attempt.question_started_at + make_interval(secs => v_timer);
  END IF;
  RETURN jsonb_build_object('deadline', v_deadline, 'server_now', now(), 'paused', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_story_mode_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_timer integer;
  v_deadline timestamptz;
BEGIN
  SELECT * INTO v_attempt FROM public.story_mode_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN
    UPDATE public.story_mode_attempts
    SET
      question_started_at = CASE
        WHEN question_started_at IS NULL THEN NULL
        ELSE question_started_at + (now() - paused_at)
      END,
      paused_at = NULL,
      updated_at = now()
    WHERE id = p_attempt_id
    RETURNING * INTO v_attempt;
  END IF;
  SELECT timer_seconds INTO v_timer
  FROM public.story_mode_questions
  WHERE id = v_attempt.active_question_id;
  IF v_attempt.question_started_at IS NOT NULL AND v_timer IS NOT NULL THEN
    v_deadline := v_attempt.question_started_at + make_interval(secs => v_timer);
  END IF;
  RETURN jsonb_build_object('deadline', v_deadline, 'server_now', now(), 'paused', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_story_mode_answer(
  p_attempt_id uuid,
  p_question_id text,
  p_selected_answer text,
  p_timed_out boolean,
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_question public.story_mode_questions%ROWTYPE;
  v_existing_response jsonb;
  v_timed_out boolean;
  v_correct boolean;
  v_figs integer := 0;
  v_total_figs integer := 0;
  v_prior_correct integer := 0;
  v_correct_count integer := 0;
  v_question_count integer := 0;
  v_level_complete boolean := false;
  v_complete_checkpoint text;
  v_retry_checkpoint text;
  v_response jsonb;
BEGIN
  SELECT event.response_payload INTO v_existing_response
  FROM public.story_mode_answer_events event
  JOIN public.story_mode_attempts attempt ON attempt.id = event.attempt_id
  WHERE event.submission_id = p_submission_id
    AND attempt.user_id = v_user_id;
  IF FOUND THEN
    RETURN v_existing_response;
  END IF;

  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;

  /* A duplicate request can arrive while the first request owns the attempt
     lock. Re-check the idempotency key after acquiring that lock so the
     waiter receives the first response even when it completed the attempt. */
  SELECT event.response_payload INTO v_existing_response
  FROM public.story_mode_answer_events event
  WHERE event.submission_id = p_submission_id
    AND event.attempt_id = v_attempt.id;
  IF FOUND THEN
    RETURN v_existing_response;
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'Resume Story Mode before answering.';
  END IF;

  SELECT * INTO v_question
  FROM public.story_mode_questions
  WHERE id = p_question_id AND level_slug = v_attempt.level_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question is not part of this Story Mode attempt.';
  END IF;
  IF v_attempt.active_question_id IS DISTINCT FROM p_question_id THEN
    RAISE EXCEPTION 'This Story Mode question is not active.';
  END IF;
  IF v_attempt.question_started_at IS NULL THEN
    RAISE EXCEPTION 'The Story Mode question timer has not started.';
  END IF;

  v_timed_out := coalesce(p_timed_out, false)
    OR now() > v_attempt.question_started_at + make_interval(secs => v_question.timer_seconds);
  v_correct := NOT v_timed_out
    AND lower(btrim(coalesce(p_selected_answer, ''))) = lower(btrim(v_question.correct_answer));

  IF v_correct AND NOT v_attempt.is_replay THEN
    INSERT INTO public.story_mode_fig_entries (
      user_id,
      level_slug,
      question_id,
      attempt_id,
      figs
    )
    VALUES (
      v_user_id,
      v_attempt.level_slug,
      v_question.id,
      v_attempt.id,
      public.story_mode_fig_value(v_question.difficulty)
    )
    ON CONFLICT (user_id, question_id) DO NOTHING
    RETURNING figs INTO v_figs;
    v_figs := coalesce(v_figs, 0);
  END IF;

  SELECT count(DISTINCT event.question_id) FILTER (WHERE event.is_correct)
  INTO v_prior_correct
  FROM public.story_mode_answer_events event
  WHERE event.attempt_id = v_attempt.id;
  SELECT count(*) INTO v_question_count
  FROM public.story_mode_questions question
  WHERE question.level_slug = v_attempt.level_slug;

  v_correct_count := v_prior_correct + CASE
    WHEN v_correct AND NOT EXISTS (
      SELECT 1 FROM public.story_mode_answer_events event
      WHERE event.attempt_id = v_attempt.id
        AND event.question_id = v_question.id
        AND event.is_correct = true
    ) THEN 1
    ELSE 0
  END;
  v_level_complete := v_correct AND v_correct_count >= v_question_count;

  SELECT checkpoint.checkpoint_id INTO v_complete_checkpoint
  FROM public.story_mode_checkpoints checkpoint
  WHERE checkpoint.level_slug = v_attempt.level_slug
  ORDER BY checkpoint.checkpoint_order DESC
  LIMIT 1;
  v_retry_checkpoint := v_attempt.checkpoint_id;

  IF v_level_complete THEN
    UPDATE public.story_mode_attempts
    SET
      status = 'completed',
      checkpoint_id = v_complete_checkpoint,
      active_question_id = NULL,
      question_started_at = NULL,
      paused_at = NULL,
      answer_count = answer_count + 1,
      correct_count = v_correct_count,
      completed_at = now(),
      updated_at = now()
    WHERE id = v_attempt.id;

    SELECT coalesce(sum(entry.figs), 0) INTO v_total_figs
    FROM public.story_mode_fig_entries entry
    WHERE entry.attempt_id = v_attempt.id;

    INSERT INTO public.story_mode_level_completions (
      user_id,
      level_slug,
      correct_count,
      question_count,
      figs_earned,
      denarii_earned
    )
    VALUES (
      v_user_id,
      v_attempt.level_slug,
      v_correct_count,
      v_question_count,
      v_total_figs,
      0
    )
    ON CONFLICT (user_id, level_slug) DO UPDATE SET
      last_completed_at = now(),
      times_completed = public.story_mode_level_completions.times_completed + 1,
      correct_count = greatest(public.story_mode_level_completions.correct_count, EXCLUDED.correct_count),
      question_count = greatest(public.story_mode_level_completions.question_count, EXCLUDED.question_count),
      figs_earned = greatest(public.story_mode_level_completions.figs_earned, EXCLUDED.figs_earned),
      denarii_earned = greatest(public.story_mode_level_completions.denarii_earned, EXCLUDED.denarii_earned);

    UPDATE public.story_mode_progress
    SET checkpoint_id = v_complete_checkpoint, updated_at = now()
    WHERE user_id = v_user_id;
  ELSE
    UPDATE public.story_mode_attempts
    SET
      checkpoint_id = v_retry_checkpoint,
      active_question_id = NULL,
      question_started_at = NULL,
      paused_at = NULL,
      answer_count = answer_count + 1,
      correct_count = v_correct_count,
      failure_count = failure_count + CASE WHEN v_correct THEN 0 ELSE 1 END,
      updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.story_mode_progress
    SET checkpoint_id = v_retry_checkpoint, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  v_response := jsonb_build_object(
    'correct', v_correct,
    'timed_out', v_timed_out,
    'figs_earned', v_figs,
    'denarii_earned', 0,
    'total_figs', v_total_figs,
    'correct_count', v_correct_count,
    'question_count', v_question_count,
    'completion_percentage', CASE
      WHEN v_question_count = 0 THEN 0
      ELSE round((v_correct_count::numeric / v_question_count::numeric) * 100)
    END,
    'level_complete', v_level_complete,
    'checkpoint_id', CASE WHEN v_level_complete THEN v_complete_checkpoint ELSE v_retry_checkpoint END,
    'action_id', CASE WHEN v_correct THEN v_question.correct_action_id ELSE v_question.wrong_action_id END,
    'explanation', v_question.explanation,
    'replay', v_attempt.is_replay
  );

  INSERT INTO public.story_mode_answer_events (
    attempt_id,
    question_id,
    submission_id,
    selected_answer,
    timed_out,
    is_correct,
    figs_earned,
    response_payload
  )
  VALUES (
    v_attempt.id,
    v_question.id,
    p_submission_id,
    p_selected_answer,
    v_timed_out,
    v_correct,
    v_figs,
    v_response
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_story_mode_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_story_mode_level(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_story_mode_checkpoint(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_story_mode_question(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_story_mode_attempt(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_story_mode_attempt(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_story_mode_progress() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_story_mode_level(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_story_mode_checkpoint(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_story_mode_question(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pause_story_mode_attempt(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_story_mode_attempt(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) TO authenticated, service_role;

/* Story Figs join the canonical lifetime Fig total. No direct Marks or
   Denarii are created; existing normalized Marks continue to derive Figs. */
CREATE OR REPLACE FUNCTION public.get_user_lifetime_figs(
  p_user_id uuid,
  p_before timestamptz DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH quiz_attempt_figs AS (
    SELECT
      attempt.id,
      attempt.user_id,
      attempt.submitted_at,
      coalesce(
        attempt.talents_scored::numeric,
        sum(
          CASE
            WHEN public.quiz_answer_is_correct(response.answer, question.question_payload)
              AND NOT coalesce(response.assisted_by_relic, false)
            THEN CASE
              WHEN question.difficulty_tag = 'hard' THEN 5
              WHEN question.difficulty_tag IN ('moderate', 'medium') THEN 3
              ELSE 1
            END
            ELSE 0
          END
        )::numeric,
        0
      ) AS figs
    FROM public.quiz_attempts attempt
    LEFT JOIN public.question_responses response
      ON response.quiz_attempt_id = attempt.id
    LEFT JOIN public.generated_questions question
      ON question.id = response.question_id
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('submitted', 'timed_out')
      AND (p_before IS NULL OR attempt.submitted_at < p_before)
    GROUP BY attempt.id, attempt.user_id, attempt.submitted_at, attempt.talents_scored
  ), fig_sources AS (
    SELECT coalesce(sum(attempt.score), 0)::numeric AS figs
    FROM public.game_attempts attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.completed_at IS NOT NULL
      AND attempt.status IN ('passed', 'failed')
      AND (p_before IS NULL OR attempt.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(participant.score), 0)::numeric
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE participant.user_id = p_user_id
      AND participant.finished_at IS NOT NULL
      AND room.status = 'completed'
      AND (p_before IS NULL OR participant.finished_at < p_before)
      AND (p_before IS NULL OR room.completed_at < p_before)

    UNION ALL

    SELECT coalesce(sum(quiz.figs), 0)::numeric
    FROM quiz_attempt_figs quiz

    UNION ALL

    SELECT coalesce(sum(story.figs), 0)::numeric
    FROM public.story_mode_fig_entries story
    WHERE story.user_id = p_user_id
      AND (p_before IS NULL OR story.earned_at < p_before)
  )
  SELECT coalesce(sum(source.figs), 0)::numeric
  FROM fig_sources source;
$$;

REVOKE ALL ON FUNCTION public.get_user_lifetime_figs(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_lifetime_figs(uuid, timestamptz)
  TO service_role;
