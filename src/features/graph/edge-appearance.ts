import type { RenderParams } from "sigma/types";

import { blastColor, blastRole, type AppearanceContext, type BlastRole } from "./appearance";
import { mixColors, withPremultipliedAlpha as premultiplied } from "./color-math";
import { EDGE_TYPE, type EdgeKind } from "./graph-model";
import type { Palette } from "./palette";

/*
 * Visual rules for sigma's edges. Every size is in screen pixels: the line program keeps edges this wide at any zoom.
 * - Import edges are thin lines; a pair of files that import each other is drawn once.
 * - Folder links join hubs in the overview only, faint and beneath imports; at the Files level folders show as regions.
 * - The pairs the selection overlay draws as arcs are hidden here, so a relation never shows twice.
 */
const IMPORT_EDGE_SIZE = 1;
const ACTIVE_EDGE_SIZE = 1.5;
const BLAST_EDGE_SIZE = 1.5;
const TREE_EDGE_SIZE = 1;
const TREE_ALPHA = 0.5;
const TREE_ALPHA_FOCUSED = 0.85;
const BACKGROUND_EDGE_ALPHA = 0.05;
const ACTIVE_EDGE_ALPHA = 0.85;
const DIRECTION_ALPHA = 0.7;

const SPARSE_EDGES = 30;
const DENSE_EDGES = 4000;
const SPARSE_ALPHA = 0.75;
const DENSE_ALPHA = 0.16;
const LONG_EDGE_SHARE = 0.6;
const MIN_LENGTH_FADE = 0.3;
export const HIDE_EDGES_ON_MOVE_THRESHOLD = 2500;

/**
 * Sigma divides an edge's size by sqrt(camera ratio), so lines swell as you zoom in until a 1px import reads like a
 * road. Pinning the size ratio to 1 for edges keeps them at their size in screen pixels at any zoom.
 */
export function screenSpaceParams(params: RenderParams): RenderParams {
  return { ...params, sizeRatio: 1 };
}

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

export interface EdgeInfo {
  readonly kind: EdgeKind;
  readonly source: string;
  readonly target: string;
  /** Both ends are folders that are shown as hubs. */
  readonly betweenHubs: boolean;
  /** Distance between the two ends in layout units. */
  readonly length: number;
  /** The reverse import exists as well. */
  readonly mutual: boolean;
  /** The selection overlay draws this pair as an arc. */
  readonly drawnAsArc: boolean;
}

export interface EdgeStyle {
  color: string;
  size: number;
  zIndex: number;
  hidden: boolean;
  type: string;
}

const HIDDEN: EdgeStyle = { color: "#000000", size: 0, zIndex: 0, hidden: true, type: EDGE_TYPE };

function line(color: string, size: number, zIndex: number): EdgeStyle {
  return { color, size, zIndex, hidden: false, type: EDGE_TYPE };
}

function depthOf(role: BlastRole): number | null {
  if (role.kind === "origin") return 0;
  return role.kind === "dependent" ? role.depth : null;
}

function blastEdgeColor(source: BlastRole, target: BlastRole, palette: Palette): string | null {
  if (source.kind !== "dependent") return null;
  return depthOf(target) === source.depth - 1 ? blastColor(palette, source.depth) : null;
}

function treeEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  if (!edge.betweenHubs || ctx.level !== "overview") return HIDDEN;
  const active = ctx.focus?.node;
  const touched = active === edge.source || active === edge.target;
  return line(premultiplied(ctx.palette.edge, touched ? TREE_ALPHA_FOCUSED : TREE_ALPHA), TREE_EDGE_SIZE, touched ? 2 : 0);
}

function blastEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle | null {
  const sourceRole = blastRole(ctx.blast, edge.source);
  if (sourceRole.kind === "inactive") return null;
  const color = blastEdgeColor(sourceRole, blastRole(ctx.blast, edge.target), ctx.palette);
  if (color !== null) return line(color, BLAST_EDGE_SIZE, 3);
  if (ctx.level === "overview") return HIDDEN;
  return line(premultiplied(ctx.palette.edge, BACKGROUND_EDGE_ALPHA), IMPORT_EDGE_SIZE, 0);
}

function activeNode(ctx: AppearanceContext): string | null {
  return ctx.focus?.node ?? ctx.selected;
}

function directionHue(edge: EdgeInfo, palette: Palette, active: string): string {
  if (edge.mutual) return mixColors(palette.importer, palette.imports, 0.5);
  return edge.source === active ? palette.imports : palette.importer;
}

function directionEdge(edge: EdgeInfo, ctx: AppearanceContext, active: string): EdgeStyle {
  const alpha = ctx.focus === null ? DIRECTION_ALPHA : ACTIVE_EDGE_ALPHA;
  return line(premultiplied(directionHue(edge, ctx.palette, active), alpha), ACTIVE_EDGE_SIZE, 3);
}

function importEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  const blast = blastEdge(edge, ctx);
  if (blast !== null) return blast;
  const active = activeNode(ctx);
  if (active !== null && (edge.source === active || edge.target === active)) return directionEdge(edge, ctx, active);
  if (ctx.level === "overview") return HIDDEN;
  const alpha = active === null ? ctx.edgeAlpha * lengthFade(edge.length, ctx.layoutSpan) : BACKGROUND_EDGE_ALPHA;
  return line(premultiplied(ctx.palette.edge, alpha), IMPORT_EDGE_SIZE, 1);
}

function stronger(first: EdgeStyle, second: EdgeStyle): EdgeStyle {
  if (first.hidden) return second;
  if (second.hidden) return first;
  return second.zIndex > first.zIndex ? second : first;
}

/** Two files that import each other share one line: the edge whose source sorts first draws it, styled by the stronger direction. */
function mutualImportEdge(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  if (edge.source > edge.target) return HIDDEN;
  return stronger(importEdge(edge, ctx), importEdge({ ...edge, source: edge.target, target: edge.source }, ctx));
}

export function edgeStyle(edge: EdgeInfo, ctx: AppearanceContext): EdgeStyle {
  if (edge.kind === "tree") return treeEdge(edge, ctx);
  if (edge.drawnAsArc) return HIDDEN;
  return edge.mutual ? mutualImportEdge(edge, ctx) : importEdge(edge, ctx);
}
