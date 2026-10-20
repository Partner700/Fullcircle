export type JourneyLocation =
  | { route: 'main'; space: number }
  | { route: 'loop'; space: number }
  | { route: 'prison'; prison: 'holding' | 'deep' };

export type JourneyEffect =
  | { kind: 'move'; by?: number; to?: number; activateLanding?: boolean }
  | { kind: 'milestone' }
  | { kind: 'prison'; prison: 'holding' | 'deep' }
  | { kind: 'loop'; entrance: number }
  | { kind: 'loop_shift'; to: number }
  | { kind: 'swap'; opponent: 'leader' | 'last' }
  | { kind: 'all_move'; by: number }
  | { kind: 'sequence'; effects: JourneyEffect[] }
  | { kind: 'delayed'; effect: JourneyEffect }
  | { kind: 'transfer_delayed' }
  | { kind: 'choice'; choices: [JourneyEffect, JourneyEffect] }
  | { kind: 'trial'; success: JourneyEffect; failure: JourneyEffect }
  | { kind: 'extend_prison'; turns: number }
  | { kind: 'no_op' };

export type JourneyTrap = { id: string; name: string; effect: JourneyEffect };
export type JourneyConfig = {
  finishSpace: 51;
  winningLaps: number;
  finalChallengeSpace: 50;
  loopLength: number;
  loopEntrances: [number, number];
  ordinaryExit: number;
  surpriseExit: number;
  promotionBonus: number;
  prisonTurns: { holding: number; deep: number };
  maximumChainDepth: number;
  milestones: { space: number; title: string; questionStage: number }[];
  traps: Record<number, JourneyTrap>;
};

export type JourneyPlayer = {
  id: string;
  location: JourneyLocation;
  status: 'ACTIVE' | 'TRAPPED_IN_LOOP' | 'IN_HOLDING_PRISON' | 'IN_DEEP_PRISON' | 'FINISHED';
  loopEntryMainSpace: number | null;
  completedLoopCircuits: number;
  loopEscapes: number;
  prisonTurnsRemaining: number;
  savedLocation: JourneyLocation | null;
  pendingEffects: JourneyEffect[];
  correctAnswers: number;
  completedLaps?: number;
};

export type JourneyEvent = {
  sequence: number;
  source: string;
  targetPlayerId: string;
  effectType: string;
  previousLocation: JourneyLocation;
  newLocation: JourneyLocation;
  resolution: 'applied' | 'pending' | 'skipped';
  reason?: string;
  animation: 'forward' | 'backward' | 'loop' | 'prison' | 'swap' | 'reveal' | 'none';
};

export type JourneyPendingAction = {
  playerId: string;
  kind: 'choice' | 'trial';
  source: string;
  choices: [JourneyEffect, JourneyEffect];
} | null;

export type JourneyGame = {
  players: JourneyPlayer[];
  turnIndex: number;
  status: 'playing' | 'finished';
  winnerId: string | null;
  pendingAction: JourneyPendingAction;
  events: JourneyEvent[];
  version: number;
};

export const JOURNEY_MACHINE_ID = '00000000-0000-0000-0000-000000000000';

const main = (space: number): JourneyLocation => ({ route: 'main', space });
const loop = (space: number): JourneyLocation => ({ route: 'loop', space });
const prison = (name: 'holding' | 'deep'): JourneyLocation => ({ route: 'prison', prison: name });

export const JOURNEY_TRAP_LIBRARY: Record<string, JourneyTrap> = {
  return_start: { id: 'return_start', name: 'Return to Start', effect: { kind: 'move', to: 1 } },
  seven_behind: { id: 'seven_behind', name: 'Seven Steps Behind', effect: { kind: 'move', by: -7 } },
  great_fall: { id: 'great_fall', name: 'The Great Fall', effect: { kind: 'move', by: -20 } },
  almost_there: { id: 'almost_there', name: 'Almost There', effect: { kind: 'move', to: 7 } },
  reversal: { id: 'reversal', name: 'The Reversal', effect: { kind: 'milestone' } },
  collapse: { id: 'collapse', name: 'The Collapse', effect: { kind: 'move', to: 1 } },
  ten_forward: { id: 'ten_forward', name: 'Ten Steps Forward', effect: { kind: 'move', by: 10 } },
  elevation: { id: 'elevation', name: 'The Unexpected Elevation', effect: { kind: 'move', to: 42 } },
  dangerous_gift: { id: 'dangerous_gift', name: 'The Dangerous Gift', effect: { kind: 'move', by: 8, activateLanding: true } },
  trial: { id: 'trial', name: 'The Trial', effect: { kind: 'trial', success: { kind: 'move', by: 12 }, failure: { kind: 'prison', prison: 'deep' } } },
  final_trial: { id: 'final_trial', name: 'The Final Challenge', effect: { kind: 'trial', success: { kind: 'no_op' }, failure: { kind: 'prison', prison: 'deep' } } },
  captured: { id: 'captured', name: 'Captured', effect: { kind: 'prison', prison: 'holding' } },
  condemned: { id: 'condemned', name: 'Condemned', effect: { kind: 'prison', prison: 'deep' } },
  false_freedom: { id: 'false_freedom', name: 'False Freedom', effect: { kind: 'prison', prison: 'deep' } },
  extended_sentence: { id: 'extended_sentence', name: 'Extended Sentence', effect: { kind: 'extend_prison', turns: 2 } },
  snare: { id: 'snare', name: 'The Snare', effect: { kind: 'loop', entrance: 23 } },
  return_maze: { id: 'return_maze', name: 'Return to the Maze', effect: { kind: 'loop', entrance: 30 } },
  endless_circuit: { id: 'endless_circuit', name: 'The Endless Circuit', effect: { kind: 'loop_shift', to: 1 } },
  false_exit: { id: 'false_exit', name: 'The False Exit', effect: { kind: 'no_op' } },
  great_exchange: { id: 'great_exchange', name: 'The Great Exchange', effect: { kind: 'swap', opponent: 'leader' } },
  last_first: { id: 'last_first', name: 'The Last Shall Be First', effect: { kind: 'swap', opponent: 'last' } },
  rivals_choice: { id: 'rivals_choice', name: "The Rival's Choice", effect: { kind: 'choice', choices: [{ kind: 'move', by: -20 }, { kind: 'prison', prison: 'deep' }] } },
  burden_transfer: { id: 'burden_transfer', name: 'The Burden Transfer', effect: { kind: 'transfer_delayed' } },
  collective_fall: { id: 'collective_fall', name: 'The Collective Fall', effect: { kind: 'all_move', by: -5 } },
  double_disaster: { id: 'double_disaster', name: 'Double Disaster', effect: { kind: 'sequence', effects: [{ kind: 'move', by: -7 }, { kind: 'prison', prison: 'holding' }] } },
  chain: { id: 'chain', name: 'The Chain of Consequences', effect: { kind: 'move', to: 37, activateLanding: true } },
  cursed_step: { id: 'cursed_step', name: 'The Cursed Step', effect: { kind: 'delayed', effect: { kind: 'move', by: -7 } } },
  betrayal: { id: 'betrayal', name: 'The Betrayal', effect: { kind: 'sequence', effects: [{ kind: 'move', by: 5 }, { kind: 'delayed', effect: { kind: 'move', by: -10 } }] } },
  unstable_ground: { id: 'unstable_ground', name: 'The Unstable Ground', effect: { kind: 'sequence', effects: [{ kind: 'move', to: 24, activateLanding: true }, { kind: 'move', by: -5, activateLanding: true }] } },
  kings_decree: { id: 'kings_decree', name: "The King's Decree", effect: { kind: 'all_move', by: -7 } },
  great_collapse: { id: 'great_collapse', name: 'The Great Collapse', effect: { kind: 'sequence', effects: [{ kind: 'move', to: 1 }, { kind: 'prison', prison: 'deep' }] } },
};

export const DEFAULT_JOURNEY_CONFIG: JourneyConfig = {
  finishSpace: 51,
  winningLaps: 3,
  finalChallengeSpace: 50,
  loopLength: 10,
  loopEntrances: [23, 30],
  ordinaryExit: 6,
  surpriseExit: 10,
  promotionBonus: 10,
  prisonTurns: { holding: 2, deep: 3 },
  maximumChainDepth: 12,
  milestones: [
    { space: 1, title: 'Beginning', questionStage: 1 },
    { space: 9, title: 'Disruption', questionStage: 1 },
    { space: 16, title: 'Calling', questionStage: 2 },
    { space: 23, title: 'Preparation', questionStage: 3 },
    { space: 31, title: 'Great Fight', questionStage: 4 },
    { space: 40, title: 'Recognition', questionStage: 5 },
    { space: 47, title: 'Outcome', questionStage: 5 },
  ],
  traps: Object.fromEntries([
    [5, 'ten_forward'], [11, 'captured'], [18, 'seven_behind'],
    [24, 'chain'], [26, 'great_exchange'], [32, 'dangerous_gift'],
    [35, 'great_fall'], [37, 'condemned'], [39, 'collective_fall'],
    [41, 'elevation'], [44, 'almost_there'], [46, 'trial'],
    [50, 'final_trial'],
  ].map(([space, id]) => [Number(space), JOURNEY_TRAP_LIBRARY[String(id)]])),
};

export function createJourneyGame(playerIds: string[]): JourneyGame {
  if (playerIds.length < 1 || new Set(playerIds).size !== playerIds.length) throw new Error('Journey players must be unique.');
  return {
    players: playerIds.map((id) => ({
      id, location: main(1), status: 'ACTIVE', loopEntryMainSpace: null,
      completedLoopCircuits: 0, loopEscapes: 0, prisonTurnsRemaining: 0,
      savedLocation: null, pendingEffects: [], correctAnswers: 0, completedLaps: 0,
    })),
    turnIndex: 0, status: 'playing', winnerId: null, pendingAction: null, events: [], version: 0,
  };
}

export function journeyQuestionStage(config: JourneyConfig, location: JourneyLocation): number {
  const space = location.route === 'main' ? location.space : 1;
  return [...config.milestones].reverse().find((milestone) => space >= milestone.space)?.questionStage || 1;
}

function copyGame(game: JourneyGame): JourneyGame {
  return structuredClone(game);
}

function statusFor(location: JourneyLocation): JourneyPlayer['status'] {
  if (location.route === 'loop') return 'TRAPPED_IN_LOOP';
  if (location.route === 'prison') return location.prison === 'holding' ? 'IN_HOLDING_PRISON' : 'IN_DEEP_PRISON';
  return 'ACTIVE';
}

function record(game: JourneyGame, player: JourneyPlayer, source: string, effectType: string,
  previousLocation: JourneyLocation, animation: JourneyEvent['animation'],
  resolution: JourneyEvent['resolution'] = 'applied', reason?: string) {
  game.events.push({ sequence: (game.events[game.events.length - 1]?.sequence || 0) + 1, source, targetPlayerId: player.id,
    effectType, previousLocation, newLocation: structuredClone(player.location), resolution, reason, animation });
  if (game.events.length > 100) game.events.splice(0, game.events.length - 100);
}

function nextTurn(game: JourneyGame) {
  if (game.status !== 'playing') return;
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
}

type QueuedEffect = { playerId: string; source: string; effect: JourneyEffect; key: string };

function landingEffect(config: JourneyConfig, player: JourneyPlayer): QueuedEffect | null {
  if (player.location.route !== 'main') return null;
  const space = player.location.space;
  if (space === 1 || space === config.finishSpace) return null;
  if (config.loopEntrances.includes(space)) {
    return { playerId: player.id, source: `main:${space}`, effect: { kind: 'loop', entrance: space }, key: `entrance:${space}` };
  }
  const trap = config.traps[space];
  return trap ? { playerId: player.id, source: `main:${space}`, effect: trap.effect, key: trap.id } : null;
}

function resolveEffects(game: JourneyGame, config: JourneyConfig, initial: QueuedEffect[]) {
  const queue = [...initial];
  const seen = new Set<string>();
  let depth = 0;
  while (queue.length > 0) {
    const item = queue.shift()!;
    const player = game.players.find((candidate) => candidate.id === item.playerId);
    if (!player) continue;
    const signature = `${player.id}:${item.key}:${JSON.stringify(player.location)}`;
    if (depth >= config.maximumChainDepth || seen.has(signature)) {
      record(game, player, item.source, item.effect.kind, player.location, 'none', 'skipped',
        depth >= config.maximumChainDepth ? 'chain-depth-limit' : 'repeated-state');
      break;
    }
    seen.add(signature);
    depth += 1;
    const previous = structuredClone(player.location);
    const effect = item.effect;
    let animation: JourneyEvent['animation'] = 'none';
    let followLanding = false;
    switch (effect.kind) {
      case 'move': {
        if (player.location.route !== 'main') break;
        const target = Math.max(1, Math.min(config.finalChallengeSpace - 1, effect.to ?? player.location.space + (effect.by || 0)));
        animation = target >= player.location.space ? 'forward' : 'backward';
        player.location = main(target);
        followLanding = effect.activateLanding !== false;
        break;
      }
      case 'milestone':
        if (player.location.route !== 'main' || previous.route !== 'main') break;
        player.location = main([...config.milestones].reverse().find((milestone) => milestone.space < previous.space)?.space || 1);
        animation = 'backward';
        break;
      case 'prison':
        if (player.location.route === 'prison') break;
        player.savedLocation = structuredClone(player.location);
        player.location = prison(effect.prison);
        player.prisonTurnsRemaining = config.prisonTurns[effect.prison];
        animation = 'prison';
        break;
      case 'loop':
        if (player.location.route === 'prison' || (item.key === 'return_maze' && player.loopEscapes === 0)) break;
        player.loopEntryMainSpace = effect.entrance;
        player.location = loop(1);
        animation = 'loop';
        break;
      case 'loop_shift':
        if (player.location.route !== 'loop') break;
        player.location = loop(Math.max(1, Math.min(config.loopLength, effect.to)));
        animation = 'loop';
        break;
      case 'swap': {
        if (player.location.route !== 'main') break;
        const candidates = game.players.filter((other) => other.id !== player.id && other.location.route === 'main' && other.status !== 'FINISHED');
        candidates.sort((a, b) => ((a.completedLaps || 0) - (b.completedLaps || 0)) * config.finishSpace
          + (a.location as { space: number }).space - (b.location as { space: number }).space);
        const opponent = effect.opponent === 'last' ? candidates[0] : candidates[candidates.length - 1];
        if (!opponent) break;
        const opponentPrevious = structuredClone(opponent.location);
        opponent.location = previous;
        player.location = opponentPrevious;
        animation = 'swap';
        record(game, opponent, item.source, 'swap', opponentPrevious, animation);
        break;
      }
      case 'all_move':
        for (const other of game.players) {
          if (other.location.route !== 'main' || other.status === 'FINISHED') continue;
          const from = structuredClone(other.location);
          other.location = main(Math.max(1, Math.min(config.finalChallengeSpace - 1, other.location.space + effect.by)));
          record(game, other, item.source, 'all_move', from, effect.by < 0 ? 'backward' : 'forward');
        }
        break;
      case 'sequence':
        queue.unshift(...effect.effects.map((part, index) => ({ ...item, effect: part, key: `${item.key}:part:${index}` })));
        break;
      case 'delayed':
        player.pendingEffects.push(effect.effect);
        break;
      case 'transfer_delayed': {
        const other = game.players.find((candidate) => candidate.id !== player.id && candidate.status !== 'FINISHED');
        if (other && player.pendingEffects.length) other.pendingEffects.push(player.pendingEffects.shift()!);
        break;
      }
      case 'choice':
      case 'trial':
        game.pendingAction = { playerId: player.id, kind: effect.kind, source: item.source,
          choices: effect.kind === 'choice' ? effect.choices : [effect.success, effect.failure] };
        record(game, player, item.source, effect.kind, previous, 'none', 'pending');
        return;
      case 'extend_prison':
        if (player.location.route === 'prison') player.prisonTurnsRemaining = Math.min(5, player.prisonTurnsRemaining + effect.turns);
        break;
      case 'no_op':
        break;
    }
    player.status = statusFor(player.location);
    record(game, player, item.source, effect.kind, previous, animation);
    if (followLanding) {
      const next = landingEffect(config, player);
      if (next) queue.unshift(next);
    }
  }
}

export function resolveJourneyRoll(original: JourneyGame, playerId: string, die: number,
  config: JourneyConfig = DEFAULT_JOURNEY_CONFIG): JourneyGame {
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error('A die result must be between 1 and 6.');
  if (original.status !== 'playing' || original.pendingAction || original.players[original.turnIndex]?.id !== playerId) {
    throw new Error('It is not this player\'s turn.');
  }
  const game = copyGame(original);
  const player = game.players[game.turnIndex];
  const previous = structuredClone(player.location);
  if (player.location.route === 'prison') throw new Error('A prisoner must serve a turn, not roll a die.');
  player.correctAnswers += 1;
  const dueEffects = player.pendingEffects.splice(0);
  if (player.location.route === 'loop') {
    const startIndex = player.location.space - 1;
    const endIndex = startIndex + die;
    player.completedLoopCircuits += Math.floor(endIndex / config.loopLength);
    const landingLoopSpace = (endIndex % config.loopLength) + 1;
    player.location = loop(landingLoopSpace);
    record(game, player, 'die', 'loop-move', previous, 'loop');
    if (landingLoopSpace === config.ordinaryExit || landingLoopSpace === config.surpriseExit) {
      const promoted = landingLoopSpace === config.surpriseExit;
      const destination = Math.min(config.finalChallengeSpace - 1, (player.loopEntryMainSpace || config.loopEntrances[0]) + 1
        + (promoted ? config.promotionBonus : 0));
      const from = structuredClone(player.location);
      player.location = main(destination);
      player.status = 'ACTIVE';
      player.loopEntryMainSpace = null;
      player.loopEscapes += 1;
      record(game, player, promoted ? 'surprise-card' : 'ordinary-escape', promoted ? 'promotion' : 'escape', from,
        promoted ? 'reveal' : 'forward');
    }
  } else {
    const progress = player.location.space - 1 + die;
    const crossedStart = Math.floor(progress / config.finishSpace);
    player.completedLaps = (player.completedLaps || 0) + crossedStart;
    const won = player.completedLaps >= config.winningLaps;
    player.location = main(won ? 1 : progress % config.finishSpace + 1);
    record(game, player, 'die', 'main-move', previous, 'forward');
    if (crossedStart) record(game, player, 'lap-complete', 'lap', previous, 'reveal');
    // The race ends as the third earned lap crosses Start, before any further square.
    if (won) {
      player.status = 'FINISHED';
      game.status = 'finished';
      game.winnerId = player.id;
      record(game, player, 'qualifying-finish', 'victory', player.location, 'reveal');
      game.version += 1;
      return game;
    }
    const effect = landingEffect(config, player);
    if (effect) resolveEffects(game, config, [effect]);
  }
  if (game.pendingAction) {
    player.pendingEffects.unshift(...dueEffects);
  } else {
    if (dueEffects.length && player.location.route !== 'prison') {
      resolveEffects(game, config, dueEffects.map((effect, index) => ({ playerId, source: 'delayed-penalty', effect, key: `delayed:${index}` })));
    }
    if (!game.pendingAction) nextTurn(game);
  }
  game.version += 1;
  return game;
}

export function resolveJourneyMiss(original: JourneyGame, playerId: string): JourneyGame {
  if (original.status !== 'playing' || original.pendingAction || original.players[original.turnIndex]?.id !== playerId) {
    throw new Error('It is not this player\'s turn.');
  }
  const game = copyGame(original);
  const player = game.players[game.turnIndex];
  if (player.location.route === 'prison') throw new Error('A prisoner must serve a turn.');
  record(game, player, 'trivia', 'incorrect-answer', structuredClone(player.location), 'none');
  nextTurn(game);
  game.version += 1;
  return game;
}

export function serveJourneyPrisonTurn(original: JourneyGame, playerId: string,
  config: JourneyConfig = DEFAULT_JOURNEY_CONFIG): JourneyGame {
  if (original.status !== 'playing' || original.pendingAction || original.players[original.turnIndex]?.id !== playerId) {
    throw new Error('It is not this player\'s turn.');
  }
  const game = copyGame(original);
  const player = game.players[game.turnIndex];
  if (player.location.route !== 'prison') throw new Error('Only a prisoner may serve a prison turn.');
  const previous = structuredClone(player.location);
  player.prisonTurnsRemaining -= 1;
  if (player.prisonTurnsRemaining > 0) {
    record(game, player, 'prison-sentence', 'serve-turn', previous, 'none');
  } else {
    const saved = player.savedLocation;
    player.location = previous.prison === 'deep' && saved?.route === 'main'
      ? main(Math.max(1, saved.space - 7)) : saved || main(1);
    player.savedLocation = null;
    player.prisonTurnsRemaining = 0;
    player.status = statusFor(player.location);
    record(game, player, 'prison-release', 'release', previous, 'prison');
    if (previous.prison === 'deep' && player.location.route === 'main') {
      const effect = landingEffect(config, player);
      if (effect) resolveEffects(game, config, [effect]);
    }
  }
  if (!game.pendingAction) nextTurn(game);
  game.version += 1;
  return game;
}

export function resolveJourneyAction(original: JourneyGame, actorId: string, choice: 0 | 1,
  config: JourneyConfig = DEFAULT_JOURNEY_CONFIG): JourneyGame {
  const pending = original.pendingAction;
  if (!pending) throw new Error('There is no journey decision to resolve.');
  if (choice !== 0 && choice !== 1) throw new Error('Choose one of the two outcomes.');
  if (pending.kind === 'trial' && actorId !== pending.playerId) throw new Error('Only the challenged player may answer the trial.');
  if (pending.kind === 'choice' && (actorId === pending.playerId || !original.players.some((player) => player.id === actorId))) {
    throw new Error('An opposing player must make this choice.');
  }
  const game = copyGame(original);
  game.pendingAction = null;
  if (pending.kind === 'trial' && choice === 0) {
    const player = game.players.find((candidate) => candidate.id === pending.playerId);
    if (player) player.correctAnswers += 1;
  }
  resolveEffects(game, config, [{ playerId: pending.playerId, source: pending.source, effect: pending.choices[choice], key: `${pending.kind}:${choice}` }]);
  if (!game.pendingAction) nextTurn(game);
  game.version += 1;
  return game;
}
