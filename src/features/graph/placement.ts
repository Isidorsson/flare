import { hashString } from "./graph-paths";

const HASH_RANGE = 2 ** 32;
const NEAR_RADIUS = 14;

export interface Point {
  readonly x: number;
  readonly y: number;
}

function unit(seed: string): number {
  return hashString(seed) / HASH_RANGE;
}

export function centroid(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** A stable point close to `center`, different for every id, so a newcomer lands beside its peers instead of on top. */
export function jitterAround(id: string, center: Point, radius: number = NEAR_RADIUS): Point {
  const angle = unit(`${id}#angle`) * Math.PI * 2;
  const distance = Math.sqrt(unit(`${id}#distance`)) * radius;
  return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
}

/** Beside the average of the given anchors, or null when there is nothing to be near. */
export function placeNear(id: string, anchors: readonly Point[], radius: number = NEAR_RADIUS): Point | null {
  const middle = centroid(anchors);
  return middle === null ? null : jitterAround(id, middle, radius);
}
