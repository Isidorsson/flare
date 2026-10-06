export interface Bodies {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly radii: Float64Array;
  /** How hard a body is to move; the heavier of two touching bodies gives way less. Defaults to the radius. */
  readonly masses?: Float64Array;
}

export interface Separator {
  /** Runs up to `iterations` relaxation passes; returns the deepest overlap left, 0 once nothing touches. */
  step: (iterations: number) => number;
}

const NEIGHBOUR_CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];
const STRIDE = 1_048_576;
const DAMPING = 0.85;
const TOLERANCE = 0.01;
const COINCIDENT_ANGLE = 2.399963;

function cellKey(cx: number, cy: number): number {
  return cx * STRIDE + cy;
}

interface Cell {
  readonly cx: number;
  readonly cy: number;
  readonly members: number[];
}

function buildGrid(bodies: Bodies, size: number): Map<number, Cell> {
  const grid = new Map<number, Cell>();
  for (let index = 0; index < bodies.xs.length; index += 1) {
    const cx = Math.floor((bodies.xs[index] ?? 0) / size);
    const cy = Math.floor((bodies.ys[index] ?? 0) / size);
    const key = cellKey(cx, cy);
    const cell = grid.get(key);
    if (cell === undefined) grid.set(key, { cx, cy, members: [index] });
    else cell.members.push(index);
  }
  return grid;
}

function at(values: Float64Array, index: number): number {
  return values[index] ?? 0;
}

function direction(bodies: Bodies, first: number, second: number): { dx: number; dy: number; distance: number } {
  const dx = at(bodies.xs, second) - at(bodies.xs, first);
  const dy = at(bodies.ys, second) - at(bodies.ys, first);
  const distance = Math.hypot(dx, dy);
  if (distance > 0) return { dx, dy, distance };
  return { dx: Math.cos(first * COINCIDENT_ANGLE), dy: Math.sin(first * COINCIDENT_ANGLE), distance: 0 };
}

function pushApart(bodies: Bodies, first: number, second: number, gap: number): number {
  const { xs, ys, radii } = bodies;
  const { dx, dy, distance } = direction(bodies, first, second);
  const overlap = at(radii, first) + at(radii, second) + gap - distance;
  if (overlap <= 0) return 0;
  const length = distance > 0 ? distance : 1;
  const push = overlap * DAMPING;
  const masses = bodies.masses ?? radii;
  const shareFirst = at(masses, second) / (at(masses, first) + at(masses, second));
  xs[first] = at(xs, first) - (dx / length) * push * shareFirst;
  ys[first] = at(ys, first) - (dy / length) * push * shareFirst;
  xs[second] = at(xs, second) + (dx / length) * push * (1 - shareFirst);
  ys[second] = at(ys, second) + (dy / length) * push * (1 - shareFirst);
  return overlap;
}

function relaxCells(bodies: Bodies, gap: number, home: Cell, neighbour: Cell): number {
  let deepest = 0;
  for (const first of home.members) {
    for (const second of neighbour.members) {
      if (neighbour === home && second <= first) continue;
      deepest = Math.max(deepest, pushApart(bodies, first, second, gap));
    }
  }
  return deepest;
}

function relaxPass(bodies: Bodies, gap: number, cell: number): number {
  const grid = buildGrid(bodies, cell);
  let deepest = 0;
  for (const home of grid.values()) {
    for (const [ox, oy] of NEIGHBOUR_CELLS) {
      const neighbour = grid.get(cellKey(home.cx + ox, home.cy + oy));
      if (neighbour !== undefined) deepest = Math.max(deepest, relaxCells(bodies, gap, home, neighbour));
    }
  }
  return deepest;
}

export function maxRadius(bodies: Bodies): number {
  return bodies.radii.reduce((largest, radius) => Math.max(largest, radius), 0);
}

/** Spreads touching circles apart without changing their order, so a clustered layout keeps its shape. */
export function createSeparator(bodies: Bodies, gap: number): Separator {
  const cell = Math.max(maxRadius(bodies) * 2 + gap, 1e-6);
  return {
    step: (iterations) => {
      let deepest = 0;
      for (let pass = 0; pass < iterations; pass += 1) {
        deepest = relaxPass(bodies, gap, cell);
        if (deepest < TOLERANCE) return 0;
      }
      return deepest;
    },
  };
}
