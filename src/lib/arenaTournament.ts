export type ArenaTournamentSlot = {
  index: number;
  round: number;
  match: number;
  label: string;
  sourceIndexes: [number, number] | null;
  group?: number;
};

export type ArenaTournamentStart = 'groups' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'final';

export function placeTournamentFixturePlayer(
  draft: Record<string, [string, string]>, gameId: string, side: 0 | 1,
  playerId: string, knockout: boolean, lockedGameIds: ReadonlySet<string> = new Set(),
): Record<string, [string, string]> {
  const previous = draft[gameId]?.[side];
  if (!previous || previous === playerId || draft[gameId][1 - side] === playerId) return draft;
  const occupied = knockout ? Object.entries(draft).find(([id, pair]) => id !== gameId && pair.includes(playerId)) : undefined;
  if (occupied && lockedGameIds.has(occupied[0])) return draft;
  const updated = Object.fromEntries(Object.entries(draft).map(([id, pair]) => [id, [...pair] as [string, string]]));
  if (occupied) updated[occupied[0]][occupied[1][0] === playerId ? 0 : 1] = previous;
  updated[gameId][side] = playerId;
  return updated;
}

export function arenaTournamentEntrants(start: ArenaTournamentStart, groupEntrants: 8 | 16 | 32 = 8): number {
  if (start === 'groups') return groupEntrants;
  return { round_of_16: 16, quarterfinal: 8, semifinal: 4, final: 2 }[start];
}

export function arenaTournamentSlots(playerCount: number, hasGroups = false): ArenaTournamentSlot[] {
  if (!Number.isInteger(playerCount) || ![2, 4, 8, 16, 32].includes(playerCount)
    || (hasGroups && ![8, 16, 32].includes(playerCount)) || (!hasGroups && playerCount === 32)) {
    throw new Error('Choose a supported tournament size.');
  }
  const slots: ArenaTournamentSlot[] = [];
  if (hasGroups) {
    const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let group = 1; group <= playerCount / 4; group += 1) {
      for (let match = 1; match <= pairs.length; match += 1) {
        slots.push({
          index: slots.length, round: 0, match: (group - 1) * 6 + match,
          label: `Group ${String.fromCharCode(64 + group)} - Game ${match}`,
          sourceIndexes: null, group,
        });
      }
    }
  }
  let previous: number[] = [];
  let matches = hasGroups ? playerCount / 4 : playerCount / 2;
  let round = 1;
  while (matches >= 1) {
    const current: number[] = [];
    for (let match = 1; match <= matches; match += 1) {
      const index = slots.length;
      const label = matches === 1 ? 'Final' : matches === 2 ? `Semi-final ${match}`
        : matches === 4 ? `Quarter-final ${match}` : `Round of 16 - Game ${match}`;
      slots.push({
        index, round, match, label,
        sourceIndexes: previous.length ? [previous[(match - 1) * 2], previous[(match - 1) * 2 + 1]] : null,
      });
      current.push(index);
    }
    previous = current;
    matches /= 2;
    round += 1;
  }
  return slots;
}

export function validateArenaTournamentTimes(playerCount: number, values: string[], now = Date.now(), hasGroups = false): string | null {
  const slots = arenaTournamentSlots(playerCount, hasGroups);
  if (values.length !== slots.length || values.some((value) => !value)) return 'Choose a date and time for every game.';
  const timestamps = values.map((value) => new Date(value).getTime());
  if (timestamps.some((time) => !Number.isFinite(time) || time < now + 2 * 60_000 || time > now + 90 * 86_400_000)) {
    return 'Schedule every game between two minutes and 90 days from now.';
  }
  for (const slot of slots) {
    if (hasGroups && slot.round === 1) {
      const groupEnd = Math.max(...timestamps.slice(0, playerCount * 6 / 4));
      if (timestamps[slot.index] < groupEnd + 20 * 60_000) {
        return `${slot.label} must start at least 20 minutes after the group stage.`;
      }
    }
    if (!slot.sourceIndexes) continue;
    const [left, right] = slot.sourceIndexes;
    if (timestamps[slot.index] < Math.max(timestamps[left], timestamps[right]) + 20 * 60_000) {
      return `${slot.label} must start at least 20 minutes after both preceding games.`;
    }
  }
  return null;
}
