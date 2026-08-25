type MovementValue = number | string | null | undefined;

export type BoardMovementInput = {
  currentValue?: MovementValue;
  previousValue?: MovementValue;
  currentRank?: MovementValue;
  previousRank?: MovementValue;
  reportedMovement?: MovementValue;
};

function finiteNumber(value: MovementValue): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveBoardMovement({
  currentValue,
  previousValue,
  currentRank,
  previousRank,
  reportedMovement,
}: BoardMovementInput): -1 | 0 | 1 | null {
  const current = finiteNumber(currentValue);
  const previous = finiteNumber(previousValue);
  if (current !== null && previous !== null) {
    if (current > previous) return 1;
    if (current < previous) return -1;
  }

  const rank = finiteNumber(currentRank);
  const priorRank = finiteNumber(previousRank);
  if (rank !== null && priorRank !== null) {
    if (rank < priorRank) return 1;
    if (rank > priorRank) return -1;
  }

  const reported = finiteNumber(reportedMovement);
  if (reported !== null) return Math.sign(reported) as -1 | 0 | 1;
  if (current !== null && previous !== null) return 0;
  if (rank !== null && priorRank !== null) return 0;
  return null;
}
