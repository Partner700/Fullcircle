export const ROAD_HOME_CONFIG = {
  trackLength: 52,
  homeLaneLength: 6,
  finalHome: 58,
  maxBonusRolls: 2,
  startingDenarii: 50,
  rewards: {
    ownQuestion: 10,
    inheritedQuestion: 20,
    inheritedPenalty: 20,
    capture: 30,
    pawnHome: 40,
    firstPlace: 100,
  },
  timers: {
    roll: 15,
    pawn: 15,
    inheritedDecision: 10,
    easy: 40,
    medium: 25,
    hard: 15,
    expert: 15,
    veryHard: 15,
  },
  safeSpaces: [0, 8, 13, 21, 26, 34, 39, 47],
  prisonSpaces: [6, 19, 32, 45],
  surpriseSpaces: [10, 23, 36, 49],
  homeSurpriseProgress: [53, 56],
  startOffsets: [0, 13, 26, 39],
  colours: ['coral', 'royal', 'sage', 'gold'],
} as const;

export type RoadHomeDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'very_hard';
export type RoadHomePhase =
  | 'AWAITING_ROLL'
  | 'QUESTION'
  | 'SELECTING_PAWN'
  | 'INHERITED_OFFER'
  | 'PRISON_MANAGEMENT'
  | 'SURPRISE_CARD'
  | 'GAME_OVER';

export type RoadHomeQuestion = {
  id: string;
  prompt: string;
  type: 'multiple_choice' | 'true_false' | 'standard_text';
  options?: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  reference?: string;
  explanation?: string;
  difficulty: RoadHomeDifficulty;
  timerSeconds: number;
};

export type RoadHomePawn = {
  id: string;
  number: number;
  progress: number;
  prisonRounds: number;
  imprisonedTurn: number | null;
  shielded: boolean;
};

export type RoadHomeStats = {
  correct: number;
  inheritedClaimed: number;
  inheritedExpired: number;
  captured: number;
  lost: number;
  denariiEarned: number;
  denariiSpent: number;
  relicsFound: number;
  relicsUsed: number;
  prisonEscapes: number;
  totalMovement: number;
};

export type RoadHomePlayer = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  colour: string;
  startOffset: number;
  isBot: boolean;
  forfeited?: boolean;
  denarii: number;
  pawns: RoadHomePawn[];
  relics: string[];
  finishedRank: number | null;
  stats: RoadHomeStats;
};

export type RoadHomeChallenge = {
  id: string;
  question: RoadHomeQuestion;
  rolledValue: number;
  originPlayerId: string;
  eligiblePlayerIds: string[];
  attemptedPlayerIds: string[];
  declinedPlayerIds: string[];
  createdTurnNumber: number;
  status: 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'ANSWER_REVEALED';
};

export type RoadHomeEvent = {
  id: string;
  type: string;
  message: string;
  playerId?: string | null;
  createdAt: string;
};

export type RoadHomeSurprise = {
  category: 'question' | 'verse' | 'denarii' | 'relic';
  title: string;
  detail: string;
  reward?: number;
  relic?: string;
};

type MoveContinuation = 'END_TURN' | 'BONUS_OR_END' | 'CONTINUE_OWN_TURN';
type QuestionPurpose = 'own' | 'inherited' | 'prison' | 'surprise' | 'verse';

export type RoadHomeState = {
  roomId: string;
  version: number;
  questionPool: RoadHomeQuestion[];
  phase: RoadHomePhase;
  turnNumber: number;
  activePlayerIndex: number;
  players: RoadHomePlayer[];
  diceValue: number | null;
  bonusRollsUsed: number;
  currentQuestion: RoadHomeQuestion | null;
  questionPurpose: QuestionPurpose | null;
  questionDeadline: string | null;
  questionAttempts: number;
  legalPawnIds: string[];
  pendingMoveValue: number | null;
  moveContinuation: MoveContinuation | null;
  activeChallengeId: string | null;
  activePrisonPawnId: string | null;
  challengeQueue: RoadHomeChallenge[];
  pendingSurprise: RoadHomeSurprise | null;
  usedQuestionIds: string[];
  rankings: string[];
  eventLog: RoadHomeEvent[];
  winnerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoadHomeParticipant = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isBot?: boolean;
};

export type RoadHomeCommand =
  | { action: 'ROLL' }
  | { action: 'ANSWER'; answer: string }
  | { action: 'MOVE'; pawnId: string }
  | { action: 'CHALLENGE_DECISION'; decision: 'accept' | 'decline' }
  | { action: 'PRISON_ACTION'; pawnId: string; decision: 'question' | 'pay' | 'serve' }
  | { action: 'ACK_SURPRISE' }
  | { action: 'USE_RELIC'; relic: string; pawnId?: string }
  | { action: 'FORFEIT' };

type RandomFn = () => number;

const FALLBACK_QUESTIONS: RoadHomeQuestion[] = [
  ['joseph-governor', 'Which brother was sold and later governed Egypt during the famine?', 'Joseph', ['Joseph', 'Benjamin', 'Judah', 'Reuben'], 'Genesis 41:41'],
  ['gideon-fleece', 'What was wet when Gideon first tested God with the fleece?', 'The fleece only', ['The fleece only', 'The ground only', 'Both fleece and ground', 'Neither'], 'Judges 6:37-38'],
  ['david-armor', 'What did David remove before facing Goliath because he had not tested it?', "Saul's armor", ["Saul's armor", "Samuel's cloak", "Jonathan's bow", "Abner's shield"], '1 Samuel 17:38-39'],
  ['esther-fast', 'How long did Esther ask the Jews in Susa to fast for her?', 'Three days', ['One day', 'Two days', 'Three days', 'Seven days'], 'Esther 4:16'],
  ['daniel-window', 'Toward which city were Daniel\'s windows open when he prayed?', 'Jerusalem', ['Jerusalem', 'Babylon', 'Nineveh', 'Damascus'], 'Daniel 6:10'],
  ['jonah-direction', 'Jonah boarded a ship for which destination while fleeing?', 'Tarshish', ['Tarshish', 'Joppa', 'Nineveh', 'Cyrene'], 'Jonah 1:3'],
  ['joshua-stones', 'How many stones were taken from the Jordan as a memorial?', 'Twelve', ['Seven', 'Ten', 'Twelve', 'Forty'], 'Joshua 4:3'],
  ['peter-sheet', 'Who received the vision of a sheet containing animals before meeting Cornelius?', 'Peter', ['Peter', 'Paul', 'Philip', 'Barnabas'], 'Acts 10:11-17'],
  ['lydia-city', 'Lydia, the seller of purple, came from which city?', 'Thyatira', ['Thyatira', 'Philippi', 'Corinth', 'Ephesus'], 'Acts 16:14'],
  ['matthias', 'Who was chosen to take Judas Iscariot\'s place among the Twelve?', 'Matthias', ['Matthias', 'Silas', 'Barnabas', 'Stephen'], 'Acts 1:26'],
  ['elisha-axe', 'What iron object floated after Elisha threw a stick into the water?', 'An axe head', ['An axe head', 'A spear point', 'A chain', 'A shield boss'], '2 Kings 6:5-7'],
  ['paul-nephew', 'Who warned the Roman commander about the plot to kill Paul?', "Paul's nephew", ["Paul's nephew", 'Silas', 'Luke', 'Ananias'], 'Acts 23:16-22'],
  ['hezekiah-sign', 'What moved backward as a sign that Hezekiah would recover?', 'The shadow on the steps', ['The shadow on the steps', 'The sun itself', 'The temple curtain', 'The river'], '2 Kings 20:9-11'],
  ['ehud-hand', 'Ehud, who delivered Israel from Eglon, was described as what?', 'Left-handed', ['Left-handed', 'Blind', 'A Nazirite', 'A priest'], 'Judges 3:15'],
  ['amos-work', 'What work did Amos name alongside tending sheep?', 'Dressing sycamore figs', ['Dressing sycamore figs', 'Making tents', 'Fishing', 'Carving stone'], 'Amos 7:14'],
  ['melchizedek', 'Melchizedek was king of Salem and priest of whom?', 'God Most High', ['God Most High', 'Dagon', 'Chemosh', 'Baal'], 'Genesis 14:18'],
  ['martha-confession', 'Who confessed to Jesus, “You are the Christ, the Son of God,” before Lazarus was raised?', 'Martha', ['Martha', 'Mary Magdalene', 'Peter', 'Thomas'], 'John 11:27'],
  ['eutychus', 'From which floor did Eutychus fall while Paul spoke late into the night?', 'The third floor', ['The second floor', 'The third floor', 'The fourth floor', 'The roof'], 'Acts 20:9'],
].map(([id, prompt, correctAnswer, options, reference], index) => ({
  id,
  prompt,
  type: 'multiple_choice',
  options,
  correctAnswer,
  acceptedAnswers: [correctAnswer],
  reference,
  explanation: `See ${reference}.`,
  difficulty: index < 5 ? 'easy' : index < 10 ? 'medium' : index < 15 ? 'hard' : 'expert',
  timerSeconds: index < 5 ? 15 : index < 10 ? 20 : index < 15 ? 25 : 30,
}));

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'road-home') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function stats(): RoadHomeStats {
  return { correct: 0, inheritedClaimed: 0, inheritedExpired: 0, captured: 0, lost: 0, denariiEarned: 0, denariiSpent: 0, relicsFound: 0, relicsUsed: 0, prisonEscapes: 0, totalMovement: 0 };
}

function addEvent(state: RoadHomeState, type: string, message: string, playerId?: string | null) {
  state.eventLog.push({ id: uid('event'), type, message, playerId, createdAt: nowIso() });
  state.eventLog = state.eventLog.slice(-100);
}

function addDenarii(state: RoadHomeState, player: RoadHomePlayer, amount: number, reason: string) {
  const before = player.denarii;
  player.denarii = Math.max(0, Math.min(9990, player.denarii + amount));
  const actual = player.denarii - before;
  if (actual >= 0) player.stats.denariiEarned += actual;
  else player.stats.denariiSpent += Math.abs(actual);
  addEvent(state, actual >= 0 ? 'DENARII_EARNED' : 'DENARII_SPENT', `${player.name} ${actual >= 0 ? 'earned' : 'spent'} ${Math.abs(actual)} denarii: ${reason}.`, player.id);
}

function activePlayer(state: RoadHomeState) {
  return state.players[state.activePlayerIndex];
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function answerIsCorrect(question: RoadHomeQuestion, answer: string) {
  const candidate = normalize(answer);
  return [question.correctAnswer, ...question.acceptedAnswers].some((item) => normalize(item) === candidate);
}

function globalPosition(player: RoadHomePlayer, pawn: RoadHomePawn) {
  if (pawn.progress < 0 || pawn.progress >= ROAD_HOME_CONFIG.trackLength) return null;
  return (player.startOffset + pawn.progress) % ROAD_HOME_CONFIG.trackLength;
}

function pawnById(state: RoadHomeState, pawnId: string) {
  for (const player of state.players) {
    const pawn = player.pawns.find((item) => item.id === pawnId);
    if (pawn) return { player, pawn };
  }
  return null;
}

function blockades(state: RoadHomeState) {
  const entries = new Map<number, { playerId: string; count: number }[]>();
  for (const player of state.players) {
    const counts = new Map<number, number>();
    for (const pawn of player.pawns) {
      const position = globalPosition(player, pawn);
      if (position == null || pawn.prisonRounds > 0) continue;
      counts.set(position, (counts.get(position) || 0) + 1);
    }
    for (const [position, count] of counts) {
      if (count < 2 || ROAD_HOME_CONFIG.safeSpaces.includes(position as never) || ROAD_HOME_CONFIG.prisonSpaces.includes(position as never)) continue;
      entries.set(position, [...(entries.get(position) || []), { playerId: player.id, count }]);
    }
  }
  return entries;
}

export function legalPawnIds(state: RoadHomeState, playerId: string, value: number) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || value < 1 || value > 6) return [];
  const walls = blockades(state);
  return player.pawns.filter((pawn) => {
    if (pawn.prisonRounds > 0 || pawn.progress === ROAD_HOME_CONFIG.finalHome) return false;
    if (pawn.progress < 0) return value === 6;
    if (pawn.progress + value > ROAD_HOME_CONFIG.finalHome) return false;
    if (pawn.progress >= ROAD_HOME_CONFIG.trackLength) return true;
    for (let step = 1; step <= value; step += 1) {
      const relative = pawn.progress + step;
      if (relative >= ROAD_HOME_CONFIG.trackLength) break;
      const position = (player.startOffset + relative) % ROAD_HOME_CONFIG.trackLength;
      const enemyWall = (walls.get(position) || []).some((wall) => wall.playerId !== player.id);
      if (enemyWall) return false;
    }
    const targetProgress = pawn.progress + value;
    if (targetProgress < ROAD_HOME_CONFIG.trackLength) {
      const target = (player.startOffset + targetProgress) % ROAD_HOME_CONFIG.trackLength;
      const friendlyCount = player.pawns.filter((other) => globalPosition(player, other) === target).length;
      if (friendlyCount >= 2) return false;
      const enemyCount = state.players.filter((other) => other.id !== player.id).flatMap((other) => other.pawns.map((item) => ({ other, item }))).filter(({ other, item }) => globalPosition(other, item) === target && item.prisonRounds === 0).length;
      if (enemyCount >= 2 && !ROAD_HOME_CONFIG.safeSpaces.includes(target as never)) return false;
    }
    return true;
  }).map((pawn) => pawn.id);
}

function difficultyForRoll(value: number): RoadHomeDifficulty {
  if (value <= 2) return 'easy';
  if (value <= 4) return 'medium';
  if (value === 5) return 'hard';
  return 'expert';
}

function timerForDifficulty(difficulty: RoadHomeDifficulty) {
  if (difficulty === 'easy') return ROAD_HOME_CONFIG.timers.easy;
  if (difficulty === 'medium') return ROAD_HOME_CONFIG.timers.medium;
  if (difficulty === 'hard') return ROAD_HOME_CONFIG.timers.hard;
  if (difficulty === 'very_hard') return ROAD_HOME_CONFIG.timers.veryHard;
  return ROAD_HOME_CONFIG.timers.expert;
}

export function normalizeQuestions(source: unknown[]): RoadHomeQuestion[] {
  const seen = new Set<string>();
  const normalized: RoadHomeQuestion[] = [];
  source.forEach((raw: any, index) => {
    const prompt = String(raw?.question || raw?.prompt || '').trim();
    const correctAnswer = String(raw?.correct_answer || raw?.correctAnswer || '').trim();
    const key = normalize(prompt);
    if (!prompt || !correctAnswer || seen.has(key)) return;
    seen.add(key);
    const options = Array.isArray(raw?.options) ? Array.from(new Set(raw.options.map((item: unknown) => String(item).trim()).filter(Boolean))) as string[] : undefined;
    const rawDifficulty = String(raw?.difficulty_tag || raw?.difficulty || '').toLowerCase();
    const difficulty: RoadHomeDifficulty = rawDifficulty.includes('very') ? 'very_hard' : rawDifficulty.includes('expert') ? 'expert' : rawDifficulty.includes('hard') ? 'hard' : rawDifficulty.includes('moderate') || rawDifficulty.includes('medium') ? 'medium' : index % 4 === 3 ? 'expert' : index % 4 === 2 ? 'hard' : index % 4 === 1 ? 'medium' : 'easy';
    normalized.push({
      id: String(raw?.id || `room-question-${index}-${key.slice(0, 20)}`),
      prompt,
      type: raw?.type === 'true_false' ? 'true_false' : raw?.type === 'standard_text' ? 'standard_text' : 'multiple_choice',
      options,
      correctAnswer,
      acceptedAnswers: Array.isArray(raw?.accepted_answers) ? raw.accepted_answers.map(String) : [correctAnswer],
      reference: String(raw?.reference || ''),
      explanation: String(raw?.explanation || ''),
      difficulty,
      timerSeconds: timerForDifficulty(difficulty),
    });
  });
  return [...normalized, ...FALLBACK_QUESTIONS.filter((question) => !seen.has(normalize(question.prompt)))];
}

function drawQuestion(state: RoadHomeState, questions: RoadHomeQuestion[], difficulty: RoadHomeDifficulty, random: RandomFn) {
  let candidates = questions.filter((question) => question.difficulty === difficulty && !state.usedQuestionIds.includes(question.id));
  if (candidates.length === 0) candidates = questions.filter((question) => !state.usedQuestionIds.includes(question.id));
  if (candidates.length === 0) {
    state.usedQuestionIds = [];
    candidates = questions.filter((question) => question.difficulty === difficulty);
  }
  if (candidates.length === 0) candidates = questions;
  const question = candidates[Math.floor(random() * candidates.length)] || FALLBACK_QUESTIONS[0];
  state.usedQuestionIds.push(question.id);
  return { ...question, options: question.options ? [...question.options] : undefined, timerSeconds: timerForDifficulty(difficulty), difficulty };
}

function setQuestion(state: RoadHomeState, question: RoadHomeQuestion, purpose: QuestionPurpose) {
  state.currentQuestion = question;
  state.questionPurpose = purpose;
  state.questionAttempts = 0;
  state.questionDeadline = new Date(Date.now() + question.timerSeconds * 1000).toISOString();
  state.phase = 'QUESTION';
  addEvent(state, 'QUESTION_DRAWN', `${activePlayer(state).name}'s question: ${question.prompt}`, activePlayer(state).id);
}

function unresolvedChallengeFor(state: RoadHomeState, playerId: string) {
  return state.challengeQueue.find((challenge) => challenge.status === 'OPEN' && challenge.eligiblePlayerIds.includes(playerId) && !challenge.attemptedPlayerIds.includes(playerId) && !challenge.declinedPlayerIds.includes(playerId));
}

function expireChallengeIfComplete(state: RoadHomeState, challenge: RoadHomeChallenge) {
  const done = challenge.eligiblePlayerIds.every((id) => challenge.attemptedPlayerIds.includes(id) || challenge.declinedPlayerIds.includes(id) || state.rankings.includes(id));
  if (!done) return false;
  challenge.status = 'ANSWER_REVEALED';
  const origin = state.players.find((player) => player.id === challenge.originPlayerId);
  if (origin) origin.stats.inheritedExpired += 1;
  addEvent(state, 'ANSWER_REVEALED', `Inherited answer: ${challenge.question.correctAnswer}${challenge.question.reference ? ` (${challenge.question.reference})` : ''}.`);
  return true;
}

function prepareOwnTurn(state: RoadHomeState) {
  const player = activePlayer(state);
  const imprisoned = player.pawns.find((pawn) => pawn.prisonRounds > 0);
  if (imprisoned) {
    state.activePrisonPawnId = imprisoned.id;
    state.phase = 'PRISON_MANAGEMENT';
    addEvent(state, 'TURN_STARTED', `${player.name}'s turn begins with a prison decision.`, player.id);
    return;
  }
  const challenge = unresolvedChallengeFor(state, player.id);
  if (challenge) {
    state.activeChallengeId = challenge.id;
    state.phase = 'INHERITED_OFFER';
    addEvent(state, 'TURN_STARTED', `${player.name} received an inherited challenge worth ${challenge.rolledValue} spaces.`, player.id);
    return;
  }
  state.phase = 'AWAITING_ROLL';
  state.diceValue = null;
  state.currentQuestion = null;
  state.questionPurpose = null;
  state.questionDeadline = null;
  state.legalPawnIds = [];
  state.pendingMoveValue = null;
  state.moveContinuation = null;
  addEvent(state, 'TURN_STARTED', `${player.name}'s turn started.`, player.id);
}

function advanceTurn(state: RoadHomeState) {
  if (state.phase === 'GAME_OVER') return;
  let attempts = 0;
  do {
    state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
    attempts += 1;
  } while ((activePlayer(state).finishedRank || activePlayer(state).forfeited) && attempts <= state.players.length);
  state.turnNumber += 1;
  state.bonusRollsUsed = 0;
  state.activeChallengeId = null;
  state.activePrisonPawnId = null;
  prepareOwnTurn(state);
}

function createChallenge(state: RoadHomeState, question: RoadHomeQuestion, value: number, origin: RoadHomePlayer) {
  const challenge: RoadHomeChallenge = {
    id: uid('challenge'),
    question: { ...question, options: question.options ? [...question.options] : undefined },
    rolledValue: value,
    originPlayerId: origin.id,
    eligiblePlayerIds: state.players.filter((player) => player.id !== origin.id && !player.finishedRank && !player.forfeited).map((player) => player.id),
    attemptedPlayerIds: [],
    declinedPlayerIds: [],
    createdTurnNumber: state.turnNumber,
    status: 'OPEN',
  };
  state.challengeQueue.push(challenge);
  addEvent(state, 'CHALLENGE_CREATED', `${origin.name}'s failed ${value} became an inherited challenge.`, origin.id);
}

function finishGameIfReady(state: RoadHomeState, player: RoadHomePlayer) {
  if (player.pawns.every((pawn) => pawn.progress === ROAD_HOME_CONFIG.finalHome) && !player.finishedRank) {
    player.finishedRank = state.rankings.length + 1;
    state.rankings.push(player.id);
    if (player.finishedRank === 1) {
      state.winnerId = player.id;
      addDenarii(state, player, ROAD_HOME_CONFIG.rewards.firstPlace, 'first place');
    }
    addEvent(state, 'PLAYER_FINISHED', `${player.name} finished in position ${player.finishedRank}.`, player.id);
  }
  const unfinished = state.players.filter((item) => !item.finishedRank && !item.forfeited);
  if (unfinished.length <= 1) {
    if (unfinished[0]) {
      unfinished[0].finishedRank = state.rankings.length + 1;
      state.rankings.push(unfinished[0].id);
    }
    state.phase = 'GAME_OVER';
    addEvent(state, 'GAME_ENDED', `${state.players.find((item) => item.id === state.winnerId)?.name || 'A player'} won The Road Home.`);
    return true;
  }
  return false;
}

export function forfeitRoadHomePlayer(stateInput: RoadHomeState, playerId: string) {
  const state = structuredClone(stateInput) as RoadHomeState;
  if (state.phase === 'GAME_OVER') return state;
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) throw new Error('That player is not in this Road Home match.');
  const player = state.players[playerIndex];
  if (player.isBot) throw new Error('The machine cannot forfeit this match.');
  if (player.forfeited) return state;

  const wasActive = state.activePlayerIndex === playerIndex;
  player.forfeited = true;
  state.challengeQueue.forEach((challenge) => {
    challenge.eligiblePlayerIds = challenge.eligiblePlayerIds.filter((id) => id !== playerId);
  });
  addEvent(state, 'PLAYER_FORFEITED', `${player.name} forfeited The Road Home.`, player.id);

  const contenders = state.players.filter((candidate) => !candidate.forfeited && !candidate.isBot);
  const activeContenders = state.players.filter((candidate) => !candidate.forfeited);
  if (contenders.length <= 1 && activeContenders.length <= 2) {
    const winner = activeContenders.find((candidate) => !candidate.isBot) || activeContenders[0] || null;
    state.winnerId = winner?.id || null;
    if (winner && !state.rankings.includes(winner.id)) {
      winner.finishedRank = 1;
      state.rankings.unshift(winner.id);
    }
    state.phase = 'GAME_OVER';
    state.currentQuestion = null;
    state.questionDeadline = null;
    state.legalPawnIds = [];
    addEvent(state, 'GAME_ENDED', winner ? `${winner.name} won after the opposing player forfeited.` : 'The match ended by forfeiture.');
  } else if (wasActive) {
    state.currentQuestion = null;
    state.questionPurpose = null;
    state.questionDeadline = null;
    state.legalPawnIds = [];
    state.pendingMoveValue = null;
    state.pendingSurprise = null;
    advanceTurn(state);
  }

  state.updatedAt = nowIso();
  state.version += 1;
  return state;
}

function drawPrisonSentence(random: RandomFn) {
  const value = random();
  return value < 0.5 ? 1 : value < 0.85 ? 2 : 3;
}

function drawSurprise(random: RandomFn): RoadHomeSurprise {
  const value = random();
  if (value < 0.35) return { category: 'question', title: 'Wisdom at the Crossroads', detail: 'Answer an extra Bible question for 30 denarii.', reward: 30 };
  if (value < 0.6) return { category: 'verse', title: 'Speak the Word', detail: 'Complete a Scripture challenge for 50 denarii.', reward: 50 };
  if (value < 0.85) {
    const amounts = [20, 20, 20, 20, 40, 40, 40, 60, 60, 80];
    const reward = amounts[Math.floor(random() * amounts.length)];
    return { category: 'denarii', title: reward >= 80 ? 'Treasury' : reward >= 60 ? 'Abundance' : reward >= 40 ? 'Provision' : 'Small Blessing', detail: `Receive ${reward} denarii.`, reward };
  }
  const relics = ['Lamp of Guidance', 'Manna Pouch', 'Sandals of Readiness', 'Shield of Faith', 'Key of Deliverance', 'Scroll of Recall', "Shepherd's Staff", "David's Sling", 'Purse of Provision', 'Trumpet of Breakthrough', 'Rod of Passage', 'Crown of Wisdom', 'Golden Scroll', 'Chariot of Fire'];
  const relic = relics[Math.floor(Math.pow(random(), 1.8) * relics.length)];
  return { category: 'relic', title: 'Relic Discovery', detail: `You discovered ${relic}.`, relic };
}

function finishMovement(state: RoadHomeState) {
  if (state.phase === 'GAME_OVER') return;
  const continuation = state.moveContinuation;
  state.pendingMoveValue = null;
  state.legalPawnIds = [];
  state.currentQuestion = null;
  state.questionPurpose = null;
  state.questionDeadline = null;
  state.activeChallengeId = null;
  if (continuation === 'CONTINUE_OWN_TURN') {
    state.moveContinuation = null;
    state.phase = 'AWAITING_ROLL';
    state.diceValue = null;
    return;
  }
  if (continuation === 'BONUS_OR_END' && state.diceValue === 6 && state.bonusRollsUsed < ROAD_HOME_CONFIG.maxBonusRolls) {
    state.bonusRollsUsed += 1;
    state.moveContinuation = null;
    state.phase = 'AWAITING_ROLL';
    state.diceValue = null;
    addEvent(state, 'BONUS_ROLL', `${activePlayer(state).name} earned another roll.`, activePlayer(state).id);
    return;
  }
  state.moveContinuation = null;
  advanceTurn(state);
}

function resolveLanding(state: RoadHomeState, player: RoadHomePlayer, pawn: RoadHomePawn, random: RandomFn) {
  if (pawn.progress === ROAD_HOME_CONFIG.finalHome) {
    addDenarii(state, player, ROAD_HOME_CONFIG.rewards.pawnHome, 'a pawn reached Home');
    addEvent(state, 'PAWN_HOME', `${player.name}'s pawn ${pawn.number} reached Home.`, player.id);
    if (finishGameIfReady(state, player)) return;
  }
  const target = globalPosition(player, pawn);
  if (target != null && !ROAD_HOME_CONFIG.safeSpaces.includes(target as never) && !ROAD_HOME_CONFIG.prisonSpaces.includes(target as never)) {
    for (const opponent of state.players.filter((item) => item.id !== player.id)) {
      const victims = opponent.pawns.filter((item) => globalPosition(opponent, item) === target && item.prisonRounds === 0);
      if (victims.length !== 1) continue;
      const victim = victims[0];
      if (victim.shielded) {
        victim.shielded = false;
        victim.progress = Math.max(0, victim.progress - 1);
        addEvent(state, 'RELIC_USED', `${opponent.name}'s Shield of Faith prevented a capture.`, opponent.id);
      } else {
        victim.progress = -1;
        victim.prisonRounds = 0;
        opponent.stats.lost += 1;
        player.stats.captured += 1;
        addDenarii(state, player, ROAD_HOME_CONFIG.rewards.capture, 'captured a pawn');
        addEvent(state, 'PAWN_CAPTURED', `${player.name} captured ${opponent.name}'s pawn ${victim.number}.`, player.id);
      }
    }
  }
  if (target != null && ROAD_HOME_CONFIG.prisonSpaces.includes(target as never)) {
    pawn.prisonRounds = drawPrisonSentence(random);
    pawn.imprisonedTurn = state.turnNumber;
    addEvent(state, 'PAWN_IMPRISONED', `${player.name}'s pawn ${pawn.number} was imprisoned for ${pawn.prisonRounds} round${pawn.prisonRounds === 1 ? '' : 's'}.`, player.id);
  }
  if ((target != null && ROAD_HOME_CONFIG.surpriseSpaces.includes(target as never)) || ROAD_HOME_CONFIG.homeSurpriseProgress.includes(pawn.progress as never)) {
    state.pendingSurprise = drawSurprise(random);
    state.phase = 'SURPRISE_CARD';
    addEvent(state, 'SURPRISE_DRAWN', `${player.name} drew ${state.pendingSurprise.title}.`, player.id);
    return;
  }
  finishMovement(state);
}

function movePawn(state: RoadHomeState, pawnId: string, random: RandomFn) {
  const player = activePlayer(state);
  const pawn = player.pawns.find((item) => item.id === pawnId);
  const value = state.pendingMoveValue || 0;
  if (!pawn || !state.legalPawnIds.includes(pawnId) || !legalPawnIds(state, player.id, value).includes(pawnId)) throw new Error('That pawn cannot use this move.');
  const from = pawn.progress;
  pawn.progress = from < 0 ? 0 : from + value;
  player.stats.totalMovement += value;
  addEvent(state, from < 0 ? 'PAWN_DEPLOYED' : 'PAWN_MOVED', from < 0 ? `${player.name} deployed pawn ${pawn.number}.` : `${player.name} moved pawn ${pawn.number} by ${value}.`, player.id);
  resolveLanding(state, player, pawn, random);
}

function continueAfterPrison(state: RoadHomeState) {
  state.activePrisonPawnId = null;
  const challenge = unresolvedChallengeFor(state, activePlayer(state).id);
  if (challenge) {
    state.activeChallengeId = challenge.id;
    state.phase = 'INHERITED_OFFER';
  } else {
    state.phase = 'AWAITING_ROLL';
  }
}

function resolveAnswer(state: RoadHomeState, questions: RoadHomeQuestion[], answer: string, random: RandomFn) {
  const player = activePlayer(state);
  const question = state.currentQuestion;
  const purpose = state.questionPurpose;
  if (!question || !purpose) throw new Error('There is no active question.');
  const correct = answerIsCorrect(question, answer);
  state.questionAttempts += 1;
  if (correct) {
    player.stats.correct += 1;
    addEvent(state, 'QUESTION_CORRECT', `${player.name} chose "${answer}" — correct${question.reference ? ` (${question.reference})` : ''}.`, player.id);
    if (purpose === 'own') {
      addDenarii(state, player, ROAD_HOME_CONFIG.rewards.ownQuestion, 'correct movement question');
      state.pendingMoveValue = state.diceValue;
      state.legalPawnIds = legalPawnIds(state, player.id, state.pendingMoveValue || 0);
      state.moveContinuation = 'BONUS_OR_END';
      state.phase = 'SELECTING_PAWN';
      return;
    }
    if (purpose === 'inherited') {
      const challenge = state.challengeQueue.find((item) => item.id === state.activeChallengeId);
      if (challenge) challenge.status = 'CLAIMED';
      player.stats.inheritedClaimed += 1;
      addDenarii(state, player, ROAD_HOME_CONFIG.rewards.inheritedQuestion, 'claimed an inherited question');
      state.pendingMoveValue = challenge?.rolledValue || 0;
      state.legalPawnIds = legalPawnIds(state, player.id, state.pendingMoveValue);
      if (state.legalPawnIds.length === 0) {
        addDenarii(state, player, Math.ceil(state.pendingMoveValue / 2) * 10, 'converted an inherited move with no legal pawn');
        state.phase = 'AWAITING_ROLL';
        state.activeChallengeId = null;
        state.currentQuestion = null;
        state.questionPurpose = null;
        return;
      }
      state.moveContinuation = 'CONTINUE_OWN_TURN';
      state.phase = 'SELECTING_PAWN';
      return;
    }
    if (purpose === 'prison') {
      const target = pawnById(state, state.activePrisonPawnId || '');
      if (target && target.player.id === player.id) {
        target.pawn.prisonRounds = 0;
        target.pawn.imprisonedTurn = null;
        player.stats.prisonEscapes += 1;
        addEvent(state, 'PAWN_RELEASED', `${player.name}'s pawn ${target.pawn.number} escaped prison by knowledge.`, player.id);
      }
      continueAfterPrison(state);
      return;
    }
    addDenarii(state, player, state.pendingSurprise?.reward || (purpose === 'verse' ? 50 : 30), purpose === 'verse' ? 'Scripture challenge' : 'surprise question');
    state.pendingSurprise = null;
    finishMovement(state);
    return;
  }

  addEvent(state, 'QUESTION_INCORRECT', `${player.name} chose "${answer || 'No answer'}" — incorrect. Correct answer: ${question.correctAnswer}${question.reference ? ` (${question.reference})` : ''}.`, player.id);
  if (purpose === 'own') {
    createChallenge(state, question, state.diceValue || 0, player);
    advanceTurn(state);
    return;
  }
  if (purpose === 'inherited') {
    const challenge = state.challengeQueue.find((item) => item.id === state.activeChallengeId);
    if (challenge) {
      challenge.attemptedPlayerIds.push(player.id);
      expireChallengeIfComplete(state, challenge);
    }
    addDenarii(state, player, -ROAD_HOME_CONFIG.rewards.inheritedPenalty, 'missed an inherited question');
    state.activeChallengeId = null;
    state.currentQuestion = null;
    state.questionPurpose = null;
    state.phase = 'AWAITING_ROLL';
    return;
  }
  if (purpose === 'prison') {
    addEvent(state, 'PRISON_ESCAPE_FAILED', `${player.name}'s pawn remains in prison.`, player.id);
    continueAfterPrison(state);
    return;
  }
  addEvent(state, 'ANSWER_REVEALED', `Surprise answer: ${question.correctAnswer}${question.reference ? ` (${question.reference})` : ''}.`, player.id);
  state.pendingSurprise = null;
  finishMovement(state);
}

export function createRoadHomeGame(roomId: string, participants: RoadHomeParticipant[], sourceQuestions: unknown[], random: RandomFn = Math.random): RoadHomeState {
  if (participants.length < 2 || participants.length > 4) throw new Error('The Road Home needs two to four players.');
  const shuffled = [...participants].sort(() => random() - 0.5);
  const questionPool = normalizeQuestions(sourceQuestions);
  const state: RoadHomeState = {
    roomId,
    version: 1,
    questionPool,
    phase: 'AWAITING_ROLL',
    turnNumber: 1,
    activePlayerIndex: 0,
    players: shuffled.map((participant, playerIndex) => ({
      id: participant.id,
      name: participant.name,
      avatarUrl: participant.avatarUrl,
      colour: ROAD_HOME_CONFIG.colours[playerIndex],
      startOffset: ROAD_HOME_CONFIG.startOffsets[playerIndex],
      isBot: Boolean(participant.isBot),
      forfeited: false,
      denarii: ROAD_HOME_CONFIG.startingDenarii,
      relics: [],
      finishedRank: null,
      stats: stats(),
      pawns: Array.from({ length: 4 }, (_, index) => ({ id: `${participant.id}-pawn-${index + 1}`, number: index + 1, progress: -1, prisonRounds: 0, imprisonedTurn: null, shielded: false })),
    })),
    diceValue: null,
    bonusRollsUsed: 0,
    currentQuestion: null,
    questionPurpose: null,
    questionDeadline: null,
    questionAttempts: 0,
    legalPawnIds: [],
    pendingMoveValue: null,
    moveContinuation: null,
    activeChallengeId: null,
    activePrisonPawnId: null,
    challengeQueue: [],
    pendingSurprise: null,
    usedQuestionIds: [],
    rankings: [],
    eventLog: [],
    winnerId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  addEvent(state, 'GAME_STARTED', `The Road Home began with ${participants.length} players.`);
  addEvent(state, 'TURN_STARTED', `${activePlayer(state).name} takes the first turn.`, activePlayer(state).id);
  return state;
}

export function applyRoadHomeCommand(stateInput: RoadHomeState, actorId: string, command: RoadHomeCommand, questionsInput: unknown[], random: RandomFn = Math.random) {
  if (command.action === 'FORFEIT') return forfeitRoadHomePlayer(stateInput, actorId);
  const state = structuredClone(stateInput) as RoadHomeState;
  const questions = normalizeQuestions(questionsInput);
  const player = activePlayer(state);
  if (state.phase === 'GAME_OVER') throw new Error('This Road Home match is complete.');
  if (player.id !== actorId) throw new Error(`It is ${player.name}'s turn.`);

  if (command.action === 'ROLL') {
    if (state.phase !== 'AWAITING_ROLL') throw new Error('The dice cannot be rolled during this phase.');
    const value = Math.floor(random() * 6) + 1;
    state.diceValue = value;
    addEvent(state, 'DICE_ROLLED', `${player.name} rolled ${value}.`, player.id);
    const legal = legalPawnIds(state, player.id, value);
    if (legal.length === 0) {
      addEvent(state, 'NO_LEGAL_MOVE', `${player.name} has no legal move for ${value}.`, player.id);
      advanceTurn(state);
    } else {
      state.legalPawnIds = legal;
      setQuestion(state, drawQuestion(state, questions, difficultyForRoll(value), random), 'own');
    }
  } else if (command.action === 'ANSWER') {
    if (state.phase !== 'QUESTION') throw new Error('There is no question to answer.');
    resolveAnswer(state, questions, command.answer, random);
  } else if (command.action === 'MOVE') {
    if (state.phase !== 'SELECTING_PAWN') throw new Error('A pawn cannot be moved now.');
    movePawn(state, command.pawnId, random);
  } else if (command.action === 'CHALLENGE_DECISION') {
    if (state.phase !== 'INHERITED_OFFER') throw new Error('There is no inherited challenge to decide.');
    const challenge = state.challengeQueue.find((item) => item.id === state.activeChallengeId);
    if (!challenge) throw new Error('The inherited challenge is no longer available.');
    if (command.decision === 'decline') {
      challenge.declinedPlayerIds.push(player.id);
      expireChallengeIfComplete(state, challenge);
      addEvent(state, 'CHALLENGE_DECLINED', `${player.name} declined and forfeited the turn.`, player.id);
      advanceTurn(state);
    } else {
      addEvent(state, 'CHALLENGE_ACCEPTED', `${player.name} accepted the inherited ${challenge.rolledValue}.`, player.id);
      setQuestion(state, challenge.question, 'inherited');
    }
  } else if (command.action === 'PRISON_ACTION') {
    if (state.phase !== 'PRISON_MANAGEMENT') throw new Error('There is no prison decision now.');
    const target = pawnById(state, command.pawnId);
    if (!target || target.player.id !== player.id || target.pawn.prisonRounds <= 0) throw new Error('That pawn is not imprisoned.');
    state.activePrisonPawnId = target.pawn.id;
    if (command.decision === 'pay') {
      const fine = target.pawn.prisonRounds * 40;
      if (player.denarii < fine) throw new Error(`You need ${fine} denarii to pay this fine.`);
      addDenarii(state, player, -fine, 'prison fine');
      target.pawn.prisonRounds = 0;
      target.pawn.imprisonedTurn = null;
      player.stats.prisonEscapes += 1;
      addEvent(state, 'PAWN_RELEASED', `${player.name} paid to release pawn ${target.pawn.number}.`, player.id);
      continueAfterPrison(state);
    } else if (command.decision === 'serve') {
      player.pawns.filter((pawn) => pawn.prisonRounds > 0 && pawn.imprisonedTurn !== state.turnNumber).forEach((pawn) => {
        pawn.prisonRounds = Math.max(0, pawn.prisonRounds - 1);
        if (pawn.prisonRounds === 0) pawn.imprisonedTurn = null;
      });
      addEvent(state, 'PRISON_SERVED', `${player.name} served the prison sentence for this turn.`, player.id);
      continueAfterPrison(state);
    } else {
      setQuestion(state, drawQuestion(state, questions, 'very_hard', random), 'prison');
    }
  } else if (command.action === 'ACK_SURPRISE') {
    if (state.phase !== 'SURPRISE_CARD' || !state.pendingSurprise) throw new Error('There is no Surprise Card to resolve.');
    const card = state.pendingSurprise;
    if (card.category === 'denarii') {
      addDenarii(state, player, card.reward || 0, card.title);
      state.pendingSurprise = null;
      finishMovement(state);
    } else if (card.category === 'relic') {
      if (player.relics.length < 3 && card.relic) {
        player.relics.push(card.relic);
        player.stats.relicsFound += 1;
        addEvent(state, 'RELIC_FOUND', `${player.name} found ${card.relic}.`, player.id);
      } else {
        addDenarii(state, player, 20, 'converted an overflowing relic');
      }
      state.pendingSurprise = null;
      finishMovement(state);
    } else {
      setQuestion(state, drawQuestion(state, questions, card.category === 'verse' ? 'hard' : 'medium', random), card.category);
    }
  } else if (command.action === 'USE_RELIC') {
    const relicIndex = player.relics.indexOf(command.relic);
    if (relicIndex < 0) throw new Error('You do not own that relic in this match.');
    if (command.relic === 'Manna Pouch') addDenarii(state, player, 40, 'Manna Pouch');
    else if (command.relic === 'Key of Deliverance') {
      const imprisoned = player.pawns.find((pawn) => pawn.prisonRounds > 0);
      if (!imprisoned) throw new Error('No pawn needs the Key of Deliverance.');
      imprisoned.prisonRounds = 0;
      imprisoned.imprisonedTurn = null;
      player.stats.prisonEscapes += 1;
      if (state.phase === 'PRISON_MANAGEMENT') continueAfterPrison(state);
    } else if (command.relic === 'Lamp of Guidance') {
      if (state.phase !== 'QUESTION' || state.currentQuestion?.type !== 'multiple_choice') throw new Error('The Lamp needs an active multiple-choice question.');
      const wrong = (state.currentQuestion.options || []).filter((option) => !answerIsCorrect(state.currentQuestion!, option));
      state.currentQuestion.options = (state.currentQuestion.options || []).filter((option) => !wrong.slice(0, 2).includes(option));
    } else if (command.relic === 'Scroll of Recall') {
      if (state.phase !== 'QUESTION' || !state.currentQuestion) throw new Error('The Scroll needs an active question.');
      setQuestion(state, drawQuestion(state, questions, state.currentQuestion.difficulty, random), state.questionPurpose || 'own');
    } else if (command.relic === 'Golden Scroll') {
      if (state.phase !== 'QUESTION' || state.questionPurpose !== 'own' || !state.currentQuestion) throw new Error('The Golden Scroll only answers a normal movement question.');
      resolveAnswer(state, questions, state.currentQuestion.correctAnswer, random);
    } else if (command.relic === "Shepherd's Staff") {
      if (state.phase !== 'INHERITED_OFFER') throw new Error("The Shepherd's Staff is used on an inherited offer.");
      const challenge = state.challengeQueue.find((item) => item.id === state.activeChallengeId);
      if (challenge) challenge.declinedPlayerIds.push(player.id);
      state.activeChallengeId = null;
      state.phase = 'AWAITING_ROLL';
    } else if (command.relic === 'Shield of Faith') {
      const target = player.pawns.find((pawn) => pawn.id === command.pawnId && pawn.progress >= 0 && pawn.progress < ROAD_HOME_CONFIG.trackLength);
      if (!target) throw new Error('Choose an active road pawn for the Shield.');
      target.shielded = true;
    } else {
      throw new Error(`${command.relic} needs a movement or combat opportunity that is not active now.`);
    }
    player.relics.splice(relicIndex, 1);
    player.stats.relicsUsed += 1;
    addEvent(state, 'RELIC_USED', `${player.name} used ${command.relic}.`, player.id);
  }

  state.updatedAt = nowIso();
  state.version += 1;
  return state;
}

export function runRoadHomeBots(stateInput: RoadHomeState, questionsInput: unknown[], random: RandomFn = Math.random) {
  let state = stateInput;
  let guard = 0;
  while (state.phase !== 'GAME_OVER' && activePlayer(state).isBot && guard < 80) {
    guard += 1;
    const bot = activePlayer(state);
    if (state.phase === 'PRISON_MANAGEMENT') {
      const pawn = bot.pawns.find((item) => item.prisonRounds > 0)!;
      const fine = pawn.prisonRounds * 40;
      state = applyRoadHomeCommand(state, bot.id, { action: 'PRISON_ACTION', pawnId: pawn.id, decision: bot.denarii >= fine ? 'pay' : 'serve' }, questionsInput, random);
    } else if (state.phase === 'INHERITED_OFFER') {
      state = applyRoadHomeCommand(state, bot.id, { action: 'CHALLENGE_DECISION', decision: random() < 0.72 ? 'accept' : 'decline' }, questionsInput, random);
    } else if (state.phase === 'AWAITING_ROLL') {
      state = applyRoadHomeCommand(state, bot.id, { action: 'ROLL' }, questionsInput, random);
    } else if (state.phase === 'QUESTION') {
      const chance = state.currentQuestion?.difficulty === 'easy' ? 0.78 : state.currentQuestion?.difficulty === 'medium' ? 0.68 : state.currentQuestion?.difficulty === 'hard' ? 0.56 : 0.46;
      const answer = random() < chance ? state.currentQuestion?.correctAnswer || '' : '__machine_missed__';
      state = applyRoadHomeCommand(state, bot.id, { action: 'ANSWER', answer }, questionsInput, random);
    } else if (state.phase === 'SELECTING_PAWN') {
      const pawnId = [...state.legalPawnIds].sort((a, b) => {
        const aPawn = pawnById(state, a)?.pawn;
        const bPawn = pawnById(state, b)?.pawn;
        return (bPawn?.progress || -1) - (aPawn?.progress || -1);
      })[0];
      state = applyRoadHomeCommand(state, bot.id, { action: 'MOVE', pawnId }, questionsInput, random);
    } else if (state.phase === 'SURPRISE_CARD') {
      state = applyRoadHomeCommand(state, bot.id, { action: 'ACK_SURPRISE' }, questionsInput, random);
    }
  }
  return state;
}

export function publicRoadHomeState(stateInput: RoadHomeState) {
  const state = structuredClone(stateInput) as RoadHomeState;
  state.questionPool = [];
  if (state.currentQuestion) {
    state.currentQuestion.correctAnswer = '';
    state.currentQuestion.acceptedAnswers = [];
    state.currentQuestion.explanation = '';
  }
  state.challengeQueue = state.challengeQueue.map((challenge) => ({
    ...challenge,
    question: {
      ...challenge.question,
      correctAnswer: challenge.status === 'ANSWER_REVEALED' ? challenge.question.correctAnswer : '',
      acceptedAnswers: [],
      explanation: challenge.status === 'ANSWER_REVEALED' ? challenge.question.explanation : '',
    },
  }));
  return state;
}
