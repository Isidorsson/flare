import { folderId } from "./directory-tree";
import type { CodeGraph } from "./graph-model";

const SAME_FOLDER_WEIGHT = 1;
const OTHER_FOLDER_WEIGHT = 0.7;
const DISC_GROWTH = 1.18;
const MIN_DISC = 1;

/** Typed-array view of the graph for pulling files towards what they import, without leaving their folder. */
export interface RelaxModel {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Node index of each file, in the order the pull visits them. */
  readonly files: Int32Array;
  /** Node index of the hub of each file's folder. */
  readonly hubs: Int32Array;
  /** How far from its hub each file may roam. */
  readonly reach: Float64Array;
  readonly offsets: Int32Array;
  readonly neighbours: Int32Array;
  readonly weights: Float64Array;
}

function importNeighbours(graph: CodeGraph, id: string): { id: string; same: boolean }[] {
  const folder = graph.getNodeAttribute(id, "folder");
  const found: { id: string; same: boolean }[] = [];
  const add = (other: string) => {
    if (graph.getNodeAttribute(other, "kind") === "file") {
      found.push({ id: other, same: graph.getNodeAttribute(other, "folder") === folder });
    }
  };
  graph.forEachOutEdge(id, (_edge, attributes, _source, target) => {
    if (attributes.kind === "import") add(target);
  });
  graph.forEachInEdge(id, (_edge, attributes, source) => {
    if (attributes.kind === "import") add(source);
  });
  return found;
}

/** Each folder's reach is how far its files already spread, plus a little, so the pull never grows an island. */
function reachByFolder(graph: CodeGraph, ids: readonly string[]): Map<string, number> {
  const reach = new Map<string, number>();
  for (const id of ids) {
    const attributes = graph.getNodeAttributes(id);
    if (attributes.kind !== "file") continue;
    const hubId = folderId(attributes.folder);
    if (!graph.hasNode(hubId)) continue;
    const hub = graph.getNodeAttributes(hubId);
    const distance = Math.hypot(attributes.x - hub.x, attributes.y - hub.y);
    reach.set(hubId, Math.max(reach.get(hubId) ?? MIN_DISC, distance * DISC_GROWTH));
  }
  return reach;
}

export function buildRelaxModel(graph: CodeGraph, ids: readonly string[], xs: Float64Array, ys: Float64Array): RelaxModel {
  const position = new Map(ids.map((id, index) => [id, index]));
  const reach = reachByFolder(graph, ids);
  const files: number[] = [];
  const hubs: number[] = [];
  const reaches: number[] = [];
  const offsets: number[] = [0];
  const neighbours: number[] = [];
  const weights: number[] = [];
  for (const id of ids) {
    const attributes = graph.getNodeAttributes(id);
    const hubId = folderId(attributes.folder);
    const hub = position.get(hubId);
    const self = position.get(id);
    if (attributes.kind !== "file" || hub === undefined || self === undefined) continue;
    files.push(self);
    hubs.push(hub);
    reaches.push(reach.get(hubId) ?? MIN_DISC);
    for (const other of importNeighbours(graph, id)) {
      const index = position.get(other.id);
      if (index === undefined) continue;
      neighbours.push(index);
      weights.push(other.same ? SAME_FOLDER_WEIGHT : OTHER_FOLDER_WEIGHT);
    }
    offsets.push(neighbours.length);
  }
  return {
    xs,
    ys,
    files: Int32Array.from(files),
    hubs: Int32Array.from(hubs),
    reach: Float64Array.from(reaches),
    offsets: Int32Array.from(offsets),
    neighbours: Int32Array.from(neighbours),
    weights: Float64Array.from(weights),
  };
}

interface Moved {
  x: number;
  y: number;
}

function neighbourMiddle(model: RelaxModel, slot: number): Moved | null {
  const { xs, ys, offsets, neighbours, weights } = model;
  const start = offsets[slot] ?? 0;
  const end = offsets[slot + 1] ?? start;
  if (end <= start) return null;
  let sumX = 0;
  let sumY = 0;
  let total = 0;
  for (let at = start; at < end; at += 1) {
    const other = neighbours[at] ?? 0;
    const weight = weights[at] ?? 0;
    sumX += (xs[other] ?? 0) * weight;
    sumY += (ys[other] ?? 0) * weight;
    total += weight;
  }
  return { x: sumX / total, y: sumY / total };
}

function withinReach(model: RelaxModel, slot: number, point: Moved): Moved {
  const hub = model.hubs[slot] ?? 0;
  const centreX = model.xs[hub] ?? 0;
  const centreY = model.ys[hub] ?? 0;
  const dx = point.x - centreX;
  const dy = point.y - centreY;
  const distance = Math.hypot(dx, dy);
  const limit = model.reach[slot] ?? MIN_DISC;
  if (distance <= limit) return point;
  return { x: centreX + (dx / distance) * limit, y: centreY + (dy / distance) * limit };
}

function pulled(model: RelaxModel, slot: number, pull: number): Moved {
  const self = model.files[slot] ?? 0;
  const x = model.xs[self] ?? 0;
  const y = model.ys[self] ?? 0;
  const middle = neighbourMiddle(model, slot);
  const target = middle === null ? { x, y } : { x: x + (middle.x - x) * pull, y: y + (middle.y - y) * pull };
  return withinReach(model, slot, target);
}

/** One Jacobi step: every file moves a fraction of the way to the weighted middle of its imports, then back inside its folder. */
export function relaxPull(model: RelaxModel, pull: number): void {
  const next: Moved[] = [];
  for (let slot = 0; slot < model.files.length; slot += 1) next.push(pulled(model, slot, pull));
  next.forEach((point, slot) => {
    const self = model.files[slot] ?? 0;
    model.xs[self] = point.x;
    model.ys[self] = point.y;
  });
}
