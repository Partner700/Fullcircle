export type JourneyPoint = { x: number; y: number };
export const JOURNEY_BOARD_SIZE = 720;
// Fifty-one distinct rectangular spaces on one closed perimeter.
export const JOURNEY_MAIN_POINTS: readonly JourneyPoint[] = [
  ...Array.from({ length: 14 }, (_, index) => ({ x: 32 + index * 656 / 13, y: 32 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 688, y: 32 + (index + 1) * 656 / 13 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 688 - (index + 1) * 656 / 13, y: 688 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 32, y: 688 - (index + 1) * 656 / 12 })),
];

export const JOURNEY_LOOP_POINTS: readonly JourneyPoint[] = [
  { x: 240, y: 310 }, { x: 320, y: 310 }, { x: 400, y: 310 }, { x: 480, y: 310 },
  { x: 480, y: 400 }, { x: 480, y: 490 }, { x: 400, y: 490 }, { x: 320, y: 490 },
  { x: 240, y: 490 }, { x: 240, y: 400 },
];
export const JOURNEY_PRISON_POINTS = { holding: { x: 133, y: 400 }, deep: { x: 587, y: 400 } };

export function journeyMainPoint(space: number): JourneyPoint {
  const point = JOURNEY_MAIN_POINTS[space - 1];
  if (!point) throw new Error(`Main-path space ${space} is not on the board.`);
  return point;
}

export function journeyLoopPoint(space: number): JourneyPoint {
  const point = JOURNEY_LOOP_POINTS[space - 1];
  if (!point) throw new Error(`Trials space ${space} is not on the board.`);
  return point;
}
