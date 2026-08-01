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
  difficulty: 'easy' | 'medium' | 'hard' | 'expert' | 'very_hard';
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
  stats: {
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
  questionPurpose: 'own' | 'inherited' | 'prison' | 'surprise' | 'verse' | null;
  questionDeadline: string | null;
  questionAttempts: number;
  legalPawnIds: string[];
  pendingMoveValue: number | null;
  moveContinuation: string | null;
  activeChallengeId: string | null;
  activePrisonPawnId: string | null;
  challengeQueue: RoadHomeChallenge[];
  pendingSurprise: {
    category: 'question' | 'verse' | 'denarii' | 'relic';
    title: string;
    detail: string;
    reward?: number;
    relic?: string;
  } | null;
  usedQuestionIds: string[];
  rankings: string[];
  eventLog: RoadHomeEvent[];
  winnerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoadHomeResponse = {
  state: RoadHomeState | null;
  version?: number;
  needsInitialization?: boolean;
  duplicate?: boolean;
};
