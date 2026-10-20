export type JourneyPoint = { x: number; y: number };
export const JOURNEY_BOARD_SIZE = 720;
// Fifty-one distinct rectangular spaces on one closed perimeter.
export const LEGACY_JOURNEY_MAIN_POINTS: readonly JourneyPoint[] = [
  ...Array.from({ length: 14 }, (_, index) => ({ x: 32 + index * 656 / 13, y: 32 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 688, y: 32 + (index + 1) * 656 / 13 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 688 - (index + 1) * 656 / 13, y: 688 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 32, y: 688 - (index + 1) * 656 / 12 })),
];

export const JOURNEY_MAIN_POINTS: readonly JourneyPoint[] = [
  ...Array.from({ length: 12 }, (_, index) => ({ x: 32 + index * 656 / 11, y: 32 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 688, y: 32 + (index + 1) * 656 / 11 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 688 - (index + 1) * 656 / 11, y: 688 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 32, y: 688 - (index + 1) * 656 / 12 })),
];

export function journeyMainPoints(spaces = 45): readonly JourneyPoint[] {
  return spaces === 51 ? LEGACY_JOURNEY_MAIN_POINTS : JOURNEY_MAIN_POINTS;
}

export const JOURNEY_LOOP_POINTS: readonly JourneyPoint[] = [
  { x: 200, y: 285 }, { x: 307, y: 285 }, { x: 413, y: 285 }, { x: 520, y: 285 },
  { x: 520, y: 405 }, { x: 520, y: 525 }, { x: 413, y: 525 }, { x: 307, y: 525 },
  { x: 200, y: 525 }, { x: 200, y: 405 },
];
export const JOURNEY_PRISON_POINTS = { holding: { x: 115, y: 405 }, deep: { x: 605, y: 405 } };

export function journeyMainPoint(space: number, spaces = 45): JourneyPoint {
  const point = journeyMainPoints(spaces)[space - 1];
  if (!point) throw new Error(`Main-path space ${space} is not on the board.`);
  return point;
}

export function journeyLoopPoint(space: number): JourneyPoint {
  const point = JOURNEY_LOOP_POINTS[space - 1];
  if (!point) throw new Error(`Trials space ${space} is not on the board.`);
  return point;
}
