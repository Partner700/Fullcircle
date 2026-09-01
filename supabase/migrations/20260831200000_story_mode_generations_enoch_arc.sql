/* Story Mode Phase 3C: Generations, Enoch's canonical transition, and Noah lock. */

ALTER TABLE public.story_mode_canonical_events
  ADD COLUMN IF NOT EXISTS result_action_id text NOT NULL DEFAULT 'character-swap',
  ADD COLUMN IF NOT EXISTS settlement_explanation text NOT NULL DEFAULT '';

ALTER TABLE public.story_mode_canonical_events
  DROP CONSTRAINT IF EXISTS story_mode_canonical_events_event_type_check;

ALTER TABLE public.story_mode_canonical_events
  ADD CONSTRAINT story_mode_canonical_events_event_type_check
  CHECK (event_type IN ('canonical_death', 'canonical_transition', 'character_transition'));

UPDATE public.story_mode_canonical_events
SET result_action_id = CASE
      WHEN id = 'abel-canonical-death' THEN 'canonical-character-exit'
      ELSE 'character-swap'
    END,
    settlement_explanation = CASE
      WHEN id = 'abel-canonical-death' THEN 'Cain killed Abel as Genesis 4:8 records. This canonical death advances the story and is not gameplay failure.'
      WHEN id = 'seth-generational-transition' THEN 'Genesis 4:25 introduces Seth and closes the Brothers chapter.'
      ELSE settlement_explanation
    END
WHERE id IN ('abel-canonical-death', 'seth-generational-transition');

INSERT INTO public.story_mode_levels (
  slug, book_slug, chapter_slug, title, level_order, unlock_after_level_slug, is_published
)
VALUES
  ('seth', 'beginnings', 'generations', 'Seth', 1, 'another-offspring', true),
  ('the-line-continues', 'beginnings', 'generations', 'The Line Continues', 2, 'seth', true),
  ('enoch-walks', 'beginnings', 'generations', 'Enoch Walks', 3, 'the-line-continues', true),
  ('walked-with-god', 'beginnings', 'generations', 'Walked with God', 4, 'enoch-walks', true),
  ('taken', 'beginnings', 'generations', 'Taken', 5, 'walked-with-god', true),
  ('methuselah', 'beginnings', 'generations', 'Methuselah', 6, 'taken', true),
  ('long-years', 'beginnings', 'generations', 'Long Years', 7, 'methuselah', true),
  ('toward-noah', 'beginnings', 'generations', 'Toward Noah', 8, 'long-years', true)
ON CONFLICT (slug) DO UPDATE SET
  book_slug = EXCLUDED.book_slug,
  chapter_slug = EXCLUDED.chapter_slug,
  title = EXCLUDED.title,
  level_order = EXCLUDED.level_order,
  unlock_after_level_slug = EXCLUDED.unlock_after_level_slug,
  is_published = EXCLUDED.is_published;

INSERT INTO public.story_mode_checkpoints (level_slug, checkpoint_id, checkpoint_order, state_hint)
VALUES
  ('seth', 'seth-bridge-start', 0, 'intro'),
  ('seth', 'seth-identity-question', 1, 'question_approach'),
  ('seth', 'seth-appointed-question', 2, 'question_approach'),
  ('seth', 'seth-bridge-complete', 3, 'level_complete'),
  ('the-line-continues', 'line-start', 0, 'intro'),
  ('the-line-continues', 'line-enosh-question', 1, 'question_approach'),
  ('the-line-continues', 'line-sequence-question', 2, 'question_approach'),
  ('the-line-continues', 'line-complete', 3, 'level_complete'),
  ('enoch-walks', 'enoch-walks-start', 0, 'intro'),
  ('enoch-walks', 'enoch-ancestry-question', 1, 'question_approach'),
  ('enoch-walks', 'enoch-methuselah-question', 2, 'question_approach'),
  ('enoch-walks', 'enoch-walks-complete', 3, 'level_complete'),
  ('walked-with-god', 'walked-start', 0, 'intro'),
  ('walked-with-god', 'walked-phrase-question', 1, 'question_approach'),
  ('walked-with-god', 'walked-years-question', 2, 'question_approach'),
  ('walked-with-god', 'walked-total-question', 3, 'question_approach'),
  ('walked-with-god', 'walked-complete', 4, 'level_complete'),
  ('taken', 'taken-start', 0, 'intro'),
  ('taken', 'taken-wording-question', 1, 'question_approach'),
  ('taken', 'taken-distinction-question', 2, 'question_approach'),
  ('taken', 'enoch-taking-event', 3, 'canonical_event'),
  ('taken', 'taken-complete', 4, 'level_complete'),
  ('methuselah', 'methuselah-start', 0, 'intro'),
  ('methuselah', 'methuselah-relation-question', 1, 'question_approach'),
  ('methuselah', 'methuselah-lamech-question', 2, 'question_approach'),
  ('methuselah', 'methuselah-complete', 3, 'level_complete'),
  ('long-years', 'long-years-start', 0, 'intro'),
  ('long-years', 'long-years-total-question', 1, 'question_approach'),
  ('long-years', 'long-years-detail-question', 2, 'question_approach'),
  ('long-years', 'long-years-complete', 3, 'level_complete'),
  ('toward-noah', 'toward-noah-start', 0, 'intro'),
  ('toward-noah', 'toward-noah-lineage-question', 1, 'question_approach'),
  ('toward-noah', 'toward-noah-name-question', 2, 'question_approach'),
  ('toward-noah', 'noah-reveal-event', 3, 'canonical_event'),
  ('toward-noah', 'toward-noah-complete', 4, 'chapter_complete')
ON CONFLICT (level_slug, checkpoint_id) DO UPDATE SET
  checkpoint_order = EXCLUDED.checkpoint_order,
  state_hint = EXCLUDED.state_hint;

INSERT INTO public.story_mode_question_pools (
  level_slug, pool_id, scene_id, checkpoint_id, pool_order, questions_per_attempt
)
VALUES
  ('seth', 'seth-identity-easy', 'seth-identity', 'seth-identity-question', 1, 1),
  ('seth', 'seth-appointed-moderate', 'seth-appointed', 'seth-appointed-question', 2, 1),
  ('the-line-continues', 'line-enosh-easy', 'line-enosh', 'line-enosh-question', 1, 1),
  ('the-line-continues', 'line-sequence-hard', 'line-sequence', 'line-sequence-question', 2, 1),
  ('enoch-walks', 'enoch-ancestry-easy', 'enoch-ancestry', 'enoch-ancestry-question', 1, 1),
  ('enoch-walks', 'enoch-methuselah-moderate', 'enoch-methuselah', 'enoch-methuselah-question', 2, 1),
  ('walked-with-god', 'walked-phrase-easy', 'walked-phrase', 'walked-phrase-question', 1, 1),
  ('walked-with-god', 'walked-years-moderate', 'walked-years', 'walked-years-question', 2, 1),
  ('walked-with-god', 'walked-total-hard', 'walked-total', 'walked-total-question', 3, 1),
  ('taken', 'taken-wording-moderate', 'taken-wording', 'taken-wording-question', 1, 1),
  ('taken', 'taken-distinction-hard', 'taken-distinction', 'taken-distinction-question', 2, 1),
  ('methuselah', 'methuselah-relation-easy', 'methuselah-relation', 'methuselah-relation-question', 1, 1),
  ('methuselah', 'methuselah-lamech-moderate', 'methuselah-lamech', 'methuselah-lamech-question', 2, 1),
  ('long-years', 'long-years-total-moderate', 'long-years-total', 'long-years-total-question', 1, 1),
  ('long-years', 'long-years-detail-hard', 'long-years-detail', 'long-years-detail-question', 2, 1),
  ('toward-noah', 'toward-noah-lineage-easy', 'toward-noah-lineage', 'toward-noah-lineage-question', 1, 1),
  ('toward-noah', 'toward-noah-name-hard', 'toward-noah-name', 'toward-noah-name-question', 2, 1)
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
  ('seth-name-given', 'seth', 'seth-identity-question', 1, 'multiple_choice',
   'What name did Eve give the son born after Abel''s death?', '["Seth", "Enosh", "Jared", "Noah"]'::jsonb,
   'Seth', 'easy', 5, 'Genesis 4:25', 'Eve called the son Seth.', 'seth-observe', 'seth-retry', 'seth-identity-easy', 'seth-identity', false),
  ('seth-after-abel', 'seth', 'seth-identity-question', 2, 'true_false',
   'Seth is introduced after the account of Abel''s death.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 4:25', 'Genesis 4:25 introduces Seth after Abel was killed.', 'seth-observe', 'seth-retry', 'seth-identity-easy', 'seth-identity', false),
  ('seth-appointed-for-abel', 'seth', 'seth-appointed-question', 3, 'multiple_choice',
   'Eve said God appointed another offspring instead of whom?', '["Abel", "Cain", "Enosh", "Jared"]'::jsonb,
   'Abel', 'moderate', 7, 'Genesis 4:25', 'Eve connected Seth with Abel, whom Cain killed.', 'seth-appointed', 'seth-retry', 'seth-appointed-moderate', 'seth-appointed', false),
  ('seth-in-place-of-cain', 'seth', 'seth-appointed-question', 4, 'true_false',
   'Eve said Seth was appointed in place of Cain.', '["True", "False"]'::jsonb,
   'False', 'moderate', 7, 'Genesis 4:25', 'The verse says another offspring instead of Abel.', 'seth-appointed', 'seth-retry', 'seth-appointed-moderate', 'seth-appointed', false),

  ('line-seth-son', 'the-line-continues', 'line-enosh-question', 1, 'multiple_choice',
   'Who was born to Seth according to Genesis 4:26?', '["Enosh", "Jared", "Enoch", "Lamech"]'::jsonb,
   'Enosh', 'easy', 5, 'Genesis 4:26', 'Genesis 4:26 names Enosh as Seth''s son.', 'line-enosh', 'line-retry', 'line-enosh-easy', 'line-enosh', false),
  ('line-call-upon-name', 'the-line-continues', 'line-enosh-question', 2, 'true_false',
   'In Enosh''s period, people began to call upon the name of the Lord.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 4:26', 'Genesis 4:26 records that people began to call upon the name of the Lord.', 'line-enosh', 'line-retry', 'line-enosh-easy', 'line-enosh', false),
  ('line-order-to-enoch', 'the-line-continues', 'line-sequence-question', 3, 'multiple_choice',
   'Which sequence follows the Genesis 5 genealogy toward Enoch?', '["Enosh, Kenan, Mahalalel, Jared, Enoch", "Enosh, Jared, Kenan, Enoch, Mahalalel", "Kenan, Enosh, Jared, Mahalalel, Enoch", "Enosh, Mahalalel, Kenan, Enoch, Jared"]'::jsonb,
   'Enosh, Kenan, Mahalalel, Jared, Enoch', 'hard', 10, 'Genesis 5:6-18', 'Genesis 5 traces the line through Enosh, Kenan, Mahalalel, Jared, and Enoch.', 'line-sequence', 'line-retry', 'line-sequence-hard', 'line-sequence', false),
  ('line-around-jared', 'the-line-continues', 'line-sequence-question', 4, 'multiple_choice',
   'Which two names immediately surround Jared in this genealogy?', '["Mahalalel and Enoch", "Kenan and Methuselah", "Enosh and Noah", "Seth and Lamech"]'::jsonb,
   'Mahalalel and Enoch', 'hard', 10, 'Genesis 5:15-18', 'Mahalalel fathers Jared, and Jared fathers Enoch.', 'line-sequence', 'line-retry', 'line-sequence-hard', 'line-sequence', false),

  ('enoch-jared-son', 'enoch-walks', 'enoch-ancestry-question', 1, 'multiple_choice',
   'Whom did Jared father according to Genesis 5:18?', '["Enoch", "Methuselah", "Lamech", "Noah"]'::jsonb,
   'Enoch', 'easy', 5, 'Genesis 5:18', 'Genesis 5:18 says Jared fathered Enoch.', 'enoch-ancestry', 'enoch-retry', 'enoch-ancestry-easy', 'enoch-ancestry', false),
  ('enoch-jared-age', 'enoch-walks', 'enoch-ancestry-question', 2, 'true_false',
   'Jared was one hundred sixty-two years old when he fathered Enoch.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 5:18', 'The genealogy gives Jared''s age as one hundred sixty-two.', 'enoch-ancestry', 'enoch-retry', 'enoch-ancestry-easy', 'enoch-ancestry', false),
  ('enoch-age-at-methuselah', 'enoch-walks', 'enoch-methuselah-question', 3, 'multiple_choice',
   'How old was Enoch when he fathered Methuselah?', '["65", "162", "187", "365"]'::jsonb,
   '65', 'moderate', 7, 'Genesis 5:21', 'Enoch was sixty-five when he fathered Methuselah.', 'enoch-methuselah', 'enoch-retry', 'enoch-methuselah-moderate', 'enoch-methuselah', false),
  ('enoch-methuselah-direction', 'enoch-walks', 'enoch-methuselah-question', 4, 'true_false',
   'Methuselah was Enoch''s father.', '["True", "False"]'::jsonb,
   'False', 'moderate', 7, 'Genesis 5:21', 'Methuselah was Enoch''s son.', 'enoch-methuselah', 'enoch-retry', 'enoch-methuselah-moderate', 'enoch-methuselah', false),

  ('walked-central-phrase', 'walked-with-god', 'walked-phrase-question', 1, 'multiple_choice',
   'Which phrase does Genesis 5 repeat about Enoch?', '["Enoch walked with God", "Enoch built a city", "Enoch ruled the generations", "Enoch gathered the nations"]'::jsonb,
   'Enoch walked with God', 'easy', 5, 'Genesis 5:22, 24', 'Genesis 5:22 and 5:24 say Enoch walked with God.', 'walked-phrase', 'walked-retry', 'walked-phrase-easy', 'walked-phrase', true),
  ('walked-phrase-repeated', 'walked-with-god', 'walked-phrase-question', 2, 'true_false',
   'Genesis 5:24 again says that Enoch walked with God.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 5:24', 'The phrase appears again immediately before Enoch''s canonical transition.', 'walked-phrase', 'walked-retry', 'walked-phrase-easy', 'walked-phrase', true),
  ('walked-three-hundred', 'walked-with-god', 'walked-years-question', 3, 'multiple_choice',
   'How many years did Enoch walk with God after fathering Methuselah?', '["300", "365", "187", "782"]'::jsonb,
   '300', 'moderate', 7, 'Genesis 5:22', 'Enoch walked with God three hundred years after Methuselah''s birth.', 'walked-years', 'walked-retry', 'walked-years-moderate', 'walked-years', true),
  ('walked-after-which-birth', 'walked-with-god', 'walked-years-question', 4, 'multiple_choice',
   'After whose birth does the passage measure Enoch''s three-hundred-year walk?', '["Methuselah''s", "Jared''s", "Lamech''s", "Noah''s"]'::jsonb,
   'Methuselah''s', 'moderate', 7, 'Genesis 5:21-22', 'The three hundred years follow Enoch''s fathering of Methuselah.', 'walked-years', 'walked-retry', 'walked-years-moderate', 'walked-years', true),
  ('walked-total-years', 'walked-with-god', 'walked-total-question', 5, 'multiple_choice',
   'How many years are given as all the days of Enoch?', '["365", "300", "969", "777"]'::jsonb,
   '365', 'hard', 10, 'Genesis 5:23', 'All the days of Enoch were three hundred sixty-five years.', 'walked-total', 'walked-retry', 'walked-total-hard', 'walked-total', true),
  ('walked-three-hundred-total', 'walked-with-god', 'walked-total-question', 6, 'true_false',
   'The three hundred years after Methuselah''s birth were Enoch''s entire lifespan.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 5:21-23', 'Enoch''s total was three hundred sixty-five years, not three hundred.', 'walked-total', 'walked-retry', 'walked-total-hard', 'walked-total', true),

  ('taken-who-took-enoch', 'taken', 'taken-wording-question', 1, 'multiple_choice',
   'Who does Genesis 5:24 say took Enoch?', '["God", "Jared", "Methuselah", "The generations"]'::jsonb,
   'God', 'moderate', 7, 'Genesis 5:24', 'Genesis 5:24 says God took Enoch.', 'taken-wording', 'taken-retry', 'taken-wording-moderate', 'taken-wording', false),
  ('taken-was-not', 'taken', 'taken-wording-question', 2, 'true_false',
   'Genesis 5:24 says Enoch was not, for God took him.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 5:24', 'This is the restrained wording of Enoch''s canonical transition.', 'taken-wording', 'taken-retry', 'taken-wording-moderate', 'taken-wording', false),
  ('taken-distinct-ending', 'taken', 'taken-distinction-question', 3, 'multiple_choice',
   'Which ending belongs specifically to Enoch in Genesis 5?', '["He was not, for God took him", "He built an ark", "He became a fugitive", "He named the city after his son"]'::jsonb,
   'He was not, for God took him', 'hard', 10, 'Genesis 5:24', 'Enoch''s entry closes with the statement that God took him.', 'taken-distinction', 'taken-retry', 'taken-distinction-hard', 'taken-distinction', false),
  ('taken-same-closing-formula', 'taken', 'taken-distinction-question', 4, 'true_false',
   'Enoch''s entry closes with the same death formula used for every surrounding patriarch.', '["True", "False"]'::jsonb,
   'False', 'hard', 10, 'Genesis 5:23-24', 'Enoch''s entry instead says he was not, for God took him.', 'taken-distinction', 'taken-retry', 'taken-distinction-hard', 'taken-distinction', false),

  ('methuselah-between', 'methuselah', 'methuselah-relation-question', 1, 'multiple_choice',
   'Which relationship chain places Methuselah correctly?', '["Enoch''s son and Lamech''s father", "Jared''s father and Noah''s son", "Lamech''s son and Enoch''s father", "Noah''s father and Seth''s son"]'::jsonb,
   'Enoch''s son and Lamech''s father', 'easy', 5, 'Genesis 5:21, 25', 'Methuselah is Enoch''s son and Lamech''s father.', 'methuselah-relation', 'methuselah-retry', 'methuselah-relation-easy', 'methuselah-relation', false),
  ('methuselah-fathered-lamech', 'methuselah', 'methuselah-relation-question', 2, 'true_false',
   'Methuselah fathered Lamech.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 5:25', 'Genesis 5:25 says Methuselah fathered Lamech.', 'methuselah-relation', 'methuselah-retry', 'methuselah-relation-easy', 'methuselah-relation', false),
  ('methuselah-age-at-lamech', 'methuselah', 'methuselah-lamech-question', 3, 'multiple_choice',
   'How old was Methuselah when he fathered Lamech?', '["187", "182", "65", "162"]'::jsonb,
   '187', 'moderate', 7, 'Genesis 5:25', 'Methuselah was one hundred eighty-seven when he fathered Lamech.', 'methuselah-lamech', 'methuselah-retry', 'methuselah-lamech-moderate', 'methuselah-lamech', false),
  ('methuselah-years-after-lamech', 'methuselah', 'methuselah-lamech-question', 4, 'true_false',
   'After fathering Lamech, Methuselah lived seven hundred eighty-two years.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 5:26', 'Genesis 5:26 gives seven hundred eighty-two further years.', 'methuselah-lamech', 'methuselah-retry', 'methuselah-lamech-moderate', 'methuselah-lamech', false),

  ('long-years-total', 'long-years', 'long-years-total-question', 1, 'multiple_choice',
   'What total lifespan does Genesis 5:27 give Methuselah?', '["969 years", "365 years", "777 years", "950 years"]'::jsonb,
   '969 years', 'moderate', 7, 'Genesis 5:27', 'All the days of Methuselah were nine hundred sixty-nine years.', 'long-years-total', 'long-years-retry', 'long-years-total-moderate', 'long-years-total', false),
  ('long-years-after-greater', 'long-years', 'long-years-total-question', 2, 'true_false',
   'Methuselah lived more years after Lamech''s birth than before it.', '["True", "False"]'::jsonb,
   'True', 'moderate', 7, 'Genesis 5:25-27', 'Seven hundred eighty-two years after is greater than one hundred eighty-seven years before.', 'long-years-total', 'long-years-retry', 'long-years-total-moderate', 'long-years-total', false),
  ('long-years-figures', 'long-years', 'long-years-detail-question', 3, 'multiple_choice',
   'Which pair gives Methuselah''s age at Lamech''s birth and his years afterward?', '["187 and 782", "182 and 595", "65 and 300", "162 and 800"]'::jsonb,
   '187 and 782', 'hard', 10, 'Genesis 5:25-26', 'The passage gives one hundred eighty-seven years, followed by seven hundred eighty-two years.', 'long-years-detail', 'long-years-retry', 'long-years-detail-hard', 'long-years-detail', false),
  ('long-years-meaning-of-969', 'long-years', 'long-years-detail-question', 4, 'multiple_choice',
   'What does the number 969 represent in Methuselah''s account?', '["His total years", "His age when Lamech was born", "His years after Lamech was born", "The number of named generations"]'::jsonb,
   'His total years', 'hard', 10, 'Genesis 5:27', 'Nine hundred sixty-nine is Methuselah''s total lifespan in the genealogy.', 'long-years-detail', 'long-years-retry', 'long-years-detail-hard', 'long-years-detail', false),

  ('toward-noah-father', 'toward-noah', 'toward-noah-lineage-question', 1, 'multiple_choice',
   'Who was Noah''s father in Genesis 5?', '["Lamech", "Methuselah", "Enoch", "Jared"]'::jsonb,
   'Lamech', 'easy', 5, 'Genesis 5:28-29', 'Lamech fathered and named Noah.', 'toward-noah-lineage', 'toward-noah-retry', 'toward-noah-lineage-easy', 'toward-noah-lineage', false),
  ('toward-noah-grandfather', 'toward-noah', 'toward-noah-lineage-question', 2, 'true_false',
   'Methuselah was Noah''s grandfather.', '["True", "False"]'::jsonb,
   'True', 'easy', 5, 'Genesis 5:25, 28', 'Methuselah fathered Lamech, and Lamech fathered Noah.', 'toward-noah-lineage', 'toward-noah-retry', 'toward-noah-lineage-easy', 'toward-noah-lineage', false),
  ('toward-noah-name', 'toward-noah', 'toward-noah-name-question', 3, 'multiple_choice',
   'What name did Lamech give his son?', '["Noah", "Enoch", "Enosh", "Seth"]'::jsonb,
   'Noah', 'hard', 10, 'Genesis 5:28-29', 'Lamech called his son Noah.', 'toward-noah-name', 'toward-noah-retry', 'toward-noah-name-hard', 'toward-noah-name', false),
  ('toward-noah-relief', 'toward-noah', 'toward-noah-name-question', 4, 'multiple_choice',
   'What hope did Lamech state when naming Noah?', '["Relief from work and painful toil", "Victory over a foreign army", "A city beyond the garden", "A new offering from the flock"]'::jsonb,
   'Relief from work and painful toil', 'hard', 10, 'Genesis 5:29', 'Lamech spoke of relief from work and painful toil because of the ground.', 'toward-noah-name', 'toward-noah-retry', 'toward-noah-name-hard', 'toward-noah-name', false)
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

INSERT INTO public.story_mode_canonical_events (
  id, level_slug, checkpoint_id, completion_checkpoint_id, event_type,
  event_order, scripture_reference, completes_chapter, result_action_id, settlement_explanation
)
VALUES
  ('enoch-canonical-taking', 'taken', 'enoch-taking-event', 'taken-complete', 'canonical_transition',
   1, 'Genesis 5:24', false, 'canonical-character-transition',
   'Genesis 5:24 records that Enoch walked with God and was not, for God took him. This canonical transition advances the story and is not gameplay failure.'),
  ('noah-generational-reveal', 'toward-noah', 'noah-reveal-event', 'toward-noah-complete', 'character_transition',
   1, 'Genesis 5:28-29', true, 'character-swap',
   'Genesis 5:28-29 introduces Noah by name and closes Generations without beginning Noah gameplay.')
ON CONFLICT (id) DO UPDATE SET
  level_slug = EXCLUDED.level_slug,
  checkpoint_id = EXCLUDED.checkpoint_id,
  completion_checkpoint_id = EXCLUDED.completion_checkpoint_id,
  event_type = EXCLUDED.event_type,
  event_order = EXCLUDED.event_order,
  scripture_reference = EXCLUDED.scripture_reference,
  completes_chapter = EXCLUDED.completes_chapter,
  result_action_id = EXCLUDED.result_action_id,
  settlement_explanation = EXCLUDED.settlement_explanation;

/* Existing Chapter 1 completers continue directly into Seth. */
UPDATE public.story_mode_progress progress
SET current_book_slug = 'beginnings',
    current_chapter_slug = 'generations',
    current_level_slug = 'seth',
    checkpoint_id = 'seth-bridge-start',
    updated_at = now()
WHERE EXISTS (
    SELECT 1 FROM public.story_mode_level_completions completion
    WHERE completion.user_id = progress.user_id AND completion.level_slug = 'another-offspring'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.story_mode_level_completions completion
    WHERE completion.user_id = progress.user_id AND completion.level_slug = 'seth'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.story_mode_attempts attempt
    WHERE attempt.user_id = progress.user_id AND attempt.status = 'in_progress'
  );

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
      'unlocked', level.unlock_after_level_slug IS NULL OR EXISTS (
        SELECT 1 FROM public.story_mode_level_completions prerequisite
        WHERE prerequisite.user_id = v_user_id
          AND prerequisite.level_slug = level.unlock_after_level_slug
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
      WHERE completion.user_id = v_user_id
        AND level.book_slug = 'beginnings' AND level.is_published = true
    ),
    'total_level_count', (
      SELECT count(*) FROM public.story_mode_levels
      WHERE book_slug = 'beginnings' AND is_published = true
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

CREATE OR REPLACE FUNCTION public.reach_story_mode_canonical_event(
  p_attempt_id uuid,
  p_event_id text
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
  v_event public.story_mode_canonical_events%ROWTYPE;
  v_current_order integer;
  v_event_order integer;
BEGIN
  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;
  IF v_attempt.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'Resume Story Mode before reaching a canonical transition.';
  END IF;

  SELECT * INTO v_event
  FROM public.story_mode_canonical_events
  WHERE id = p_event_id AND level_slug = v_attempt.level_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This canonical transition is not part of the active Story Mode level.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.story_mode_attempt_questions selected
    WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
  ) THEN
    RAISE EXCEPTION 'Complete the server-selected questions before the canonical transition.';
  END IF;

  SELECT checkpoint_order INTO v_current_order
  FROM public.story_mode_checkpoints
  WHERE level_slug = v_attempt.level_slug AND checkpoint_id = v_attempt.checkpoint_id;
  SELECT checkpoint_order INTO v_event_order
  FROM public.story_mode_checkpoints
  WHERE level_slug = v_attempt.level_slug AND checkpoint_id = v_event.checkpoint_id;

  IF v_current_order IS NULL OR v_event_order IS NULL
    OR (v_attempt.checkpoint_id IS DISTINCT FROM v_event.checkpoint_id AND v_current_order + 1 <> v_event_order) THEN
    RAISE EXCEPTION 'The canonical transition cannot be skipped or reached out of order.';
  END IF;

  IF v_attempt.checkpoint_id IS DISTINCT FROM v_event.checkpoint_id THEN
    UPDATE public.story_mode_attempts
    SET checkpoint_id = v_event.checkpoint_id, updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.story_mode_progress
    SET checkpoint_id = v_event.checkpoint_id, updated_at = now()
    WHERE user_id = v_user_id AND NOT v_attempt.is_replay;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'event_id', v_event.id,
    'checkpoint_id', v_event.checkpoint_id,
    'reached_at', now()
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
  v_next_level public.story_mode_levels%ROWTYPE;
  v_event public.story_mode_canonical_events%ROWTYPE;
  v_existing_response jsonb;
  v_question_count integer := 0;
  v_correct_count integer := 0;
  v_total_figs integer := 0;
  v_chapter_figs integer := 0;
  v_chapter_questions integer := 0;
  v_chapter_correct integer := 0;
  v_levels_completed integer := 0;
  v_next_level_checkpoint text;
  v_response jsonb;
BEGIN
  SELECT settlement.response_payload INTO v_existing_response
  FROM public.story_mode_event_settlements settlement
  JOIN public.story_mode_attempts attempt ON attempt.id = settlement.attempt_id
  WHERE attempt.user_id = v_user_id
    AND (
      settlement.submission_id = p_submission_id
      OR (settlement.attempt_id = p_attempt_id AND settlement.event_id = p_event_id)
    );
  IF FOUND THEN RETURN v_existing_response; END IF;

  SELECT * INTO v_attempt
  FROM public.story_mode_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id IS DISTINCT FROM v_user_id OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This Story Mode attempt is not active for your account.';
  END IF;

  SELECT settlement.response_payload INTO v_existing_response
  FROM public.story_mode_event_settlements settlement
  WHERE settlement.attempt_id = v_attempt.id AND settlement.event_id = p_event_id;
  IF FOUND THEN RETURN v_existing_response; END IF;

  SELECT * INTO v_event
  FROM public.story_mode_canonical_events
  WHERE id = p_event_id AND level_slug = v_attempt.level_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This canonical transition is not part of the active Story Mode level.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.story_mode_attempt_questions selected
    WHERE selected.attempt_id = v_attempt.id AND selected.answered_correct = false
  ) THEN
    RAISE EXCEPTION 'Complete the server-selected questions before the canonical transition.';
  END IF;
  IF v_attempt.checkpoint_id IS DISTINCT FROM v_event.checkpoint_id THEN
    RAISE EXCEPTION 'The canonical transition cannot be skipped or reached out of order.';
  END IF;

  SELECT count(*) FILTER (WHERE selected.answered_correct), count(*)
  INTO v_correct_count, v_question_count
  FROM public.story_mode_attempt_questions selected
  WHERE selected.attempt_id = v_attempt.id;

  SELECT coalesce(sum(entry.figs), 0) INTO v_total_figs
  FROM public.story_mode_fig_entries entry
  WHERE entry.attempt_id = v_attempt.id;

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

  SELECT * INTO v_level
  FROM public.story_mode_levels
  WHERE slug = v_attempt.level_slug;

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

  IF v_event.completes_chapter THEN
    INSERT INTO public.story_mode_chapter_completions (
      user_id, book_slug, chapter_slug
    ) VALUES (
      v_user_id, v_level.book_slug, v_level.chapter_slug
    )
    ON CONFLICT (user_id, book_slug, chapter_slug) DO UPDATE SET
      last_completed_at = now(),
      times_completed = public.story_mode_chapter_completions.times_completed + 1;
  END IF;

  UPDATE public.story_mode_progress SET
    current_book_slug = coalesce(v_next_level.book_slug, v_level.book_slug),
    current_chapter_slug = coalesce(v_next_level.chapter_slug, v_level.chapter_slug),
    current_level_slug = coalesce(v_next_level.slug, v_attempt.level_slug),
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
    AND level.book_slug = v_level.book_slug
    AND level.chapter_slug = v_level.chapter_slug;

  SELECT coalesce(sum(entry.figs), 0) INTO v_chapter_figs
  FROM public.story_mode_fig_entries entry
  JOIN public.story_mode_levels level ON level.slug = entry.level_slug
  WHERE entry.user_id = v_user_id
    AND level.book_slug = v_level.book_slug
    AND level.chapter_slug = v_level.chapter_slug;

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
      ELSE round((
        (CASE WHEN v_event.completes_chapter THEN v_chapter_correct ELSE v_correct_count END)::numeric
        / (CASE WHEN v_event.completes_chapter THEN v_chapter_questions ELSE v_question_count END)::numeric
      ) * 100)
    END,
    'level_complete', true,
    'chapter_complete', v_event.completes_chapter,
    'canonical_event_pending', false,
    'canonical_event_id', v_event.id,
    'checkpoint_id', v_event.completion_checkpoint_id,
    'action_id', v_event.result_action_id,
    'explanation', v_event.settlement_explanation,
    'replay', v_attempt.is_replay,
    'next_question', NULL,
    'levels_completed', v_levels_completed
  );

  INSERT INTO public.story_mode_event_settlements (
    attempt_id, event_id, submission_id, response_payload
  ) VALUES (
    v_attempt.id, v_event.id, p_submission_id, v_response
  );
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_story_mode_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reach_story_mode_canonical_event(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_story_mode_canonical_event(uuid, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_story_mode_progress() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reach_story_mode_canonical_event(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_story_mode_answer(uuid, text, text, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_story_mode_canonical_event(uuid, text, uuid) TO authenticated, service_role;

/* Phase 3C awards no Story Mode Denarii or Marks. Figs remain first-correct,
   first-play only through the existing user/question uniqueness boundary. */
