import { DEFAULT_JOURNEY_CONFIG, type JourneyConfig, type JourneyEffect, type JourneyEvent, type JourneyLocation } from '../../supabase/functions/_shared/biblicalJourney.ts';

export type JourneySquare = { title: string; description: string; icon: 'start' | 'crown' | 'book' | 'trials' | 'escape' | 'card' | 'lock' | 'deep' | 'forward' | 'backward' | 'swap' | 'chain' | 'challenge'; tone: 'gold' | 'green' | 'red' | 'grey' | 'blue'; special: boolean };

export function journeyEffectDescription(effect: JourneyEffect): string {
  switch (effect.kind) {
    case 'move': return effect.to !== undefined ? `Move to square ${effect.to}.` : `Move ${Math.abs(effect.by || 0)} squares ${(effect.by || 0) < 0 ? 'back' : 'forward'}.`;
    case 'milestone': return 'Return to your previous story milestone.';
    case 'prison': return effect.prison === 'holding' ? 'Enter Holding Prison. Serve two turns, then return to your saved square.' : 'Enter Deep Prison. Serve three turns, then return seven squares behind your saved main-path position.';
    case 'loop': return 'Enter the Trials. Land exactly on Escape or the Surprise Card to leave.';
    case 'loop_shift': return `Return to Trials square ${effect.to}.`;
    case 'swap': return `Exchange places with the ${effect.opponent === 'leader' ? 'leading' : 'last'} rival.`;
    case 'all_move': return `Every player on the main path moves ${Math.abs(effect.by)} squares ${effect.by < 0 ? 'back' : 'forward'}.`;
    case 'sequence': return effect.effects.map(journeyEffectDescription).join(' ');
    case 'delayed': return `On your next successful move: ${journeyEffectDescription(effect.effect)}`;
    case 'transfer_delayed': return 'Pass your waiting penalty to the leading rival.';
    case 'choice': return `A rival chooses your outcome: ${effect.choices.map(journeyEffectDescription).join(' Or: ')}`;
    case 'trial': return `Answer the challenge correctly. ${effect.success.kind === 'no_op' ? 'Pass and stay here, near the end of this lap.' : journeyEffectDescription(effect.success)} If you miss: ${journeyEffectDescription(effect.failure)}`;
    case 'extend_prison': return `Add ${effect.turns} turns to the prison sentence.`;
    case 'no_op': return 'Stay on your current square.';
  }
}

export function journeySquare(location: JourneyLocation, config: JourneyConfig = DEFAULT_JOURNEY_CONFIG): JourneySquare {
  if (location.route === 'prison') return { title: location.prison === 'holding' ? 'Holding Prison' : 'Deep Prison', description: journeyEffectDescription({ kind: 'prison', prison: location.prison }), icon: location.prison === 'holding' ? 'lock' : 'deep', tone: 'red', special: true };
  if (location.route === 'loop') {
    if (location.space === config.surpriseExit) return { title: 'Surprise Card', description: 'Land exactly here to reveal your card.', icon: 'card', tone: 'gold', special: true };
    if (location.space === config.ordinaryExit) return { title: 'Escape', description: 'Leave the Trials. Return one square ahead of the entrance you used.', icon: 'escape', tone: 'green', special: true };
    return { title: `Trials ${location.space}`, description: 'Correct answers move you but earn no points in the Trials. Land exactly on an exit to escape.', icon: 'trials', tone: 'grey', special: false };
  }
  const space = location.space;
  if (space === 1) return { title: 'Start', description: `Cross Start with an earned roll to complete a lap. The first to complete ${config.winningLaps} laps wins. Transfers never add laps.`, icon: 'start', tone: 'green', special: true };
  if (space === config.finishSpace) return { title: 'Home Stretch', description: 'One more step crosses Start and completes this lap. Keep going until you have completed three laps.', icon: 'crown', tone: 'gold', special: true };
  if (config.loopEntrances.includes(space)) return { title: 'Enter the Trials', description: journeyEffectDescription({ kind: 'loop', entrance: space }), icon: 'trials', tone: 'grey', special: true };
  const trap = config.traps[space];
  if (trap) {
    const effect = trap.effect;
    const icon = effect.kind === 'trial' || effect.kind === 'choice' ? 'challenge'
      : effect.kind === 'prison' ? effect.prison === 'deep' ? 'deep' : 'lock'
      : effect.kind === 'swap' ? 'swap' : trap.id === 'chain' ? 'chain'
      : effect.kind === 'move' && ((effect.by || 0) > 0 || (effect.to || 0) > space) ? 'forward' : 'backward';
    return { title: trap.name, description: journeyEffectDescription(effect) + (effect.kind === 'move' && effect.activateLanding !== false ? ' Any special square you land on also takes effect.' : ''), icon, tone: icon === 'forward' ? 'green' : icon === 'swap' ? 'blue' : 'red', special: true };
  }
  const milestone = config.milestones.find((item) => item.space === space);
  return milestone ? { title: milestone.title, description: `A new moment in the story. Your questions now come from Stage ${milestone.questionStage}.`, icon: 'book', tone: 'gold', special: true }
    : { title: `Square ${space}`, description: 'A correct answer moves you by the number you rolled.', icon: 'book', tone: 'blue', special: false };
}

export function journeyEventSquare(event: JourneyEvent, config: JourneyConfig): JourneySquare | null {
  if (event.resolution === 'skipped') return null;
  if (event.source === 'lap-complete') return { title: 'Lap Complete', description: 'You crossed Start with an earned roll. Another lap is complete!', icon: 'start', tone: 'green', special: true };
  if (event.source === 'surprise-card') return { title: 'Surprise Promotion', description: `You escape the Trials and advance ${config.promotionBonus} extra main-path squares!`, icon: 'card', tone: 'gold', special: true };
  if (event.source === 'ordinary-escape') return { ...journeySquare({ route: 'loop', space: config.ordinaryExit }, config), tone: 'gold' };
  if (event.source === 'prison-release') return { title: 'Released', description: 'Your sentence is complete. You return to the board.', icon: 'escape', tone: 'gold', special: true };
  if (/^main:\d+$/.test(event.source)) {
    const square = journeySquare({ route: 'main', space: Number(event.source.split(':')[1]) }, config);
    const bad = event.newLocation.route === 'prison' || event.newLocation.route === 'loop'
      || event.animation === 'backward' || event.resolution === 'pending'
      || (event.previousLocation.route === 'main' && event.newLocation.route === 'main' && event.newLocation.space < event.previousLocation.space);
    const resolvedChallenge = square.icon === 'challenge' && event.resolution === 'applied';
    return { ...square, tone: bad ? 'red' : 'gold',
      ...(resolvedChallenge ? { title: bad ? 'Challenge Missed' : 'Challenge Passed',
        description: event.newLocation.route === 'prison' ? journeyEffectDescription({ kind: 'prison', prison: event.newLocation.prison })
          : event.newLocation.route === 'main' ? `You stay in the race on square ${event.newLocation.space}.` : square.description } : {}),
    };
  }
  if (event.source === 'die' && event.effectType === 'main-move' && event.newLocation.route === 'main'
    && (event.newLocation.space === config.finishSpace || config.milestones.some((item) => item.space === (event.newLocation as { space: number }).space))
    && !config.loopEntrances.includes(event.newLocation.space)) return journeySquare(event.newLocation, config);
  return null;
}
