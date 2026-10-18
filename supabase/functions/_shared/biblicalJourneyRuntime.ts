import {
  createJourneyGame,
  DEFAULT_JOURNEY_CONFIG,
  journeyQuestionStage,
  resolveJourneyAction,
  resolveJourneyMiss,
  resolveJourneyRoll,
  serveJourneyPrisonTurn,
  type JourneyGame,
} from './biblicalJourney.ts';

export type JourneyQuestion = {
  id: string;
  stage: number;
  type: 'true_false' | 'multiple_choice' | 'odd_one' | 'fill_blank' | 'order_sequence';
  question: string;
  options: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  reference: string | null;
  explanation: string | null;
};

export type JourneyVerdict = {
  playerId: string;
  questionId: string;
  selectedAnswer: string;
  correctAnswer: string;
  correct: boolean;
  reference: string | null;
  explanation: string | null;
  die: number | null;
};

export type JourneyRuntime = {
  characterSlug: string;
  game: JourneyGame;
  questionIdsByStage: Record<number, string[]>;
  usedQuestionIds: string[];
  currentQuestion: JourneyQuestion | null;
  currentQuestionPlayerId: string | null;
  lastVerdict: JourneyVerdict | null;
};

export type JourneyPublicState = Omit<JourneyRuntime, 'questionIdsByStage' | 'usedQuestionIds' | 'currentQuestion'> & {
  currentQuestion: Pick<JourneyQuestion, 'id' | 'stage' | 'type' | 'question' | 'options'> | null;
};

export type JourneyQuestionLookup = (id: string) => Promise<JourneyQuestion | null>;

function normalizedAnswer(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function journeyAnswerIsCorrect(question: JourneyQuestion, answer: string): boolean {
  const candidate = normalizedAnswer(answer);
  if (!candidate) return false;
  const aliases = question.type === 'true_false'
    ? { yes: 'true', no: 'false', t: 'true', f: 'false' } as Record<string, string>
    : {};
  const normalizedCandidate = aliases[candidate] || candidate;
  return [question.correctAnswer, ...question.acceptedAnswers]
    .some((value) => normalizedAnswer(value) === normalizedCandidate);
}

function randomIndex(length: number, random: () => number): number {
  if (length <= 0) throw new Error('No approved question is available for this stage.');
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('The server random source is invalid.');
  return Math.floor(value * length);
}

async function openNextQuestion(runtime: JourneyRuntime, lookup: JourneyQuestionLookup, random: () => number) {
  runtime.currentQuestion = null;
  runtime.currentQuestionPlayerId = null;
  if (runtime.game.status !== 'playing') return;
  const pending = runtime.game.pendingAction;
  if (pending?.kind === 'choice') return;
  const player = pending
    ? runtime.game.players.find((candidate) => candidate.id === pending.playerId)
    : runtime.game.players[runtime.game.turnIndex];
  if (!player || (!pending && player.location.route === 'prison')) return;

  const stage = pending?.kind === 'trial'
    ? 5
    : journeyQuestionStage(DEFAULT_JOURNEY_CONFIG, player.location.route === 'loop'
      ? { route: 'main', space: player.loopEntryMainSpace || DEFAULT_JOURNEY_CONFIG.loopEntrances[0] }
      : player.location);
  const pool = runtime.questionIdsByStage[stage] || [];
  const unused = pool.filter((id) => !runtime.usedQuestionIds.includes(id));
  const candidates = unused.length ? [...unused] : [...pool];
  while (candidates.length) {
    const [id] = candidates.splice(randomIndex(candidates.length, random), 1);
    const question = await lookup(id);
    if (!question || question.stage !== stage) continue;
    runtime.currentQuestion = question;
    runtime.currentQuestionPlayerId = player.id;
    runtime.usedQuestionIds.push(id);
    return;
  }
  throw new Error(`No approved Biblical Journey question remains in Stage ${stage}.`);
}

export async function createJourneyRuntime(characterSlug: string, playerIds: string[],
  questions: Array<Pick<JourneyQuestion, 'id' | 'stage'>>, lookup: JourneyQuestionLookup,
  random: () => number): Promise<JourneyRuntime> {
  const questionIdsByStage: Record<number, string[]> = {};
  for (const question of questions) {
    if (question.stage < 1 || question.stage > 5) continue;
    questionIdsByStage[question.stage] ||= [];
    if (!questionIdsByStage[question.stage].includes(question.id)) questionIdsByStage[question.stage].push(question.id);
  }
  for (let stage = 1; stage <= 5; stage += 1) {
    if ((questionIdsByStage[stage] || []).length < 10) {
      throw new Error(`Stage ${stage} needs ten approved questions before a match can start.`);
    }
  }
  const runtime: JourneyRuntime = {
    characterSlug, game: createJourneyGame(playerIds), questionIdsByStage,
    usedQuestionIds: [], currentQuestion: null, currentQuestionPlayerId: null, lastVerdict: null,
  };
  await openNextQuestion(runtime, lookup, random);
  return runtime;
}

export async function answerJourneyQuestion(original: JourneyRuntime, actorId: string, answer: string,
  lookup: JourneyQuestionLookup, random: () => number): Promise<JourneyRuntime> {
  const question = original.currentQuestion;
  if (!question || original.currentQuestionPlayerId !== actorId || original.game.status !== 'playing') {
    throw new Error('This question is not open for you.');
  }
  const correct = journeyAnswerIsCorrect(question, answer);
  const pending = original.game.pendingAction;
  const next = structuredClone(original);
  let die: number | null = null;
  if (pending?.kind === 'trial') {
    next.game = resolveJourneyAction(next.game, actorId, correct ? 0 : 1);
  } else if (correct) {
    die = randomIndex(6, random) + 1;
    next.game = resolveJourneyRoll(next.game, actorId, die);
  } else {
    next.game = resolveJourneyMiss(next.game, actorId);
  }
  next.lastVerdict = {
    playerId: actorId, questionId: question.id, selectedAnswer: answer,
    correctAnswer: question.correctAnswer, correct, reference: question.reference,
    explanation: question.explanation, die,
  };
  await openNextQuestion(next, lookup, random);
  return next;
}

export async function chooseJourneyPenalty(original: JourneyRuntime, actorId: string, choice: 0 | 1,
  lookup: JourneyQuestionLookup, random: () => number): Promise<JourneyRuntime> {
  if (original.game.pendingAction?.kind !== 'choice') throw new Error('There is no opposing-player decision to make.');
  const next = structuredClone(original);
  next.game = resolveJourneyAction(next.game, actorId, choice);
  next.lastVerdict = null;
  await openNextQuestion(next, lookup, random);
  return next;
}

export async function serveJourneySentence(original: JourneyRuntime, actorId: string,
  lookup: JourneyQuestionLookup, random: () => number): Promise<JourneyRuntime> {
  const next = structuredClone(original);
  next.game = serveJourneyPrisonTurn(next.game, actorId);
  next.lastVerdict = null;
  await openNextQuestion(next, lookup, random);
  return next;
}

export function publicJourneyRuntime(runtime: JourneyRuntime): JourneyPublicState {
  const game = structuredClone(runtime.game);
  for (const player of game.players) player.pendingEffects = [];
  const { currentQuestion } = runtime;
  return {
    characterSlug: runtime.characterSlug,
    game,
    currentQuestionPlayerId: runtime.currentQuestionPlayerId,
    lastVerdict: runtime.lastVerdict,
    currentQuestion: currentQuestion ? {
      id: currentQuestion.id, stage: currentQuestion.stage, type: currentQuestion.type,
      question: currentQuestion.question, options: currentQuestion.options,
    } : null,
  };
}
