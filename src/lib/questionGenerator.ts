import type { GameSeedData, QuestionPayload, DailyNarrative } from './types';

type Difficulty = 'easy' | 'moderate' | 'hard';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

function makeDistractors<T>(correct: T, pool: T[], count: number): T[] {
  const wrong = shuffle(pool.filter((x) => x !== correct));
  return wrong.slice(0, count);
}

function makeMultipleChoice(
  question: string,
  correct: string,
  distractorPool: string[],
  reference?: string,
): QuestionPayload {
  const distractors = makeDistractors(correct, distractorPool, 3);
  const options = shuffle([correct, ...distractors]);
  return {
    type: 'multiple_choice',
    question,
    options,
    correct_answer: correct,
    reference,
  };
}

function makeTrueFalse(question: string, correct: boolean, reference?: string): QuestionPayload {
  return {
    type: 'true_false',
    question,
    options: ['True', 'False'],
    correct_answer: correct ? 'True' : 'False',
    reference,
  };
}

function makeOrderSequence(items: string[], question: string, reference?: string): QuestionPayload {
  return {
    type: 'order_sequence',
    question,
    items,
    correct_answer: items.join('|'),
    reference,
  };
}

function makeSpotError(correctText: string, errorText: string, reference?: string): QuestionPayload {
  return {
    type: 'spot_error',
    question: 'Find the error in this passage. Select the option that contains the mistake.',
    options: [
      'The passage is entirely correct.',
      correctText.slice(0, 60) + '...',
      errorText.slice(0, 60) + '...',
      'The reference is wrong.',
    ],
    correct_answer: errorText.slice(0, 60) + '...',
    explanation: 'The passage contains a deliberate error. Compare carefully with the original scripture.',
    reference,
  };
}

function makeScriptorium(verse: { reference: string; text: string }): QuestionPayload {
  const words = verse.text.split(' ');
  const blanked = words
    .map((w) => {
      const letters = w.replace(/[^a-zA-Z]/g, '');
      if (letters.length <= 2) return w;
      const first = w[0];
      const rest = w.slice(1).replace(/[a-zA-Z]/g, '_');
      return first + rest;
    })
    .join(' ');
  return {
    type: 'scriptorium',
    question: `Type the verse from memory. Reference: ${verse.reference}`,
    correct_answer: verse.text,
    blanked_text: blanked,
    reference: verse.reference,
  };
}

function passageExcerpt(text: string | undefined, max = 260): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > max ? `${cleaned.slice(0, max).trim()}...` : cleaned;
}

function carefulQuestionSet(narrative: DailyNarrative): { source_date: string; difficulty: Difficulty; mechanic: string; payload: QuestionPayload; recycled: boolean }[] {
  const seed = narrative.game_seed_data || {};
  const passage = passageExcerpt(narrative.main_text || seed.passage || seed.key_verse?.text);
  const terms = seed.term_facts || [];
  const plots = seed.plot_points || [];
  const chars = seed.characters || [];
  const refs = seed.cross_reference_anchors || [];
  const out: { source_date: string; difficulty: Difficulty; mechanic: string; payload: QuestionPayload; recycled: boolean }[] = [];

  if (seed.key_verse) {
    out.push({
      source_date: narrative.narrative_date,
      difficulty: 'moderate',
      mechanic: 'key_verse_careful_reading',
      payload: {
        ...makeMultipleChoice(
          `Which line best preserves the key verse without changing its meaning?`,
          seed.key_verse.text,
          [
            `A similar thought, but not the wording of ${seed.key_verse.reference}`,
            'A command that sounds biblical but is not the key verse',
            'A summary that removes the main emphasis',
          ],
          seed.key_verse.reference,
        ),
        passage,
        explanation: 'This asks for careful recognition of the actual wording and emphasis of the key verse.',
      },
      recycled: false,
    });
  }

  if (terms.length > 0) {
    const term = terms[0];
    out.push({
      source_date: narrative.narrative_date,
      difficulty: 'hard',
      mechanic: 'term_significance',
      payload: makeMultipleChoice(
        `Why is "${term.term}" important in this passage?`,
        term.fact,
        terms.slice(1).map((item) => item.fact).concat([
          'It is only decorative and carries no meaning here',
          'It contradicts the main theme of the passage',
          'It belongs to another part of Scripture entirely',
        ]),
        seed.key_verse?.reference || narrative.scripture_reference,
      ),
      recycled: false,
    });
  }

  if (plots.length >= 3) {
    out.push({
      source_date: narrative.narrative_date,
      difficulty: 'hard',
      mechanic: 'sequence_inference',
      payload: makeMultipleChoice(
        `Which detail must be noticed before the next event makes sense?`,
        plots[1],
        [plots[0], plots[2], ...(chars.length ? [chars[0]] : []), narrative.theme].filter(Boolean),
        narrative.scripture_reference,
      ),
      recycled: false,
    });
  }

  if (chars.length > 0 && plots.length > 0) {
    out.push({
      source_date: narrative.narrative_date,
      difficulty: 'moderate',
      mechanic: 'character_motive',
      payload: makeMultipleChoice(
        `Which observation best fits ${chars[0]}'s role in the passage?`,
        plots[0],
        [...plots.slice(1), ...(seed.objects || []), narrative.theme].filter(Boolean),
        narrative.scripture_reference,
      ),
      recycled: false,
    });
  }

  if (refs.length > 0) {
    out.push({
      source_date: narrative.narrative_date,
      difficulty: 'hard',
      mechanic: 'cross_reference_reasoning',
      payload: makeMultipleChoice(
        `Which cross-reference most naturally strengthens the theme "${narrative.theme}"?`,
        refs[0],
        [...refs.slice(1), 'Genesis 1:1', 'Revelation 22:21'],
        refs[0],
      ),
      recycled: false,
    });
  }

  if (passage) {
    out.push({
      source_date: narrative.narrative_date,
      difficulty: 'hard',
      mechanic: 'written_careful_answer',
      payload: {
        type: 'standard_text',
        question: `In one exact phrase, what central idea should a careful reader not miss?`,
        passage,
        correct_answer: narrative.theme,
        reference: narrative.scripture_reference,
        explanation: 'Written answers are case-sensitive for proper names and titles.',
      },
      recycled: false,
    });
  }

  return out;
}

export function generateDailyGameQuestions(
  seed: GameSeedData,
  level: number,
): { mechanic: string; payload: QuestionPayload } {
  const chars = seed.characters || [];
  const objects = seed.objects || [];
  const actions = seed.actions || [];
  const plots = seed.plot_points || [];
  const refs = seed.cross_reference_anchors || [];
  const keyVerse = seed.key_verse;
  const milestone = seed.milestone_verse;
  const errorSource = seed.error_paragraph_source;
  const mapRef = seed.map_or_tree_reference;

  switch (level) {
    case 1: {
      if (chars.length > 0) {
        return {
          mechanic: 'character_identification',
          payload: makeMultipleChoice(
            `Who is mentioned in today's reading?`,
            chars[0],
            [...chars.slice(1), ...objects, ...actions],
            keyVerse?.reference,
          ),
        };
      }
      return {
        mechanic: 'true_false',
        payload: makeTrueFalse(`Today's reading is from ${keyVerse?.reference || 'scripture'}.`, true),
      };
    }
    case 2: {
      if (keyVerse) {
        const verseWords = keyVerse.text.split(' ');
        const blankedWord = verseWords.find((w: string) => w.replace(/[^a-zA-Z]/g, '').length > 3) || '';
        return {
          mechanic: 'fill_blank_key_verse',
          payload: makeMultipleChoice(
            `Complete the key verse (${keyVerse.reference}): "...${keyVerse.text.replace(blankedWord, '_____')}..."`,
            blankedWord,
            verseWords.filter((w: string) => w !== blankedWord),
            keyVerse.reference,
          ),
        };
      }
      return {
        mechanic: 'multiple_choice',
        payload: makeMultipleChoice('What is the main theme of today\'s reading?', 'Faithfulness', ['Power', 'Wealth', 'Pride']),
      };
    }
    case 3: {
      if (chars.length >= 2) {
        return {
          mechanic: 'character_action',
          payload: makeMultipleChoice(
            `In today's reading, what is ${chars[0]} doing?`,
            actions[0] || 'Following',
            [...actions.slice(1), ...chars.slice(1)],
          ),
        };
      }
      return {
        mechanic: 'object_identification',
        payload: makeMultipleChoice(`Which object appears in the reading?`, objects[0] || 'boat', [...objects.slice(1), ...chars]),
      };
    }
    case 4: {
      if (plots.length >= 2) {
        const firstTwo = [plots[0], plots[1]];
        return {
          mechanic: 'plot_order',
          payload: makeOrderSequence(firstTwo, 'Which event happened first in today\'s reading?', keyVerse?.reference),
        };
      }
      return {
        mechanic: 'multiple_choice',
        payload: makeMultipleChoice('What happens in today\'s reading?', plots[0] || 'A miracle occurs', plots.slice(1)),
      };
    }
    case 5: {
      if (mapRef) {
        return {
          mechanic: 'geography',
          payload: makeMultipleChoice(
            `Where does today's reading take place?`,
            mapRef,
            ['Jerusalem', 'Bethlehem', 'Nazareth', 'Emmaus'].filter((x) => x !== mapRef),
          ),
        };
      }
      return {
        mechanic: 'multiple_choice',
        payload: makeMultipleChoice('What is the setting of today\'s reading?', 'By the sea', ['In the temple', 'On a mountain', 'In a garden']),
      };
    }
    case 6: {
      if (plots.length >= 3) {
        const correct = plots[1];
        return {
          mechanic: 'plot_detail',
          payload: makeMultipleChoice(
            `What happens after "${plots[0]}"?`,
            correct,
            plots.filter((p: string) => p !== correct),
          ),
        };
      }
      return {
        mechanic: 'true_false',
        payload: makeTrueFalse(`The key verse says: "${keyVerse?.text}"`, true, keyVerse?.reference),
      };
    }
    case 7: {
      if (errorSource) {
        const correctText = keyVerse?.text || plots[0] || '';
        return {
          mechanic: 'spot_error',
          payload: makeSpotError(correctText, errorSource, keyVerse?.reference),
        };
      }
      return {
        mechanic: 'hard_multiple_choice',
        payload: makeMultipleChoice(`What is the deeper meaning of today's reading?`, 'Faith requires surrender', ['Faith requires nothing', 'Faith is optional', 'Faith is inherited']),
      };
    }
    case 8: {
      if (refs.length > 0) {
        return {
          mechanic: 'cross_reference',
          payload: makeMultipleChoice(
            `Which cross-reference relates to today's reading?`,
            refs[0],
            [...refs.slice(1), 'Genesis 1:1', 'Revelation 22:21'],
            refs[0],
          ),
        };
      }
      return {
        mechanic: 'hard_multiple_choice',
        payload: makeMultipleChoice('What does the key verse teach us?', keyVerse?.text.slice(0, 30) || 'Trust in God', ['Self-reliance', 'Pride', 'Indifference']),
      };
    }
    case 9: {
      if (refs.length >= 2) {
        return {
          mechanic: 'cross_reference_detail',
          payload: makeMultipleChoice(
            `Today's reading connects to which of these passages?`,
            refs[0],
            refs.slice(1),
            refs[0],
          ),
        };
      }
      return {
        mechanic: 'true_false',
        payload: makeTrueFalse(`"${keyVerse?.text}" is the key verse from today's reading.`, true, keyVerse?.reference),
      };
    }
    case 10: {
      const verse = milestone || keyVerse;
      if (verse) {
        return {
          mechanic: 'scriptorium',
          payload: makeScriptorium(verse),
        };
      }
      return {
        mechanic: 'fill_blank',
        payload: makeMultipleChoice('What is the final word of the key verse?', 'faith', ['hope', 'love', 'peace']),
      };
    }
    default:
      return {
        mechanic: 'multiple_choice',
        payload: makeMultipleChoice('Review question', 'Correct', ['Wrong 1', 'Wrong 2', 'Wrong 3']),
      };
  }
}

export function generateQuizQuestions(
  narratives: DailyNarrative[],
  existingGameQuestions?: { mechanic: string; payload: QuestionPayload }[],
): { source_date: string; difficulty: Difficulty; mechanic: string; payload: QuestionPayload; recycled: boolean }[] {
  const questions: { source_date: string; difficulty: Difficulty; mechanic: string; payload: QuestionPayload; recycled: boolean }[] = [];

  const allSeeds = narratives.map((n) => ({ date: n.narrative_date, seed: n.game_seed_data }));

  for (const narrative of narratives) {
    questions.push(...carefulQuestionSet(narrative));
  }

  for (const { date, seed } of allSeeds) {
    if (seed.key_verse) {
      questions.push({
        source_date: date,
        difficulty: 'moderate',
        mechanic: 'key_verse_mc',
        payload: makeMultipleChoice(
          `Which wording belongs to the key verse?`,
          seed.key_verse.text.slice(0, 50),
          ['A different teaching', 'An unrelated command', 'A historical fact'],
          seed.key_verse.reference,
        ),
        recycled: false,
      });
    }
    if (seed.characters && seed.characters.length > 0) {
      questions.push({
        source_date: date,
        difficulty: 'easy',
        mechanic: 'character_mc',
        payload: makeMultipleChoice(
          `Who is a central figure in this passage?`,
          seed.characters[0],
          [...(seed.characters || []).slice(1), ...(seed.objects || [])],
        ),
        recycled: false,
      });
    }
    if (seed.plot_points && seed.plot_points.length >= 2) {
      questions.push({
        source_date: date,
        difficulty: 'hard',
        mechanic: 'plot_order',
        payload: makeOrderSequence(
          [seed.plot_points[0], seed.plot_points[1]],
          `Which event came first in the passage?`,
        ),
        recycled: false,
      });
    }
    if (seed.cross_reference_anchors && seed.cross_reference_anchors.length > 0) {
      questions.push({
        source_date: date,
        difficulty: 'hard',
        mechanic: 'cross_ref',
        payload: makeMultipleChoice(
          `Which passage is the strongest cross-reference here?`,
          seed.cross_reference_anchors[0],
          [...seed.cross_reference_anchors.slice(1), 'Genesis 1:1', 'Revelation 22:21'],
          seed.cross_reference_anchors[0],
        ),
        recycled: false,
      });
    }
  }

  if (existingGameQuestions && existingGameQuestions.length > 0) {
    const recycled = pick(existingGameQuestions, 2);
    for (const rq of recycled) {
      const original = rq.payload;
      if (original.type === 'multiple_choice' && original.options) {
        const harderOptions = shuffle(original.options);
        questions.push({
          source_date: 'recycled',
          difficulty: 'hard',
          mechanic: rq.mechanic + '_harder',
          payload: { ...original, options: harderOptions, question: original.question + ' (Higher difficulty)' },
          recycled: true,
        });
      }
    }
  }

  const milestoneVerses = allSeeds
    .filter((s) => s.seed.milestone_verse)
    .sort((a, b) => {
      const aDate = new Date(a.date);
      const bDate = new Date(b.date);
      const aDow = aDate.getDay();
      const bDow = bDate.getDay();
      const priority = (dow: number) => (dow === 1 ? 0 : dow === 5 ? 1 : 2);
      return priority(aDow) - priority(bDow);
    });

  if (milestoneVerses.length > 0) {
    const v = milestoneVerses[0].seed.milestone_verse!;
    questions.push({
      source_date: milestoneVerses[0].date,
      difficulty: 'hard',
      mechanic: 'scriptorium',
      payload: makeScriptorium(v),
      recycled: false,
    });
  }

  const easy = shuffle(questions.filter((q) => q.difficulty === 'easy'));
  const moderate = shuffle(questions.filter((q) => q.difficulty === 'moderate'));
  const hard = shuffle(questions.filter((q) => q.difficulty === 'hard'));

  const interleaved: typeof questions = [];
  let ei = 0, mi = 0, hi = 0;
  for (let i = 0; i < 10 && (ei < easy.length || mi < moderate.length || hi < hard.length); i++) {
    const cycle = i % 3;
    if (cycle === 0 && hi < hard.length) interleaved.push(hard[hi++]);
    else if (cycle === 1 && mi < moderate.length) interleaved.push(moderate[mi++]);
    else if (ei < easy.length) interleaved.push(easy[ei++]);
    else if (mi < moderate.length) interleaved.push(moderate[mi++]);
    else if (hi < hard.length) interleaved.push(hard[hi++]);
  }

  const scriptoriumQ = questions.find((q) => q.mechanic === 'scriptorium');
  let final = interleaved.slice(0, 9);
  if (scriptoriumQ) {
    final = final.filter((q) => q.mechanic !== 'scriptorium');
    final.push(scriptoriumQ);
  }

  return final.slice(0, 10);
}
