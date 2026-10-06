import type { Point } from "./placement";

/** The key for a folder's own files when comparing them with its subfolders. */
export const OWN = "#own";

const ATTRACT = 0.28;
const GRAVITY = 0.03;
const REFINE_ROUNDS = 90;
const FINAL_PUSH_ROUNDS = 60;
const JITTER = 1e-3;

/** For each parent folder, how many imports run between each pair of its children (a child is a subfolder or `OWN`). */
export type Affinity = ReadonlyMap<string, ReadonlyMap<string, number>>;

export interface ImportPair {
  readonly source: string;
  readonly target: string;
}

export function pairKey(first: string, second: string): string {
  return first < second ? `${first}\u0001${second}` : `${second}\u0001${first}`;
}

function segments(folder: string): string[] {
  return folder === "" ? [] : folder.split("/");
}

function folderOf(file: string): string {
  return file.slice(0, Math.max(file.lastIndexOf("/"), 0));
}

/** The folder where two paths part ways, and which child of it each one goes down. */
function crossing(first: readonly string[], second: readonly string[]): { parent: string; a: string; b: string } {
  let shared = 0;
  while (shared < first.length && shared < second.length && first[shared] === second[shared]) shared += 1;
  const child = (path: readonly string[]) => (path.length > shared ? path.slice(0, shared + 1).join("/") : OWN);
  return { parent: first.slice(0, shared).join("/"), a: child(first), b: child(second) };
}

export function buildAffinity(edges: readonly ImportPair[]): Affinity {
  const affinity = new Map<string, Map<string, number>>();
  for (const { source, target } of edges) {
    const { parent, a, b } = crossing(segments(folderOf(source)), segments(folderOf(target)));
    if (a === b) continue;
    const counts = affinity.get(parent) ?? new Map<string, number>();
    const key = pairKey(a, b);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    affinity.set(parent, counts);
  }
  return affinity;
}

/** Link strengths between the given children of one parent, scaled to 0..1 against its strongest link. */
export function weightMatrix(affinity: Affinity, parent: string, children: readonly string[]): number[][] {
  const counts = affinity.get(parent);
  if (counts === undefined) return children.map(() => children.map(() => 0));
  const strongest = Math.log1p(Math.max(...counts.values()));
  return children.map((first, row) =>
    children.map((second, column) => (row === column ? 0 : Math.log1p(counts.get(pairKey(first, second)) ?? 0) / strongest)),
  );
}

interface Body {
  readonly xs: number[];
  readonly ys: number[];
  readonly radii: readonly number[];
}

function separationOf(body: Body, first: number, second: number): { dx: number; dy: number; distance: number } {
  const dx = (body.xs[second] ?? 0) - (body.xs[first] ?? 0);
  const dy = (body.ys[second] ?? 0) - (body.ys[first] ?? 0);
  const distance = Math.hypot(dx, dy);
  return distance > 0 ? { dx, dy, distance } : { dx: JITTER * (first + 1), dy: JITTER * (second + 1), distance: Math.hypot(JITTER * (first + 1), JITTER * (second + 1)) };
}

/** Moves the pair along their line: positive closes the gap, negative opens it. The first body never moves. */
function nudge(body: Body, first: number, second: number, amount: number): void {
  const { dx, dy, distance } = separationOf(body, first, second);
  const ux = (dx / distance) * amount;
  const uy = (dy / distance) * amount;
  const firstShare = first === 0 ? 0 : 0.5;
  body.xs[first] = (body.xs[first] ?? 0) + ux * firstShare;
  body.ys[first] = (body.ys[first] ?? 0) + uy * firstShare;
  body.xs[second] = (body.xs[second] ?? 0) - ux * (1 - firstShare);
  body.ys[second] = (body.ys[second] ?? 0) - uy * (1 - firstShare);
}

function relaxPair(body: Body, pair: readonly [number, number], pull: number): void {
  const [first, second] = pair;
  const { distance } = separationOf(body, first, second);
  const touching = (body.radii[first] ?? 0) + (body.radii[second] ?? 0);
  if (distance < touching) nudge(body, first, second, distance - touching);
  else if (pull > 0) nudge(body, first, second, (distance - touching) * ATTRACT * pull);
}

function roundOf(body: Body, weights: readonly (readonly number[])[], attract: boolean): void {
  for (let first = 0; first < body.xs.length; first += 1) {
    for (let second = first + 1; second < body.xs.length; second += 1) {
      relaxPair(body, [first, second], attract ? (weights[first]?.[second] ?? 0) : 0);
    }
  }
  if (!attract) return;
  for (let index = 1; index < body.xs.length; index += 1) {
    body.xs[index] = (body.xs[index] ?? 0) * (1 - GRAVITY);
    body.ys[index] = (body.ys[index] ?? 0) * (1 - GRAVITY);
  }
}

/**
 * Pulls children that import each other closer, without letting any two overlap. Child 0 stays where it is.
 * Starts from an already non-overlapping packing, so the result is a tidier version of it, not a different shape.
 */
export function refineOffsets(radii: readonly number[], offsets: readonly Point[], weights: readonly (readonly number[])[]): Point[] {
  const body: Body = { xs: offsets.map((offset) => offset.x), ys: offsets.map((offset) => offset.y), radii };
  if (body.xs.length < 3) return [...offsets];
  for (let round = 0; round < REFINE_ROUNDS; round += 1) roundOf(body, weights, true);
  for (let round = 0; round < FINAL_PUSH_ROUNDS; round += 1) roundOf(body, weights, false);
  return body.xs.map((x, index) => ({ x, y: body.ys[index] ?? 0 }));
}
