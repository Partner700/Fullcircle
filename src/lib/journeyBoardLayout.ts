export type JourneyPoint = { x: number; y: number };

// Follows the submitted serpentine sketch. Space 51 extends its drawn finish at 50.
export const JOURNEY_MAIN_POINTS: readonly JourneyPoint[] = [
  { x: 92, y: 95 }, { x: 170, y: 95 }, { x: 250, y: 95 }, { x: 330, y: 95 },
  { x: 410, y: 95 }, { x: 490, y: 95 }, { x: 570, y: 95 }, { x: 655, y: 140 },
  { x: 570, y: 185 }, { x: 490, y: 185 }, { x: 410, y: 185 }, { x: 330, y: 185 },
  { x: 250, y: 185 }, { x: 170, y: 185 }, { x: 92, y: 185 }, { x: 92, y: 270 },
  { x: 92, y: 355 }, { x: 92, y: 440 }, { x: 92, y: 525 }, { x: 175, y: 525 },
  { x: 175, y: 440 }, { x: 175, y: 355 }, { x: 175, y: 270 }, { x: 260, y: 270 },
  { x: 345, y: 270 }, { x: 430, y: 270 }, { x: 515, y: 270 }, { x: 600, y: 270 },
  { x: 685, y: 270 }, { x: 770, y: 270 }, { x: 770, y: 355 }, { x: 770, y: 440 },
  { x: 770, y: 525 }, { x: 770, y: 610 }, { x: 685, y: 610 }, { x: 600, y: 610 },
  { x: 515, y: 610 }, { x: 430, y: 610 }, { x: 345, y: 610 }, { x: 260, y: 610 },
  { x: 175, y: 610 }, { x: 92, y: 610 }, { x: 92, y: 700 }, { x: 185, y: 700 },
  { x: 278, y: 700 }, { x: 371, y: 700 }, { x: 464, y: 700 }, { x: 557, y: 700 },
  { x: 650, y: 700 }, { x: 743, y: 700 }, { x: 836, y: 700 },
];

export const JOURNEY_LOOP_POINTS: readonly JourneyPoint[] = [
  { x: 520, y: 345 }, { x: 615, y: 370 }, { x: 665, y: 435 }, { x: 625, y: 505 },
  { x: 535, y: 545 }, { x: 430, y: 550 }, { x: 330, y: 525 }, { x: 275, y: 455 },
  { x: 315, y: 380 }, { x: 420, y: 345 },
];

export function journeyMainPoint(space: number): JourneyPoint {
  const point = JOURNEY_MAIN_POINTS[space - 1];
  if (!point) throw new Error(`Main-path space ${space} is not on the board.`);
  return point;
}

export function journeyLoopPoint(space: number): JourneyPoint {
  const point = JOURNEY_LOOP_POINTS[space - 1];
  if (!point) throw new Error(`Loop space ${space} is not on the board.`);
  return point;
}
