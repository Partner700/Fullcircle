import type { JourneyEvent, JourneyLocation } from '../../supabase/functions/_shared/biblicalJourney.ts';

export type JourneyPoint = { x: number; y: number };
export const JOURNEY_BOARD_SIZE = 720;
export const JOURNEY_BOARD_HEIGHT = 900;
// Fifty-one distinct rectangular spaces on one closed perimeter.
export const LEGACY_JOURNEY_MAIN_POINTS: readonly JourneyPoint[] = [
  ...Array.from({ length: 14 }, (_, index) => ({ x: 32 + index * 656 / 13, y: 32 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 688, y: 32 + (index + 1) * 656 / 13 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 688 - (index + 1) * 656 / 13, y: 688 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 32, y: 688 - (index + 1) * 656 / 12 })),
];

export const JOURNEY_MAIN_POINTS: readonly JourneyPoint[] = [
  ...Array.from({ length: 12 }, (_, index) => ({ x: 32 + index * 656 / 11, y: 32 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 688, y: 32 + (index + 1) * 836 / 11 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 688 - (index + 1) * 656 / 11, y: 868 })),
  ...Array.from({ length: 11 }, (_, index) => ({ x: 32, y: 868 - (index + 1) * 836 / 12 })),
];

export function journeyMainPoints(spaces = 45): readonly JourneyPoint[] {
  return spaces === 51 ? LEGACY_JOURNEY_MAIN_POINTS : JOURNEY_MAIN_POINTS;
}

export const JOURNEY_LOOP_POINTS: readonly JourneyPoint[] = [
  { x: 200, y: 375 }, { x: 307, y: 375 }, { x: 413, y: 375 }, { x: 520, y: 375 },
  { x: 520, y: 495 }, { x: 520, y: 615 }, { x: 413, y: 615 }, { x: 307, y: 615 },
  { x: 200, y: 615 }, { x: 200, y: 495 },
];
export const LEGACY_JOURNEY_LOOP_POINTS: readonly JourneyPoint[] = [
  { x: 200, y: 285 }, { x: 307, y: 285 }, { x: 413, y: 285 }, { x: 520, y: 285 },
  { x: 520, y: 405 }, { x: 520, y: 525 }, { x: 413, y: 525 }, { x: 307, y: 525 },
  { x: 200, y: 525 }, { x: 200, y: 405 },
];

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
export function journeyMovementPath(event: JourneyEvent, finishSpace: number, loopLength: number): JourneyLocation[] {
  if (event.resolution !== 'applied') return [];
  const from = event.previousLocation;
  const to = event.newLocation;
  if (from.route !== to.route || from.route === 'prison' || to.route === 'prison') return [to];
  if (from.space === to.space) return [];
  if (event.source !== 'die' && event.animation !== 'forward' && event.animation !== 'backward') return [to];
  const isDie = event.source === 'die';
  const forward = isDie || event.animation === 'forward';
  const distance = isDie
    ? (to.space - from.space + (from.route === 'main' ? finishSpace : loopLength)) % (from.route === 'main' ? finishSpace : loopLength)
    : Math.abs(to.space - from.space);
  if (distance > 8 || distance === 0) return [to];
  const length = from.route === 'main' ? finishSpace : loopLength;
  return Array.from({ length: distance }, (_, index) => ({ route: from.route,
    space: isDie ? (from.space + index) % length + 1 : from.space + (forward ? index + 1 : -index - 1),
  } as JourneyLocation));
}
