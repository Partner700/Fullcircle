/* Story Mode Phase 3B: complete Book I, Chapter 1 -- Brothers. */

ALTER TABLE public.story_mode_questions
  ADD COLUMN IF NOT EXISTS pool_id text,
  ADD COLUMN IF NOT EXISTS scene_id text,
  ADD COLUMN IF NOT EXISTS is_read_follow_up boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.story_mode_question_pools (
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug) ON DELETE CASCADE,
  pool_id text NOT NULL,
  scene_id text NOT NULL,
  checkpoint_id text NOT NULL,
  pool_order integer NOT NULL CHECK (pool_order > 0),
  questions_per_attempt integer NOT NULL DEFAULT 1 CHECK (questions_per_attempt > 0),
  PRIMARY KEY (level_slug, pool_id),
  UNIQUE (level_slug, pool_order),
  FOREIGN KEY (level_slug, checkpoint_id)
    REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS public.story_mode_attempt_questions (
  attempt_id uuid NOT NULL REFERENCES public.story_mode_attempts(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES public.story_mode_questions(id) ON DELETE RESTRICT,
  pool_id text NOT NULL,
  scene_id text NOT NULL,
  sequence_order integer NOT NULL CHECK (sequence_order > 0),
  answered_correct boolean NOT NULL DEFAULT false,
  selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id),
  UNIQUE (attempt_id, sequence_order)
);

CREATE TABLE IF NOT EXISTS public.story_mode_canonical_events (
  id text PRIMARY KEY,
  level_slug text NOT NULL REFERENCES public.story_mode_levels(slug) ON DELETE CASCADE,
  checkpoint_id text NOT NULL,
  completion_checkpoint_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('canonical_death', 'character_transition')),
  event_order integer NOT NULL CHECK (event_order > 0),
  scripture_reference text NOT NULL,
  completes_chapter boolean NOT NULL DEFAULT false,
  UNIQUE (level_slug, event_order),
  FOREIGN KEY (level_slug, checkpoint_id)
    REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id),
  FOREIGN KEY (level_slug, completion_checkpoint_id)
    REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS public.story_mode_event_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.story_mode_attempts(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.story_mode_canonical_events(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL UNIQUE,
  response_payload jsonb NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, event_id)
);

CREATE TABLE IF NOT EXISTS public.story_mode_chapter_completions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_slug text NOT NULL,
  chapter_slug text NOT NULL,
  first_completed_at timestamptz NOT NULL DEFAULT now(),
  last_completed_at timestamptz NOT NULL DEFAULT now(),
  times_completed integer NOT NULL DEFAULT 1 CHECK (times_completed > 0),
  PRIMARY KEY (user_id, book_slug, chapter_slug)
);

ALTER TABLE public.story_mode_question_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_attempt_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_canonical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_event_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_chapter_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.story_mode_question_pools,
  public.story_mode_attempt_questions,
  public.story_mode_canonical_events,
  public.story_mode_event_settlements,
  public.story_mode_chapter_completions
FROM PUBLIC, anon, authenticated;

INSERT INTO public.story_mode_levels (
  slug, book_slug, chapter_slug, title, level_order, unlock_after_level_slug, is_published
)
VALUES
  ('regard', 'beginnings', 'brothers', 'Regard', 2, 'abel-offering', true),
  ('at-the-door', 'beginnings', 'brothers', 'At the Door', 3, 'regard', true),
  ('the-field', 'beginnings', 'brothers', 'The Field', 4, 'at-the-door', true),
  ('your-brother', 'beginnings', 'brothers', 'Your Brother', 5, 'the-field', true),
  ('another-offspring', 'beginnings', 'brothers', 'Another Offspring', 6, 'your-brother', true)
ON CONFLICT (slug) DO UPDATE SET
  book_slug = EXCLUDED.book_slug,
  chapter_slug = EXCLUDED.chapter_slug,
  title = EXCLUDED.title,
  level_order = EXCLUDED.level_order,
  unlock_after_level_slug = EXCLUDED.unlock_after_level_slug,
  is_published = EXCLUDED.is_published;

INSERT INTO public.story_mode_checkpoints (level_slug, checkpoint_id, checkpoint_order, state_hint)
VALUES
  ('regard', 'regard-start', 0, 'intro'),
  ('regard', 'regard-observe-question', 1, 'question_approach'),
  ('regard', 'regard-response-question', 2, 'question_approach'),
  ('regard', 'regard-anger-question', 3, 'question_approach'),
  ('regard', 'regard-complete', 4, 'level_complete'),
  ('at-the-door', 'door-start', 0, 'intro'),
  ('at-the-door', 'door-question-checkpoint', 1, 'question_approach'),
  ('at-the-door', 'door-warning-question', 2, 'question_approach'),
  ('at-the-door', 'door-rule-question', 3, 'question_approach'),
  ('at-the-door', 'door-complete', 4, 'level_complete'),
  ('the-field', 'field-start', 0, 'intro'),
  ('the-field', 'field-speech-question', 1, 'question_approach'),
  ('the-field', 'field-movement-question', 2, 'question_approach'),
  ('the-field', 'field-confrontation-question', 3, 'question_approach'),
  ('the-field', 'field-canonical-event', 4, 'canonical_event'),
  ('the-field', 'field-complete', 5, 'level_complete'),
  ('your-brother', 'brother-start', 0, 'intro'),
  ('your-brother', 'brother-question-checkpoint', 1, 'question_approach'),
  ('your-brother', 'brother-cry-question', 2, 'question_approach'),
  ('your-brother', 'brother-consequence-question', 3, 'question_approach'),
  ('your-brother', 'brother-complete', 4, 'level_complete'),
  ('another-offspring', 'seth-transition-start', 0, 'intro'),
  ('another-offspring', 'seth-generational-event', 1, 'canonical_event'),
  ('another-offspring', 'seth-transition-complete', 2, 'chapter_complete')
ON CONFLICT (level_slug, checkpoint_id) DO UPDATE SET
  checkpoint_order = EXCLUDED.checkpoint_order,
  state_hint = EXCLUDED.state_hint;

INSERT INTO public.story_mode_question_pools (
  level_slug, pool_id, scene_id, checkpoint_id, pool_order, questions_per_attempt
)
VALUES
  ('abel-offering', 'abel-offering-core', 'abel-offering-event', 'abel-offering-question', 1, 1),
  ('regard', 'regard-easy', 'regard-observe', 'regard-observe-question', 1, 1),
  ('regard', 'regard-moderate', 'regard-response', 'regard-response-question', 2, 1),
  ('regard', 'regard-hard', 'regard-anger', 'regard-anger-question', 3, 1),
  ('at-the-door', 'door-easy', 'door-question', 'door-question-checkpoint', 1, 1),
  ('at-the-door', 'door-moderate', 'door-warning', 'door-warning-question', 2, 1),
  ('at-the-door', 'door-hard', 'door-rule', 'door-rule-question', 3, 1),
  ('the-field', 'field-easy', 'field-speech', 'field-speech-question', 1, 1),
  ('the-field', 'field-moderate', 'field-movement', 'field-movement-question', 2, 1),
  ('the-field', 'field-hard', 'field-confrontation', 'field-confrontation-question', 3, 1),
  ('your-brother', 'brother-easy', 'brother-question', 'brother-question-checkpoint', 1, 1),
  ('your-brother', 'brother-moderate', 'brother-cry', 'brother-cry-question', 2, 1),
  ('your-brother', 'brother-hard', 'brother-consequence', 'brother-consequence-question', 3, 1)
ON CONFLICT (level_slug, pool_id) DO UPDATE SET
  scene_id = EXCLUDED.scene_id,
  checkpoint_id = EXCLUDED.checkpoint_id,
  pool_order = EXCLUDED.pool_order,
  questions_per_attempt = EXCLUDED.questions_per_attempt;

UPDATE public.story_mode_questions
SET pool_id = 'abel-offering-core', scene_id = 'abel-offering-event', is_read_follow_up = false
WHERE id = 'abel-offering-firstborn';

INSERT INTO public.story_mode_questions (
  id, level_slug, checkpoint_id, question_order, question_type, prompt, options,
  correct_answer, difficulty, timer_seconds, scripture_reference, explanation,
  correct_action_id, wrong_action_id, pool_id, scene_id, is_read_follow_up
)
VALUES
  ('regard-cain-occupation', 'regard', 'regard-observe-question', 1, 'multiple_choice',
   'What kind of worker was Cain?', '["A worker of the ground", "A keeper of sheep", "A maker of tents", "A keeper of vineyards"]'::jsonb,
   'A worker of the ground', 'easy', 5, 'Genesis 4:2', 'Genesis 4:2 says Cain was a worker of the ground.', 'regard-observe', 'regard-retry', 'regard-easy', 'regard-observe', false),
  ('regard-abel-occupation', 'regard', 'regard-observe-question', 2, 'true_false',
   'Abel was a keeper of sheep.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 4:2', 'Genesis 4:2 identifies Abel as a keeper of sheep.', 'regard-observe', 'regard-retry', 'regard-easy', 'regard-observe', false),
  ('regard-cain-offering', 'regard', 'regard-response-question', 3, 'multiple_choice',
   'What did Cain bring as an offering to the Lord?', '["Fruit of the ground", "The firstborn of his flock", "Bread from his table", "Incense and oil"]'::jsonb,
   'Fruit of the ground', 'moderate', 7, 'Genesis 4:3', 'Cain brought an offering of the fruit of the ground.', 'regard-response', 'regard-retry', 'regard-moderate', 'regard-response', false),
  ('regard-abel-distinction', 'regard', 'regard-response-question', 4, 'multiple_choice',
   'Which detail distinguishes Abel''s offering in Genesis 4:4?', '["The firstborn of his flock and their fat portions", "Fruit gathered at the end of the harvest", "A tenth of every possession", "A lamb and grain mixed together"]'::jsonb,
   'The firstborn of his flock and their fat portions', 'moderate', 7, 'Genesis 4:4', 'The passage names the firstborn of Abel''s flock and their fat portions.', 'regard-response', 'regard-retry', 'regard-moderate', 'regard-response', false),
  ('regard-response-distinction', 'regard', 'regard-anger-question', 5, 'multiple_choice',
   'For whom did the Lord have regard?', '["Abel and his offering", "Cain and his offering", "Both brothers and both offerings", "Neither brother nor offering"]'::jsonb,
   'Abel and his offering', 'hard', 10, 'Genesis 4:4-5', 'Genesis 4:4-5 says the Lord had regard for Abel and his offering.', 'regard-anger', 'regard-retry', 'regard-hard', 'regard-anger', false),
  ('regard-cain-reaction', 'regard', 'regard-anger-question', 6, 'multiple_choice',
   'How did Cain react when the Lord had no regard for his offering?', '["He became very angry and his face fell", "He immediately brought Abel''s offering", "He left without emotion", "He asked Abel to teach him shepherding"]'::jsonb,
   'He became very angry and his face fell', 'hard', 10, 'Genesis 4:5', 'Cain was very angry, and his face fell.', 'regard-anger', 'regard-retry', 'regard-hard', 'regard-anger', false),

  ('door-why-angry', 'at-the-door', 'door-question-checkpoint', 1, 'multiple_choice',
   'What did the Lord first ask Cain about?', '["Why he was angry", "Why he left the field", "Why he brought sheep", "Why Abel was absent"]'::jsonb,
   'Why he was angry', 'easy', 5, 'Genesis 4:6', 'The Lord asked Cain why he was angry.', 'door-question', 'door-retry', 'door-easy', 'door-question', false),
  ('door-face-fallen', 'at-the-door', 'door-question-checkpoint', 2, 'true_false',
   'The Lord asked Cain why his face had fallen.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 4:6', 'Genesis 4:6 includes the question about Cain''s fallen face.', 'door-question', 'door-retry', 'door-easy', 'door-question', false),
  ('door-do-well', 'at-the-door', 'door-warning-question', 3, 'true_false',
   'The warning says that if Cain does well, he will be accepted.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 4:7', 'The opening condition of Genesis 4:7 connects doing well with acceptance.', 'door-warning', 'door-retry', 'door-moderate', 'door-warning', true),
  ('door-crouching-place', 'at-the-door', 'door-warning-question', 4, 'multiple_choice',
   'Where does Genesis 4:7 describe sin as crouching?', '["At the door", "In the field", "Beside the offering", "Beyond the garden"]'::jsonb,
   'At the door', 'moderate', 7, 'Genesis 4:7', 'The warning describes sin as crouching at the door.', 'door-warning', 'door-retry', 'door-moderate', 'door-warning', true),
  ('door-desire', 'at-the-door', 'door-rule-question', 5, 'multiple_choice',
   'According to the warning, whose desire is contrary to Cain?', '["Sin''s desire", "Abel''s desire", "The ground''s desire", "The flock''s desire"]'::jsonb,
   'Sin''s desire', 'hard', 10, 'Genesis 4:7', 'The warning describes sin''s desire as contrary to Cain.', 'door-rule', 'door-retry', 'door-hard', 'door-rule', true),
  ('door-rule-over', 'at-the-door', 'door-rule-question', 6, 'true_false',
   'Cain was told that he must rule over sin.', '["True", "False"]'::jsonb,
   'True', 'hard', 10, 'Genesis 4:7', 'The warning ends with the responsibility to rule over it.', 'door-rule', 'door-retry', 'door-hard', 'door-rule', true),

  ('field-cain-spoke', 'the-field', 'field-speech-question', 1, 'multiple_choice',
   'Before the brothers were in the field, what does Genesis 4:8 say Cain did?', '["He spoke to Abel his brother", "He hid Abel''s flock", "He returned to the offering", "He left the land alone"]'::jsonb,
   'He spoke to Abel his brother', 'easy', 5, 'Genesis 4:8', 'Genesis 4:8 says Cain spoke to Abel his brother.', 'field-speech', 'field-retry', 'field-easy', 'field-speech', false),
  ('field-location', 'the-field', 'field-speech-question', 2, 'multiple_choice',
   'Where were Cain and Abel when Cain rose against Abel?', '["In the field", "At the offering place", "At the garden entrance", "Inside a city"]'::jsonb,
   'In the field', 'easy', 5, 'Genesis 4:8', 'The event occurred when they were in the field.', 'field-speech', 'field-retry', 'field-easy', 'field-speech', false),
  ('field-rose-against', 'the-field', 'field-movement-question', 3, 'true_false',
   'Cain rose up against Abel his brother in the field.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 4:8', 'The passage names Cain as the one who rose against Abel.', 'field-movement', 'field-retry', 'field-moderate', 'field-movement', false),
  ('field-killer', 'the-field', 'field-movement-question', 4, 'multiple_choice',
   'Who killed Abel according to Genesis 4:8?', '["Cain", "A stranger", "An unnamed enemy", "The passage does not say"]'::jsonb,
   'Cain', 'moderate', 7, 'Genesis 4:8', 'Genesis 4:8 states that Cain killed Abel.', 'field-movement', 'field-retry', 'field-moderate', 'field-movement', false),
  ('field-no-recorded-dialogue', 'the-field', 'field-confrontation-question', 5, 'true_false',
   'Genesis 4:8 records the exact words Cain spoke to Abel before they entered the field.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 4:8', 'The passage says Cain spoke to Abel but does not record the words.', 'field-confrontation', 'field-retry', 'field-hard', 'field-confrontation', false),

  ('brother-where-is-abel', 'your-brother', 'brother-question-checkpoint', 1, 'multiple_choice',
   'What did the Lord ask Cain after Abel''s death?', '["Where is Abel your brother?", "Where is your offering?", "Why did you leave Eden?", "Where is your flock?"]'::jsonb,
   'Where is Abel your brother?', 'easy', 5, 'Genesis 4:9', 'The Lord asked Cain where Abel his brother was.', 'brother-question', 'brother-retry', 'brother-easy', 'brother-question', false),
  ('brother-keeper-reply', 'your-brother', 'brother-question-checkpoint', 2, 'multiple_choice',
   'Which question was part of Cain''s reply?', '["Am I my brother''s keeper?", "Am I a worker of the ground?", "Am I accepted?", "Am I still in the field?"]'::jsonb,
   'Am I my brother''s keeper?', 'easy', 5, 'Genesis 4:9', 'Cain replied, "Am I my brother''s keeper?"', 'brother-question', 'brother-retry', 'brother-easy', 'brother-question', false),
  ('brother-blood-cries', 'your-brother', 'brother-cry-question', 3, 'multiple_choice',
   'What was crying to the Lord from the ground?', '["The voice of Abel''s blood", "Cain''s offering", "The voice of the flock", "The fruit of the ground"]'::jsonb,
   'The voice of Abel''s blood', 'moderate', 7, 'Genesis 4:10', 'The Lord said the voice of Abel''s blood cried from the ground.', 'brother-cry', 'brother-retry', 'brother-moderate', 'brother-cry', false),
  ('brother-cursed-source', 'your-brother', 'brother-cry-question', 4, 'multiple_choice',
   'From what was Cain cursed after the ground received Abel''s blood?', '["From the ground", "From the flock", "From the offering stones", "From the eastern gate"]'::jsonb,
   'From the ground', 'moderate', 7, 'Genesis 4:11', 'Cain was cursed from the ground that received Abel''s blood.', 'brother-cry', 'brother-retry', 'brother-moderate', 'brother-cry', false),
  ('brother-ground-strength', 'your-brother', 'brother-consequence-question', 5, 'multiple_choice',
   'What would the ground no longer do for Cain?', '["Yield its strength", "Receive rain", "Grow any tree", "Hold Abel''s blood"]'::jsonb,
   'Yield its strength', 'hard', 10, 'Genesis 4:12', 'The ground would no longer yield its strength to Cain.', 'brother-consequence', 'brother-retry', 'brother-hard', 'brother-consequence', false),
  ('brother-fugitive-wanderer', 'your-brother', 'brother-consequence-question', 6, 'multiple_choice',
   'What condition did the Lord say Cain would have on the earth?', '["A fugitive and a wanderer", "A keeper of sheep", "A king over the field", "A priest at the offering place"]'::jsonb,
   'A fugitive and a wanderer', 'hard', 10, 'Genesis 4:12', 'Genesis 4:12 says Cain would be a fugitive and a wanderer.', 'brother-consequence', 'brother-retry', 'brother-hard', 'brother-consequence', false),
  ('brother-protective-mark', 'your-brother', 'brother-consequence-question', 7, 'true_false',
   'The Lord put a mark on Cain so that no one who found him should attack him.', '["True", "False"]'::jsonb,
   'True', 'hard', 10, 'Genesis 4:15', 'Genesis 4:15 records the protective mark placed on Cain.', 'brother-consequence', 'brother-retry', 'brother-hard', 'brother-consequence', false)
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
  wrong_action_id = EXCLUDED.wrong_action_id,
  pool_id = EXCLUDED.pool_id,
  scene_id = EXCLUDED.scene_id,
  is_read_follow_up = EXCLUDED.is_read_follow_up;

ALTER TABLE public.story_mode_questions
  ALTER COLUMN pool_id SET NOT NULL,
  ALTER COLUMN scene_id SET NOT NULL;

DO $phase3b$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'story_mode_questions_pool_fkey'
  ) THEN
    ALTER TABLE public.story_mode_questions
      ADD CONSTRAINT story_mode_questions_pool_fkey
      FOREIGN KEY (level_slug, pool_id)
      REFERENCES public.story_mode_question_pools(level_slug, pool_id);
  END IF;
END;
$phase3b$;

INSERT INTO public.story_mode_canonical_events (
  id, level_slug, checkpoint_id, completion_checkpoint_id, event_type,
  event_order, scripture_reference, completes_chapter
)
VALUES
  ('abel-canonical-death', 'the-field', 'field-canonical-event', 'field-complete', 'canonical_death', 1, 'Genesis 4:8', false),
  ('seth-generational-transition', 'another-offspring', 'seth-generational-event', 'seth-transition-complete', 'character_transition', 1, 'Genesis 4:25', true)
ON CONFLICT (id) DO UPDATE SET
  level_slug = EXCLUDED.level_slug,
  checkpoint_id = EXCLUDED.checkpoint_id,
  completion_checkpoint_id = EXCLUDED.completion_checkpoint_id,
  event_type = EXCLUDED.event_type,
  event_order = EXCLUDED.event_order,
  scripture_reference = EXCLUDED.scripture_reference,
  completes_chapter = EXCLUDED.completes_chapter;

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
    'checkpoint_id', question.checkpoint_id,
    'pool_id', question.pool_id,
    'scene_id', question.scene_id,
    'type', question.question_type,
    'prompt', question.prompt,
    'options', CASE
      WHEN question.question_type = 'true_false' THEN '["True", "False"]'::jsonb
      ELSE question.options
    END,
    'difficulty', question.difficulty,
    'timer_seconds', question.timer_seconds,
    'scripture_reference', question.scripture_reference,
    'is_read_follow_up', question.is_read_follow_up
  )
  FROM public.story_mode_questions question
  WHERE question.id = p_question_id;
$$;

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
  v_chapter_completed boolean;
BEGIN
  INSERT INTO public.story_mode_progress (
    user_id, current_book_slug, current_chapter_slug, current_level_slug, checkpoint_id
  )
  SELECT v_user_id, level.book_slug, level.chapter_slug, level.slug, checkpoint.checkpoint_id
  FROM public.story_mode_levels level
  JOIN LATERAL (
    SELECT candidate.checkpoint_id
    FROM public.story_mode_checkpoints candidate
    WHERE candidate.level_slug = level.slug
    ORDER BY candidate.checkpoint_order
    LIMIT 1
  ) checkpoint ON true
  WHERE level.is_published = true AND level.unlock_after_level_slug IS NULL
  ORDER BY level.level_order
  LIMIT 1
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_progress FROM public.story_mode_progress WHERE user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Story Mode has no published starting level.'; END IF;

  SELECT attempt.id INTO v_active_attempt_id
  FROM public.story_mode_attempts attempt
  WHERE attempt.user_id = v_user_id AND attempt.status = 'in_progress'
  ORDER BY attempt.started_at DESC LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.story_mode_chapter_completions completion
    WHERE completion.user_id = v_user_id
      AND completion.book_slug = 'beginnings'
      AND completion.chapter_slug = 'brothers'
  ) INTO v_chapter_completed;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'level_slug', level.slug,
      'completed', completion.user_id IS NOT NULL,
      'unlocked', level.unlock_after_level_slug IS NULL OR EXISTS (
        SELECT 1 FROM public.story_mode_level_completions prerequisite
        WHERE prerequisite.user_id = v_user_id AND prerequisite.level_slug = level.unlock_after_level_slug
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
    ON completion.user_id = v_user_id AND completion.level_slug = level.slug
  WHERE level.is_published = true
    AND level.book_slug = 'beginnings'
    AND level.chapter_slug = 'brothers';

  RETURN jsonb_build_object(
    'current_book_slug', v_progress.current_book_slug,
    'current_chapter_slug', v_progress.current_chapter_slug,
    'current_level_slug', v_progress.current_level_slug,
    'checkpoint_id', v_progress.checkpoint_id,
    'completed_level_count', (
      SELECT count(*) FROM public.story_mode_level_completions completion
      JOIN public.story_mode_levels level ON level.slug = completion.level_slug
      WHERE completion.user_id = v_user_id
        AND level.book_slug = 'beginnings' AND level.chapter_slug = 'brothers' AND level.is_published = true
    ),
    'total_level_count', (
      SELECT count(*) FROM public.story_mode_levels
      WHERE book_slug = 'beginnings' AND chapter_slug = 'brothers' AND is_published = true
    ),
    'active_attempt_id', v_active_attempt_id,
    'chapter_completed', v_chapter_completed,
    'chapter_figs_earned', (
      SELECT coalesce(sum(entry.figs), 0) FROM public.story_mode_fig_entries entry
      JOIN public.story_mode_levels level ON level.slug = entry.level_slug
      WHERE entry.user_id = v_user_id AND level.book_slug = 'beginnings' AND level.chapter_slug = 'brothers'
    ),
    'chapter_denarii_earned', 0,
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
  v_pending_event_id text;
BEGIN
  SELECT * INTO v_level FROM public.story_mode_levels
  WHERE slug = p_level_slug AND is_published = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'This Story Mode level is locked or unavailable.'; END IF;

  IF v_level.unlock_after_level_slug IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.story_mode_level_completions completion
    WHERE completion.user_id = v_user_id AND completion.level_slug = v_level.unlock_after_level_slug
  ) THEN
    RAISE EXCEPTION 'Complete the previous Story Mode level first.';
  END IF;

  PERFORM 1 FROM public.profiles profile WHERE profile.id = v_user_id FOR UPDATE;

  SELECT checkpoint.checkpoint_id INTO v_start_checkpoint
  FROM public.story_mode_checkpoints checkpoint
  WHERE checkpoint.level_slug = p_level_slug
  ORDER BY checkpoint.checkpoint_order LIMIT 1;
  IF v_start_checkpoint IS NULL THEN RAISE EXCEPTION 'This Story Mode level has no starting checkpoint.'; END IF;

  SELECT * INTO v_attempt FROM public.story_mode_attempts attempt
  WHERE attempt.user_id = v_user_id AND attempt.status = 'in_progress'
  ORDER BY attempt.started_at DESC LIMIT 1 FOR UPDATE;

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
    INSERT INTO public.story_mode_attempts (user_id, level_slug, checkpoint_id, is_replay)
    VALUES (v_user_id, p_level_slug, v_start_checkpoint, v_is_replay)
    RETURNING * INTO v_attempt;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.story_mode_attempt_questions selected WHERE selected.attempt_id = v_attempt.id
  ) THEN
    WITH ranked AS (
      SELECT
        pool.pool_id,
        pool.scene_id,
        pool.pool_order,
        question.id AS question_id,
        row_number() OVER (
          PARTITION BY pool.level_slug, pool.pool_id
          ORDER BY md5(v_attempt.id::text || ':' || question.id)
        ) AS within_pool_order,
        pool.questions_per_attempt
      FROM public.story_mode_question_pools pool
      JOIN public.story_mode_questions question
        ON question.level_slug = pool.level_slug AND question.pool_id = pool.pool_id
      WHERE pool.level_slug = p_level_slug
    ), chosen AS (
      SELECT * FROM ranked WHERE within_pool_order <= questions_per_attempt
    ), ordered AS (
      SELECT
        question_id, pool_id, scene_id,
        row_number() OVER (ORDER BY pool_order, within_pool_order, question_id)::integer AS sequence_order
      FROM chosen
    )
    INSERT INTO public.story_mode_attempt_questions (
      attempt_id, question_id, pool_id, scene_id, sequence_order
    )
    SELECT v_attempt.id, question_id, pool_id, scene_id, sequence_order FROM ordered
    ON CONFLICT (attempt_id, question_id) DO NOTHING;
  END IF;

  IF NOT v_attempt.is_replay THEN
    INSERT INTO public.story_mode_progress (
      user_id, current_book_slug, current_chapter_slug, current_level_slug, checkpoint_id, updated_at
    ) VALUES (
      v_user_id, v_level.book_slug, v_level.chapter_slug, v_level.slug, v_attempt.checkpoint_id, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      current_book_slug = EXCLUDED.current_book_slug,
      current_chapter_slug = EXCLUDED.current_chapter_slug,
      current_level_slug = EXCLUDED.current_level_slug,
      checkpoint_id = EXCLUDED.checkpoint_id,
      updated_at = now();
  END IF;

  SELECT question.* INTO v_question
  FROM public.story_mode_attempt_questions selected
  JOIN public.story_mode_questions question ON question.id = selected.question_id
  WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
  ORDER BY selected.sequence_order LIMIT 1;

  IF NOT FOUND THEN
    SELECT event.id INTO v_pending_event_id
    FROM public.story_mode_canonical_events event
    WHERE event.level_slug = v_attempt.level_slug
    ORDER BY event.event_order LIMIT 1;
    IF v_pending_event_id IS NULL THEN
      RAISE EXCEPTION 'This Story Mode level has no active question or canonical transition.';
    END IF;
  END IF;

  SELECT checkpoint.state_hint INTO v_checkpoint_state
  FROM public.story_mode_checkpoints checkpoint
  WHERE checkpoint.level_slug = v_attempt.level_slug AND checkpoint.checkpoint_id = v_attempt.checkpoint_id;

  IF v_attempt.question_started_at IS NOT NULL AND v_question.id IS NOT NULL
    AND v_attempt.active_question_id = v_question.id THEN
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
    'question', CASE WHEN v_question.id IS NULL THEN NULL ELSE public.story_mode_question_payload(v_question.id) END,
    'pending_event_id', v_pending_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_story_mode_checkpoint(p_attempt_id uuid, p_checkpoint_id text)
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
  v_expected_checkpoint text;
  v_next_state_hint text;
BEGIN
  SELECT * INTO v_attempt FROM public.story_mode_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN RAISE EXCEPTION 'Resume Story Mode before saving a checkpoint.'; END IF;

  SELECT question.checkpoint_id INTO v_expected_checkpoint
  FROM public.story_mode_attempt_questions selected
  JOIN public.story_mode_questions question ON question.id = selected.question_id
  WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
  ORDER BY selected.sequence_order LIMIT 1;
  IF v_expected_checkpoint IS DISTINCT FROM p_checkpoint_id THEN
    RAISE EXCEPTION 'Only the next server-selected Story Mode checkpoint can be saved.';
  END IF;

  SELECT checkpoint_order INTO v_current_order FROM public.story_mode_checkpoints
  WHERE level_slug = v_attempt.level_slug AND checkpoint_id = v_attempt.checkpoint_id;
  SELECT checkpoint_order, state_hint INTO v_next_order, v_next_state_hint FROM public.story_mode_checkpoints
  WHERE level_slug = v_attempt.level_slug AND checkpoint_id = p_checkpoint_id;
  IF v_next_order IS NULL THEN RAISE EXCEPTION 'Unknown Story Mode checkpoint.'; END IF;
  IF v_current_order IS NOT NULL AND v_next_order > v_current_order + 1 THEN
    RAISE EXCEPTION 'Story Mode checkpoints must be reached in order.';
  END IF;
  IF v_current_order IS NOT NULL AND v_next_order < v_current_order THEN
    RAISE EXCEPTION 'Story Mode checkpoints cannot be moved backward.';
  END IF;
  IF v_next_state_hint IN ('level_complete', 'chapter_complete', 'canonical_event') THEN
    RAISE EXCEPTION 'Terminal Story Mode checkpoints must be settled by the server.';
  END IF;

  UPDATE public.story_mode_attempts SET checkpoint_id = p_checkpoint_id, updated_at = now() WHERE id = p_attempt_id;
  UPDATE public.story_mode_progress SET checkpoint_id = p_checkpoint_id, updated_at = now()
  WHERE user_id = v_user_id AND NOT v_attempt.is_replay;
  RETURN jsonb_build_object('checkpoint_id', p_checkpoint_id, 'saved_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_story_mode_question(p_attempt_id uuid, p_question_id text)
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
  SELECT * INTO v_attempt FROM public.story_mode_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN RAISE EXCEPTION 'Resume Story Mode before starting the question.'; END IF;

  SELECT question.* INTO v_question
  FROM public.story_mode_attempt_questions selected
  JOIN public.story_mode_questions question ON question.id = selected.question_id
  WHERE selected.attempt_id = v_attempt.id AND selected.question_id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question is not part of this Story Mode attempt.'; END IF;

  SELECT selected.question_id INTO v_expected_question_id
  FROM public.story_mode_attempt_questions selected
  WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
  ORDER BY selected.sequence_order LIMIT 1;
  IF v_expected_question_id IS DISTINCT FROM p_question_id THEN
    RAISE EXCEPTION 'This Story Mode question is not unlocked yet.';
  END IF;
  IF v_attempt.checkpoint_id IS DISTINCT FROM v_question.checkpoint_id THEN
    RAISE EXCEPTION 'Reach the Story Mode question checkpoint first.';
  END IF;

  IF v_attempt.question_started_at IS NULL OR v_attempt.active_question_id IS DISTINCT FROM p_question_id THEN
    UPDATE public.story_mode_attempts
    SET active_question_id = p_question_id, question_started_at = now(), updated_at = now()
    WHERE id = p_attempt_id RETURNING * INTO v_attempt;
  END IF;

  RETURN jsonb_build_object(
    'deadline', v_attempt.question_started_at + make_interval(secs => v_question.timer_seconds),
    'server_now', now(), 'paused', false
  );
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
  v_level public.story_mode_levels%ROWTYPE;
  v_question public.story_mode_questions%ROWTYPE;
  v_next_question public.story_mode_questions%ROWTYPE;
  v_existing_response jsonb;
  v_timed_out boolean;
  v_correct boolean;
  v_figs integer := 0;
  v_total_figs integer := 0;
  v_correct_count integer := 0;
  v_question_count integer := 0;
  v_level_complete boolean := false;
  v_pending_event_id text;
  v_complete_checkpoint text;
  v_next_level_slug text;
  v_next_level_checkpoint text;
  v_response jsonb;
BEGIN
  SELECT event.response_payload INTO v_existing_response
  FROM public.story_mode_answer_events event
  JOIN public.story_mode_attempts attempt ON attempt.id = event.attempt_id
  WHERE event.submission_id = p_submission_id AND attempt.user_id = v_user_id;
  IF FOUND THEN RETURN v_existing_response; END IF;

  SELECT * INTO v_attempt FROM public.story_mode_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;

  SELECT event.response_payload INTO v_existing_response
  FROM public.story_mode_answer_events event
  WHERE event.submission_id = p_submission_id AND event.attempt_id = v_attempt.id;
  IF FOUND THEN RETURN v_existing_response; END IF;

  IF v_attempt.status <> 'in_progress' THEN RAISE EXCEPTION 'This Story Mode attempt is not active for your account.'; END IF;
  IF v_attempt.paused_at IS NOT NULL THEN RAISE EXCEPTION 'Resume Story Mode before answering.'; END IF;

  SELECT question.* INTO v_question
  FROM public.story_mode_attempt_questions selected
  JOIN public.story_mode_questions question ON question.id = selected.question_id
  WHERE selected.attempt_id = v_attempt.id AND selected.question_id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question is not part of this Story Mode attempt.'; END IF;
  IF v_attempt.active_question_id IS DISTINCT FROM p_question_id THEN
    RAISE EXCEPTION 'This Story Mode question is not active.';
  END IF;
  IF v_attempt.question_started_at IS NULL THEN RAISE EXCEPTION 'The Story Mode question timer has not started.'; END IF;

  v_timed_out := coalesce(p_timed_out, false)
    OR now() > v_attempt.question_started_at + make_interval(secs => v_question.timer_seconds);
  v_correct := NOT v_timed_out
    AND lower(btrim(coalesce(p_selected_answer, ''))) = lower(btrim(v_question.correct_answer));

  IF v_correct AND NOT v_attempt.is_replay THEN
    INSERT INTO public.story_mode_fig_entries (user_id, level_slug, question_id, attempt_id, figs)
    VALUES (v_user_id, v_attempt.level_slug, v_question.id, v_attempt.id, public.story_mode_fig_value(v_question.difficulty))
    ON CONFLICT (user_id, question_id) DO NOTHING
    RETURNING figs INTO v_figs;
    v_figs := coalesce(v_figs, 0);
  END IF;

  IF v_correct THEN
    UPDATE public.story_mode_attempt_questions
    SET answered_correct = true
    WHERE attempt_id = v_attempt.id AND question_id = v_question.id;
  END IF;

  SELECT count(*) FILTER (WHERE selected.answered_correct), count(*)
  INTO v_correct_count, v_question_count
  FROM public.story_mode_attempt_questions selected
  WHERE selected.attempt_id = v_attempt.id;

  IF v_correct THEN
    SELECT question.* INTO v_next_question
    FROM public.story_mode_attempt_questions selected
    JOIN public.story_mode_questions question ON question.id = selected.question_id
    WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
    ORDER BY selected.sequence_order LIMIT 1;

    IF v_next_question.id IS NULL THEN
      SELECT event.id, event.checkpoint_id INTO v_pending_event_id, v_complete_checkpoint
      FROM public.story_mode_canonical_events event
      WHERE event.level_slug = v_attempt.level_slug
      ORDER BY event.event_order LIMIT 1;

      IF v_pending_event_id IS NULL THEN
        SELECT checkpoint.checkpoint_id INTO v_complete_checkpoint
        FROM public.story_mode_checkpoints checkpoint
        WHERE checkpoint.level_slug = v_attempt.level_slug
          AND checkpoint.state_hint = 'level_complete'
        ORDER BY checkpoint.checkpoint_order DESC LIMIT 1;
        v_level_complete := true;
      END IF;
    END IF;
  END IF;

  SELECT coalesce(sum(entry.figs), 0) INTO v_total_figs
  FROM public.story_mode_fig_entries entry WHERE entry.attempt_id = v_attempt.id;

  IF v_level_complete THEN
    UPDATE public.story_mode_attempts SET
      status = 'completed', checkpoint_id = v_complete_checkpoint,
      active_question_id = NULL, question_started_at = NULL, paused_at = NULL,
      answer_count = answer_count + 1, correct_count = v_correct_count,
      completed_at = now(), updated_at = now()
    WHERE id = v_attempt.id;

    INSERT INTO public.story_mode_level_completions (
      user_id, level_slug, correct_count, question_count, figs_earned, denarii_earned
    ) VALUES (v_user_id, v_attempt.level_slug, v_correct_count, v_question_count, v_total_figs, 0)
    ON CONFLICT (user_id, level_slug) DO UPDATE SET
      last_completed_at = now(),
      times_completed = public.story_mode_level_completions.times_completed + 1,
      correct_count = greatest(public.story_mode_level_completions.correct_count, EXCLUDED.correct_count),
      question_count = greatest(public.story_mode_level_completions.question_count, EXCLUDED.question_count),
      figs_earned = greatest(public.story_mode_level_completions.figs_earned, EXCLUDED.figs_earned),
      denarii_earned = greatest(public.story_mode_level_completions.denarii_earned, EXCLUDED.denarii_earned);

    SELECT * INTO v_level FROM public.story_mode_levels WHERE slug = v_attempt.level_slug;
    SELECT next_level.slug, checkpoint.checkpoint_id INTO v_next_level_slug, v_next_level_checkpoint
    FROM public.story_mode_levels next_level
    JOIN LATERAL (
      SELECT candidate.checkpoint_id FROM public.story_mode_checkpoints candidate
      WHERE candidate.level_slug = next_level.slug ORDER BY candidate.checkpoint_order LIMIT 1
    ) checkpoint ON true
    WHERE next_level.book_slug = v_level.book_slug
      AND next_level.chapter_slug = v_level.chapter_slug
      AND next_level.level_order = v_level.level_order + 1
      AND next_level.is_published = true;

    UPDATE public.story_mode_progress SET
      current_level_slug = coalesce(v_next_level_slug, v_attempt.level_slug),
      checkpoint_id = coalesce(v_next_level_checkpoint, v_complete_checkpoint),
      updated_at = now()
    WHERE user_id = v_user_id AND NOT v_attempt.is_replay;
  ELSE
    UPDATE public.story_mode_attempts SET
      checkpoint_id = CASE
        WHEN v_correct AND v_next_question.id IS NOT NULL THEN v_next_question.checkpoint_id
        WHEN v_correct AND v_pending_event_id IS NOT NULL THEN v_complete_checkpoint
        ELSE checkpoint_id
      END,
      active_question_id = NULL,
      question_started_at = NULL,
      paused_at = NULL,
      answer_count = answer_count + 1,
      correct_count = v_correct_count,
      failure_count = failure_count + CASE WHEN v_correct THEN 0 ELSE 1 END,
      updated_at = now()
    WHERE id = v_attempt.id;

    UPDATE public.story_mode_progress SET
      checkpoint_id = CASE
        WHEN v_correct AND v_next_question.id IS NOT NULL THEN v_next_question.checkpoint_id
        WHEN v_correct AND v_pending_event_id IS NOT NULL THEN v_complete_checkpoint
        ELSE checkpoint_id
      END,
      updated_at = now()
    WHERE user_id = v_user_id AND NOT v_attempt.is_replay;
  END IF;

  v_response := jsonb_build_object(
    'correct', v_correct,
    'timed_out', v_timed_out,
    'figs_earned', v_figs,
    'denarii_earned', 0,
    'total_figs', v_total_figs,
    'correct_count', v_correct_count,
    'question_count', v_question_count,
    'completion_percentage', CASE WHEN v_question_count = 0 THEN 0 ELSE round((v_correct_count::numeric / v_question_count::numeric) * 100) END,
    'level_complete', v_level_complete,
    'chapter_complete', false,
    'canonical_event_pending', v_pending_event_id IS NOT NULL,
    'canonical_event_id', v_pending_event_id,
    'checkpoint_id', CASE
      WHEN v_level_complete THEN v_complete_checkpoint
      WHEN v_correct AND v_next_question.id IS NOT NULL THEN v_next_question.checkpoint_id
      WHEN v_correct AND v_pending_event_id IS NOT NULL THEN v_complete_checkpoint
      ELSE v_attempt.checkpoint_id
    END,
    'action_id', CASE WHEN v_correct THEN v_question.correct_action_id ELSE v_question.wrong_action_id END,
    'explanation', v_question.explanation,
    'replay', v_attempt.is_replay,
    'next_question', CASE WHEN v_next_question.id IS NULL THEN NULL ELSE public.story_mode_question_payload(v_next_question.id) END,
    'levels_completed', (
      SELECT count(*) FROM public.story_mode_level_completions completion
      JOIN public.story_mode_levels level ON level.slug = completion.level_slug
      WHERE completion.user_id = v_user_id AND level.book_slug = 'beginnings' AND level.chapter_slug = 'brothers'
    )
  );

  INSERT INTO public.story_mode_answer_events (
    attempt_id, question_id, submission_id, selected_answer, timed_out,
    is_correct, figs_earned, response_payload
  ) VALUES (
    v_attempt.id, v_question.id, p_submission_id, p_selected_answer, v_timed_out,
    v_correct, v_figs, v_response
  );
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_story_mode_canonical_event(
  p_attempt_id uuid,
  p_event_id text,
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
  v_level public.story_mode_levels%ROWTYPE;
  v_event public.story_mode_canonical_events%ROWTYPE;
  v_existing_response jsonb;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_total_figs integer := 0;
  v_chapter_figs integer := 0;
  v_chapter_questions integer := 0;
  v_chapter_correct integer := 0;
  v_levels_completed integer := 0;
  v_next_level_slug text;
  v_next_level_checkpoint text;
  v_response jsonb;
BEGIN
  SELECT settlement.response_payload INTO v_existing_response
  FROM public.story_mode_event_settlements settlement
  JOIN public.story_mode_attempts attempt ON attempt.id = settlement.attempt_id
  WHERE attempt.user_id = v_user_id
    AND (settlement.submission_id = p_submission_id
      OR (settlement.attempt_id = p_attempt_id AND settlement.event_id = p_event_id));
  IF FOUND THEN RETURN v_existing_response; END IF;

  SELECT * INTO v_attempt FROM public.story_mode_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;

  SELECT settlement.response_payload INTO v_existing_response
  FROM public.story_mode_event_settlements settlement
  WHERE settlement.attempt_id = v_attempt.id AND settlement.event_id = p_event_id;
  IF FOUND THEN RETURN v_existing_response; END IF;

  SELECT * INTO v_event FROM public.story_mode_canonical_events
  WHERE id = p_event_id AND level_slug = v_attempt.level_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'This canonical transition is not part of the active Story Mode level.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.story_mode_attempt_questions selected
    WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
  ) THEN
    RAISE EXCEPTION 'Complete the server-selected questions before the canonical transition.';
  END IF;
  IF v_attempt.level_slug <> 'another-offspring' AND v_attempt.checkpoint_id IS DISTINCT FROM v_event.checkpoint_id THEN
    RAISE EXCEPTION 'The canonical transition cannot be skipped or reached out of order.';
  END IF;

  SELECT count(*) FILTER (WHERE selected.answered_correct), count(*)
  INTO v_correct_count, v_question_count
  FROM public.story_mode_attempt_questions selected WHERE selected.attempt_id = v_attempt.id;
  SELECT coalesce(sum(entry.figs), 0) INTO v_total_figs
  FROM public.story_mode_fig_entries entry WHERE entry.attempt_id = v_attempt.id;

  UPDATE public.story_mode_attempts SET
    status = 'completed',
    checkpoint_id = v_event.completion_checkpoint_id,
    active_question_id = NULL,
    question_started_at = NULL,
    paused_at = NULL,
    correct_count = v_correct_count,
    completed_at = now(),
    updated_at = now()
  WHERE id = v_attempt.id;

  INSERT INTO public.story_mode_level_completions (
    user_id, level_slug, correct_count, question_count, figs_earned, denarii_earned
  ) VALUES (v_user_id, v_attempt.level_slug, v_correct_count, v_question_count, v_total_figs, 0)
  ON CONFLICT (user_id, level_slug) DO UPDATE SET
    last_completed_at = now(),
    times_completed = public.story_mode_level_completions.times_completed + 1,
    correct_count = greatest(public.story_mode_level_completions.correct_count, EXCLUDED.correct_count),
    question_count = greatest(public.story_mode_level_completions.question_count, EXCLUDED.question_count),
    figs_earned = greatest(public.story_mode_level_completions.figs_earned, EXCLUDED.figs_earned),
    denarii_earned = greatest(public.story_mode_level_completions.denarii_earned, EXCLUDED.denarii_earned);

  SELECT * INTO v_level FROM public.story_mode_levels WHERE slug = v_attempt.level_slug;
  SELECT next_level.slug, checkpoint.checkpoint_id INTO v_next_level_slug, v_next_level_checkpoint
  FROM public.story_mode_levels next_level
  JOIN LATERAL (
    SELECT candidate.checkpoint_id FROM public.story_mode_checkpoints candidate
    WHERE candidate.level_slug = next_level.slug ORDER BY candidate.checkpoint_order LIMIT 1
  ) checkpoint ON true
  WHERE next_level.book_slug = v_level.book_slug
    AND next_level.chapter_slug = v_level.chapter_slug
    AND next_level.level_order = v_level.level_order + 1
    AND next_level.is_published = true;

  IF v_event.completes_chapter THEN
    INSERT INTO public.story_mode_chapter_completions (
      user_id, book_slug, chapter_slug
    ) VALUES (v_user_id, v_level.book_slug, v_level.chapter_slug)
    ON CONFLICT (user_id, book_slug, chapter_slug) DO UPDATE SET
      last_completed_at = now(),
      times_completed = public.story_mode_chapter_completions.times_completed + 1;
  END IF;

  UPDATE public.story_mode_progress SET
    current_book_slug = v_level.book_slug,
    current_chapter_slug = v_level.chapter_slug,
    current_level_slug = coalesce(v_next_level_slug, v_attempt.level_slug),
    checkpoint_id = coalesce(v_next_level_checkpoint, v_event.completion_checkpoint_id),
    updated_at = now()
  WHERE user_id = v_user_id AND NOT v_attempt.is_replay;

  SELECT
    coalesce(sum(completion.correct_count), 0),
    coalesce(sum(completion.question_count), 0),
    count(*)
  INTO v_chapter_correct, v_chapter_questions, v_levels_completed
  FROM public.story_mode_level_completions completion
  JOIN public.story_mode_levels level ON level.slug = completion.level_slug
  WHERE completion.user_id = v_user_id
    AND level.book_slug = v_level.book_slug AND level.chapter_slug = v_level.chapter_slug;

  SELECT coalesce(sum(entry.figs), 0) INTO v_chapter_figs
  FROM public.story_mode_fig_entries entry
  JOIN public.story_mode_levels level ON level.slug = entry.level_slug
  WHERE entry.user_id = v_user_id
    AND level.book_slug = v_level.book_slug AND level.chapter_slug = v_level.chapter_slug;

  v_response := jsonb_build_object(
    'correct', true,
    'timed_out', false,
    'figs_earned', 0,
    'denarii_earned', 0,
    'total_figs', CASE WHEN v_event.completes_chapter THEN v_chapter_figs ELSE v_total_figs END,
    'correct_count', CASE WHEN v_event.completes_chapter THEN v_chapter_correct ELSE v_correct_count END,
    'question_count', CASE WHEN v_event.completes_chapter THEN v_chapter_questions ELSE v_question_count END,
    'completion_percentage', CASE
      WHEN (CASE WHEN v_event.completes_chapter THEN v_chapter_questions ELSE v_question_count END) = 0 THEN 100
      ELSE round(((CASE WHEN v_event.completes_chapter THEN v_chapter_correct ELSE v_correct_count END)::numeric
        / (CASE WHEN v_event.completes_chapter THEN v_chapter_questions ELSE v_question_count END)::numeric) * 100)
    END,
    'level_complete', true,
    'chapter_complete', v_event.completes_chapter,
    'canonical_event_pending', false,
    'canonical_event_id', v_event.id,
    'checkpoint_id', v_event.completion_checkpoint_id,
    'action_id', CASE WHEN v_event.event_type = 'canonical_death' THEN 'canonical-character-exit' ELSE 'character-swap' END,
    'explanation', CASE
      WHEN v_event.event_type = 'canonical_death' THEN 'Cain killed Abel as Genesis 4:8 records. This canonical death advances the story and is not gameplay failure.'
      ELSE 'Genesis 4:25 introduces Seth and closes the Brothers chapter.'
    END,
    'replay', v_attempt.is_replay,
    'next_question', NULL,
    'levels_completed', v_levels_completed
  );

  INSERT INTO public.story_mode_event_settlements (
    attempt_id, event_id, submission_id, response_payload
  ) VALUES (v_attempt.id, v_event.id, p_submission_id, v_response);
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.story_mode_question_payload(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_story_mode_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_story_mode_level(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_story_mode_checkpoint(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_story_mode_question(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_story_mode_canonical_event(uuid, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.story_mode_question_payload(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_story_mode_progress() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_story_mode_level(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_story_mode_checkpoint(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_story_mode_question(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_story_mode_canonical_event(uuid, text, uuid) TO authenticated, service_role;

/* No Story Mode Denarii or Marks are awarded. Figs remain first-correct,
   first-play only through story_mode_fig_entries and its user/question key. */
