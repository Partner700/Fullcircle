export type ArenaTournamentSlot = {
  index: number;
  round: number;
  match: number;
  label: string;
  sourceIndexes: [number, number] | null;
};

export function arenaTournamentSlots(playerCount: 4 | 8): ArenaTournamentSlot[] {
  const slots: ArenaTournamentSlot[] = [];
  let previous: number[] = [];
  let matches = playerCount / 2;
  let round = 1;
  while (matches >= 1) {
    const current: number[] = [];
    for (let match = 1; match <= matches; match += 1) {
      const index = slots.length;
      const label = matches === 1 ? 'Final' : matches === 2 ? `Semi-final ${match}` : `Quarter-final ${match}`;
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

export function validateArenaTournamentTimes(playerCount: 4 | 8, values: string[], now = Date.now()): string | null {
  const slots = arenaTournamentSlots(playerCount);
  if (values.length !== slots.length || values.some((value) => !value)) return 'Choose a date and time for every game.';
  const timestamps = values.map((value) => new Date(value).getTime());
  if (timestamps.some((time) => !Number.isFinite(time) || time < now + 2 * 60_000 || time > now + 90 * 86_400_000)) {
    return 'Schedule every game between two minutes and 90 days from now.';
  }
  for (const slot of slots) {
    if (!slot.sourceIndexes) continue;
    const [left, right] = slot.sourceIndexes;
    if (timestamps[slot.index] < Math.max(timestamps[left], timestamps[right]) + 20 * 60_000) {
      return `${slot.label} must start at least 20 minutes after both preceding games.`;
    }
  }
  return null;
}
