export const ARENA_RELICS = ['hint', 'eliminate', 'freeze-timer', 'skip', 'reveal-reference', 'witch-ball-endor', 'talking-donkey'] as const;
export type ArenaRelicSlug = typeof ARENA_RELICS[number];
export type ArenaQuestionAid = {
  used: ArenaRelicSlug[];
  hiddenOptions: string[];
  notice: string;
  donkeyActive?: boolean;
};

export function arenaRelicEffect(slug: string, question: {
  type: string; options: string[]; reference?: string | null; correctAnswer: string;
}, previous: ArenaQuestionAid | undefined, isCorrect: (answer: string) => boolean) {
  if (!ARENA_RELICS.includes(slug as ArenaRelicSlug)) throw new Error('This relic is not used during Arena questions.');
  const aid: ArenaQuestionAid = structuredClone(previous || { used: [], hiddenOptions: [], notice: '' });
  if (aid.used.includes(slug as ArenaRelicSlug)) throw new Error('You already used this relic on this question.');
  let extraSeconds = 0;
  let answer: string | undefined;
  if (slug === 'hint') {
    aid.notice = question.reference ? `Look for the detail in ${question.reference}.` : `The answer begins with ${question.correctAnswer.trim().slice(0, 1)}.`;
  } else if (slug === 'eliminate') {
    if (!['multiple_choice', 'odd_one'].includes(question.type)) throw new Error('Eliminate needs a multiple-choice question.');
    const wrong = question.options.filter((option) => !isCorrect(option) && !aid.hiddenOptions.includes(option));
    if (wrong.length < 2) throw new Error('There are not two wrong choices left to remove.');
    aid.hiddenOptions.push(...wrong.slice(0, 2));
    aid.notice = 'Two wrong choices removed.';
  } else if (slug === 'freeze-timer') {
    extraSeconds = 60;
    aid.notice = '60 seconds added.';
  } else if (slug === 'reveal-reference') {
    if (!question.reference?.trim()) throw new Error('This question has no reference to reveal.');
    aid.notice = `Reference: ${question.reference}`;
  } else if (slug === 'talking-donkey') {
    aid.donkeyActive = true;
    aid.notice = 'The Talking Donkey will stop one wrong answer.';
  } else if (slug === 'witch-ball-endor') {
    answer = question.correctAnswer;
    aid.notice = 'The Crystal Ball secured this answer.';
  } else {
    answer = '';
    aid.notice = 'Question skipped. No point earned.';
  }
  aid.used.push(slug as ArenaRelicSlug);
  return { aid, extraSeconds, answer };
}
