/* Story Mode Phase 3D: Noah through the prepared Ark, before Flood gameplay. */

CREATE TABLE IF NOT EXISTS public.story_mode_chapter_unlocks (
  book_slug text NOT NULL,
  chapter_slug text NOT NULL,
  prerequisite_book_slug text NOT NULL,
  prerequisite_chapter_slug text NOT NULL,
  PRIMARY KEY (book_slug, chapter_slug)
);

CREATE TABLE IF NOT EXISTS public.story_mode_world_builds (
  id text PRIMARY KEY,
  label text NOT NULL,
  total_stages integer NOT NULL CHECK (total_stages > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.story_mode_world_build_stages (
  build_id text NOT NULL REFERENCES public.story_mode_world_builds(id) ON DELETE CASCADE,
  stage_order integer NOT NULL CHECK (stage_order > 0),
  stage_slug text NOT NULL,
  component_key text NOT NULL,
  completion_label text NOT NULL,
  trigger_level_slug text NOT NULL,
  trigger_pool_id text NOT NULL,
  checkpoint_id text NOT NULL,
  PRIMARY KEY (build_id, stage_order),
  UNIQUE (build_id, stage_slug),
  UNIQUE (trigger_level_slug, trigger_pool_id),
  FOREIGN KEY (trigger_level_slug, trigger_pool_id)
    REFERENCES public.story_mode_question_pools(level_slug, pool_id) ON DELETE CASCADE,
  FOREIGN KEY (trigger_level_slug, checkpoint_id)
    REFERENCES public.story_mode_checkpoints(level_slug, checkpoint_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.story_mode_level_build_context (
  level_slug text PRIMARY KEY REFERENCES public.story_mode_levels(slug) ON DELETE CASCADE,
  build_id text NOT NULL REFERENCES public.story_mode_world_builds(id) ON DELETE CASCADE,
  starting_stage_order integer NOT NULL CHECK (starting_stage_order >= 0),
  ending_stage_order integer NOT NULL CHECK (ending_stage_order >= starting_stage_order)
);

CREATE TABLE IF NOT EXISTS public.story_mode_user_build_progress (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  build_id text NOT NULL REFERENCES public.story_mode_world_builds(id) ON DELETE CASCADE,
  stage_order integer NOT NULL DEFAULT 0 CHECK (stage_order >= 0),
  stage_slug text NOT NULL DEFAULT 'site',
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, build_id)
);

CREATE TABLE IF NOT EXISTS public.story_mode_attempt_build_progress (
  attempt_id uuid PRIMARY KEY REFERENCES public.story_mode_attempts(id) ON DELETE CASCADE,
  build_id text NOT NULL REFERENCES public.story_mode_world_builds(id) ON DELETE CASCADE,
  stage_order integer NOT NULL DEFAULT 0 CHECK (stage_order >= 0),
  stage_slug text NOT NULL DEFAULT 'site',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.story_mode_chapter_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_world_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_world_build_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_level_build_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_user_build_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_mode_attempt_build_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.story_mode_chapter_unlocks,
  public.story_mode_world_builds,
  public.story_mode_world_build_stages,
  public.story_mode_level_build_context,
  public.story_mode_user_build_progress,
  public.story_mode_attempt_build_progress
FROM PUBLIC, anon, authenticated;

INSERT INTO public.story_mode_levels (
  slug, book_slug, chapter_slug, title, level_order, unlock_after_level_slug, is_published
)
VALUES
  ('corruption', 'beginnings', 'noah', 'Corruption', 1, 'toward-noah', true),
  ('noah-found-favor', 'beginnings', 'noah', 'Noah Found Favor', 2, 'corruption', true),
  ('make-yourself-an-ark', 'beginnings', 'noah', 'Make Yourself an Ark', 3, 'noah-found-favor', true),
  ('gopher-wood', 'beginnings', 'noah', 'Gopher Wood', 4, 'make-yourself-an-ark', true),
  ('three-hundred-cubits', 'beginnings', 'noah', 'Three Hundred Cubits', 5, 'gopher-wood', true),
  ('rooms-door-and-decks', 'beginnings', 'noah', 'Rooms, Door, and Decks', 6, 'three-hundred-cubits', true),
  ('the-covenant', 'beginnings', 'noah', 'The Covenant', 7, 'rooms-door-and-decks', true),
  ('every-living-thing', 'beginnings', 'noah', 'Every Living Thing', 8, 'the-covenant', true),
  ('provisions', 'beginnings', 'noah', 'Provisions', 9, 'every-living-thing', true),
  ('the-ark-stands', 'beginnings', 'noah', 'The Ark Stands', 10, 'provisions', true),
  ('the-flood', 'beginnings', 'noah', 'The Flood', 11, 'the-ark-stands', false)
ON CONFLICT (slug) DO UPDATE SET
  book_slug = EXCLUDED.book_slug,
  chapter_slug = EXCLUDED.chapter_slug,
  title = EXCLUDED.title,
  level_order = EXCLUDED.level_order,
  unlock_after_level_slug = EXCLUDED.unlock_after_level_slug,
  is_published = EXCLUDED.is_published;

INSERT INTO public.story_mode_chapter_unlocks (
  book_slug, chapter_slug, prerequisite_book_slug, prerequisite_chapter_slug
)
VALUES ('beginnings', 'noah', 'beginnings', 'generations')
ON CONFLICT (book_slug, chapter_slug) DO UPDATE SET
  prerequisite_book_slug = EXCLUDED.prerequisite_book_slug,
  prerequisite_chapter_slug = EXCLUDED.prerequisite_chapter_slug;

INSERT INTO public.story_mode_checkpoints (level_slug, checkpoint_id, checkpoint_order, state_hint)
VALUES
  ('corruption', 'corruption-start', 0, 'intro'),
  ('corruption', 'corruption-violence-question', 1, 'question_approach'),
  ('corruption', 'corruption-earth-question', 2, 'question_approach'),
  ('corruption', 'corruption-complete', 3, 'level_complete'),
  ('noah-found-favor', 'favor-start', 0, 'intro'),
  ('noah-found-favor', 'favor-noah-question', 1, 'question_approach'),
  ('noah-found-favor', 'favor-sons-question', 2, 'question_approach'),
  ('noah-found-favor', 'favor-complete', 3, 'level_complete'),
  ('make-yourself-an-ark', 'ark-command-start', 0, 'intro'),
  ('make-yourself-an-ark', 'ark-command-question', 1, 'question_approach'),
  ('make-yourself-an-ark', 'ark-read-question', 2, 'question_approach'),
  ('make-yourself-an-ark', 'ark-command-complete', 3, 'level_complete'),
  ('gopher-wood', 'wood-start', 0, 'intro'),
  ('gopher-wood', 'wood-material-question', 1, 'question_approach'),
  ('gopher-wood', 'wood-covering-question', 2, 'question_approach'),
  ('gopher-wood', 'wood-complete', 3, 'level_complete'),
  ('three-hundred-cubits', 'dimensions-start', 0, 'intro'),
  ('three-hundred-cubits', 'dimensions-length-question', 1, 'question_approach'),
  ('three-hundred-cubits', 'dimensions-width-question', 2, 'question_approach'),
  ('three-hundred-cubits', 'dimensions-height-question', 3, 'question_approach'),
  ('three-hundred-cubits', 'dimensions-complete', 4, 'level_complete'),
  ('rooms-door-and-decks', 'structure-start', 0, 'intro'),
  ('rooms-door-and-decks', 'structure-rooms-question', 1, 'question_approach'),
  ('rooms-door-and-decks', 'structure-opening-question', 2, 'question_approach'),
  ('rooms-door-and-decks', 'structure-decks-question', 3, 'question_approach'),
  ('rooms-door-and-decks', 'structure-complete', 4, 'level_complete'),
  ('the-covenant', 'covenant-start', 0, 'intro'),
  ('the-covenant', 'covenant-judgment-question', 1, 'question_approach'),
  ('the-covenant', 'covenant-household-question', 2, 'question_approach'),
  ('the-covenant', 'covenant-complete', 3, 'level_complete'),
  ('every-living-thing', 'animals-start', 0, 'intro'),
  ('every-living-thing', 'animals-pairs-question', 1, 'question_approach'),
  ('every-living-thing', 'animals-kinds-question', 2, 'question_approach'),
  ('every-living-thing', 'animals-life-question', 3, 'question_approach'),
  ('every-living-thing', 'animals-complete', 4, 'level_complete'),
  ('provisions', 'provisions-start', 0, 'intro'),
  ('provisions', 'provisions-food-question', 1, 'question_approach'),
  ('provisions', 'provisions-storage-question', 2, 'question_approach'),
  ('provisions', 'provisions-complete', 3, 'level_complete'),
  ('the-ark-stands', 'ark-stands-start', 0, 'intro'),
  ('the-ark-stands', 'ark-stands-obedience-question', 1, 'question_approach'),
  ('the-ark-stands', 'ark-stands-family-question', 2, 'question_approach'),
  ('the-ark-stands', 'ark-stands-readiness-question', 3, 'question_approach'),
  ('the-ark-stands', 'ark-stands-complete', 4, 'level_complete')
ON CONFLICT (level_slug, checkpoint_id) DO UPDATE SET
  checkpoint_order = EXCLUDED.checkpoint_order,
  state_hint = EXCLUDED.state_hint;

INSERT INTO public.story_mode_question_pools (
  level_slug, pool_id, scene_id, checkpoint_id, pool_order, questions_per_attempt
)
VALUES
  ('corruption', 'corruption-violence-easy', 'corruption-violence', 'corruption-violence-question', 1, 1),
  ('corruption', 'corruption-earth-moderate', 'corruption-earth', 'corruption-earth-question', 2, 1),
  ('noah-found-favor', 'favor-noah-easy', 'favor-noah', 'favor-noah-question', 1, 1),
  ('noah-found-favor', 'favor-sons-moderate', 'favor-sons', 'favor-sons-question', 2, 1),
  ('make-yourself-an-ark', 'ark-command-easy', 'ark-command-basic', 'ark-command-question', 1, 1),
  ('make-yourself-an-ark', 'ark-read-hard', 'ark-command-read-detail', 'ark-read-question', 2, 1),
  ('gopher-wood', 'gopher-material-moderate', 'wood-material', 'wood-material-question', 1, 1),
  ('gopher-wood', 'gopher-covering-hard', 'wood-covering', 'wood-covering-question', 2, 1),
  ('three-hundred-cubits', 'dimensions-length-easy', 'dimensions-length', 'dimensions-length-question', 1, 1),
  ('three-hundred-cubits', 'dimensions-width-moderate', 'dimensions-width', 'dimensions-width-question', 2, 1),
  ('three-hundred-cubits', 'dimensions-height-hard', 'dimensions-height', 'dimensions-height-question', 3, 1),
  ('rooms-door-and-decks', 'structure-rooms-moderate', 'structure-rooms', 'structure-rooms-question', 1, 1),
  ('rooms-door-and-decks', 'structure-opening-door-hard', 'structure-opening-door', 'structure-opening-question', 2, 1),
  ('rooms-door-and-decks', 'structure-decks-hard', 'structure-decks', 'structure-decks-question', 3, 1),
  ('the-covenant', 'covenant-judgment-moderate', 'covenant-judgment', 'covenant-judgment-question', 1, 1),
  ('the-covenant', 'covenant-household-hard', 'covenant-household', 'covenant-household-question', 2, 1),
  ('every-living-thing', 'animals-pairs-easy', 'animals-pairs', 'animals-pairs-question', 1, 1),
  ('every-living-thing', 'animals-kinds-moderate', 'animals-kinds', 'animals-kinds-question', 2, 1),
  ('every-living-thing', 'animals-life-hard', 'animals-life', 'animals-life-question', 3, 1),
  ('provisions', 'provisions-food-easy', 'provisions-food', 'provisions-food-question', 1, 1),
  ('provisions', 'provisions-storage-moderate', 'provisions-storage', 'provisions-storage-question', 2, 1),
  ('the-ark-stands', 'final-obedience-easy', 'ark-stands-obedience', 'ark-stands-obedience-question', 1, 1),
  ('the-ark-stands', 'final-family-easy', 'ark-stands-family', 'ark-stands-family-question', 2, 1),
  ('the-ark-stands', 'final-readiness-hard', 'ark-stands-readiness', 'ark-stands-readiness-question', 3, 1)
ON CONFLICT (level_slug, pool_id) DO UPDATE SET
  scene_id = EXCLUDED.scene_id,
  checkpoint_id = EXCLUDED.checkpoint_id,
  pool_order = EXCLUDED.pool_order,
  questions_per_attempt = EXCLUDED.questions_per_attempt;

INSERT INTO public.story_mode_questions (
  id, level_slug, checkpoint_id, question_order, question_type, prompt, options,
  correct_answer, difficulty, timer_seconds, scripture_reference, explanation,
  correct_action_id, wrong_action_id, pool_id, scene_id, is_read_follow_up
)
VALUES
  ('noah-corruption-filled', 'corruption', 'corruption-violence-question', 1, 'multiple_choice',
   'What does Genesis 6 say filled the earth?', '["Violence", "Harvest", "Music", "Trade"]'::jsonb,
   'Violence', 'easy', 5, 'Genesis 6:11, 13', 'The earth was filled with violence.', 'observe', 'blocked', 'corruption-violence-easy', 'corruption-violence', false),
  ('noah-corruption-peaceful', 'corruption', 'corruption-violence-question', 2, 'true_false',
   'Genesis 6 describes the earth as peaceful and orderly.', '["True", "False"]'::jsonb,
   'False', 'easy', 5, 'Genesis 6:11-13', 'The passage describes corruption and violence.', 'observe', 'blocked', 'corruption-violence-easy', 'corruption-violence', false),
  ('noah-corruption-before-god', 'corruption', 'corruption-earth-question', 3, 'multiple_choice',
   'How is the earth described before God in Genesis 6:11?', '["Corrupt", "Complete", "Empty", "Hidden"]'::jsonb,
   'Corrupt', 'moderate', 7, 'Genesis 6:11', 'The earth was corrupt before God.', 'observe', 'collapse', 'corruption-earth-moderate', 'corruption-earth', false),
  ('noah-corruption-judgment-link', 'corruption', 'corruption-earth-question', 4, 'true_false',
   'Genesis 6 connects the corrupted, violent earth with announced judgment.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 6:11-13', 'The announcement follows the description of corruption and violence.', 'observe', 'collapse', 'corruption-earth-moderate', 'corruption-earth', false),

  ('noah-favor-who', 'noah-found-favor', 'favor-noah-question', 1, 'multiple_choice',
   'Who found favor in the eyes of the Lord?', '["Noah", "Lamech", "Methuselah", "Japheth"]'::jsonb,
   'Noah', 'easy', 5, 'Genesis 6:8', 'Noah found favor in the eyes of the Lord.', 'observe', 'rejected', 'favor-noah-easy', 'favor-noah', false),
  ('noah-favor-statement', 'noah-found-favor', 'favor-noah-question', 2, 'true_false',
   'Genesis 6 says Noah found favor in the eyes of the Lord.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 6:8', 'This is the statement of Genesis 6:8.', 'observe', 'rejected', 'favor-noah-easy', 'favor-noah', false),
  ('noah-sons-names', 'noah-found-favor', 'favor-sons-question', 3, 'multiple_choice',
   'Which three sons of Noah are named in Genesis 6:10?', '["Shem, Ham, and Japheth", "Cain, Abel, and Seth", "Enosh, Jared, and Enoch", "Lamech, Noah, and Shem"]'::jsonb,
   'Shem, Ham, and Japheth', 'moderate', 7, 'Genesis 6:10', 'Genesis names Shem, Ham, and Japheth.', 'group-enter', 'misplaced', 'favor-sons-moderate', 'favor-sons', false),
  ('noah-sons-four', 'noah-found-favor', 'favor-sons-question', 4, 'true_false',
   'Genesis 6:10 names four sons of Noah.', '["True", "False"]'::jsonb,
   'False', 'moderate', 7, 'Genesis 6:10', 'The verse names three sons.', 'group-enter', 'misplaced', 'favor-sons-moderate', 'favor-sons', false),

  ('noah-command-object', 'make-yourself-an-ark', 'ark-command-question', 1, 'multiple_choice',
   'What was Noah commanded to make?', '["An Ark", "A city", "An altar", "A tower"]'::jsonb,
   'An Ark', 'easy', 5, 'Genesis 6:14', 'Noah was commanded to make an Ark.', 'measure-place', 'rejected', 'ark-command-easy', 'ark-command-basic', false),
  ('noah-command-city', 'make-yourself-an-ark', 'ark-command-question', 2, 'true_false',
   'The construction command in Genesis 6:14 was to build a city.', '["True", "False"]'::jsonb,
   'False', 'easy', 5, 'Genesis 6:14', 'The command was to make an Ark.', 'measure-place', 'rejected', 'ark-command-easy', 'ark-command-basic', false),
  ('noah-read-instruction-sequence', 'make-yourself-an-ark', 'ark-read-question', 3, 'multiple_choice',
   'Which material instruction appears with the command to make the Ark?', '["Use gopher wood", "Use carved stone", "Use fired brick", "Use cedar panels only"]'::jsonb,
   'Use gopher wood', 'hard', 10, 'Genesis 6:14', 'The displayed reading uses the wording gopher wood.', 'foundation-settle', 'collapse', 'ark-read-hard', 'ark-command-read-detail', true),
  ('noah-read-closing-obedience', 'make-yourself-an-ark', 'ark-read-question', 4, 'multiple_choice',
   'How does Genesis 6:22 summarize Noah''s response?', '["He did all that God commanded him", "He changed the dimensions", "He waited for another builder", "He began the Flood"]'::jsonb,
   'He did all that God commanded him', 'hard', 10, 'Genesis 6:22', 'Genesis 6 closes by recording Noah''s obedience.', 'foundation-settle', 'collapse', 'ark-read-hard', 'ark-command-read-detail', true),

  ('noah-material-gopher', 'gopher-wood', 'wood-material-question', 1, 'multiple_choice',
   'Which material wording is used in the displayed Genesis 6:14 text?', '["Gopher wood", "Marble", "Bronze", "Mud brick"]'::jsonb,
   'Gopher wood', 'moderate', 7, 'Genesis 6:14', 'Full Circle uses gopher wood consistently in this passage.', 'carry-cut-place', 'rejected', 'gopher-material-moderate', 'wood-material', false),
  ('noah-material-not-stone', 'gopher-wood', 'wood-material-question', 2, 'multiple_choice',
   'Which choice does not replace the material named for the Ark?', '["Gopher wood", "Dressed stone", "Iron sheets", "Clay brick"]'::jsonb,
   'Gopher wood', 'moderate', 7, 'Genesis 6:14', 'The material named in the displayed text is gopher wood.', 'carry-cut-place', 'rejected', 'gopher-material-moderate', 'wood-material', false),
  ('noah-pitch-placement', 'gopher-wood', 'wood-covering-question', 3, 'multiple_choice',
   'Where was pitch to cover the Ark?', '["Inside and outside", "Outside only", "Inside only", "On the door only"]'::jsonb,
   'Inside and outside', 'hard', 10, 'Genesis 6:14', 'The Ark was to be covered with pitch inside and outside.', 'raise-hammer', 'lean', 'gopher-covering-hard', 'wood-covering', true),
  ('noah-pitch-outside-only', 'gopher-wood', 'wood-covering-question', 4, 'true_false',
   'Genesis 6:14 limits the pitch covering to the outside of the Ark.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 6:14', 'The instruction includes both inside and outside.', 'raise-hammer', 'lean', 'gopher-covering-hard', 'wood-covering', true),

  ('noah-length-cubits', 'three-hundred-cubits', 'dimensions-length-question', 1, 'multiple_choice',
   'What length does Genesis 6:15 give the Ark?', '["300 cubits", "50 cubits", "30 cubits", "100 cubits"]'::jsonb,
   '300 cubits', 'easy', 5, 'Genesis 6:15', 'The Ark''s length is three hundred cubits.', 'measure-place', 'misplaced', 'dimensions-length-easy', 'dimensions-length', false),
  ('noah-longest-measure', 'three-hundred-cubits', 'dimensions-length-question', 2, 'multiple_choice',
   'Which stated measurement is three hundred cubits?', '["Length", "Breadth", "Height", "Door"]'::jsonb,
   'Length', 'easy', 5, 'Genesis 6:15', 'Three hundred cubits is the length.', 'measure-place', 'misplaced', 'dimensions-length-easy', 'dimensions-length', false),
  ('noah-breadth-cubits', 'three-hundred-cubits', 'dimensions-width-question', 3, 'multiple_choice',
   'What breadth does Genesis 6:15 give the Ark?', '["50 cubits", "300 cubits", "30 cubits", "15 cubits"]'::jsonb,
   '50 cubits', 'moderate', 7, 'Genesis 6:15', 'The breadth is fifty cubits.', 'measure-raise', 'lean', 'dimensions-width-moderate', 'dimensions-width', false),
  ('noah-breadth-height-pair', 'three-hundred-cubits', 'dimensions-width-question', 4, 'multiple_choice',
   'Which pair correctly gives breadth and height?', '["50 and 30 cubits", "30 and 50 cubits", "300 and 50 cubits", "50 and 300 cubits"]'::jsonb,
   '50 and 30 cubits', 'moderate', 7, 'Genesis 6:15', 'Breadth is fifty and height is thirty cubits.', 'measure-raise', 'lean', 'dimensions-width-moderate', 'dimensions-width', false),
  ('noah-height-cubits', 'three-hundred-cubits', 'dimensions-height-question', 5, 'multiple_choice',
   'What height does Genesis 6:15 give the Ark?', '["30 cubits", "50 cubits", "300 cubits", "60 cubits"]'::jsonb,
   '30 cubits', 'hard', 10, 'Genesis 6:15', 'The height is thirty cubits.', 'raise-hammer', 'collapse', 'dimensions-height-hard', 'dimensions-height', false),
  ('noah-all-dimensions', 'three-hundred-cubits', 'dimensions-height-question', 6, 'multiple_choice',
   'Which sequence gives length, breadth, and height?', '["300, 50, 30 cubits", "300, 30, 50 cubits", "50, 300, 30 cubits", "30, 50, 300 cubits"]'::jsonb,
   '300, 50, 30 cubits', 'hard', 10, 'Genesis 6:15', 'The dimensions are three hundred by fifty by thirty cubits.', 'raise-hammer', 'collapse', 'dimensions-height-hard', 'dimensions-height', false),

  ('noah-rooms-within', 'rooms-door-and-decks', 'structure-rooms-question', 1, 'multiple_choice',
   'What was Noah told to make within the Ark?', '["Rooms or compartments", "A throne room", "A courtyard", "A stone tower"]'::jsonb,
   'Rooms or compartments', 'moderate', 7, 'Genesis 6:14', 'Genesis 6:14 includes rooms or compartments.', 'place-hammer', 'misplaced', 'structure-rooms-moderate', 'structure-rooms', false),
  ('noah-no-rooms', 'rooms-door-and-decks', 'structure-rooms-question', 2, 'true_false',
   'The Ark instruction contains no interior rooms or compartments.', '["True", "False"]'::jsonb,
   'False', 'moderate', 7, 'Genesis 6:14', 'Rooms or compartments are part of the instruction.', 'place-hammer', 'misplaced', 'structure-rooms-moderate', 'structure-rooms', false),
  ('noah-door-location', 'rooms-door-and-decks', 'structure-opening-question', 3, 'multiple_choice',
   'Where was the Ark''s door to be placed?', '["In its side", "In the roof", "Under the keel", "At both ends"]'::jsonb,
   'In its side', 'hard', 10, 'Genesis 6:16', 'The door was to be set in the side of the Ark.', 'place-open-door', 'misplaced', 'structure-opening-door-hard', 'structure-opening-door', true),
  ('noah-opening-and-door', 'rooms-door-and-decks', 'structure-opening-question', 4, 'multiple_choice',
   'Which structural pair is explicitly named in Genesis 6:16?', '["An opening and a side door", "Twin towers and a bridge", "A chimney and a gatehouse", "Stone windows and bronze doors"]'::jsonb,
   'An opening and a side door', 'hard', 10, 'Genesis 6:16', 'The passage names an opening and a door in the side.', 'place-open-door', 'misplaced', 'structure-opening-door-hard', 'structure-opening-door', true),
  ('noah-three-decks', 'rooms-door-and-decks', 'structure-decks-question', 5, 'multiple_choice',
   'How are the Ark''s deck levels described?', '["Lower, second, and third", "Lower and upper only", "Four equal decks", "One open deck"]'::jsonb,
   'Lower, second, and third', 'hard', 10, 'Genesis 6:16', 'Genesis 6:16 names lower, second, and third decks.', 'raise-place-seal', 'collapse', 'structure-decks-hard', 'structure-decks', false),
  ('noah-two-decks-only', 'rooms-door-and-decks', 'structure-decks-question', 6, 'true_false',
   'Genesis 6:16 describes only two deck levels.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 6:16', 'Lower, second, and third decks are named.', 'raise-place-seal', 'collapse', 'structure-decks-hard', 'structure-decks', false),

  ('noah-covenant-announcement', 'the-covenant', 'covenant-judgment-question', 1, 'multiple_choice',
   'What event does God announce in Genesis 6:17?', '["The Flood", "The rainbow", "The tower of Babel", "The exodus"]'::jsonb,
   'The Flood', 'moderate', 7, 'Genesis 6:17', 'God announces bringing floodwaters upon the earth.', 'observe-stop', 'blocked', 'covenant-judgment-moderate', 'covenant-judgment', false),
  ('noah-covenant-established', 'the-covenant', 'covenant-judgment-question', 2, 'true_false',
   'Genesis 6:18 says God would establish his covenant with Noah.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 6:18', 'The covenant language is stated before the Flood.', 'observe-stop', 'blocked', 'covenant-judgment-moderate', 'covenant-judgment', false),
  ('noah-household-entry', 'the-covenant', 'covenant-household-question', 3, 'multiple_choice',
   'Who is named to enter the Ark with Noah in Genesis 6:18?', '["His wife, his sons, and his sons'' wives", "Only his sons", "Only his wife", "The people of every city"]'::jsonb,
   'His wife, his sons, and his sons'' wives', 'hard', 10, 'Genesis 6:18', 'The verse names Noah''s wife, sons, and sons'' wives.', 'household-prepare', 'misplaced', 'covenant-household-hard', 'covenant-household', false),
  ('noah-wives-named', 'the-covenant', 'covenant-household-question', 4, 'true_false',
   'Genesis 6:18 gives personal names for Noah''s wife and his sons'' wives.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 6:18', 'The wives are included but remain unnamed in the verse.', 'household-prepare', 'misplaced', 'covenant-household-hard', 'covenant-household', false),

  ('noah-creatures-two', 'every-living-thing', 'animals-pairs-question', 1, 'multiple_choice',
   'According to Genesis 6:19, how many of every kind are mentioned for preservation?', '["Two", "One", "Seven of every kind", "Twelve"]'::jsonb,
   'Two', 'easy', 5, 'Genesis 6:19', 'Genesis 6:19 speaks of two of every kind.', 'animal-enter', 'blocked', 'animals-pairs-easy', 'animals-pairs', false),
  ('noah-creatures-kept-alive', 'every-living-thing', 'animals-pairs-question', 2, 'true_false',
   'The creatures are brought into the preservation instruction to be kept alive with Noah.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 6:19', 'The purpose stated is to keep them alive with Noah.', 'animal-enter', 'blocked', 'animals-pairs-easy', 'animals-pairs', false),
  ('noah-creature-categories', 'every-living-thing', 'animals-kinds-question', 3, 'multiple_choice',
   'Which categories are named in Genesis 6:20?', '["Birds, livestock, and creeping things", "Fish only", "Birds and fish only", "Wild beasts only"]'::jsonb,
   'Birds, livestock, and creeping things', 'moderate', 7, 'Genesis 6:20', 'The verse names birds, livestock, and creeping things by their kinds.', 'group-enter', 'misplaced', 'animals-kinds-moderate', 'animals-kinds', true),
  ('noah-visual-roster-exhaustive', 'every-living-thing', 'animals-kinds-question', 4, 'true_false',
   'The small animal silhouettes on screen are an exhaustive list of every creature in the text.', '["True", "False"]'::jsonb,
   'False', 'moderate', 7, 'Genesis 6:20', 'The grouped silhouettes are representative, not exhaustive.', 'group-enter', 'misplaced', 'animals-kinds-moderate', 'animals-kinds', true),
  ('noah-creatures-come', 'every-living-thing', 'animals-life-question', 5, 'multiple_choice',
   'What does Genesis 6:20 say the creatures will do?', '["Come to Noah to be kept alive", "Build the Ark", "Choose the dimensions", "Gather the food"]'::jsonb,
   'Come to Noah to be kept alive', 'hard', 10, 'Genesis 6:20', 'The verse says they will come to Noah to be kept alive.', 'group-enter', 'blocked', 'animals-life-hard', 'animals-life', false),
  ('noah-genesis-six-seven-clean', 'every-living-thing', 'animals-life-question', 6, 'true_false',
   'Genesis 6:19-20 itself gives the later Genesis 7 clean-animal count distinction.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 6:19-20', 'This question preserves the immediate Genesis 6 context instead of flattening chapters.', 'group-enter', 'blocked', 'animals-life-hard', 'animals-life', false),

  ('noah-food-gather', 'provisions', 'provisions-food-question', 1, 'multiple_choice',
   'What was Noah told to gather in Genesis 6:21?', '["Every kind of food that is eaten", "Gold and silver", "Stone tools only", "A named feast menu"]'::jsonb,
   'Every kind of food that is eaten', 'easy', 5, 'Genesis 6:21', 'Noah was told to gather food that is eaten.', 'carry-load', 'spill', 'provisions-food-easy', 'provisions-food', false),
  ('noah-food-menu', 'provisions', 'provisions-food-question', 2, 'true_false',
   'Genesis 6:21 provides a detailed menu of named meals for the Ark.', '["True", "False"]'::jsonb,
   'False', 'easy', 5, 'Genesis 6:21', 'The instruction speaks generally of food.', 'carry-load', 'spill', 'provisions-food-easy', 'provisions-food', false),
  ('noah-food-purpose', 'provisions', 'provisions-storage-question', 3, 'multiple_choice',
   'Why was the gathered food to be stored?', '["It would be food for Noah''s household and the creatures", "It would purchase the Ark", "It would mark the covenant", "It would display the Ark''s dimensions"]'::jsonb,
   'It would be food for Noah''s household and the creatures', 'moderate', 7, 'Genesis 6:21', 'The stored food was for Noah and the creatures.', 'load-store', 'spill', 'provisions-storage-moderate', 'provisions-storage', true),
  ('noah-food-only-noah', 'provisions', 'provisions-storage-question', 4, 'true_false',
   'The stored provisions were intended only for Noah.', '["True", "False"]'::jsonb,
   'False', 'moderate', 7, 'Genesis 6:21', 'The food was for Noah''s household and the creatures.', 'load-store', 'spill', 'provisions-storage-moderate', 'provisions-storage', true),

  ('noah-final-obedience', 'the-ark-stands', 'ark-stands-obedience-question', 1, 'multiple_choice',
   'What final statement does Genesis 6:22 make about Noah?', '["He did according to all God commanded him", "He entered alone", "He changed the Ark design", "He performed only part of the command"]'::jsonb,
   'He did according to all God commanded him', 'easy', 5, 'Genesis 6:22', 'Genesis 6:22 records complete obedience to the command.', 'inspect-observe', 'blocked', 'final-obedience-easy', 'ark-stands-obedience', false),
  ('noah-final-partial-obedience', 'the-ark-stands', 'ark-stands-obedience-question', 2, 'true_false',
   'Genesis 6:22 says Noah completed only part of what God commanded.', '["True", "False"]'::jsonb,
   'False', 'easy', 5, 'Genesis 6:22', 'The verse says Noah did all that God commanded.', 'inspect-observe', 'blocked', 'final-obedience-easy', 'ark-stands-obedience', false),
  ('noah-final-family', 'the-ark-stands', 'ark-stands-family-question', 3, 'multiple_choice',
   'Which household remains prepared beside Noah?', '["His wife, three sons, and their wives", "Only Shem", "Only Noah and his wife", "Named construction workers"]'::jsonb,
   'His wife, three sons, and their wives', 'easy', 5, 'Genesis 6:18', 'The household matches Genesis 6:18 without invented workers.', 'household-ready', 'misplaced', 'final-family-easy', 'ark-stands-family', false),
  ('noah-final-alone', 'the-ark-stands', 'ark-stands-family-question', 4, 'true_false',
   'Genesis 6 prepares Noah to enter the Ark entirely alone.', '["True", "False"]'::jsonb,
   'False', 'easy', 5, 'Genesis 6:18', 'Noah''s household is included.', 'household-ready', 'misplaced', 'final-family-easy', 'ark-stands-family', false),
  ('noah-final-readiness', 'the-ark-stands', 'ark-stands-readiness-question', 5, 'multiple_choice',
   'Which summary matches the preparation completed in Genesis 6?', '["Ark prepared, household ready, creatures assembled, food stored", "Ark unfinished and dimensions undecided", "Household absent and food uncollected", "City walls complete and creatures dismissed"]'::jsonb,
   'Ark prepared, household ready, creatures assembled, food stored', 'hard', 10, 'Genesis 6:14-22', 'Phase 3D ends with preparation complete and future events still locked.', 'ark-complete', 'collapse', 'final-readiness-hard', 'ark-stands-readiness', false),
  ('noah-final-preparation-complete', 'the-ark-stands', 'ark-stands-readiness-question', 6, 'true_false',
   'The preparation in Genesis 6 includes the Ark, the household, living creatures, and stored food.', '["True", "False"]'::jsonb,
   'True', 'hard', 10, 'Genesis 6:14-22', 'Those elements belong to the completed preparation recorded in Genesis 6.', 'ark-complete', 'collapse', 'final-readiness-hard', 'ark-stands-readiness', false)
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

INSERT INTO public.story_mode_world_builds (id, label, total_stages)
VALUES ('noah-ark', 'The Ark', 9)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, total_stages = EXCLUDED.total_stages;

INSERT INTO public.story_mode_world_build_stages (
  build_id, stage_order, stage_slug, component_key, completion_label,
  trigger_level_slug, trigger_pool_id, checkpoint_id
)
VALUES
  ('noah-ark', 1, 'foundation', 'foundation', 'Foundation laid',
   'make-yourself-an-ark', 'ark-read-hard', 'ark-read-question'),
  ('noah-ark', 2, 'frame', 'frame', 'Timber frame raised and sealed',
   'gopher-wood', 'gopher-covering-hard', 'wood-covering-question'),
  ('noah-ark', 3, 'hull', 'hull', 'Hull brought to scale',
   'three-hundred-cubits', 'dimensions-height-hard', 'dimensions-height-question'),
  ('noah-ark', 4, 'opening', 'opening', 'Opening and side door formed',
   'rooms-door-and-decks', 'structure-opening-door-hard', 'structure-opening-question'),
  ('noah-ark', 5, 'decks', 'decks', 'Rooms and three decks arranged',
   'rooms-door-and-decks', 'structure-decks-hard', 'structure-decks-question'),
  ('noah-ark', 6, 'household', 'household', 'Household prepared under the covenant',
   'the-covenant', 'covenant-household-hard', 'covenant-household-question'),
  ('noah-ark', 7, 'animals', 'animals', 'Living-creature groups assembled',
   'every-living-thing', 'animals-life-hard', 'animals-life-question'),
  ('noah-ark', 8, 'provisions', 'provisions', 'Food stored',
   'provisions', 'provisions-storage-moderate', 'provisions-storage-question'),
  ('noah-ark', 9, 'complete', 'complete', 'Ark prepared',
   'the-ark-stands', 'final-readiness-hard', 'ark-stands-readiness-question')
ON CONFLICT (build_id, stage_order) DO UPDATE SET
  stage_slug = EXCLUDED.stage_slug,
  component_key = EXCLUDED.component_key,
  completion_label = EXCLUDED.completion_label,
  trigger_level_slug = EXCLUDED.trigger_level_slug,
  trigger_pool_id = EXCLUDED.trigger_pool_id,
  checkpoint_id = EXCLUDED.checkpoint_id;

INSERT INTO public.story_mode_level_build_context (
  level_slug, build_id, starting_stage_order, ending_stage_order
)
VALUES
  ('make-yourself-an-ark', 'noah-ark', 0, 1),
  ('gopher-wood', 'noah-ark', 1, 2),
  ('three-hundred-cubits', 'noah-ark', 2, 3),
  ('rooms-door-and-decks', 'noah-ark', 3, 5),
  ('the-covenant', 'noah-ark', 5, 6),
  ('every-living-thing', 'noah-ark', 6, 7),
  ('provisions', 'noah-ark', 7, 8),
  ('the-ark-stands', 'noah-ark', 8, 9)
ON CONFLICT (level_slug) DO UPDATE SET
  build_id = EXCLUDED.build_id,
  starting_stage_order = EXCLUDED.starting_stage_order,
  ending_stage_order = EXCLUDED.ending_stage_order;

CREATE OR REPLACE FUNCTION public.story_mode_build_state_payload(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'construction_id', build.id,
    'label', build.label,
    'stage_order', progress.stage_order,
    'stage_slug', progress.stage_slug,
    'total_stages', build.total_stages,
    'completed', progress.stage_order >= build.total_stages,
    'completed_components', coalesce((
      SELECT jsonb_agg(stage.component_key ORDER BY stage.stage_order)
      FROM public.story_mode_world_build_stages stage
      WHERE stage.build_id = build.id AND stage.stage_order <= progress.stage_order
    ), '[]'::jsonb),
    'checkpoint_id', attempt.checkpoint_id
  )
  FROM public.story_mode_attempt_build_progress progress
  JOIN public.story_mode_world_builds build ON build.id = progress.build_id
  JOIN public.story_mode_attempts attempt ON attempt.id = progress.attempt_id
  WHERE progress.attempt_id = p_attempt_id;
$$;

REVOKE ALL ON FUNCTION public.story_mode_build_state_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.story_mode_build_state_payload(uuid) TO service_role;

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
  v_chapters jsonb;
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
  ORDER BY level.created_at, level.level_order
  LIMIT 1
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_progress
  FROM public.story_mode_progress
  WHERE user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Story Mode has no published starting level.'; END IF;

  SELECT attempt.id INTO v_active_attempt_id
  FROM public.story_mode_attempts attempt
  WHERE attempt.user_id = v_user_id AND attempt.status = 'in_progress'
  ORDER BY attempt.started_at DESC LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.story_mode_chapter_completions completion
    WHERE completion.user_id = v_user_id
      AND completion.book_slug = v_progress.current_book_slug
      AND completion.chapter_slug = v_progress.current_chapter_slug
  ) INTO v_chapter_completed;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'level_slug', level.slug,
      'completed', completion.user_id IS NOT NULL,
      'unlocked', (
        (level.unlock_after_level_slug IS NULL OR EXISTS (
          SELECT 1 FROM public.story_mode_level_completions prerequisite
          WHERE prerequisite.user_id = v_user_id
            AND prerequisite.level_slug = level.unlock_after_level_slug
        ))
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.story_mode_chapter_unlocks chapter_unlock
            WHERE chapter_unlock.book_slug = level.book_slug
              AND chapter_unlock.chapter_slug = level.chapter_slug
          )
          OR EXISTS (
            SELECT 1
            FROM public.story_mode_chapter_unlocks chapter_unlock
            JOIN public.story_mode_chapter_completions prerequisite
              ON prerequisite.user_id = v_user_id
              AND prerequisite.book_slug = chapter_unlock.prerequisite_book_slug
              AND prerequisite.chapter_slug = chapter_unlock.prerequisite_chapter_slug
            WHERE chapter_unlock.book_slug = level.book_slug
              AND chapter_unlock.chapter_slug = level.chapter_slug
          )
        )
      ),
      'times_completed', coalesce(completion.times_completed, 0),
      'first_completed_at', completion.first_completed_at,
      'figs_earned', coalesce(completion.figs_earned, 0),
      'denarii_earned', coalesce(completion.denarii_earned, 0)
    ) ORDER BY level.created_at, level.level_order
  ), '[]'::jsonb)
  INTO v_levels
  FROM public.story_mode_levels level
  LEFT JOIN public.story_mode_level_completions completion
    ON completion.user_id = v_user_id AND completion.level_slug = level.slug
  WHERE level.is_published = true AND level.book_slug = 'beginnings';

  WITH chapter_keys AS (
    SELECT DISTINCT level.book_slug, level.chapter_slug
    FROM public.story_mode_levels level
    WHERE level.is_published = true AND level.book_slug = 'beginnings'
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'book_slug', chapter.book_slug,
      'chapter_slug', chapter.chapter_slug,
      'completed', completion.user_id IS NOT NULL,
      'times_completed', coalesce(completion.times_completed, 0),
      'first_completed_at', completion.first_completed_at,
      'figs_earned', coalesce((
        SELECT sum(entry.figs)
        FROM public.story_mode_fig_entries entry
        JOIN public.story_mode_levels level ON level.slug = entry.level_slug
        WHERE entry.user_id = v_user_id
          AND level.book_slug = chapter.book_slug
          AND level.chapter_slug = chapter.chapter_slug
      ), 0),
      'denarii_earned', 0
    ) ORDER BY chapter.book_slug, chapter.chapter_slug
  ), '[]'::jsonb)
  INTO v_chapters
  FROM chapter_keys chapter
  LEFT JOIN public.story_mode_chapter_completions completion
    ON completion.user_id = v_user_id
    AND completion.book_slug = chapter.book_slug
    AND completion.chapter_slug = chapter.chapter_slug;

  RETURN jsonb_build_object(
    'current_book_slug', v_progress.current_book_slug,
    'current_chapter_slug', v_progress.current_chapter_slug,
    'current_level_slug', v_progress.current_level_slug,
    'checkpoint_id', v_progress.checkpoint_id,
    'completed_level_count', (
      SELECT count(*) FROM public.story_mode_level_completions completion
      JOIN public.story_mode_levels level ON level.slug = completion.level_slug
      WHERE completion.user_id = v_user_id AND level.book_slug = 'beginnings'
    ),
    'total_level_count', (
      SELECT count(*) FROM public.story_mode_levels WHERE book_slug = 'beginnings'
    ),
    'active_attempt_id', v_active_attempt_id,
    'chapter_completed', v_chapter_completed,
    'chapter_figs_earned', (
      SELECT coalesce(sum(entry.figs), 0)
      FROM public.story_mode_fig_entries entry
      JOIN public.story_mode_levels level ON level.slug = entry.level_slug
      WHERE entry.user_id = v_user_id
        AND level.book_slug = v_progress.current_book_slug
        AND level.chapter_slug = v_progress.current_chapter_slug
    ),
    'chapter_denarii_earned', 0,
    'levels', v_levels,
    'chapters', v_chapters
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
  v_build_context public.story_mode_level_build_context%ROWTYPE;
  v_user_build public.story_mode_user_build_progress%ROWTYPE;
  v_attempt_build public.story_mode_attempt_build_progress%ROWTYPE;
  v_restored boolean := false;
  v_is_replay boolean;
  v_start_checkpoint text;
  v_checkpoint_state text;
  v_deadline timestamptz;
  v_pending_event_id text;
  v_initial_build_stage integer;
  v_initial_build_slug text;
BEGIN
  SELECT * INTO v_level
  FROM public.story_mode_levels
  WHERE slug = p_level_slug AND is_published = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'This Story Mode level is locked or unavailable.'; END IF;

  IF v_level.unlock_after_level_slug IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.story_mode_level_completions completion
    WHERE completion.user_id = v_user_id AND completion.level_slug = v_level.unlock_after_level_slug
  ) THEN
    RAISE EXCEPTION 'Complete the previous Story Mode level first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.story_mode_chapter_unlocks chapter_unlock
    WHERE chapter_unlock.book_slug = v_level.book_slug
      AND chapter_unlock.chapter_slug = v_level.chapter_slug
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.story_mode_chapter_unlocks chapter_unlock
    JOIN public.story_mode_chapter_completions completion
      ON completion.user_id = v_user_id
      AND completion.book_slug = chapter_unlock.prerequisite_book_slug
      AND completion.chapter_slug = chapter_unlock.prerequisite_chapter_slug
    WHERE chapter_unlock.book_slug = v_level.book_slug
      AND chapter_unlock.chapter_slug = v_level.chapter_slug
  ) THEN
    RAISE EXCEPTION 'Complete the previous Story Mode chapter first.';
  END IF;

  PERFORM 1 FROM public.profiles profile WHERE profile.id = v_user_id FOR UPDATE;

  SELECT checkpoint.checkpoint_id INTO v_start_checkpoint
  FROM public.story_mode_checkpoints checkpoint
  WHERE checkpoint.level_slug = p_level_slug
  ORDER BY checkpoint.checkpoint_order LIMIT 1;
  IF v_start_checkpoint IS NULL THEN RAISE EXCEPTION 'This Story Mode level has no starting checkpoint.'; END IF;

  SELECT * INTO v_attempt
  FROM public.story_mode_attempts attempt
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

  SELECT * INTO v_build_context
  FROM public.story_mode_level_build_context
  WHERE level_slug = v_attempt.level_slug;

  IF FOUND THEN
    IF v_attempt.is_replay THEN
      v_initial_build_stage := v_build_context.starting_stage_order;
      SELECT coalesce(stage.stage_slug, 'site') INTO v_initial_build_slug
      FROM (SELECT 1) seed
      LEFT JOIN public.story_mode_world_build_stages stage
        ON stage.build_id = v_build_context.build_id
        AND stage.stage_order = v_initial_build_stage;
    ELSE
      INSERT INTO public.story_mode_user_build_progress (user_id, build_id, stage_order, stage_slug)
      VALUES (v_user_id, v_build_context.build_id, 0, 'site')
      ON CONFLICT (user_id, build_id) DO NOTHING;

      SELECT * INTO v_user_build
      FROM public.story_mode_user_build_progress
      WHERE user_id = v_user_id AND build_id = v_build_context.build_id
      FOR UPDATE;

      IF v_user_build.stage_order < v_build_context.starting_stage_order
        OR v_user_build.stage_order > v_build_context.ending_stage_order THEN
        RAISE EXCEPTION 'The authoritative Story Mode construction sequence is not ready for this level.';
      END IF;
      v_initial_build_stage := v_user_build.stage_order;
      v_initial_build_slug := v_user_build.stage_slug;
    END IF;

    INSERT INTO public.story_mode_attempt_build_progress (
      attempt_id, build_id, stage_order, stage_slug
    ) VALUES (
      v_attempt.id, v_build_context.build_id, v_initial_build_stage, coalesce(v_initial_build_slug, 'site')
    )
    ON CONFLICT (attempt_id) DO NOTHING;

    SELECT * INTO v_attempt_build
    FROM public.story_mode_attempt_build_progress
    WHERE attempt_id = v_attempt.id
    FOR UPDATE;
    IF v_attempt_build.build_id IS DISTINCT FROM v_build_context.build_id
      OR v_attempt_build.stage_order < v_build_context.starting_stage_order
      OR v_attempt_build.stage_order > v_build_context.ending_stage_order THEN
      RAISE EXCEPTION 'The saved Story Mode construction state is invalid for this level.';
    END IF;
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
    'pending_event_id', v_pending_event_id,
    'build_state', public.story_mode_build_state_payload(v_attempt.id)
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
  v_next_level public.story_mode_levels%ROWTYPE;
  v_question public.story_mode_questions%ROWTYPE;
  v_next_question public.story_mode_questions%ROWTYPE;
  v_build_context public.story_mode_level_build_context%ROWTYPE;
  v_build_stage public.story_mode_world_build_stages%ROWTYPE;
  v_attempt_build public.story_mode_attempt_build_progress%ROWTYPE;
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
  v_next_level_checkpoint text;
  v_response jsonb;
  v_updated_rows integer := 0;
BEGIN
  SELECT event.response_payload INTO v_existing_response
  FROM public.story_mode_answer_events event
  JOIN public.story_mode_attempts attempt ON attempt.id = event.attempt_id
  WHERE event.submission_id = p_submission_id AND attempt.user_id = v_user_id;
  IF FOUND THEN RETURN v_existing_response; END IF;

  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;

  SELECT event.response_payload INTO v_existing_response
  FROM public.story_mode_answer_events event
  WHERE event.submission_id = p_submission_id AND event.attempt_id = v_attempt.id;
  IF FOUND THEN RETURN v_existing_response; END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN RAISE EXCEPTION 'Resume Story Mode before answering.'; END IF;

  SELECT question.* INTO v_question
  FROM public.story_mode_attempt_questions selected
  JOIN public.story_mode_questions question ON question.id = selected.question_id
  WHERE selected.attempt_id = v_attempt.id AND selected.question_id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question is not part of this Story Mode attempt.'; END IF;
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
    INSERT INTO public.story_mode_fig_entries (user_id, level_slug, question_id, attempt_id, figs)
    VALUES (
      v_user_id, v_attempt.level_slug, v_question.id, v_attempt.id,
      public.story_mode_fig_value(v_question.difficulty)
    )
    ON CONFLICT (user_id, question_id) DO NOTHING
    RETURNING figs INTO v_figs;
    v_figs := coalesce(v_figs, 0);
  END IF;

  IF v_correct THEN
    UPDATE public.story_mode_attempt_questions
    SET answered_correct = true
    WHERE attempt_id = v_attempt.id AND question_id = v_question.id;
  END IF;

  SELECT stage.* INTO v_build_stage
  FROM public.story_mode_world_build_stages stage
  JOIN public.story_mode_attempt_build_progress build_progress
    ON build_progress.attempt_id = v_attempt.id
    AND build_progress.build_id = stage.build_id
  WHERE stage.trigger_level_slug = v_attempt.level_slug
    AND stage.trigger_pool_id = v_question.pool_id;

  IF FOUND THEN
    SELECT * INTO v_attempt_build
    FROM public.story_mode_attempt_build_progress
    WHERE attempt_id = v_attempt.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The authoritative Story Mode construction state is missing.';
    END IF;

    IF v_correct THEN
      IF v_build_stage.stage_order <> v_attempt_build.stage_order + 1 THEN
        RAISE EXCEPTION 'Story Mode construction stages cannot be skipped or duplicated.';
      END IF;

      UPDATE public.story_mode_attempt_build_progress
      SET stage_order = v_build_stage.stage_order,
          stage_slug = v_build_stage.stage_slug,
          updated_at = now()
      WHERE attempt_id = v_attempt.id
        AND build_id = v_build_stage.build_id
        AND stage_order = v_attempt_build.stage_order;
      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'The Story Mode construction stage changed concurrently.';
      END IF;

      IF NOT v_attempt.is_replay THEN
        UPDATE public.story_mode_user_build_progress progress
        SET stage_order = v_build_stage.stage_order,
            stage_slug = v_build_stage.stage_slug,
            completed_at = CASE
              WHEN v_build_stage.stage_order >= build.total_stages THEN coalesce(progress.completed_at, now())
              ELSE progress.completed_at
            END,
            updated_at = now()
        FROM public.story_mode_world_builds build
        WHERE progress.user_id = v_user_id
          AND progress.build_id = v_build_stage.build_id
          AND build.id = progress.build_id
          AND progress.stage_order = v_attempt_build.stage_order;
        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
        IF v_updated_rows <> 1 THEN
          RAISE EXCEPTION 'The main Story Mode construction state did not advance atomically.';
        END IF;
      END IF;
    END IF;
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

  SELECT * INTO v_build_context
  FROM public.story_mode_level_build_context
  WHERE level_slug = v_attempt.level_slug;
  IF v_level_complete AND FOUND THEN
    SELECT * INTO v_attempt_build
    FROM public.story_mode_attempt_build_progress
    WHERE attempt_id = v_attempt.id
    FOR UPDATE;
    IF NOT FOUND OR v_attempt_build.build_id IS DISTINCT FROM v_build_context.build_id
      OR v_attempt_build.stage_order < v_build_context.ending_stage_order THEN
      RAISE EXCEPTION 'Every mandatory construction milestone must be settled before level completion.';
    END IF;
  END IF;

  SELECT coalesce(sum(entry.figs), 0) INTO v_total_figs
  FROM public.story_mode_fig_entries entry
  WHERE entry.attempt_id = v_attempt.id;

  IF v_level_complete THEN
    UPDATE public.story_mode_attempts SET
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

    INSERT INTO public.story_mode_level_completions (
      user_id, level_slug, correct_count, question_count, figs_earned, denarii_earned
    ) VALUES (
      v_user_id, v_attempt.level_slug, v_correct_count, v_question_count, v_total_figs, 0
    )
    ON CONFLICT (user_id, level_slug) DO UPDATE SET
      last_completed_at = now(),
      times_completed = public.story_mode_level_completions.times_completed + 1,
      correct_count = greatest(public.story_mode_level_completions.correct_count, EXCLUDED.correct_count),
      question_count = greatest(public.story_mode_level_completions.question_count, EXCLUDED.question_count),
      figs_earned = greatest(public.story_mode_level_completions.figs_earned, EXCLUDED.figs_earned),
      denarii_earned = greatest(public.story_mode_level_completions.denarii_earned, EXCLUDED.denarii_earned);

    SELECT * INTO v_level FROM public.story_mode_levels WHERE slug = v_attempt.level_slug;
    SELECT * INTO v_next_level
    FROM public.story_mode_levels next_level
    WHERE next_level.unlock_after_level_slug = v_attempt.level_slug
      AND next_level.is_published = true
    ORDER BY next_level.created_at, next_level.level_order
    LIMIT 1;

    IF v_next_level.slug IS NOT NULL THEN
      SELECT checkpoint.checkpoint_id INTO v_next_level_checkpoint
      FROM public.story_mode_checkpoints checkpoint
      WHERE checkpoint.level_slug = v_next_level.slug
      ORDER BY checkpoint.checkpoint_order LIMIT 1;
    END IF;

    UPDATE public.story_mode_progress SET
      current_book_slug = coalesce(v_next_level.book_slug, v_level.book_slug),
      current_chapter_slug = coalesce(v_next_level.chapter_slug, v_level.chapter_slug),
      current_level_slug = coalesce(v_next_level.slug, v_attempt.level_slug),
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

  SELECT * INTO v_level FROM public.story_mode_levels WHERE slug = v_attempt.level_slug;
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
    'next_question', CASE
      WHEN v_next_question.id IS NULL THEN NULL
      ELSE public.story_mode_question_payload(v_next_question.id)
    END,
    'levels_completed', (
      SELECT count(*) FROM public.story_mode_level_completions completion
      JOIN public.story_mode_levels level ON level.slug = completion.level_slug
      WHERE completion.user_id = v_user_id
        AND level.book_slug = v_level.book_slug
        AND level.chapter_slug = v_level.chapter_slug
    ),
    'build_state', public.story_mode_build_state_payload(v_attempt.id)
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

REVOKE ALL ON FUNCTION public.get_my_story_mode_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_story_mode_level(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_story_mode_progress() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_story_mode_level(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) TO authenticated, service_role;

/* Phase 3D awards no Story Mode Denarii or Marks. The unpublished Flood row is
   progression metadata only; it has no checkpoint, question, scene, or gameplay. */
