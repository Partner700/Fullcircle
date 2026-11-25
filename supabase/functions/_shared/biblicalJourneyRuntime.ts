import { ARENA_STANDSTILL_MS } from './arenaBoardMarket.ts';
import { arenaMatchRelicIsMuted, countArenaMatchRelicUse } from './arenaMatchRelicLimits.ts';
import {
  createJourneyGame,
  journeyConfigForGame,
  JOURNEY_MACHINE_ID,
  journeyQuestionStage,
  resolveJourneyAction,
  resolveJourneyMiss,
  resolveJourneyRoll,
  resolveJourneyShield,
  serveJourneyPrisonTurn,
  type JourneyGame,
} from './biblicalJourney.ts';
import { arenaQuestionFigs, arenaRelicEffect, type ArenaQuestionAid } from './arenaRelics.ts';

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
  questionAid?: ArenaQuestionAid;
  pausedUntil?: string;
  undo?: { playerId: string; before: JourneyGame };
};

export const JOURNEY_QUESTION_SECONDS = 45;
export const JOURNEY_VERDICT_MS = 3200;
export const JOURNEY_ROLL_REVEAL_MS = 1800;

export type JourneyPublicState = Omit<JourneyRuntime, 'questionIdsByStage' | 'usedQuestionIds' | 'currentQuestion' | 'undo'> & {
  undoOffer?: { playerId: string };
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
  runtime.questionAid = undefined;
  if (runtime.game.status !== 'playing' || runtime.game.shieldOffer) return;
  const pending = runtime.game.pendingAction;
  if (pending?.kind === 'choice') return;
  const player = pending
    ? runtime.game.players.find((candidate) => candidate.id === pending.playerId)
    : runtime.game.players[runtime.game.turnIndex];
  if (!player || (!pending && player.prisonTurnsRemaining > 0)) return;

  const stage = pending?.kind === 'trial'
    ? 5
    : journeyQuestionStage(journeyConfigForGame(runtime.game), player.location.route === 'loop'
      ? { route: 'main', space: player.loopEntryMainSpace || journeyConfigForGame(runtime.game).loopEntrances[0] }
      : player.location);
  const pool = runtime.questionIdsByStage[stage] || [];
  const unused = pool.filter((id) => !runtime.usedQuestionIds.includes(id));
  const candidates = unused.length ? [...unused] : [...pool];
  while (candidates.length) {
    const [id] = candidates.splice(randomIndex(candidates.length, random), 1);
    const question = await lookup(id);
    if (!question) continue;
    // Stage assignments can change as the bank grows. This match keeps its original pool.
    runtime.currentQuestion = { ...question, stage };
    runtime.currentQuestionPlayerId = player.id;
    runtime.awaitingRoll = !pending;
    runtime.questionOpensAt = new Date(Date.now() + handoffMs).toISOString();
    runtime.questionDeadline = new Date(Date.parse(runtime.questionOpensAt) + JOURNEY_QUESTION_SECONDS * 1000).toISOString();
    runtime.usedQuestionIds.push(id);
    return;
  }
  throw new Error(`No approved Biblical Journey question remains in Stage ${stage}.`);
}

export async function createJourneyRuntime(characterSlug: string, playerIds: string[],
  questions: Array<Pick<JourneyQuestion, 'id' | 'stage'>>, lookup: JourneyQuestionLookup,
  random: () => number, tentSides?: Record<string, string>): Promise<JourneyRuntime> {
  const questionIdsByStage: Record<number, string[]> = {};
  for (const question of questions) {
    if (question.stage < 1 || question.stage > 5) continue;
    questionIdsByStage[question.stage] ||= [];
    if (!questionIdsByStage[question.stage].includes(question.id)) questionIdsByStage[question.stage].push(question.id);
  }
  for (let stage = 1; stage <= 5; stage += 1) {
    if (!(questionIdsByStage[stage] || []).length) {
      throw new Error(`Stage ${stage} needs questions before a match can start.`);
    }
  }
  if (new Set(Object.values(questionIdsByStage).flat()).size < 200) {
    throw new Error('This character needs at least 200 active questions before a match can start.');
  }
  const runtime: JourneyRuntime = {
    characterSlug, game: createJourneyGame(playerIds, tentSides), questionIdsByStage,
    usedQuestionIds: [], currentQuestion: null, currentQuestionPlayerId: null,
    questionDeadline: null, lastVerdict: null,
  };
  await openNextQuestion(runtime, lookup, random);
  return runtime;
}

export function rollJourneyDie(original: JourneyRuntime, actorId: string, random: () => number): JourneyRuntime {
  if (!original.awaitingRoll || original.game.status !== 'playing' || original.game.pendingAction
    || original.game.players[original.game.turnIndex]?.id !== actorId || original.currentQuestionPlayerId !== actorId
    || original.game.players[original.game.turnIndex].prisonTurnsRemaining > 0) {
    throw new Error('It is not your turn to roll.');
  }
  if (actorId !== JOURNEY_MACHINE_ID && original.questionDeadline && Date.now() >= Date.parse(original.questionDeadline)) throw new Error('This turn has timed out.');
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
  lookup: JourneyQuestionLookup, random: () => number, shieldOwners?: readonly string[]): Promise<JourneyRuntime> {
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
  if (!correct && !expired && next.questionAid?.donkeyActive) {
    next.lastVerdict = null;
    next.questionAid.donkeyActive = false;
    next.questionAid.notice = 'That answer was stopped. Choose again before time runs out.';
    next.game.version += 1;
    return next;
  }
  let die: number | null = original.pendingDie || null;
  if (pending?.kind === 'trial') {
    next.game = resolveJourneyAction(next.game, actorId, correct ? 0 : 1, undefined, shieldOwners);
  } else if (correct) {
    // Existing matches without the new roll phase can finish their current question.
    die = original.pendingDie || randomIndex(6, random) + 1;
    next.game = resolveJourneyRoll(next.game, actorId, die, undefined, shieldOwners);
  } else {
    next.game = resolveJourneyMiss(next.game, actorId, expired ? null : original.pendingDie);
  }
  const player = next.game.players.find(p => p.id === actorId);
  const previousPlayer = original.game.players.find(p => p.id === actorId);
  if (player && previousPlayer) {
    player.questionFigs = (previousPlayer.questionFigs ?? previousPlayer.correctAnswers)
      + arenaQuestionFigs(correct, next.questionAid);
  }
  next.lastVerdict = {
    playerId: actorId, questionId: question.id, question: question.question,
    selectedAnswer: submittedAnswer,
    correctAnswer: question.correctAnswer, correct, reference: question.reference,
    explanation: question.explanation, die,
  };
  await openNextQuestion(next, lookup, random, JOURNEY_VERDICT_MS);
  const machineMatch = original.game.players.some(candidate => candidate.id === JOURNEY_MACHINE_ID);
  if (!pending && actorId !== JOURNEY_MACHINE_ID && next.game.status === 'playing' && (correct || machineMatch)) {
    next.undo = { playerId: actorId, before: original.game };
  }
  return next;
}

export async function applyJourneyRelic(original: JourneyRuntime, actorId: string, slug: string,
  lookup: JourneyQuestionLookup, random: () => number, shieldOwners?: readonly string[]): Promise<JourneyRuntime> {
  const question = original.currentQuestion;
  if (!question || original.awaitingRoll || original.game.status !== 'playing'
    || original.currentQuestionPlayerId !== actorId || actorId === JOURNEY_MACHINE_ID
    || !original.questionDeadline || Date.now() >= Date.parse(original.questionDeadline)
    || original.questionOpensAt && Date.now() < Date.parse(original.questionOpensAt)) {
    throw new Error('Relics are available only during your open question.');
  }
  const effect = arenaRelicEffect(slug, question, original.questionAid,
    (answer) => journeyAnswerIsCorrect(question, answer));
  const next = structuredClone(original);
  next.questionAid = effect.aid;
  next.lastVerdict = null;
  if (slug === 'skip') {
    const player = next.game.players[next.game.turnIndex];
    player.questionFigs = (player.questionFigs ?? player.correctAnswers) + arenaQuestionFigs(false, effect.aid);
    next.game.pendingAction = null;
    next.game.bonusTurnPlayerId = null;
    next.game.version += 1;
    await openNextQuestion(next, lookup, random);
    return next;
  }
  if (effect.answer !== undefined) return answerJourneyQuestion(next, actorId, effect.answer, lookup, random, shieldOwners);
  if (effect.extraSeconds) next.questionDeadline = new Date(Date.parse(original.questionDeadline) + effect.extraSeconds * 1000).toISOString();
  next.game.version += 1;
  return next;
}

export async function expireJourneyQuestion(original: JourneyRuntime,
  lookup: JourneyQuestionLookup, random: () => number, shieldOwners?: readonly string[]): Promise<JourneyRuntime> {
  if (!original.currentQuestionPlayerId || !original.questionDeadline
    || Date.now() < Date.parse(original.questionDeadline)) {
    throw new Error('This question has not timed out.');
  }
  if (original.awaitingRoll) {
    const next = structuredClone(original);
    next.game = resolveJourneyMiss(next.game, original.currentQuestionPlayerId, null);
    next.lastVerdict = null;
    delete next.undo;
    await openNextQuestion(next, lookup, random);
    return next;
  }
  return answerJourneyQuestion(original, original.currentQuestionPlayerId, '', lookup, random, shieldOwners);
}

export async function chooseJourneyPenalty(original: JourneyRuntime, actorId: string, choice: 0 | 1,
  lookup: JourneyQuestionLookup, random: () => number, shieldOwners?: readonly string[]): Promise<JourneyRuntime> {
  if (original.game.pendingAction?.kind !== 'choice') throw new Error('There is no opposing-player decision to make.');
  const next = structuredClone(original);
  next.game = resolveJourneyAction(next.game, actorId, choice, undefined, shieldOwners);
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
  if (runtime.game.status !== 'playing' || runtime.game.shieldOffer) return false;
  const pending = runtime.game.pendingAction;
  if (pending?.kind === 'choice') return pending.playerId !== JOURNEY_MACHINE_ID;
  if (pending?.kind === 'trial') return runtime.currentQuestionPlayerId === JOURNEY_MACHINE_ID;
  return runtime.game.players[runtime.game.turnIndex]?.id === JOURNEY_MACHINE_ID;
}

export async function advanceMachineJourney(original: JourneyRuntime, lookup: JourneyQuestionLookup,
  random: () => number, accuracy: number, shieldOwners?: readonly string[]): Promise<JourneyRuntime> {
  if (!machineJourneyMayAct(original) || !original.game.players.some((player) => player.id === JOURNEY_MACHINE_ID)) {
    throw new Error('It is not The Scribe\'s turn.');
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) throw new Error('Invalid machine accuracy.');
  if (original.awaitingRoll) return rollJourneyDie(original, JOURNEY_MACHINE_ID, random);
  if (original.game.pendingAction?.kind === 'choice') {
    return chooseJourneyPenalty(original, JOURNEY_MACHINE_ID, random() < 0.5 ? 0 : 1, lookup, random, shieldOwners);
  }
  if (!original.game.pendingAction && original.game.players[original.game.turnIndex].prisonTurnsRemaining > 0) {
    return serveJourneySentence(original, JOURNEY_MACHINE_ID, lookup, random);
  }
  const question = original.currentQuestion;
  if (!question || original.currentQuestionPlayerId !== JOURNEY_MACHINE_ID) {
    throw new Error('The Scribe has no open question.');
  }
  const correct = random() < accuracy;
  const next = await answerJourneyQuestion(original, JOURNEY_MACHINE_ID,
    correct ? question.correctAnswer : '#', lookup, random, shieldOwners);
  if (!correct && next.lastVerdict) next.lastVerdict.selectedAnswer = 'No answer';
  return next;
}

export function publicJourneyRuntime(runtime: JourneyRuntime): JourneyPublicState {
  const game = structuredClone(runtime.game);
  delete game.shieldContinuation;
  for (const player of game.players) {
    player.pendingEffects = [];
    player.score = Math.max(0, player.score ?? player.correctAnswers);
  }
  const { currentQuestion } = runtime;
  return {
    characterSlug: runtime.characterSlug,
    game,
    pausedUntil: runtime.pausedUntil,
    undoOffer: runtime.undo && !game.shieldOffer
      ? { playerId: runtime.undo.playerId } : undefined,
    currentQuestionPlayerId: runtime.currentQuestionPlayerId,
    questionDeadline: runtime.questionDeadline || null,
    lastVerdict: runtime.lastVerdict,
    awaitingRoll: runtime.awaitingRoll || false,
    pendingDie: runtime.pendingDie || null,
    questionOpensAt: runtime.questionOpensAt || null,
    questionAid: runtime.awaitingRoll ? undefined : runtime.questionAid,
    currentQuestion: currentQuestion && !runtime.awaitingRoll ? {
      id: currentQuestion.id, stage: currentQuestion.stage, type: currentQuestion.type,
      question: currentQuestion.question, options: currentQuestion.options,
    } : null,
  };
}

export async function decideJourneyShield(original: JourneyRuntime, actorId: string, decision: 'use' | 'expire' | 'reflect',
  lookup: JourneyQuestionLookup, random: () => number, shieldOwners?: readonly string[]): Promise<JourneyRuntime> {
  const next = structuredClone(original);
  next.game = resolveJourneyShield(next.game, actorId, decision, shieldOwners);
  if (decision === 'use' || decision === 'reflect') delete next.undo;
  next.lastVerdict = null;
  await openNextQuestion(next, lookup, random);
  return next;
}

export async function undoJourneyMove(original: JourneyRuntime, actorId: string,
  lookup: JourneyQuestionLookup, random: () => number): Promise<JourneyRuntime> {
  const { undo, game } = original;
  const machine = game.players.some((player) => player.id === JOURNEY_MACHINE_ID);
  if (arenaMatchRelicIsMuted(game.matchRelicUses, actorId, 'undo', machine)) {
    throw new Error('You have reached the three-use Undo limit for this match.');
  }
  if (!undo || undo.playerId !== actorId || game.status !== 'playing' || game.shieldOffer) {
    throw new Error('Your last Journey move can no longer be undone.');
  }
  const next = structuredClone(original);
  next.game = structuredClone(undo.before);
  next.game.version = game.version + 1;
  next.game.events = structuredClone(game.events);
  next.game.matchRelicUses = structuredClone(game.matchRelicUses);
  countArenaMatchRelicUse(next.game, actorId, 'undo');
  delete next.undo;
  delete next.pausedUntil;
  next.lastVerdict = null;
  await openNextQuestion(next, lookup, random);
  return next;
}

export function pauseJourneyMatch(original: JourneyRuntime, actorId: string): JourneyRuntime {
  const { game } = original;
  const now = Date.now();
  const machine = game.players.some((player) => player.id === JOURNEY_MACHINE_ID);
  if (arenaMatchRelicIsMuted(game.matchRelicUses, actorId, 'standstill', machine)) {
    throw new Error('You have already used Standstill in this match.');
  }
  if (game.status !== 'playing' || game.shieldOffer || game.pendingAction?.kind === 'choice'
    || game.players[game.turnIndex]?.id !== actorId || actorId === JOURNEY_MACHINE_ID
    || (original.pausedUntil && now < Date.parse(original.pausedUntil))
    || (original.questionDeadline && now >= Date.parse(original.questionDeadline))) {
    throw new Error('Standstill is available on your active Journey turn before time runs out.');
  }
  const next = structuredClone(original);
  countArenaMatchRelicUse(next.game, actorId, 'standstill');
  next.pausedUntil = new Date(now + ARENA_STANDSTILL_MS).toISOString();
  next.lastVerdict = null;
  if (next.questionDeadline) next.questionDeadline = new Date(Date.parse(next.questionDeadline) + ARENA_STANDSTILL_MS).toISOString();
  if (next.questionOpensAt && Date.parse(next.questionOpensAt) > now) {
    next.questionOpensAt = new Date(Date.parse(next.questionOpensAt) + ARENA_STANDSTILL_MS).toISOString();
  }
  next.game.version += 1;
  return next;
}
