import type { CodeGraph } from "./graph-model";
import type { Point } from "./placement";

export const MAX_ARCS_PER_SIDE = 7;
export const ARC_CURVATURE = 0.26;
export const ARC_FLOW_PX_PER_MS = 0.03;

export interface ArcTargets {
  /** Files that import the origin: a change here can reach them. */
  readonly importers: readonly string[];
  /** Files the origin imports: what it leans on. */
  readonly imports: readonly string[];
}

function strongest(graph: CodeGraph, ids: readonly string[]): string[] {
  return [...ids]
    .sort((a, b) => graph.getNodeAttribute(b, "importance") - graph.getNodeAttribute(a, "importance") || (a < b ? -1 : 1))
    .slice(0, MAX_ARCS_PER_SIDE);
}

/** The files one import away from a file, the busiest first, capped so a hub does not become a hairball. */
export function arcTargets(graph: CodeGraph, origin: string): ArcTargets {
  if (!graph.hasNode(origin)) return { importers: [], imports: [] };
  const importers: string[] = [];
  const imports: string[] = [];
  graph.forEachInEdge(origin, (_edge, attributes, source) => {
    if (attributes.kind === "import") importers.push(source);
  });
  graph.forEachOutEdge(origin, (_edge, attributes, _source, target) => {
    if (attributes.kind === "import") imports.push(target);
  });
  return { importers: strongest(graph, importers), imports: strongest(graph, imports) };
}

function unitHash(index: number): number {
  return index % 2 === 0 ? 1 : -1;
}

/** Bows the arc sideways, alternating sides so neighbouring arcs fan out instead of stacking. */
export function arcControl(from: Point, to: Point, index: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bow = ARC_CURVATURE * unitHash(index);
  return { x: (from.x + to.x) / 2 - dy * bow, y: (from.y + to.y) / 2 + dx * bow };
}

/** A point on the quadratic curve at `t` from 0 to 1. */
export function arcPoint(from: Point, control: Point, to: Point, t: number): Point {
  const rest = 1 - t;
  return {
    x: rest * rest * from.x + 2 * rest * t * control.x + t * t * to.x,
    y: rest * rest * from.y + 2 * rest * t * control.y + t * t * to.y,
  };
}
