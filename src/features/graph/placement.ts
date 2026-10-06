import { directoryKey, hashString } from "./graph-paths";

export const DIRECTORY_RING_RADIUS = 100;
export const FILE_SPREAD_RADIUS = 30;
const NEIGHBOUR_JITTER = 6;
const HASH_RANGE = 2 ** 32;

export interface Point {
  readonly x: number;
  readonly y: number;
}

function unit(seed: string): number {
  return hashString(seed) / HASH_RANGE;
}

export function initialPosition(id: string): Point {
  const ringAngle = unit(directoryKey(id)) * Math.PI * 2;
  const spreadAngle = unit(id) * Math.PI * 2;
  const spread = Math.sqrt(unit(`${id}#spread`)) * FILE_SPREAD_RADIUS;
  return {
    x: Math.cos(ringAngle) * DIRECTORY_RING_RADIUS + Math.cos(spreadAngle) * spread,
    y: Math.sin(ringAngle) * DIRECTORY_RING_RADIUS + Math.sin(spreadAngle) * spread,
  };
}

export function positionNear(id: string, neighbours: readonly Point[]): Point {
  if (neighbours.length === 0) return initialPosition(id);
  const sum = neighbours.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  const angle = unit(`${id}#angle`) * Math.PI * 2;
  return {
    x: sum.x / neighbours.length + Math.cos(angle) * NEIGHBOUR_JITTER,
    y: sum.y / neighbours.length + Math.sin(angle) * NEIGHBOUR_JITTER,
  };
}
