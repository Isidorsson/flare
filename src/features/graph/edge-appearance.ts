import { blastColor, blastRole, type AppearanceContext, type BlastRole } from "./appearance";
import { withPremultipliedAlpha as premultiplied } from "./color-math";
import type { EdgeKind } from "./graph-model";
import { IMPORT_EDGE_TYPE, TREE_EDGE_TYPE } from "./graph-model";
import type { Palette } from "./palette";

const IMPORT_EDGE_SIZE = 1;
const ACTIVE_EDGE_SIZE = 1.6;
const BLAST_EDGE_SIZE = 1.5;
const TREE_EDGE_SIZE = 1;
const TREE_ALPHA_OVERVIEW = 0.7;
const TREE_ALPHA_FILES = 0.35;
const TREE_ALPHA_FOCUSED = 0.85;
const BACKGROUND_EDGE_ALPHA = 0.05;
const ACTIVE_EDGE_ALPHA = 0.85;
const DIRECTION_ALPHA = 0.7;
const LINE_TYPE = TREE_EDGE_TYPE;

const SPARSE_EDGES = 30;
const DENSE_EDGES = 4000;
const SPARSE_ALPHA = 0.75;
const DENSE_ALPHA = 0.16;
const LONG_EDGE_SHARE = 0.6;
const MIN_LENGTH_FADE = 0.3;
const ARROW_MAX_EDGES = 350;
export const HIDE_EDGES_ON_MOVE_THRESHOLD = 2500;

/** The more imports there are, the fainter each one has to be for the picture to stay readable. */
export function restingEdgeAlpha(edgeCount: number): number {
  const span = Math.log(DENSE_EDGES / SPARSE_EDGES);
  const t = Math.min(Math.max(Math.log(Math.max(edgeCount, 1) / SPARSE_EDGES) / span, 0), 1);
  return SPARSE_ALPHA + (DENSE_ALPHA - SPARSE_ALPHA) * t;
}

/** Long imports cross the whole map and make the most noise, so they fade towards a floor as they approach the layout's span. */
export function lengthFade(length: number, span: number): number {
  if (span <= 0) return 1;
  const share = Math.min(length / (span * LONG_EDGE_SHARE), 1);
  return 1 - (1 - MIN_LENGTH_FADE) * share;
}

export function showsArrows(edgeCount: number): boolean {
  return edgeCount <= ARROW_MAX_EDGES;
}

export interface EdgeInfo {
  readonly kind: EdgeKind;
  readonly source: string;
  readonly target: string;
  /** Both ends are folders that are shown as hubs. */
  readonly betweenHubs: boolean;
  /** Distance between the two ends in layout units. */
  readonly length: number;
}

export interface EdgeStyle {
  color: string;
  size: number;
  zIndex: number;
  hidden: boolean;
  type: string;
}

const HIDDEN: EdgeStyle = { color: "#000000", size: 0, zIndex: 0, hidden: true, type: LINE_TYPE };

function depthOf(role: BlastRole): number | null {
  if (role.kind === "origin") return 0;
  return role.kind === "dependent" ? role.depth : null;
}

function blastEdgeColor(source: BlastRole, target: BlastRole, palette: Palette): string | null {
  if (source.kind !== "dependent") return null;
  return depthOf(target) === source.depth - 1 ? blastColor(palette, source.depth) : null;
}

function treeEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  if (!edge.betweenHubs) return HIDDEN;
  const active = ctx.focus?.node;
  const touched = active === edge.source || active === edge.target;
  const alpha = touched ? TREE_ALPHA_FOCUSED : ctx.level === "overview" ? TREE_ALPHA_OVERVIEW : TREE_ALPHA_FILES;
  return { color: premultiplied(ctx.palette.edge, alpha), size: TREE_EDGE_SIZE, zIndex: touched ? 2 : 1, hidden: false, type: LINE_TYPE };
}

function importType(ctx: AppearanceContext): string {
  return ctx.arrows ? IMPORT_EDGE_TYPE : LINE_TYPE;
}

function blastEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle | null {
  const sourceRole = blastRole(ctx.blast, edge.source);
  if (sourceRole.kind === "inactive") return null;
  const color = blastEdgeColor(sourceRole, blastRole(ctx.blast, edge.target), ctx.palette);
  if (color !== null) return { color, size: BLAST_EDGE_SIZE, zIndex: 3, hidden: false, type: importType(ctx) };
  if (ctx.level === "overview") return HIDDEN;
  const faint = premultiplied(ctx.palette.edge, BACKGROUND_EDGE_ALPHA);
  return { color: faint, size: IMPORT_EDGE_SIZE, zIndex: 0, hidden: false, type: importType(ctx) };
}

function activeNode(ctx: AppearanceContext): string | null {
  return ctx.focus?.node ?? ctx.selected;
}

function directionEdge(edge: EdgeInfo, ctx: AppearanceContext, active: string): EdgeStyle {
  const outgoing = edge.source === active;
  const hue = outgoing ? ctx.palette.imports : ctx.palette.importer;
  const alpha = ctx.focus === null ? DIRECTION_ALPHA : ACTIVE_EDGE_ALPHA;
  return { color: premultiplied(hue, alpha), size: ACTIVE_EDGE_SIZE, zIndex: 3, hidden: false, type: importType(ctx) };
}

function importEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  const blast = blastEdge(edge, ctx);
  if (blast !== null) return blast;
  const active = activeNode(ctx);
  if (active !== null && (edge.source === active || edge.target === active)) return directionEdge(edge, ctx, active);
  if (ctx.level === "overview") return HIDDEN;
  const alpha = active === null ? ctx.edgeAlpha * lengthFade(edge.length, ctx.layoutSpan) : BACKGROUND_EDGE_ALPHA;
  return { color: premultiplied(ctx.palette.edge, alpha), size: IMPORT_EDGE_SIZE, zIndex: 1, hidden: false, type: importType(ctx) };
}

export function edgeStyle(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  return edge.kind === "tree" ? treeEdge(edge, ctx) : importEdge(edge, ctx);
}
