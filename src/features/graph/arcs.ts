import { mixColors } from "./color-math";
import type { CodeGraph } from "./graph-model";
import type { GraphState } from "./graph-store";
import type { Palette } from "./palette";
import type { Point } from "./placement";

export const MAX_ARCS_PER_SIDE = 7;
export const ARC_CURVATURE = 0.26;
export const ARC_FLOW_PX_PER_MS = 0.03;

/** How a neighbour relates to the arc origin: it imports the origin, the origin imports it, or both. */
export type ArcRelation = "importer" | "import" | "mutual";

/** One arc per neighbouring file, however many import edges run between the two. */
export interface ArcLink {
  readonly id: string;
  readonly relation: ArcRelation;
}

export interface ArcShape {
  readonly from: Point;
  readonly to: Point;
  readonly control: Point;
}

const NO_LINKS: readonly ArcLink[] = [];

/** Arcs fan out from the selected file in the direct reach; a blast radius shows its paths as coloured edges instead. */
export function arcOrigin(state: Pick<GraphState, "reach" | "selected">): string | null {
  return state.reach === "direct" ? state.selected : null;
}

function neighbourRelations(graph: CodeGraph, origin: string): Map<string, ArcRelation> {
  const relations = new Map<string, ArcRelation>();
  graph.forEachInEdge(origin, (_edge, attributes, source) => {
    if (attributes.kind === "import") relations.set(source, "importer");
  });
  graph.forEachOutEdge(origin, (_edge, attributes, _source, target) => {
    if (attributes.kind !== "import") return;
    relations.set(target, relations.has(target) ? "mutual" : "import");
  });
  return relations;
}

function strongest(graph: CodeGraph, links: readonly ArcLink[]): ArcLink[] {
  const importance = (link: ArcLink) => graph.getNodeAttribute(link.id, "importance");
  return [...links]
    .sort((a, b) => importance(b) - importance(a) || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_ARCS_PER_SIDE);
}

/**
 * The files one import away from the origin, the busiest first. Files that can be affected by the origin (importers,
 * and mutual imports) and files it leans on are capped separately so a hub does not become a hairball.
 */
export function arcLinks(graph: CodeGraph, origin: string | null): readonly ArcLink[] {
  if (origin === null || !graph.hasNode(origin)) return NO_LINKS;
  const links = [...neighbourRelations(graph, origin)].map(([id, relation]) => ({ id, relation }));
  return [
    ...strongest(graph, links.filter((link) => link.relation !== "import")),
    ...strongest(graph, links.filter((link) => link.relation === "import")),
  ];
}

/** The files arcs link to an origin, and the test for whether an edge is one of those pairs. */
export interface ArcPairs {
  readonly origin: string | null;
  readonly neighbours: ReadonlySet<string>;
}

export const NO_ARC_PAIRS: ArcPairs = { origin: null, neighbours: new Set() };

export function arcPairs(graph: CodeGraph, origin: string | null): ArcPairs {
  return { origin, neighbours: new Set(arcLinks(graph, origin).map((link) => link.id)) };
}

/** Whether the overlay draws the pair as an arc, in either direction; sigma then leaves the edge out. */
export function isArcPair(pairs: ArcPairs, source: string, target: string): boolean {
  if (pairs.origin === source) return pairs.neighbours.has(target);
  return pairs.origin === target && pairs.neighbours.has(source);
}

/** Every arc bows to the same side of the line from the origin, so arcs to nearby files nest instead of crossing. */
export function arcControl(origin: Point, neighbour: Point): Point {
  const dx = neighbour.x - origin.x;
  const dy = neighbour.y - origin.y;
  return { x: (origin.x + neighbour.x) / 2 - dy * ARC_CURVATURE, y: (origin.y + neighbour.y) / 2 + dx * ARC_CURVATURE };
}

/** The curve between the origin and a neighbour, run in the direction the import points so the dashes flow that way. */
export function arcShape(relation: ArcRelation, origin: Point, neighbour: Point): ArcShape {
  const control = arcControl(origin, neighbour);
  return relation === "importer" ? { from: neighbour, to: origin, control } : { from: origin, to: neighbour, control };
}

export function arcColor(palette: Palette, relation: ArcRelation): string {
  if (relation === "importer") return palette.importer;
  if (relation === "import") return palette.imports;
  return mixColors(palette.importer, palette.imports, 0.5);
}

/** A point on the quadratic curve at `t` from 0 to 1. */
export function arcPoint(from: Point, control: Point, to: Point, t: number): Point {
  const rest = 1 - t;
  return {
    x: rest * rest * from.x + 2 * rest * t * control.x + t * t * to.x,
    y: rest * rest * from.y + 2 * rest * t * control.y + t * t * to.y,
  };
}
