/* Story Mode Phase 3E: Genesis 7-9 Flood environment and Book I completion. */

CREATE TABLE IF NOT EXISTS public.story_mode_environment_sequences (
  id text PRIMARY KEY,
  label text NOT NULL,
  total_stages integer NOT NULL CHECK (total_stages > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.story_mode_environment_stages (
  sequence_id text NOT NULL REFERENCES public.story_mode_environment_sequences(id) ON DELETE CASCADE,
  stage_order integer NOT NULL CHECK (stage_order > 0),
  stage_slug text NOT NULL,
  weather text NOT NULL CHECK (weather IN ('none', 'clear', 'wind', 'still', 'haze', 'clouding', 'drizzle', 'rain', 'heavy_rain', 'storm')),
  weather_intensity integer NOT NULL DEFAULT 0 CHECK (weather_intensity BETWEEN 0 AND 4),
  water_stage integer NOT NULL DEFAULT 0 CHECK (water_stage BETWEEN 0 AND 7),
  water_trend text NOT NULL CHECK (water_trend IN ('none', 'rising', 'stable', 'falling')),
  terrain_state text NOT NULL CHECK (terrain_state IN ('dry', 'wet', 'covered', 'submerged', 'emerging', 'muddy')),
  traversal_mode text NOT NULL CHECK (traversal_mode IN ('ground', 'ark_approach', 'ark_interior', 'ark_floating', 'ark_resting', 'dry_land')),
  ark_state text NOT NULL CHECK (ark_state IN ('prepared', 'sealed', 'floating', 'resting', 'opened')),
  bird_kind text NOT NULL DEFAULT 'none' CHECK (bird_kind IN ('none', 'raven', 'dove')),
  bird_state text NOT NULL DEFAULT 'none' CHECK (bird_state IN ('none', 'waiting', 'released', 'flying', 'returned', 'carrying', 'no_return')),
  olive_leaf_visible boolean NOT NULL DEFAULT false,
  altar_visible boolean NOT NULL DEFAULT false,
  rainbow_visible boolean NOT NULL DEFAULT false,
  completion_label text NOT NULL,
  trigger_level_slug text NOT NULL,
  trigger_pool_id text NOT NULL,
  checkpoint_id text NOT NULL,
  PRIMARY KEY (sequence_id, stage_order),
  UNIQUE (sequence_id, stage_slug),
  UNIQUE (trigger_level_slug, trigger_pool_id),
  FOREIGN KEY (trigger_level_slug, trigger_pool_id)
    REFERENCES public.story_mode_question_pools(level_slug, pool_id) ON DELETE CASCADE,
  FOREIGN KEY (trigger_level_slug, checkpoint_id)
    REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.story_mode_level_environment_context (
  level_slug text PRIMARY KEY REFERENCES public.story_mode_levels(slug) ON DELETE CASCADE,
  sequence_id text NOT NULL REFERENCES public.story_mode_environment_sequences(id) ON DELETE CASCADE,
  starting_stage_order integer NOT NULL CHECK (starting_stage_order >= 0),
  ending_stage_order integer NOT NULL CHECK (ending_stage_order >= starting_stage_order)
);

CREATE TABLE IF NOT EXISTS public.story_mode_user_environment_progress (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sequence_id text NOT NULL REFERENCES public.story_mode_environment_sequences(id) ON DELETE CASCADE,
  stage_order integer NOT NULL DEFAULT 0 CHECK (stage_order >= 0),
  stage_slug text NOT NULL DEFAULT 'prepared-ark',
  checkpoint_id text NOT NULL DEFAULT 'ark-stands-complete',
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sequence_id)
);

CREATE TABLE IF NOT EXISTS public.story_mode_attempt_environment_progress (
  attempt_id uuid PRIMARY KEY REFERENCES public.story_mode_attempts(id) ON DELETE CASCADE,
  sequence_id text NOT NULL REFERENCES public.story_mode_environment_sequences(id) ON DELETE CASCADE,
  stage_order integer NOT NULL DEFAULT 0 CHECK (stage_order >= 0),
  stage_slug text NOT NULL DEFAULT 'prepared-ark',
  checkpoint_id text NOT NULL DEFAULT 'ark-stands-complete',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.story_mode_book_completions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_slug text NOT NULL,
  first_completed_at timestamptz NOT NULL DEFAULT now(),
  chapters_completed integer NOT NULL CHECK (chapters_completed >= 0),
  levels_completed integer NOT NULL CHECK (levels_completed >= 0),
  questions_encountered integer NOT NULL CHECK (questions_encountered >= 0),
  correct_answers integer NOT NULL CHECK (correct_answers >= 0),
  completion_percentage integer NOT NULL CHECK (completion_percentage BETWEEN 0 AND 100),
  figs_earned integer NOT NULL DEFAULT 0 CHECK (figs_earned >= 0),
  denarii_earned integer NOT NULL DEFAULT 0 CHECK (denarii_earned >= 0),
  PRIMARY KEY (user_id, book_slug)
);

ALTER TABLE public.story_mode_environment_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_environment_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_level_environment_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_user_environment_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_attempt_environment_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_book_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.story_mode_environment_sequences,
  public.story_mode_environment_stages,
  public.story_mode_level_environment_context,
  public.story_mode_user_environment_progress,
  public.story_mode_attempt_environment_progress,
  public.story_mode_book_completions
FROM PUBLIC, anon, authenticated;

/* Remove the unpublished Phase 3D placeholder before assigning canonical order 11. */
DELETE FROM public.story_mode_levels
WHERE slug = 'the-flood'
  AND is_published = false;

INSERT INTO public.story_mode_levels (
  slug, book_slug, chapter_slug, title, level_order, unlock_after_level_slug, is_published
)
VALUES
  ('enter-the-ark', 'beginnings', 'noah', 'Enter the Ark', 11, 'the-ark-stands', true),
  ('seven-days', 'beginnings', 'noah', 'Seven Days', 12, 'enter-the-ark', true),
  ('forty-days', 'beginnings', 'noah', 'Forty Days', 13, 'seven-days', true),
  ('waters-prevailed', 'beginnings', 'noah', 'Waters Prevailed', 14, 'forty-days', true),
  ('god-remembered-noah', 'beginnings', 'noah', 'God Remembered Noah', 15, 'waters-prevailed', true),
  ('the-mountains-appear', 'beginnings', 'noah', 'The Mountains Appear', 16, 'god-remembered-noah', true),
  ('the-raven', 'beginnings', 'noah', 'The Raven', 17, 'the-mountains-appear', true),
  ('the-dove', 'beginnings', 'noah', 'The Dove', 18, 'the-raven', true),
  ('an-olive-leaf', 'beginnings', 'noah', 'An Olive Leaf', 19, 'the-dove', true),
  ('dry-ground', 'beginnings', 'noah', 'Dry Ground', 20, 'an-olive-leaf', true),
  ('come-out', 'beginnings', 'noah', 'Come Out', 21, 'dry-ground', true),
  ('an-altar', 'beginnings', 'noah', 'An Altar', 22, 'come-out', true),
  ('my-covenant', 'beginnings', 'noah', 'My Covenant', 23, 'an-altar', true),
  ('the-bow-in-the-cloud', 'beginnings', 'noah', 'The Bow in the Cloud', 24, 'my-covenant', true)
ON CONFLICT (slug) DO UPDATE SET
  book_slug = EXCLUDED.book_slug,
  chapter_slug = EXCLUDED.chapter_slug,
  title = EXCLUDED.title,
  level_order = EXCLUDED.level_order,
  unlock_after_level_slug = EXCLUDED.unlock_after_level_slug,
  is_published = EXCLUDED.is_published;

INSERT INTO public.story_mode_checkpoints (level_slug, checkpoint_id, checkpoint_order, state_hint)
VALUES
  ('enter-the-ark', 'enter-the-ark-start', 0, 'intro'),
  ('enter-the-ark', 'entry-household-question', 1, 'question_approach'),
  ('enter-the-ark', 'entry-animals-question', 2, 'question_approach'),
  ('enter-the-ark', 'entry-door-question', 3, 'question_approach'),
  ('enter-the-ark', 'enter-the-ark-complete', 4, 'level_complete'),
  ('seven-days', 'seven-days-start', 0, 'intro'),
  ('seven-days', 'seven-wait-question', 1, 'question_approach'),
  ('seven-days', 'seven-rain-question', 2, 'question_approach'),
  ('seven-days', 'seven-days-complete', 3, 'level_complete'),
  ('forty-days', 'forty-days-start', 0, 'intro'),
  ('forty-days', 'forty-duration-question', 1, 'question_approach'),
  ('forty-days', 'forty-fountains-question', 2, 'question_approach'),
  ('forty-days', 'forty-days-complete', 3, 'level_complete'),
  ('waters-prevailed', 'waters-prevailed-start', 0, 'intro'),
  ('waters-prevailed', 'waters-lift-question', 1, 'question_approach'),
  ('waters-prevailed', 'waters-prevail-question', 2, 'question_approach'),
  ('waters-prevailed', 'waters-prevailed-complete', 3, 'level_complete'),
  ('god-remembered-noah', 'god-remembered-noah-start', 0, 'intro'),
  ('god-remembered-noah', 'remembered-wind-question', 1, 'question_approach'),
  ('god-remembered-noah', 'remembered-rest-question', 2, 'question_approach'),
  ('god-remembered-noah', 'god-remembered-noah-complete', 3, 'level_complete'),
  ('the-mountains-appear', 'the-mountains-appear-start', 0, 'intro'),
  ('the-mountains-appear', 'mountains-date-question', 1, 'question_approach'),
  ('the-mountains-appear', 'mountains-visible-question', 2, 'question_approach'),
  ('the-mountains-appear', 'the-mountains-appear-complete', 3, 'level_complete'),
  ('the-raven', 'the-raven-start', 0, 'intro'),
  ('the-raven', 'raven-release-question', 1, 'question_approach'),
  ('the-raven', 'raven-movement-question', 2, 'question_approach'),
  ('the-raven', 'the-raven-complete', 3, 'level_complete'),
  ('the-dove', 'the-dove-start', 0, 'intro'),
  ('the-dove', 'dove-first-question', 1, 'question_approach'),
  ('the-dove', 'dove-return-question', 2, 'question_approach'),
  ('the-dove', 'the-dove-complete', 3, 'level_complete'),
  ('an-olive-leaf', 'an-olive-leaf-start', 0, 'intro'),
  ('an-olive-leaf', 'olive-wait-question', 1, 'question_approach'),
  ('an-olive-leaf', 'olive-leaf-question', 2, 'question_approach'),
  ('an-olive-leaf', 'olive-third-question', 3, 'question_approach'),
  ('an-olive-leaf', 'an-olive-leaf-complete', 4, 'level_complete'),
  ('dry-ground', 'dry-ground-start', 0, 'intro'),
  ('dry-ground', 'dry-uncover-question', 1, 'question_approach'),
  ('dry-ground', 'dry-complete-question', 2, 'question_approach'),
  ('dry-ground', 'dry-ground-complete', 3, 'level_complete'),
  ('come-out', 'come-out-start', 0, 'intro'),
  ('come-out', 'exit-command-question', 1, 'question_approach'),
  ('come-out', 'exit-groups-question', 2, 'question_approach'),
  ('come-out', 'come-out-complete', 3, 'level_complete'),
  ('an-altar', 'an-altar-start', 0, 'intro'),
  ('an-altar', 'altar-build-question', 1, 'question_approach'),
  ('an-altar', 'altar-declaration-question', 2, 'question_approach'),
  ('an-altar', 'an-altar-complete', 3, 'level_complete'),
  ('my-covenant', 'my-covenant-start', 0, 'intro'),
  ('my-covenant', 'covenant-parties-question', 1, 'question_approach'),
  ('my-covenant', 'covenant-promise-question', 2, 'question_approach'),
  ('my-covenant', 'my-covenant-complete', 3, 'level_complete'),
  ('the-bow-in-the-cloud', 'the-bow-in-the-cloud-start', 0, 'intro'),
  ('the-bow-in-the-cloud', 'bow-sign-question', 1, 'question_approach'),
  ('the-bow-in-the-cloud', 'bow-cloud-question', 2, 'question_approach'),
  ('the-bow-in-the-cloud', 'the-bow-in-the-cloud-complete', 3, 'level_complete')
ON CONFLICT (level_slug, checkpoint_id) DO UPDATE SET
  checkpoint_order = EXCLUDED.checkpoint_order,
  state_hint = EXCLUDED.state_hint;

INSERT INTO public.story_mode_question_pools (
  level_slug, pool_id, scene_id, checkpoint_id, pool_order, questions_per_attempt
)
VALUES
  ('enter-the-ark', 'entry-household-moderate', 'entry-household', 'entry-household-question', 1, 1),
  ('enter-the-ark', 'entry-animals-moderate', 'entry-animals', 'entry-animals-question', 2, 1),
  ('enter-the-ark', 'entry-door-hard', 'entry-door', 'entry-door-question', 3, 1),
  ('seven-days', 'seven-wait-easy', 'seven-wait', 'seven-wait-question', 1, 1),
  ('seven-days', 'seven-rain-moderate', 'seven-rain', 'seven-rain-question', 2, 1),
  ('forty-days', 'forty-duration-easy', 'forty-duration', 'forty-duration-question', 1, 1),
  ('forty-days', 'forty-fountains-hard', 'forty-fountains', 'forty-fountains-question', 2, 1),
  ('waters-prevailed', 'waters-lift-easy', 'waters-lift', 'waters-lift-question', 1, 1),
  ('waters-prevailed', 'waters-prevail-hard', 'waters-prevail', 'waters-prevail-question', 2, 1),
  ('god-remembered-noah', 'remembered-wind-moderate', 'remembered-wind', 'remembered-wind-question', 1, 1),
  ('god-remembered-noah', 'remembered-rest-hard', 'remembered-rest', 'remembered-rest-question', 2, 1),
  ('the-mountains-appear', 'mountains-date-hard', 'mountains-date', 'mountains-date-question', 1, 1),
  ('the-mountains-appear', 'mountains-visible-easy', 'mountains-visible', 'mountains-visible-question', 2, 1),
  ('the-raven', 'raven-release-easy', 'raven-release', 'raven-release-question', 1, 1),
  ('the-raven', 'raven-movement-moderate', 'raven-movement', 'raven-movement-question', 2, 1),
  ('the-dove', 'dove-first-easy', 'dove-first', 'dove-first-question', 1, 1),
  ('the-dove', 'dove-return-moderate', 'dove-return', 'dove-return-question', 2, 1),
  ('an-olive-leaf', 'olive-wait-moderate', 'olive-wait', 'olive-wait-question', 1, 1),
  ('an-olive-leaf', 'olive-leaf-easy', 'olive-leaf', 'olive-leaf-question', 2, 1),
  ('an-olive-leaf', 'olive-third-hard', 'olive-third', 'olive-third-question', 3, 1),
  ('dry-ground', 'dry-uncover-moderate', 'dry-uncover', 'dry-uncover-question', 1, 1),
  ('dry-ground', 'dry-complete-hard', 'dry-complete', 'dry-complete-question', 2, 1),
  ('come-out', 'exit-command-easy', 'exit-command', 'exit-command-question', 1, 1),
  ('come-out', 'exit-groups-moderate', 'exit-groups', 'exit-groups-question', 2, 1),
  ('an-altar', 'altar-build-easy', 'altar-build', 'altar-build-question', 1, 1),
  ('an-altar', 'altar-declaration-hard', 'altar-declaration', 'altar-declaration-question', 2, 1),
  ('my-covenant', 'covenant-parties-moderate', 'covenant-parties', 'covenant-parties-question', 1, 1),
  ('my-covenant', 'covenant-promise-hard', 'covenant-promise', 'covenant-promise-question', 2, 1),
  ('the-bow-in-the-cloud', 'bow-sign-easy', 'bow-sign', 'bow-sign-question', 1, 1),
  ('the-bow-in-the-cloud', 'bow-cloud-hard', 'bow-cloud', 'bow-cloud-question', 2, 1)
ON CONFLICT (level_slug, pool_id) DO UPDATE SET
  scene_id = EXCLUDED.scene_id,
  checkpoint_id = EXCLUDED.checkpoint_id,
  pool_order = EXCLUDED.pool_order,
  questions_per_attempt = EXCLUDED.questions_per_attempt;

WITH question_seed AS (
  SELECT *
  FROM jsonb_to_recordset($flood_questions$
  [
    {"id":"flood-entry-household-members","level_slug":"enter-the-ark","checkpoint_id":"entry-household-question","question_order":1,"question_type":"multiple_choice","prompt":"Who entered the Ark with Noah according to Genesis 7?","options":["His wife, his sons, and his sons' wives","Only his three sons","Only his wife","Unnamed builders"],"correct_answer":"His wife, his sons, and his sons' wives","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 7:1, 7, 13","explanation":"Noah entered with his wife, his sons, and his sons' wives.","correct_action_id":"household-enter","wrong_action_id":"entry-blocked","pool_id":"entry-household-moderate","scene_id":"entry-household","is_read_follow_up":false},
    {"id":"flood-entry-household-alone","level_slug":"enter-the-ark","checkpoint_id":"entry-household-question","question_order":2,"question_type":"true_false","prompt":"Noah entered the Ark alone.","options":["True","False"],"correct_answer":"False","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 7:7, 13","explanation":"The passage names Noah's household with him.","correct_action_id":"household-enter","wrong_action_id":"entry-blocked","pool_id":"entry-household-moderate","scene_id":"entry-household","is_read_follow_up":false},
    {"id":"flood-entry-animal-distinctions","level_slug":"enter-the-ark","checkpoint_id":"entry-animals-question","question_order":3,"question_type":"multiple_choice","prompt":"Which distinctions does Genesis 7 preserve in the entry instructions?","options":["Clean animals, animals not clean, and birds","Only birds and fish","Wild animals only","No animal distinctions"],"correct_answer":"Clean animals, animals not clean, and birds","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 7:2-3, 8-9","explanation":"Genesis 7 distinguishes clean animals, animals not clean, and birds.","correct_action_id":"animals-enter","wrong_action_id":"animals-delayed","pool_id":"entry-animals-moderate","scene_id":"entry-animals","is_read_follow_up":true},
    {"id":"flood-entry-same-number","level_slug":"enter-the-ark","checkpoint_id":"entry-animals-question","question_order":4,"question_type":"true_false","prompt":"Genesis 7 gives no distinction at all between clean animals, animals not clean, and birds.","options":["True","False"],"correct_answer":"False","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 7:2-3, 8-9","explanation":"The passage explicitly preserves those distinctions and male-and-female detail.","correct_action_id":"animals-enter","wrong_action_id":"animals-delayed","pool_id":"entry-animals-moderate","scene_id":"entry-animals","is_read_follow_up":true},
    {"id":"flood-entry-who-shut","level_slug":"enter-the-ark","checkpoint_id":"entry-door-question","question_order":5,"question_type":"multiple_choice","prompt":"Who shut Noah in after the creatures entered?","options":["The Lord","Noah","Shem","Noah's wife"],"correct_answer":"The Lord","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 7:16","explanation":"Genesis 7:16 says the Lord shut him in.","correct_action_id":"ark-sealed","wrong_action_id":"door-reset","pool_id":"entry-door-hard","scene_id":"entry-door","is_read_follow_up":true},
    {"id":"flood-entry-door-sequence","level_slug":"enter-the-ark","checkpoint_id":"entry-door-question","question_order":6,"question_type":"multiple_choice","prompt":"Which sequence agrees with Genesis 7:15-16?","options":["The creatures entered, then the Lord shut Noah in","Noah shut the Ark before any creature entered","The rain ended, then the door was opened","Shem dismissed the animals"],"correct_answer":"The creatures entered, then the Lord shut Noah in","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 7:15-16","explanation":"Entry precedes the Lord's shutting action.","correct_action_id":"ark-sealed","wrong_action_id":"door-reset","pool_id":"entry-door-hard","scene_id":"entry-door","is_read_follow_up":true},

    {"id":"flood-seven-days-number","level_slug":"seven-days","checkpoint_id":"seven-wait-question","question_order":1,"question_type":"multiple_choice","prompt":"How many days were to pass before rain came upon the earth?","options":["Seven","Three","Twelve","Forty"],"correct_answer":"Seven","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 7:4, 10","explanation":"The stated waiting interval was seven days.","correct_action_id":"seven-days-pass","wrong_action_id":"wait-reset","pool_id":"seven-wait-easy","scene_id":"seven-wait","is_read_follow_up":false},
    {"id":"flood-seven-before-wait","level_slug":"seven-days","checkpoint_id":"seven-wait-question","question_order":2,"question_type":"true_false","prompt":"The waters arrived before the seven-day interval was complete.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 7:10","explanation":"After seven days, the waters came upon the earth.","correct_action_id":"seven-days-pass","wrong_action_id":"wait-reset","pool_id":"seven-wait-easy","scene_id":"seven-wait","is_read_follow_up":false},
    {"id":"flood-seven-what-followed","level_slug":"seven-days","checkpoint_id":"seven-rain-question","question_order":3,"question_type":"multiple_choice","prompt":"What followed the completed seven-day interval?","options":["The waters of the Flood came upon the earth","The Ark was dismantled","Noah left the Ark","The dove was released"],"correct_answer":"The waters of the Flood came upon the earth","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 7:10-12","explanation":"The Flood waters came after the seven-day interval.","correct_action_id":"rain-begins","wrong_action_id":"rain-withheld","pool_id":"seven-rain-moderate","scene_id":"seven-rain","is_read_follow_up":false},
    {"id":"flood-seven-after","level_slug":"seven-days","checkpoint_id":"seven-rain-question","question_order":4,"question_type":"true_false","prompt":"Genesis 7 places the coming of the Flood waters after seven days.","options":["True","False"],"correct_answer":"True","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 7:10","explanation":"That order is explicit in Genesis 7:10.","correct_action_id":"rain-begins","wrong_action_id":"rain-withheld","pool_id":"seven-rain-moderate","scene_id":"seven-rain","is_read_follow_up":false},

    {"id":"flood-forty-duration","level_slug":"forty-days","checkpoint_id":"forty-duration-question","question_order":1,"question_type":"multiple_choice","prompt":"How long did rain fall according to Genesis 7:12?","options":["Forty days and forty nights","Seven days only","One hundred days","Twelve months"],"correct_answer":"Forty days and forty nights","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 7:12","explanation":"Rain fell forty days and forty nights.","correct_action_id":"forty-days-pass","wrong_action_id":"duration-reset","pool_id":"forty-duration-easy","scene_id":"forty-duration","is_read_follow_up":false},
    {"id":"flood-forty-ten-days","level_slug":"forty-days","checkpoint_id":"forty-duration-question","question_order":2,"question_type":"true_false","prompt":"Genesis 7 says the rain lasted ten days and ten nights.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 7:12","explanation":"The duration was forty days and forty nights.","correct_action_id":"forty-days-pass","wrong_action_id":"duration-reset","pool_id":"forty-duration-easy","scene_id":"forty-duration","is_read_follow_up":false},
    {"id":"flood-fountains-windows","level_slug":"forty-days","checkpoint_id":"forty-fountains-question","question_order":3,"question_type":"multiple_choice","prompt":"Which pair is named when the Flood begins?","options":["Fountains of the great deep and windows of heaven","Rivers and wells only","Clouds and mountain springs only","Seas and irrigation canals"],"correct_answer":"Fountains of the great deep and windows of heaven","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 7:11","explanation":"Both the fountains of the great deep and windows of heaven are named.","correct_action_id":"waters-rise","wrong_action_id":"waters-reset","pool_id":"forty-fountains-hard","scene_id":"forty-fountains","is_read_follow_up":false},
    {"id":"flood-date-opening","level_slug":"forty-days","checkpoint_id":"forty-fountains-question","question_order":4,"question_type":"multiple_choice","prompt":"On which stated day were the deep's fountains broken up and heaven's windows opened?","options":["The seventeenth day of the second month in Noah's six hundredth year","The first day of the first month in Noah's fifth year","The tenth day of the seventh month","The twenty-seventh day of the second month in Noah's next year"],"correct_answer":"The seventeenth day of the second month in Noah's six hundredth year","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 7:11","explanation":"Genesis 7:11 supplies that date in Noah's six hundredth year.","correct_action_id":"waters-rise","wrong_action_id":"waters-reset","pool_id":"forty-fountains-hard","scene_id":"forty-fountains","is_read_follow_up":false},

    {"id":"flood-waters-lift-ark","level_slug":"waters-prevailed","checkpoint_id":"waters-lift-question","question_order":1,"question_type":"multiple_choice","prompt":"What did the increasing waters do to the Ark?","options":["They lifted it above the earth","They buried it in dry ground","They broke it apart","They left it unmoved on the field"],"correct_answer":"They lifted it above the earth","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 7:17-18","explanation":"The waters bore up the Ark, and it rose high above the earth.","correct_action_id":"ark-afloat","wrong_action_id":"ark-grounded","pool_id":"waters-lift-easy","scene_id":"waters-lift","is_read_follow_up":false},
    {"id":"flood-waters-ark-ground","level_slug":"waters-prevailed","checkpoint_id":"waters-lift-question","question_order":2,"question_type":"true_false","prompt":"The Ark remained fixed to dry ground while the waters increased.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 7:17-18","explanation":"The waters lifted the Ark, which moved upon the waters.","correct_action_id":"ark-afloat","wrong_action_id":"ark-grounded","pool_id":"waters-lift-easy","scene_id":"waters-lift","is_read_follow_up":false},
    {"id":"flood-prevail-mountains","level_slug":"waters-prevailed","checkpoint_id":"waters-prevail-question","question_order":3,"question_type":"multiple_choice","prompt":"What happened to the high mountains under the whole heaven?","options":["They were covered","They became the Ark's roof","They remained entirely dry","They were moved into the sea"],"correct_answer":"They were covered","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 7:19-20","explanation":"Genesis 7 describes the waters covering the high mountains.","correct_action_id":"high-water-settled","wrong_action_id":"high-water-reset","pool_id":"waters-prevail-hard","scene_id":"waters-prevail","is_read_follow_up":false},
    {"id":"flood-prevail-duration","level_slug":"waters-prevailed","checkpoint_id":"waters-prevail-question","question_order":4,"question_type":"multiple_choice","prompt":"How long did the waters prevail upon the earth?","options":["One hundred fifty days","Forty hours","Seven months exactly","Ten days"],"correct_answer":"One hundred fifty days","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 7:24","explanation":"The waters prevailed for one hundred fifty days.","correct_action_id":"high-water-settled","wrong_action_id":"high-water-reset","pool_id":"waters-prevail-hard","scene_id":"waters-prevail","is_read_follow_up":false},

    {"id":"flood-remembered-wind","level_slug":"god-remembered-noah","checkpoint_id":"remembered-wind-question","question_order":1,"question_type":"multiple_choice","prompt":"What did God make pass over the earth as the waters began to subside?","options":["A wind","A fire","A flock","A wall"],"correct_answer":"A wind","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:1","explanation":"God made a wind pass over the earth, and the waters subsided.","correct_action_id":"water-recedes","wrong_action_id":"recession-blocked","pool_id":"remembered-wind-moderate","scene_id":"remembered-wind","is_read_follow_up":true},
    {"id":"flood-remembered-restraint","level_slug":"god-remembered-noah","checkpoint_id":"remembered-wind-question","question_order":2,"question_type":"true_false","prompt":"Genesis 8 says the sources of the waters were restrained as the waters receded.","options":["True","False"],"correct_answer":"True","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:2-3","explanation":"The fountains and windows were closed, rain was restrained, and waters receded.","correct_action_id":"water-recedes","wrong_action_id":"recession-blocked","pool_id":"remembered-wind-moderate","scene_id":"remembered-wind","is_read_follow_up":true},
    {"id":"flood-rest-location","level_slug":"god-remembered-noah","checkpoint_id":"remembered-rest-question","question_order":3,"question_type":"multiple_choice","prompt":"Where did the Ark rest according to Genesis 8:4?","options":["On the mountains of Ararat","On Mount Sinai","In the Jordan valley","On the plain of Shinar"],"correct_answer":"On the mountains of Ararat","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:4","explanation":"The passage says the Ark rested on the mountains of Ararat.","correct_action_id":"ark-rested","wrong_action_id":"ark-rest-reset","pool_id":"remembered-rest-hard","scene_id":"remembered-rest","is_read_follow_up":true},
    {"id":"flood-rest-date","level_slug":"god-remembered-noah","checkpoint_id":"remembered-rest-question","question_order":4,"question_type":"true_false","prompt":"Genesis 8:4 places the Ark's resting on the seventeenth day of the seventh month.","options":["True","False"],"correct_answer":"True","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:4","explanation":"That is the date stated for the Ark's resting.","correct_action_id":"ark-rested","wrong_action_id":"ark-rest-reset","pool_id":"remembered-rest-hard","scene_id":"remembered-rest","is_read_follow_up":true},

    {"id":"flood-mountains-date","level_slug":"the-mountains-appear","checkpoint_id":"mountains-date-question","question_order":1,"question_type":"multiple_choice","prompt":"When did the tops of the mountains become visible?","options":["On the first day of the tenth month","On the first day of the first month","On the seventeenth day of the second month","Before the Ark rested"],"correct_answer":"On the first day of the tenth month","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:5","explanation":"The mountain tops appeared on the first day of the tenth month.","correct_action_id":"mountains-stage-ready","wrong_action_id":"mountains-stage-reset","pool_id":"mountains-date-hard","scene_id":"mountains-date","is_read_follow_up":false},
    {"id":"flood-mountains-order","level_slug":"the-mountains-appear","checkpoint_id":"mountains-date-question","question_order":2,"question_type":"multiple_choice","prompt":"Which event occurs first in Genesis 8:4-5?","options":["The Ark rests on the mountains of Ararat","The mountain tops become visible","Noah leaves the Ark","The dove returns with a leaf"],"correct_answer":"The Ark rests on the mountains of Ararat","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:4-5","explanation":"The Ark rests before the later date when mountain tops become visible.","correct_action_id":"mountains-stage-ready","wrong_action_id":"mountains-stage-reset","pool_id":"mountains-date-hard","scene_id":"mountains-date","is_read_follow_up":false},
    {"id":"flood-mountains-visible","level_slug":"the-mountains-appear","checkpoint_id":"mountains-visible-question","question_order":3,"question_type":"multiple_choice","prompt":"What became visible as the waters continued to decrease?","options":["The tops of the mountains","A new city","The altar","A tower"],"correct_answer":"The tops of the mountains","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:5","explanation":"The tops of the mountains became visible.","correct_action_id":"mountains-visible","wrong_action_id":"terrain-hidden","pool_id":"mountains-visible-easy","scene_id":"mountains-visible","is_read_follow_up":false},
    {"id":"flood-mountains-earth-dry","level_slug":"the-mountains-appear","checkpoint_id":"mountains-visible-question","question_order":4,"question_type":"true_false","prompt":"The appearance of mountain tops meant every part of the earth was already dry.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:5, 13-14","explanation":"Further recession and drying occur later in the chapter.","correct_action_id":"mountains-visible","wrong_action_id":"terrain-hidden","pool_id":"mountains-visible-easy","scene_id":"mountains-visible","is_read_follow_up":false},

    {"id":"flood-raven-first-bird","level_slug":"the-raven","checkpoint_id":"raven-release-question","question_order":1,"question_type":"multiple_choice","prompt":"Which bird did Noah send out first after opening the Ark window?","options":["A raven","A dove","An eagle","A sparrow"],"correct_answer":"A raven","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:6-7","explanation":"Noah first sent out a raven.","correct_action_id":"raven-released","wrong_action_id":"bird-reset","pool_id":"raven-release-easy","scene_id":"raven-release","is_read_follow_up":false},
    {"id":"flood-raven-dove-first","level_slug":"the-raven","checkpoint_id":"raven-release-question","question_order":2,"question_type":"true_false","prompt":"The dove was the first bird sent from the opened window.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:6-8","explanation":"The raven was sent before the dove.","correct_action_id":"raven-released","wrong_action_id":"bird-reset","pool_id":"raven-release-easy","scene_id":"raven-release","is_read_follow_up":false},
    {"id":"flood-raven-motion","level_slug":"the-raven","checkpoint_id":"raven-movement-question","question_order":3,"question_type":"multiple_choice","prompt":"How does Genesis 8:7 describe the raven's movement?","options":["It went to and fro","It returned with an olive leaf","It stayed in Noah's hand","It flew directly to a mountain and remained"],"correct_answer":"It went to and fro","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:7","explanation":"The raven went to and fro until the waters were dried up.","correct_action_id":"raven-circles","wrong_action_id":"bird-reset","pool_id":"raven-movement-moderate","scene_id":"raven-movement","is_read_follow_up":false},
    {"id":"flood-raven-olive","level_slug":"the-raven","checkpoint_id":"raven-movement-question","question_order":4,"question_type":"true_false","prompt":"The raven returned to Noah carrying a freshly plucked olive leaf.","options":["True","False"],"correct_answer":"False","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:7, 11","explanation":"The olive leaf belongs to the later dove sequence.","correct_action_id":"raven-circles","wrong_action_id":"bird-reset","pool_id":"raven-movement-moderate","scene_id":"raven-movement","is_read_follow_up":false},

    {"id":"flood-dove-purpose","level_slug":"the-dove","checkpoint_id":"dove-first-question","question_order":1,"question_type":"multiple_choice","prompt":"Why did Noah send out the dove?","options":["To see whether the waters had subsided from the ground","To lead the animal groups","To find another Ark","To carry food away"],"correct_answer":"To see whether the waters had subsided from the ground","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:8","explanation":"Genesis 8:8 states this purpose.","correct_action_id":"dove-released","wrong_action_id":"dove-reset","pool_id":"dove-first-easy","scene_id":"dove-first","is_read_follow_up":false},
    {"id":"flood-dove-no-rest","level_slug":"the-dove","checkpoint_id":"dove-first-question","question_order":2,"question_type":"true_false","prompt":"The dove returned because it found no resting place for its foot.","options":["True","False"],"correct_answer":"True","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:9","explanation":"The waters still covered the face of the whole earth.","correct_action_id":"dove-released","wrong_action_id":"dove-reset","pool_id":"dove-first-easy","scene_id":"dove-first","is_read_follow_up":false},
    {"id":"flood-dove-received","level_slug":"the-dove","checkpoint_id":"dove-return-question","question_order":3,"question_type":"multiple_choice","prompt":"What did Noah do when the first dove returned?","options":["He reached out, took it, and brought it into the Ark","He sent it away immediately","He placed it on the altar","He ignored it"],"correct_answer":"He reached out, took it, and brought it into the Ark","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:9","explanation":"Noah received the returned dove into the Ark.","correct_action_id":"dove-returned","wrong_action_id":"dove-reset","pool_id":"dove-return-moderate","scene_id":"dove-return","is_read_follow_up":false},
    {"id":"flood-dove-nest","level_slug":"the-dove","checkpoint_id":"dove-return-question","question_order":4,"question_type":"true_false","prompt":"The first dove found a permanent nest and did not return.","options":["True","False"],"correct_answer":"False","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:9","explanation":"It found no resting place and returned to Noah.","correct_action_id":"dove-returned","wrong_action_id":"dove-reset","pool_id":"dove-return-moderate","scene_id":"dove-return","is_read_follow_up":false},

    {"id":"flood-olive-wait-seven","level_slug":"an-olive-leaf","checkpoint_id":"olive-wait-question","question_order":1,"question_type":"multiple_choice","prompt":"How long did Noah wait before sending the dove a second time?","options":["Seven more days","One day","Forty days","One hundred fifty days"],"correct_answer":"Seven more days","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:10","explanation":"Noah waited another seven days.","correct_action_id":"second-dove-release","wrong_action_id":"wait-reset","pool_id":"olive-wait-moderate","scene_id":"olive-wait","is_read_follow_up":false},
    {"id":"flood-olive-immediate","level_slug":"an-olive-leaf","checkpoint_id":"olive-wait-question","question_order":2,"question_type":"true_false","prompt":"Noah sent the dove a second time immediately on the same day.","options":["True","False"],"correct_answer":"False","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:10","explanation":"A seven-day wait came before the second release.","correct_action_id":"second-dove-release","wrong_action_id":"wait-reset","pool_id":"olive-wait-moderate","scene_id":"olive-wait","is_read_follow_up":false},
    {"id":"flood-olive-object","level_slug":"an-olive-leaf","checkpoint_id":"olive-leaf-question","question_order":3,"question_type":"multiple_choice","prompt":"What did the dove bring back in its beak?","options":["A freshly plucked olive leaf","A grain of wheat","A stone","A piece of the Ark"],"correct_answer":"A freshly plucked olive leaf","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:11","explanation":"The dove returned with a freshly plucked olive leaf.","correct_action_id":"olive-leaf-received","wrong_action_id":"leaf-hidden","pool_id":"olive-leaf-easy","scene_id":"olive-leaf","is_read_follow_up":false},
    {"id":"flood-olive-evening","level_slug":"an-olive-leaf","checkpoint_id":"olive-leaf-question","question_order":4,"question_type":"true_false","prompt":"The dove returned to Noah in the evening with the olive leaf.","options":["True","False"],"correct_answer":"True","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:11","explanation":"Genesis 8:11 places the return in the evening.","correct_action_id":"olive-leaf-received","wrong_action_id":"leaf-hidden","pool_id":"olive-leaf-easy","scene_id":"olive-leaf","is_read_follow_up":false},
    {"id":"flood-third-release-order","level_slug":"an-olive-leaf","checkpoint_id":"olive-third-question","question_order":5,"question_type":"multiple_choice","prompt":"Which sequence precedes the third dove release?","options":["Another seven-day wait after the olive-leaf return","No wait after the first raven","Noah first leaves the Ark","The altar is built"],"correct_answer":"Another seven-day wait after the olive-leaf return","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:11-12","explanation":"Noah waited another seven days before the third release.","correct_action_id":"third-dove-release","wrong_action_id":"third-release-blocked","pool_id":"olive-third-hard","scene_id":"olive-third","is_read_follow_up":false},
    {"id":"flood-third-release-result","level_slug":"an-olive-leaf","checkpoint_id":"olive-third-question","question_order":6,"question_type":"multiple_choice","prompt":"What happened after Noah sent the dove the third time?","options":["It did not return to him again","It returned with a second leaf","It returned immediately with the raven","It remained in Noah's hand"],"correct_answer":"It did not return to him again","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:12","explanation":"The dove did not return after the third release.","correct_action_id":"third-dove-release","wrong_action_id":"third-release-blocked","pool_id":"olive-third-hard","scene_id":"olive-third","is_read_follow_up":false},

    {"id":"flood-dry-covering","level_slug":"dry-ground","checkpoint_id":"dry-uncover-question","question_order":1,"question_type":"multiple_choice","prompt":"What did Noah remove before looking at the ground?","options":["The covering of the Ark","The altar stones","The rainbow","The mountain tops"],"correct_answer":"The covering of the Ark","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:13","explanation":"Noah removed the Ark's covering and looked.","correct_action_id":"ark-opened","wrong_action_id":"covering-reset","pool_id":"dry-uncover-moderate","scene_id":"dry-uncover","is_read_follow_up":false},
    {"id":"flood-dry-face","level_slug":"dry-ground","checkpoint_id":"dry-uncover-question","question_order":2,"question_type":"true_false","prompt":"After removing the covering, Noah saw that the face of the ground was dry or drying.","options":["True","False"],"correct_answer":"True","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:13","explanation":"This is the observation recorded in Genesis 8:13.","correct_action_id":"ark-opened","wrong_action_id":"covering-reset","pool_id":"dry-uncover-moderate","scene_id":"dry-uncover","is_read_follow_up":false},
    {"id":"flood-dry-final-date","level_slug":"dry-ground","checkpoint_id":"dry-complete-question","question_order":3,"question_type":"multiple_choice","prompt":"On which stated date was the earth dry in Genesis 8:14?","options":["The twenty-seventh day of the second month","The first day of the tenth month","The seventeenth day of the seventh month","The first day of the first month"],"correct_answer":"The twenty-seventh day of the second month","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:14","explanation":"Genesis 8:14 states the twenty-seventh day of the second month.","correct_action_id":"dry-ground-settled","wrong_action_id":"dry-ground-reset","pool_id":"dry-complete-hard","scene_id":"dry-complete","is_read_follow_up":false},
    {"id":"flood-dry-left-early","level_slug":"dry-ground","checkpoint_id":"dry-complete-question","question_order":4,"question_type":"true_false","prompt":"Noah left the Ark immediately when he first saw the drying ground, before God spoke.","options":["True","False"],"correct_answer":"False","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:13-16","explanation":"Noah waited for God's command to come out.","correct_action_id":"dry-ground-settled","wrong_action_id":"dry-ground-reset","pool_id":"dry-complete-hard","scene_id":"dry-complete","is_read_follow_up":false},

    {"id":"flood-exit-authority","level_slug":"come-out","checkpoint_id":"exit-command-question","question_order":1,"question_type":"multiple_choice","prompt":"Who told Noah to come out of the Ark?","options":["God","The raven","Shem","An unnamed messenger"],"correct_answer":"God","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:15-17","explanation":"God spoke to Noah and commanded the exit.","correct_action_id":"ark-exit-authorized","wrong_action_id":"exit-blocked","pool_id":"exit-command-easy","scene_id":"exit-command","is_read_follow_up":false},
    {"id":"flood-exit-self-authorized","level_slug":"come-out","checkpoint_id":"exit-command-question","question_order":2,"question_type":"true_false","prompt":"Noah authorized his own exit without waiting for a command.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:15-18","explanation":"The command from God precedes Noah's departure.","correct_action_id":"ark-exit-authorized","wrong_action_id":"exit-blocked","pool_id":"exit-command-easy","scene_id":"exit-command","is_read_follow_up":false},
    {"id":"flood-exit-groups","level_slug":"come-out","checkpoint_id":"exit-groups-question","question_order":3,"question_type":"multiple_choice","prompt":"Who and what came out of the Ark?","options":["Noah's household and the living creatures by their groups","Only Noah","Only the birds","Only clean animals"],"correct_answer":"Noah's household and the living creatures by their groups","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:18-19","explanation":"The household and creature groups came out.","correct_action_id":"procession-exits","wrong_action_id":"procession-reset","pool_id":"exit-groups-moderate","scene_id":"exit-groups","is_read_follow_up":false},
    {"id":"flood-exit-creatures","level_slug":"come-out","checkpoint_id":"exit-groups-question","question_order":4,"question_type":"true_false","prompt":"Genesis 8 records that the creature groups came out according to their families or kinds.","options":["True","False"],"correct_answer":"True","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 8:19","explanation":"The passage preserves grouped creature departure.","correct_action_id":"procession-exits","wrong_action_id":"procession-reset","pool_id":"exit-groups-moderate","scene_id":"exit-groups","is_read_follow_up":false},

    {"id":"flood-altar-built","level_slug":"an-altar","checkpoint_id":"altar-build-question","question_order":1,"question_type":"multiple_choice","prompt":"What did Noah build after leaving the Ark?","options":["An altar to the Lord","A tower","A second Ark","A city wall"],"correct_answer":"An altar to the Lord","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:20","explanation":"Noah built an altar to the Lord.","correct_action_id":"altar-built","wrong_action_id":"altar-reset","pool_id":"altar-build-easy","scene_id":"altar-build","is_read_follow_up":true},
    {"id":"flood-altar-clean","level_slug":"an-altar","checkpoint_id":"altar-build-question","question_order":2,"question_type":"true_false","prompt":"Genesis 8:20 connects Noah's offering with every clean animal and every clean bird.","options":["True","False"],"correct_answer":"True","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 8:20","explanation":"That clean-animal and clean-bird detail is explicit.","correct_action_id":"altar-built","wrong_action_id":"altar-reset","pool_id":"altar-build-easy","scene_id":"altar-build","is_read_follow_up":true},
    {"id":"flood-declaration-pairs","level_slug":"an-altar","checkpoint_id":"altar-declaration-question","question_order":3,"question_type":"multiple_choice","prompt":"Which pair appears in the post-Flood declaration?","options":["Seedtime and harvest","Brick and mortar","Silver and gold","War and conquest"],"correct_answer":"Seedtime and harvest","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:22","explanation":"Seedtime and harvest are among the continuing rhythms named.","correct_action_id":"altar-offering-settled","wrong_action_id":"declaration-reset","pool_id":"altar-declaration-hard","scene_id":"altar-declaration","is_read_follow_up":true},
    {"id":"flood-declaration-cease","level_slug":"an-altar","checkpoint_id":"altar-declaration-question","question_order":4,"question_type":"true_false","prompt":"Genesis 8:22 says day and night shall cease while the earth remains.","options":["True","False"],"correct_answer":"False","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 8:22","explanation":"The verse says these rhythms shall not cease while the earth remains.","correct_action_id":"altar-offering-settled","wrong_action_id":"declaration-reset","pool_id":"altar-declaration-hard","scene_id":"altar-declaration","is_read_follow_up":true},

    {"id":"flood-covenant-parties","level_slug":"my-covenant","checkpoint_id":"covenant-parties-question","question_order":1,"question_type":"multiple_choice","prompt":"With whom does Genesis 9 describe the covenant being established?","options":["Noah, his descendants, and every living creature","Noah alone","Only Noah's sons","Only the birds"],"correct_answer":"Noah, his descendants, and every living creature","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 9:8-10","explanation":"The covenant explicitly includes descendants and living creatures.","correct_action_id":"covenant-parties-settled","wrong_action_id":"covenant-reset","pool_id":"covenant-parties-moderate","scene_id":"covenant-parties","is_read_follow_up":true},
    {"id":"flood-covenant-noah-only","level_slug":"my-covenant","checkpoint_id":"covenant-parties-question","question_order":2,"question_type":"true_false","prompt":"The covenant in Genesis 9 applies only to Noah personally.","options":["True","False"],"correct_answer":"False","difficulty":"moderate","timer_seconds":7,"scripture_reference":"Genesis 9:8-10","explanation":"It extends to descendants and every living creature.","correct_action_id":"covenant-parties-settled","wrong_action_id":"covenant-reset","pool_id":"covenant-parties-moderate","scene_id":"covenant-parties","is_read_follow_up":true},
    {"id":"flood-covenant-promise","level_slug":"my-covenant","checkpoint_id":"covenant-promise-question","question_order":3,"question_type":"multiple_choice","prompt":"What Flood promise is stated in the covenant?","options":["Never again will a Flood destroy all flesh and the earth in that way","Rain will never fall again","No river will ever overflow","No storm will ever occur"],"correct_answer":"Never again will a Flood destroy all flesh and the earth in that way","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 9:11, 15","explanation":"The promise concerns another all-destroying Flood, not the end of all rain or storms.","correct_action_id":"covenant-promise-settled","wrong_action_id":"covenant-reset","pool_id":"covenant-promise-hard","scene_id":"covenant-promise","is_read_follow_up":true},
    {"id":"flood-covenant-scope","level_slug":"my-covenant","checkpoint_id":"covenant-promise-question","question_order":4,"question_type":"multiple_choice","prompt":"Which scope matches the remembered covenant in Genesis 9:15?","options":["God, humanity, and every living creature of all flesh","Noah's immediate household only","A single mountain","Only clean birds"],"correct_answer":"God, humanity, and every living creature of all flesh","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 9:15-16","explanation":"The covenant scope includes every living creature of all flesh.","correct_action_id":"covenant-promise-settled","wrong_action_id":"covenant-reset","pool_id":"covenant-promise-hard","scene_id":"covenant-promise","is_read_follow_up":true},

    {"id":"flood-bow-sign","level_slug":"the-bow-in-the-cloud","checkpoint_id":"bow-sign-question","question_order":1,"question_type":"multiple_choice","prompt":"What sign did God set for the covenant?","options":["The bow in the cloud","The Ark door","The altar stones","The raven"],"correct_answer":"The bow in the cloud","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 9:12-13","explanation":"God set the bow in the cloud as the covenant sign.","correct_action_id":"bow-prepared","wrong_action_id":"bow-hidden","pool_id":"bow-sign-easy","scene_id":"bow-sign","is_read_follow_up":false},
    {"id":"flood-bow-altar-sign","level_slug":"the-bow-in-the-cloud","checkpoint_id":"bow-sign-question","question_order":2,"question_type":"true_false","prompt":"The altar, rather than the bow in the cloud, is named as the sign of the Genesis 9 covenant.","options":["True","False"],"correct_answer":"False","difficulty":"easy","timer_seconds":5,"scripture_reference":"Genesis 9:12-13","explanation":"The bow in the cloud is the stated sign.","correct_action_id":"bow-prepared","wrong_action_id":"bow-hidden","pool_id":"bow-sign-easy","scene_id":"bow-sign","is_read_follow_up":false},
    {"id":"flood-bow-remembrance","level_slug":"the-bow-in-the-cloud","checkpoint_id":"bow-cloud-question","question_order":3,"question_type":"multiple_choice","prompt":"What does Genesis 9 connect with the bow being seen in the cloud?","options":["Remembering the everlasting covenant","Beginning another Flood","Opening the Ark again","Building a tower"],"correct_answer":"Remembering the everlasting covenant","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 9:14-16","explanation":"The visible bow is connected with remembering the everlasting covenant.","correct_action_id":"rainbow-revealed","wrong_action_id":"rainbow-withheld","pool_id":"bow-cloud-hard","scene_id":"bow-cloud","is_read_follow_up":false},
    {"id":"flood-bow-before-covenant","level_slug":"the-bow-in-the-cloud","checkpoint_id":"bow-cloud-question","question_order":4,"question_type":"true_false","prompt":"In this sequence, the rainbow may authoritatively appear before the covenant promise is established.","options":["True","False"],"correct_answer":"False","difficulty":"hard","timer_seconds":10,"scripture_reference":"Genesis 9:8-17","explanation":"The sign follows the covenant statement in the canonical sequence.","correct_action_id":"rainbow-revealed","wrong_action_id":"rainbow-withheld","pool_id":"bow-cloud-hard","scene_id":"bow-cloud","is_read_follow_up":false}
  ]
  $flood_questions$::jsonb) AS question(
    id text,
    level_slug text,
    checkpoint_id text,
    question_order integer,
    question_type text,
    prompt text,
    options jsonb,
    correct_answer text,
    difficulty text,
    timer_seconds integer,
    scripture_reference text,
    explanation text,
    correct_action_id text,
    wrong_action_id text,
    pool_id text,
    scene_id text,
    is_read_follow_up boolean
  )
)
INSERT INTO public.story_mode_questions (
  id, level_slug, checkpoint_id, question_order, question_type, prompt, options,
  correct_answer, difficulty, timer_seconds, scripture_reference, explanation,
  correct_action_id, wrong_action_id, pool_id, scene_id, is_read_follow_up
)
SELECT
  id, level_slug, checkpoint_id, question_order, question_type, prompt, options,
  correct_answer, difficulty, timer_seconds, scripture_reference, explanation,
  correct_action_id, wrong_action_id, pool_id, scene_id, is_read_follow_up
FROM question_seed
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

INSERT INTO public.story_mode_environment_sequences (id, label, total_stages)
VALUES ('noah-flood-environment', 'Noah Flood environment', 17)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  total_stages = EXCLUDED.total_stages;

INSERT INTO public.story_mode_environment_stages (
  sequence_id, stage_order, stage_slug, weather, weather_intensity,
  water_stage, water_trend, terrain_state, traversal_mode, ark_state,
  bird_kind, bird_state, olive_leaf_visible, altar_visible, rainbow_visible,
  completion_label, trigger_level_slug, trigger_pool_id, checkpoint_id
)
VALUES
  ('noah-flood-environment', 1, 'ark-sealed', 'clouding', 1, 0, 'none', 'dry', 'ark_interior', 'sealed', 'none', 'none', false, false, false,
   'The household and creatures are within the sealed Ark.', 'enter-the-ark', 'entry-door-hard', 'entry-door-question'),
  ('noah-flood-environment', 2, 'rain-begins', 'rain', 2, 1, 'rising', 'wet', 'ark_interior', 'sealed', 'none', 'none', false, false, false,
   'The seven days pass and rain begins.', 'seven-days', 'seven-rain-moderate', 'seven-rain-question'),
  ('noah-flood-environment', 3, 'forty-days', 'storm', 4, 3, 'rising', 'covered', 'ark_interior', 'sealed', 'none', 'none', false, false, false,
   'Forty days and forty nights are underway.', 'forty-days', 'forty-duration-easy', 'forty-duration-question'),
  ('noah-flood-environment', 4, 'ark-afloat', 'heavy_rain', 4, 6, 'rising', 'submerged', 'ark_floating', 'floating', 'none', 'none', false, false, false,
   'The waters lift the Ark above the earth.', 'forty-days', 'forty-fountains-hard', 'forty-fountains-question'),
  ('noah-flood-environment', 5, 'high-water', 'storm', 3, 7, 'stable', 'submerged', 'ark_floating', 'floating', 'none', 'none', false, false, false,
   'The waters prevail at the canonical high-water stage.', 'waters-prevailed', 'waters-prevail-hard', 'waters-prevail-question'),
  ('noah-flood-environment', 6, 'waters-receding', 'wind', 2, 6, 'falling', 'submerged', 'ark_floating', 'floating', 'none', 'none', false, false, false,
   'Wind passes and the waters begin to recede.', 'god-remembered-noah', 'remembered-wind-moderate', 'remembered-wind-question'),
  ('noah-flood-environment', 7, 'ark-resting', 'wind', 1, 5, 'falling', 'emerging', 'ark_resting', 'resting', 'none', 'none', false, false, false,
   'The Ark rests on the mountains of Ararat.', 'god-remembered-noah', 'remembered-rest-hard', 'remembered-rest-question'),
  ('noah-flood-environment', 8, 'mountains-visible', 'clear', 0, 4, 'falling', 'emerging', 'ark_resting', 'resting', 'none', 'none', false, false, false,
   'The tops of the mountains become visible.', 'the-mountains-appear', 'mountains-visible-easy', 'mountains-visible-question'),
  ('noah-flood-environment', 9, 'raven-released', 'still', 0, 3, 'falling', 'emerging', 'ark_resting', 'resting', 'raven', 'flying', false, false, false,
   'The raven goes to and fro.', 'the-raven', 'raven-movement-moderate', 'raven-movement-question'),
  ('noah-flood-environment', 10, 'first-dove-returned', 'still', 0, 3, 'falling', 'emerging', 'ark_resting', 'resting', 'dove', 'returned', false, false, false,
   'The first dove returns and Noah receives it.', 'the-dove', 'dove-return-moderate', 'dove-return-question'),
  ('noah-flood-environment', 11, 'olive-leaf-returned', 'clear', 0, 2, 'falling', 'emerging', 'ark_resting', 'resting', 'dove', 'carrying', true, false, false,
   'The dove returns with a freshly plucked olive leaf.', 'an-olive-leaf', 'olive-leaf-easy', 'olive-leaf-question'),
  ('noah-flood-environment', 12, 'third-dove-no-return', 'clear', 0, 1, 'falling', 'muddy', 'ark_resting', 'resting', 'dove', 'no_return', false, false, false,
   'After the final wait, the dove does not return.', 'an-olive-leaf', 'olive-third-hard', 'olive-third-question'),
  ('noah-flood-environment', 13, 'dry-ground', 'clear', 0, 0, 'falling', 'muddy', 'ark_resting', 'opened', 'none', 'none', false, false, false,
   'The earth is dry, but exit still awaits the command.', 'dry-ground', 'dry-complete-hard', 'dry-complete-question'),
  ('noah-flood-environment', 14, 'ark-exited', 'clear', 0, 0, 'none', 'dry', 'dry_land', 'opened', 'none', 'none', false, false, false,
   'The household and creature groups leave the Ark.', 'come-out', 'exit-groups-moderate', 'exit-groups-question'),
  ('noah-flood-environment', 15, 'altar-offered', 'still', 0, 0, 'none', 'dry', 'dry_land', 'opened', 'none', 'none', false, true, false,
   'Noah builds the altar and the post-Flood declaration follows.', 'an-altar', 'altar-declaration-hard', 'altar-declaration-question'),
  ('noah-flood-environment', 16, 'covenant-established', 'clear', 0, 0, 'none', 'dry', 'dry_land', 'opened', 'none', 'none', false, true, false,
   'The covenant is established with descendants and living creatures.', 'my-covenant', 'covenant-promise-hard', 'covenant-promise-question'),
  ('noah-flood-environment', 17, 'rainbow-revealed', 'clear', 0, 0, 'none', 'dry', 'dry_land', 'opened', 'none', 'none', false, true, true,
   'The bow appears in the cloud and Book I can complete.', 'the-bow-in-the-cloud', 'bow-cloud-hard', 'bow-cloud-question')
ON CONFLICT (sequence_id, stage_order) DO UPDATE SET
  stage_slug = EXCLUDED.stage_slug,
  weather = EXCLUDED.weather,
  weather_intensity = EXCLUDED.weather_intensity,
  water_stage = EXCLUDED.water_stage,
  water_trend = EXCLUDED.water_trend,
  terrain_state = EXCLUDED.terrain_state,
  traversal_mode = EXCLUDED.traversal_mode,
  ark_state = EXCLUDED.ark_state,
  bird_kind = EXCLUDED.bird_kind,
  bird_state = EXCLUDED.bird_state,
  olive_leaf_visible = EXCLUDED.olive_leaf_visible,
  altar_visible = EXCLUDED.altar_visible,
  rainbow_visible = EXCLUDED.rainbow_visible,
  completion_label = EXCLUDED.completion_label,
  trigger_level_slug = EXCLUDED.trigger_level_slug,
  trigger_pool_id = EXCLUDED.trigger_pool_id,
  checkpoint_id = EXCLUDED.checkpoint_id;

INSERT INTO public.story_mode_level_environment_context (
  level_slug, sequence_id, starting_stage_order, ending_stage_order
)
VALUES
  ('enter-the-ark', 'noah-flood-environment', 0, 1),
  ('seven-days', 'noah-flood-environment', 1, 2),
  ('forty-days', 'noah-flood-environment', 2, 4),
  ('waters-prevailed', 'noah-flood-environment', 4, 5),
  ('god-remembered-noah', 'noah-flood-environment', 5, 7),
  ('the-mountains-appear', 'noah-flood-environment', 7, 8),
  ('the-raven', 'noah-flood-environment', 8, 9),
  ('the-dove', 'noah-flood-environment', 9, 10),
  ('an-olive-leaf', 'noah-flood-environment', 10, 12),
  ('dry-ground', 'noah-flood-environment', 12, 13),
  ('come-out', 'noah-flood-environment', 13, 14),
  ('an-altar', 'noah-flood-environment', 14, 15),
  ('my-covenant', 'noah-flood-environment', 15, 16),
  ('the-bow-in-the-cloud', 'noah-flood-environment', 16, 17)
ON CONFLICT (level_slug) DO UPDATE SET
  sequence_id = EXCLUDED.sequence_id,
  starting_stage_order = EXCLUDED.starting_stage_order,
  ending_stage_order = EXCLUDED.ending_stage_order;

/* Every Flood scene reuses the already-completed authoritative Ark. */
INSERT INTO public.story_mode_level_build_context (
  level_slug, build_id, starting_stage_order, ending_stage_order
)
SELECT level_slug, 'noah-ark', 9, 9
FROM public.story_mode_level_environment_context
ON CONFLICT (level_slug) DO UPDATE SET
  build_id = EXCLUDED.build_id,
  starting_stage_order = EXCLUDED.starting_stage_order,
  ending_stage_order = EXCLUDED.ending_stage_order;

CREATE OR REPLACE FUNCTION public.story_mode_environment_state_payload(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN progress.attempt_id IS NULL THEN NULL ELSE jsonb_build_object(
    'sequence_id', progress.sequence_id,
    'label', sequence.label,
    'stage_order', progress.stage_order,
    'stage_slug', progress.stage_slug,
    'total_stages', sequence.total_stages,
    'completed', progress.stage_order >= sequence.total_stages,
    'weather', coalesce(stage.weather, 'clouding'),
    'weather_intensity', coalesce(stage.weather_intensity, 1),
    'water_stage', coalesce(stage.water_stage, 0),
    'water_trend', coalesce(stage.water_trend, 'none'),
    'terrain_state', coalesce(stage.terrain_state, 'dry'),
    'traversal_mode', coalesce(stage.traversal_mode, 'ark_approach'),
    'ark_state', coalesce(stage.ark_state, 'prepared'),
    'bird_kind', coalesce(stage.bird_kind, 'none'),
    'bird_state', coalesce(stage.bird_state, 'none'),
    'olive_leaf_visible', coalesce(stage.olive_leaf_visible, false),
    'altar_visible', coalesce(stage.altar_visible, false),
    'rainbow_visible', coalesce(stage.rainbow_visible, false),
    'checkpoint_id', progress.checkpoint_id
  ) END
  FROM public.story_mode_attempt_environment_progress progress
  JOIN public.story_mode_environment_sequences sequence ON sequence.id = progress.sequence_id
  LEFT JOIN public.story_mode_environment_stages stage
    ON stage.sequence_id = progress.sequence_id
   AND stage.stage_order = progress.stage_order
  WHERE progress.attempt_id = p_attempt_id;
$$;

CREATE OR REPLACE FUNCTION public.get_my_story_mode_environment_state(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_payload jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.story_mode_attempts attempt
    WHERE attempt.id = p_attempt_id
      AND attempt.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'This Story Mode environment is not available for your account.';
  END IF;

  SELECT public.story_mode_environment_state_payload(p_attempt_id) INTO v_payload;
  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.story_mode_initialize_environment_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context public.story_mode_level_environment_context%ROWTYPE;
  v_user_progress public.story_mode_user_environment_progress%ROWTYPE;
  v_stage_slug text := 'prepared-ark';
  v_checkpoint_id text := 'ark-stands-complete';
BEGIN
  SELECT * INTO v_context
  FROM public.story_mode_level_environment_context
  WHERE level_slug = NEW.level_slug;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_context.starting_stage_order > 0 THEN
    SELECT stage.stage_slug, stage.checkpoint_id
    INTO v_stage_slug, v_checkpoint_id
    FROM public.story_mode_environment_stages stage
    WHERE stage.sequence_id = v_context.sequence_id
      AND stage.stage_order = v_context.starting_stage_order;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The authoritative Story Mode environment start stage is missing.';
    END IF;
  END IF;

  IF NOT NEW.is_replay THEN
    INSERT INTO public.story_mode_user_environment_progress (
      user_id, sequence_id, stage_order, stage_slug, checkpoint_id
    ) VALUES (
      NEW.user_id, v_context.sequence_id, v_context.starting_stage_order, v_stage_slug, v_checkpoint_id
    )
    ON CONFLICT (user_id, sequence_id) DO NOTHING;

    SELECT * INTO v_user_progress
    FROM public.story_mode_user_environment_progress
    WHERE user_id = NEW.user_id
      AND sequence_id = v_context.sequence_id
    FOR UPDATE;

    IF NOT FOUND OR v_user_progress.stage_order <> v_context.starting_stage_order THEN
      RAISE EXCEPTION 'The authoritative Story Mode environment is not ready for this level.';
    END IF;
  END IF;

  INSERT INTO public.story_mode_attempt_environment_progress (
    attempt_id, sequence_id, stage_order, stage_slug, checkpoint_id
  ) VALUES (
    NEW.id, v_context.sequence_id, v_context.starting_stage_order, v_stage_slug, v_checkpoint_id
  )
  ON CONFLICT (attempt_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_mode_initialize_environment_attempt_trigger ON public.story_mode_attempts;
CREATE TRIGGER story_mode_initialize_environment_attempt_trigger
AFTER INSERT ON public.story_mode_attempts
FOR EACH ROW
EXECUTE FUNCTION public.story_mode_initialize_environment_attempt();

CREATE OR REPLACE FUNCTION public.story_mode_advance_environment_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.story_mode_attempts%ROWTYPE;
  v_stage public.story_mode_environment_stages%ROWTYPE;
  v_progress public.story_mode_attempt_environment_progress%ROWTYPE;
  v_total_stages integer;
  v_updated_rows integer;
BEGIN
  IF OLD.answered_correct OR NOT NEW.answered_correct THEN RETURN NEW; END IF;

  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = NEW.attempt_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_stage
  FROM public.story_mode_environment_stages stage
  WHERE stage.trigger_level_slug = v_attempt.level_slug
    AND stage.trigger_pool_id = NEW.pool_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_progress
  FROM public.story_mode_attempt_environment_progress
  WHERE attempt_id = v_attempt.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The authoritative Story Mode environment state is missing.';
  END IF;
  IF v_stage.sequence_id IS DISTINCT FROM v_progress.sequence_id
     OR v_stage.stage_order <> v_progress.stage_order + 1 THEN
    RAISE EXCEPTION 'Story Mode environment stages cannot be skipped or duplicated.';
  END IF;

  UPDATE public.story_mode_attempt_environment_progress
  SET stage_order = v_stage.stage_order,
      stage_slug = v_stage.stage_slug,
      checkpoint_id = v_stage.checkpoint_id,
      updated_at = now()
  WHERE attempt_id = v_attempt.id
    AND sequence_id = v_progress.sequence_id
    AND stage_order = v_progress.stage_order;
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'The Story Mode environment changed concurrently.';
  END IF;

  IF NOT v_attempt.is_replay THEN
    SELECT total_stages INTO v_total_stages
    FROM public.story_mode_environment_sequences
    WHERE id = v_stage.sequence_id;

    UPDATE public.story_mode_user_environment_progress
    SET stage_order = v_stage.stage_order,
        stage_slug = v_stage.stage_slug,
        checkpoint_id = v_stage.checkpoint_id,
        completed_at = CASE
          WHEN v_stage.stage_order >= v_total_stages THEN coalesce(completed_at, now())
          ELSE completed_at
        END,
        updated_at = now()
    WHERE user_id = v_attempt.user_id
      AND sequence_id = v_stage.sequence_id
      AND stage_order = v_progress.stage_order;
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
      RAISE EXCEPTION 'The main Story Mode environment did not advance atomically.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_mode_advance_environment_stage_trigger ON public.story_mode_attempt_questions;
CREATE TRIGGER story_mode_advance_environment_stage_trigger
AFTER UPDATE OF answered_correct ON public.story_mode_attempt_questions
FOR EACH ROW
WHEN (OLD.answered_correct IS FALSE AND NEW.answered_correct IS TRUE)
EXECUTE FUNCTION public.story_mode_advance_environment_stage();

CREATE OR REPLACE FUNCTION public.story_mode_guard_environment_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context public.story_mode_level_environment_context%ROWTYPE;
  v_stage_order integer;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT * INTO v_context
  FROM public.story_mode_level_environment_context
  WHERE level_slug = NEW.level_slug;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT stage_order INTO v_stage_order
  FROM public.story_mode_attempt_environment_progress
  WHERE attempt_id = NEW.id
  FOR UPDATE;

  IF v_stage_order IS NULL OR v_stage_order < v_context.ending_stage_order THEN
    RAISE EXCEPTION 'Every mandatory Story Mode environment milestone must be settled before level completion.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_mode_guard_environment_completion_trigger ON public.story_mode_attempts;
CREATE TRIGGER story_mode_guard_environment_completion_trigger
BEFORE UPDATE OF status ON public.story_mode_attempts
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.story_mode_guard_environment_completion();

CREATE OR REPLACE FUNCTION public.story_mode_settle_book_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level public.story_mode_levels%ROWTYPE;
  v_required_chapter_levels integer;
  v_completed_chapter_levels integer;
  v_required_book_levels integer;
  v_completed_book_levels integer;
  v_chapters_completed integer;
  v_questions integer;
  v_correct integer;
  v_figs integer;
  v_denarii integer;
BEGIN
  SELECT * INTO v_level
  FROM public.story_mode_levels
  WHERE slug = NEW.level_slug
    AND is_published = true;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_required_chapter_levels
  FROM public.story_mode_levels level
  WHERE level.book_slug = v_level.book_slug
    AND level.chapter_slug = v_level.chapter_slug
    AND level.is_published = true;

  SELECT count(*) INTO v_completed_chapter_levels
  FROM public.story_mode_level_completions completion
  JOIN public.story_mode_levels level ON level.slug = completion.level_slug
  WHERE completion.user_id = NEW.user_id
    AND level.book_slug = v_level.book_slug
    AND level.chapter_slug = v_level.chapter_slug
    AND level.is_published = true;

  IF v_required_chapter_levels > 0 AND v_completed_chapter_levels = v_required_chapter_levels THEN
    INSERT INTO public.story_mode_chapter_completions (
      user_id, book_slug, chapter_slug
    ) VALUES (
      NEW.user_id, v_level.book_slug, v_level.chapter_slug
    )
    ON CONFLICT (user_id, book_slug, chapter_slug) DO NOTHING;
  END IF;

  SELECT count(*) INTO v_required_book_levels
  FROM public.story_mode_levels level
  WHERE level.book_slug = v_level.book_slug
    AND level.is_published = true;

  SELECT count(*) INTO v_completed_book_levels
  FROM public.story_mode_level_completions completion
  JOIN public.story_mode_levels level ON level.slug = completion.level_slug
  WHERE completion.user_id = NEW.user_id
    AND level.book_slug = v_level.book_slug
    AND level.is_published = true;

  IF v_required_book_levels = 0 OR v_completed_book_levels <> v_required_book_levels THEN RETURN NEW; END IF;

  /* Beginnings cannot complete until the final covenant/rainbow state is settled. */
  IF v_level.book_slug = 'beginnings' AND NOT EXISTS (
    SELECT 1
    FROM public.story_mode_user_environment_progress progress
    JOIN public.story_mode_environment_sequences sequence ON sequence.id = progress.sequence_id
    WHERE progress.user_id = NEW.user_id
      AND progress.sequence_id = 'noah-flood-environment'
      AND progress.stage_order >= sequence.total_stages
  ) THEN
    RAISE EXCEPTION 'Book I cannot complete before the covenant and rainbow sequence.';
  END IF;

  SELECT count(*) INTO v_chapters_completed
  FROM public.story_mode_chapter_completions completion
  WHERE completion.user_id = NEW.user_id
    AND completion.book_slug = v_level.book_slug;

  SELECT
    coalesce(sum(completion.question_count), 0),
    coalesce(sum(completion.correct_count), 0),
    coalesce(sum(completion.figs_earned), 0),
    coalesce(sum(completion.denarii_earned), 0)
  INTO v_questions, v_correct, v_figs, v_denarii
  FROM public.story_mode_level_completions completion
  JOIN public.story_mode_levels level ON level.slug = completion.level_slug
  WHERE completion.user_id = NEW.user_id
    AND level.book_slug = v_level.book_slug
    AND level.is_published = true;

  INSERT INTO public.story_mode_book_completions (
    user_id, book_slug, chapters_completed, levels_completed,
    questions_encountered, correct_answers, completion_percentage,
    figs_earned, denarii_earned
  ) VALUES (
    NEW.user_id, v_level.book_slug, v_chapters_completed, v_completed_book_levels,
    v_questions, v_correct, 100, v_figs, v_denarii
  )
  ON CONFLICT (user_id, book_slug) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_mode_settle_book_completion_trigger ON public.story_mode_level_completions;
CREATE TRIGGER story_mode_settle_book_completion_trigger
AFTER INSERT OR UPDATE ON public.story_mode_level_completions
FOR EACH ROW
EXECUTE FUNCTION public.story_mode_settle_book_completion();

/* Repair a missing chapter ledger only when every published level is already complete. */
INSERT INTO public.story_mode_chapter_completions (user_id, book_slug, chapter_slug)
SELECT completion.user_id, level.book_slug, level.chapter_slug
FROM public.story_mode_level_completions completion
JOIN public.story_mode_levels level ON level.slug = completion.level_slug
WHERE level.is_published = true
GROUP BY completion.user_id, level.book_slug, level.chapter_slug
HAVING count(*) = (
  SELECT count(*)
  FROM public.story_mode_levels required
  WHERE required.book_slug = level.book_slug
    AND required.chapter_slug = level.chapter_slug
    AND required.is_published = true
)
ON CONFLICT (user_id, book_slug, chapter_slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_my_story_mode_book_completion(p_book_slug text DEFAULT 'beginnings')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.story_mode_require_player();
  v_completion public.story_mode_book_completions%ROWTYPE;
  v_chapters integer;
  v_levels integer;
  v_required_levels integer;
  v_questions integer;
  v_correct integer;
  v_figs integer;
  v_denarii integer;
BEGIN
  SELECT * INTO v_completion
  FROM public.story_mode_book_completions completion
  WHERE completion.user_id = v_user_id
    AND completion.book_slug = p_book_slug;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'book_slug', v_completion.book_slug,
      'completed', true,
      'chapters_completed', v_completion.chapters_completed,
      'levels_completed', v_completion.levels_completed,
      'questions_encountered', v_completion.questions_encountered,
      'successful_responses', v_completion.correct_answers,
      'completion_percentage', v_completion.completion_percentage,
      'figs_earned', v_completion.figs_earned,
      'denarii_earned', v_completion.denarii_earned,
      'completed_at', v_completion.first_completed_at
    );
  END IF;

  SELECT count(*) INTO v_chapters
  FROM public.story_mode_chapter_completions completion
  WHERE completion.user_id = v_user_id
    AND completion.book_slug = p_book_slug;

  SELECT count(*) INTO v_required_levels
  FROM public.story_mode_levels level
  WHERE level.book_slug = p_book_slug
    AND level.is_published = true;

  SELECT
    count(*),
    coalesce(sum(completion.question_count), 0),
    coalesce(sum(completion.correct_count), 0),
    coalesce(sum(completion.figs_earned), 0),
    coalesce(sum(completion.denarii_earned), 0)
  INTO v_levels, v_questions, v_correct, v_figs, v_denarii
  FROM public.story_mode_level_completions completion
  JOIN public.story_mode_levels level ON level.slug = completion.level_slug
  WHERE completion.user_id = v_user_id
    AND level.book_slug = p_book_slug
    AND level.is_published = true;

  RETURN jsonb_build_object(
    'book_slug', p_book_slug,
    'completed', false,
    'chapters_completed', v_chapters,
    'levels_completed', v_levels,
    'questions_encountered', v_questions,
    'successful_responses', v_correct,
    'completion_percentage', CASE
      WHEN v_required_levels = 0 THEN 0
      ELSE round((v_levels::numeric / v_required_levels::numeric) * 100)
    END,
    'figs_earned', v_figs,
    'denarii_earned', v_denarii,
    'completed_at', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.story_mode_environment_state_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_mode_initialize_environment_attempt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_mode_advance_environment_stage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_mode_guard_environment_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_mode_settle_book_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_story_mode_environment_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_story_mode_book_completion(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_story_mode_environment_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_story_mode_book_completion(text) TO authenticated, service_role;
