import {
  createJourneyGame,
  DEFAULT_JOURNEY_CONFIG,
  JOURNEY_MACHINE_ID,
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
  question: string;
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
  questionDeadline: string | null;
  lastVerdict: JourneyVerdict | null;
  awaitingRoll?: boolean;
  pendingDie?: number | null;
  questionOpensAt?: string | null;
};

export const JOURNEY_QUESTION_SECONDS = 30;
export const JOURNEY_VERDICT_MS = 3200;
export const JOURNEY_ROLL_REVEAL_MS = 1800;

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

async function openNextQuestion(runtime: JourneyRuntime, lookup: JourneyQuestionLookup,
  random: () => number, handoffMs = 0) {
  runtime.currentQuestion = null;
  runtime.currentQuestionPlayerId = null;
  runtime.questionDeadline = null;
  runtime.questionOpensAt = null;
  runtime.awaitingRoll = false;
  runtime.pendingDie = null;
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
    runtime.awaitingRoll = !pending;
    if (pending) {
      runtime.questionOpensAt = new Date(Date.now() + handoffMs).toISOString();
      runtime.questionDeadline = new Date(Date.now() + handoffMs + JOURNEY_QUESTION_SECONDS * 1000).toISOString();
    }
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
    usedQuestionIds: [], currentQuestion: null, currentQuestionPlayerId: null,
    questionDeadline: null, lastVerdict: null,
  };
  await openNextQuestion(runtime, lookup, random);
  return runtime;
}

export function rollJourneyDie(original: JourneyRuntime, actorId: string, random: () => number): JourneyRuntime {
  if (!original.awaitingRoll || original.game.status !== 'playing' || original.game.pendingAction
    || original.game.players[original.game.turnIndex]?.id !== actorId || original.currentQuestionPlayerId !== actorId
    || original.game.players[original.game.turnIndex].location.route === 'prison') {
    throw new Error('It is not your turn to roll.');
  }
  const next = structuredClone(original);
  next.pendingDie = randomIndex(6, random) + 1;
  next.awaitingRoll = false;
  next.lastVerdict = null;
  next.questionOpensAt = new Date(Date.now() + JOURNEY_ROLL_REVEAL_MS).toISOString();
  next.questionDeadline = new Date(Date.parse(next.questionOpensAt) + JOURNEY_QUESTION_SECONDS * 1000).toISOString();
  next.game.version += 1;
  return next;
}

export async function answerJourneyQuestion(original: JourneyRuntime, actorId: string, answer: string,
  lookup: JourneyQuestionLookup, random: () => number): Promise<JourneyRuntime> {
  const question = original.currentQuestion;
  if (!question || original.awaitingRoll || original.currentQuestionPlayerId !== actorId || original.game.status !== 'playing') {
    throw new Error('This question is not open for you.');
  }
  if (original.questionOpensAt && Date.now() < Date.parse(original.questionOpensAt)) throw new Error('Wait for the question to open.');
  const expired = Boolean(original.questionDeadline && Date.now() >= Date.parse(original.questionDeadline));
  if (!expired && !answer.trim()) throw new Error('Enter an answer before time runs out.');
  const submittedAnswer = expired ? 'Time expired' : answer;
  const correct = !expired && journeyAnswerIsCorrect(question, answer);
  const pending = original.game.pendingAction;
  const next = structuredClone(original);
  let die: number | null = original.pendingDie || null;
  if (pending?.kind === 'trial') {
    next.game = resolveJourneyAction(next.game, actorId, correct ? 0 : 1);
  } else if (correct) {
    // Existing matches without the new roll phase can finish their current question.
    die = original.pendingDie || randomIndex(6, random) + 1;
    next.game = resolveJourneyRoll(next.game, actorId, die);
  } else {
    next.game = resolveJourneyMiss(next.game, actorId);
  }
  next.lastVerdict = {
    playerId: actorId, questionId: question.id, question: question.question,
    selectedAnswer: submittedAnswer,
    correctAnswer: question.correctAnswer, correct, reference: question.reference,
    explanation: question.explanation, die,
  };
  await openNextQuestion(next, lookup, random, JOURNEY_VERDICT_MS);
  return next;
}

export async function expireJourneyQuestion(original: JourneyRuntime,
  lookup: JourneyQuestionLookup, random: () => number): Promise<JourneyRuntime> {
  if (!original.currentQuestionPlayerId || !original.questionDeadline
    || Date.now() < Date.parse(original.questionDeadline)) {
    throw new Error('This question has not timed out.');
  }
  return answerJourneyQuestion(original, original.currentQuestionPlayerId, '', lookup, random);
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

export function machineJourneyMayAct(runtime: Pick<JourneyRuntime, 'game' | 'currentQuestionPlayerId'>): boolean {
  if (runtime.game.status !== 'playing') return false;
  const pending = runtime.game.pendingAction;
  if (pending?.kind === 'choice') return pending.playerId !== JOURNEY_MACHINE_ID;
  if (pending?.kind === 'trial') return runtime.currentQuestionPlayerId === JOURNEY_MACHINE_ID;
  return runtime.game.players[runtime.game.turnIndex]?.id === JOURNEY_MACHINE_ID;
}

export async function advanceMachineJourney(original: JourneyRuntime, lookup: JourneyQuestionLookup,
  random: () => number, accuracy: number): Promise<JourneyRuntime> {
  if (!machineJourneyMayAct(original) || !original.game.players.some((player) => player.id === JOURNEY_MACHINE_ID)) {
    throw new Error('It is not The Scribe\'s turn.');
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) throw new Error('Invalid machine accuracy.');
  if (original.awaitingRoll) return rollJourneyDie(original, JOURNEY_MACHINE_ID, random);
  if (original.game.pendingAction?.kind === 'choice') {
    return chooseJourneyPenalty(original, JOURNEY_MACHINE_ID, random() < 0.5 ? 0 : 1, lookup, random);
  }
  if (!original.game.pendingAction && original.game.players[original.game.turnIndex].location.route === 'prison') {
    return serveJourneySentence(original, JOURNEY_MACHINE_ID, lookup, random);
  }
  const question = original.currentQuestion;
  if (!question || original.currentQuestionPlayerId !== JOURNEY_MACHINE_ID) {
    throw new Error('The Scribe has no open question.');
  }
  const correct = random() < accuracy;
  const next = await answerJourneyQuestion(original, JOURNEY_MACHINE_ID,
    correct ? question.correctAnswer : '#', lookup, random);
  if (!correct && next.lastVerdict) next.lastVerdict.selectedAnswer = 'No answer';
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
    questionDeadline: runtime.questionDeadline || null,
    lastVerdict: runtime.lastVerdict,
    awaitingRoll: runtime.awaitingRoll || false,
    pendingDie: runtime.pendingDie || null,
    questionOpensAt: runtime.questionOpensAt || null,
    currentQuestion: currentQuestion && !runtime.awaitingRoll ? {
      id: currentQuestion.id, stage: currentQuestion.stage, type: currentQuestion.type,
      question: currentQuestion.question, options: currentQuestion.options,
    } : null,
  };
}
