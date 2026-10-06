import type { DirNode } from "./directory-tree";
import type { Point } from "./placement";

export const SEED_SPACING = 4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HUB_RADIUS_FACTOR = 1.6;
const GAP_FACTOR = 1.4;
const RING_STEP_FACTOR = 0.35;
const ARC_STEP_FACTOR = 0.7;
const MIN_RING_STEPS = 10;

export interface Seeds {
  readonly files: ReadonlyMap<string, Point>;
  readonly folders: ReadonlyMap<string, Point>;
}

interface Circle extends Point {
  readonly r: number;
}

interface PackedDir {
  readonly dir: DirNode;
  readonly radius: number;
  readonly children: readonly { readonly packed: PackedDir; readonly offset: Point }[];
}

function overlaps(placed: readonly Circle[], x: number, y: number, r: number): boolean {
  return placed.some((circle) => Math.hypot(circle.x - x, circle.y - y) < circle.r + r);
}

function findSpot(placed: readonly Circle[], r: number, index: number): Circle {
  const first = placed[0];
  const start = first === undefined ? 0 : first.r + r;
  for (let ring = 0; ; ring += 1) {
    const distance = start + ring * r * RING_STEP_FACTOR;
    const steps = Math.max(MIN_RING_STEPS, Math.ceil((2 * Math.PI * distance) / (r * ARC_STEP_FACTOR)));
    const phase = index * GOLDEN_ANGLE;
    for (let step = 0; step < steps; step += 1) {
      const angle = phase + (step / steps) * 2 * Math.PI;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      if (!overlaps(placed, x, y, r)) return { x, y, r };
    }
  }
}

/** Index 0 sits at the origin; the rest are packed around it, biggest first, as close as they fit. */
export function packCircles(radii: readonly number[]): Point[] {
  const first = radii[0];
  if (first === undefined) return [];
  const spots: Point[] = radii.map(() => ({ x: 0, y: 0 }));
  const placed: Circle[] = [{ x: 0, y: 0, r: first }];
  const order = radii
    .map((r, index) => ({ r, index }))
    .slice(1)
    .sort((a, b) => b.r - a.r || a.index - b.index);
  for (const { r, index } of order) {
    const spot = findSpot(placed, r, index);
    placed.push(spot);
    spots[index] = { x: spot.x, y: spot.y };
  }
  return spots;
}

function blobRadius(files: number, spacing: number): number {
  return files === 0 ? 0 : spacing * Math.sqrt(files) + spacing / 2;
}

function packDir(dir: DirNode, spacing: number): PackedDir {
  const children = dir.dirs.map((child) => packDir(child, spacing));
  const own = Math.max(blobRadius(dir.files.length, spacing), spacing * HUB_RADIUS_FACTOR);
  const gap = spacing * GAP_FACTOR;
  const offsets = packCircles([own, ...children.map((child) => child.radius + gap)]);
  const placed = children.map((packed, index) => ({ packed, offset: offsets[index + 1] ?? { x: 0, y: 0 } }));
  const extent = placed.reduce((far, { packed, offset }) => Math.max(far, Math.hypot(offset.x, offset.y) + packed.radius), own);
  return { dir, radius: extent, children: placed };
}

function seedFiles(files: readonly string[], center: Point, spacing: number, out: Map<string, Point>): void {
  files.forEach((id, index) => {
    const distance = spacing * Math.sqrt(index + 0.5);
    const angle = index * GOLDEN_ANGLE;
    out.set(id, { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance });
  });
}

function seedDir(packed: PackedDir, center: Point, spacing: number, out: { files: Map<string, Point>; folders: Map<string, Point> }): void {
  out.folders.set(packed.dir.path, center);
  seedFiles(packed.dir.files, center, spacing, out.files);
  for (const { packed: child, offset } of packed.children) {
    seedDir(child, { x: center.x + offset.x, y: center.y + offset.y }, spacing, out);
  }
}

/** Gives every folder its own disc, packed beside its siblings, with its files fanned around its hub. */
export function packDirectories(tree: DirNode, spacing: number = SEED_SPACING): Seeds {
  const out = { files: new Map<string, Point>(), folders: new Map<string, Point>() };
  seedDir(packDir(tree, spacing), { x: 0, y: 0 }, spacing, out);
  return out;
}
