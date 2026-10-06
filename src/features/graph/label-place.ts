import type { Point } from "./placement";

export type Side = "top" | "bottom" | "right" | "left";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

export interface LabelRequest {
  readonly id: string;
  readonly size: Size;
  readonly anchor: Point;
  /** Rendered radius of the node being labelled, so the label clears it. */
  readonly radius: number;
  readonly sides: readonly Side[];
  /** Special labels (hovered, selected, touched) are always shown, clamped into view if need be. */
  readonly required: boolean;
}

export interface PlacedLabel {
  readonly id: string;
  readonly rect: Rect;
  readonly side: Side;
}

export interface Obstacle extends Point {
  readonly id: string;
  readonly radius: number;
}

export const LABEL_GAP = 4;
export const VIEW_MARGIN = 4;
const MAX_OBSTACLE_OVERLAP = 2;
const GRID_CELL = 48;

export const SIDES_FOR_FILES: readonly Side[] = ["right", "left", "top", "bottom"];
export const SIDES_FOR_HUBS: readonly Side[] = ["top", "bottom", "right", "left"];

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function circleTouchesRect(circle: Obstacle, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.radius;
}

export function rectFor(request: LabelRequest, side: Side): Rect {
  const { anchor, size, radius } = request;
  const offset = radius + LABEL_GAP;
  switch (side) {
    case "right":
      return { x: anchor.x + offset, y: anchor.y - size.height / 2, ...size };
    case "left":
      return { x: anchor.x - offset - size.width, y: anchor.y - size.height / 2, ...size };
    case "top":
      return { x: anchor.x - size.width / 2, y: anchor.y - offset - size.height, ...size };
    case "bottom":
      return { x: anchor.x - size.width / 2, y: anchor.y + offset, ...size };
  }
}

function insideView(rect: Rect, view: Size): boolean {
  return (
    rect.x >= VIEW_MARGIN &&
    rect.y >= VIEW_MARGIN &&
    rect.x + rect.width <= view.width - VIEW_MARGIN &&
    rect.y + rect.height <= view.height - VIEW_MARGIN
  );
}

function clampIntoView(rect: Rect, view: Size): Rect {
  const x = Math.min(Math.max(rect.x, VIEW_MARGIN), Math.max(view.width - rect.width - VIEW_MARGIN, VIEW_MARGIN));
  const y = Math.min(Math.max(rect.y, VIEW_MARGIN), Math.max(view.height - rect.height - VIEW_MARGIN, VIEW_MARGIN));
  return { ...rect, x, y };
}

/** Obstacles bucketed by screen cell so a label only checks the nodes near it. */
export class ObstacleGrid {
  private readonly cells = new Map<string, Obstacle[]>();

  constructor(obstacles: readonly Obstacle[]) {
    for (const obstacle of obstacles) this.insert(obstacle);
  }

  private insert(obstacle: Obstacle): void {
    const span = Math.ceil(obstacle.radius / GRID_CELL);
    const cx = Math.floor(obstacle.x / GRID_CELL);
    const cy = Math.floor(obstacle.y / GRID_CELL);
    for (let ix = cx - span; ix <= cx + span; ix += 1) {
      for (let iy = cy - span; iy <= cy + span; iy += 1) this.bucket(ix, iy, true)?.push(obstacle);
    }
  }

  private bucket(ix: number, iy: number, create: boolean): Obstacle[] | undefined {
    const key = `${ix},${iy}`;
    let list = this.cells.get(key);
    if (list === undefined && create) {
      list = [];
      this.cells.set(key, list);
    }
    return list;
  }

  private cellsUnder(rect: Rect): Obstacle[][] {
    const found: Obstacle[][] = [];
    const x1 = Math.floor((rect.x + rect.width) / GRID_CELL);
    const y1 = Math.floor((rect.y + rect.height) / GRID_CELL);
    for (let ix = Math.floor(rect.x / GRID_CELL); ix <= x1; ix += 1) {
      for (let iy = Math.floor(rect.y / GRID_CELL); iy <= y1; iy += 1) {
        const list = this.bucket(ix, iy, false);
        if (list !== undefined) found.push(list);
      }
    }
    return found;
  }

  /** How many obstacles other than `ignore` the rectangle would cover. */
  countUnder(rect: Rect, ignore: string): number {
    const seen = new Set<string>();
    for (const obstacle of this.cellsUnder(rect).flat()) {
      if (obstacle.id !== ignore && circleTouchesRect(obstacle, rect)) seen.add(obstacle.id);
    }
    return seen.size;
  }
}

interface Candidate {
  readonly rect: Rect;
  readonly side: Side;
  readonly cost: number;
}

function bestCandidate(request: LabelRequest, placed: readonly PlacedLabel[], grid: ObstacleGrid, view: Size): Candidate | null {
  let best: Candidate | null = null;
  for (const side of request.sides) {
    const rect = rectFor(request, side);
    if (!insideView(rect, view) || placed.some((other) => rectsOverlap(rect, other.rect))) continue;
    const cost = grid.countUnder(rect, request.id);
    if (best === null || cost < best.cost) best = { rect, side, cost };
    if (cost === 0) break;
  }
  return best;
}

function forcedPlacement(request: LabelRequest, view: Size): PlacedLabel {
  const side = request.sides[0] ?? "right";
  return { id: request.id, side, rect: clampIntoView(rectFor(request, side), view) };
}

/** Greedy by priority: each label takes the first side where it overlaps no other label and few nodes. */
export function placeLabels(requests: readonly LabelRequest[], view: Size, obstacles: readonly Obstacle[]): PlacedLabel[] {
  const grid = new ObstacleGrid(obstacles);
  const placed: PlacedLabel[] = [];
  for (const request of requests) {
    const found = bestCandidate(request, placed, grid, view);
    if (found !== null && (request.required || found.cost <= MAX_OBSTACLE_OVERLAP)) {
      placed.push({ id: request.id, rect: found.rect, side: found.side });
    } else if (request.required) {
      placed.push(forcedPlacement(request, view));
    }
  }
  return placed;
}
