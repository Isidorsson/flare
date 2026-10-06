import { grownSize, isTwinkling, nodeBrightness } from "./activity-math";
import { activityColor, type ActivityPalette } from "./activity-palette";
import type { ActivityState, NodeActivity } from "./activity-state";
import { mixColors, withAlpha } from "./color-math";
import type { BlastState, ColorBy } from "./graph-store";
import { hashString } from "./graph-paths";
import type { Language } from "./graph-types";
import type { Palette } from "./palette";

export const MIN_NODE_SIZE = 3;
export const MAX_NODE_SIZE = 11;
const SIZE_PER_ROOT_DEGREE = 1.4;
const FOCUS_DIM_MIX = 0.65;
const OUTSIDE_EDGE_ALPHA = 0.18;
const DEFAULT_EDGE_ALPHA = 0.55;
const EDGE_SIZE = 0.6;
const ACTIVE_EDGE_SIZE = 1.6;

export interface Focus {
  readonly node: string;
  readonly neighbours: ReadonlySet<string>;
}

export interface AppearanceContext {
  readonly palette: Palette;
  readonly activityColors: ActivityPalette;
  readonly colorBy: ColorBy;
  readonly blast: BlastState | null;
  readonly activity: Pick<ActivityState, "nodes">;
  readonly now: number;
  readonly reducedMotion: boolean;
  readonly focus: Focus | null;
}

export interface NodeInfo {
  readonly id: string;
  readonly label: string;
  readonly language: Language;
  readonly dirKey: string;
  readonly inDegree: number;
}

export interface NodeStyle {
  color: string;
  size: number;
  label: string;
  zIndex: number;
  forceLabel: boolean;
  highlighted: boolean;
}

export interface EdgeStyle {
  color: string;
  size: number;
  zIndex: number;
}

export type BlastRole =
  | { readonly kind: "inactive" }
  | { readonly kind: "origin" }
  | { readonly kind: "dependent"; readonly depth: number }
  | { readonly kind: "outside" };

const INACTIVE: BlastRole = { kind: "inactive" };
const ORIGIN: BlastRole = { kind: "origin" };
const OUTSIDE: BlastRole = { kind: "outside" };

export function nodeSize(inDegree: number): number {
  return Math.min(MAX_NODE_SIZE, MIN_NODE_SIZE + Math.sqrt(inDegree) * SIZE_PER_ROOT_DEGREE);
}

export function blastRole(blast: BlastState | null, id: string): BlastRole {
  if (blast === null) return INACTIVE;
  if (blast.origin === id) return ORIGIN;
  if (blast.depths === null) return INACTIVE;
  const depth = blast.depths.get(id);
  return depth === undefined ? OUTSIDE : { kind: "dependent", depth };
}

export function blastColor(palette: Palette, depth: number): string {
  const index = Math.min(Math.max(depth, 1), palette.blastDepths.length) - 1;
  return palette.blastDepths[index] ?? palette.dim;
}

function directoryColor(palette: Palette, dirKey: string): string {
  const index = hashString(dirKey) % palette.directories.length;
  return palette.directories[index] ?? palette.dim;
}

function baseColor(info: NodeInfo, role: BlastRole, ctx: AppearanceContext): string {
  switch (role.kind) {
    case "origin":
      return ctx.palette.blastOrigin;
    case "dependent":
      return blastColor(ctx.palette, role.depth);
    case "outside":
      return ctx.palette.dim;
    case "inactive":
      return ctx.colorBy === "language"
        ? ctx.palette.language[info.language]
        : directoryColor(ctx.palette, info.dirKey);
  }
}

function isOutOfFocus(id: string, focus: Focus | null): boolean {
  return focus !== null && focus.node !== id && !focus.neighbours.has(id);
}

function tintedColor(
  info: NodeInfo,
  role: BlastRole,
  activity: NodeActivity | undefined,
  ctx: AppearanceContext,
): string {
  const color = baseColor(info, role, ctx);
  if (activity === undefined || role.kind !== "inactive") return color;
  const tint = activityColor(ctx.activityColors, activity.lastKind);
  return mixColors(color, tint, nodeBrightness(ctx.now - activity.lastTouchedAt, ctx.reducedMotion));
}

function restingZIndex(role: BlastRole, dimmed: boolean, activity: NodeActivity | undefined, hot: boolean): number {
  if (role.kind === "outside" || dimmed) return 0;
  if (hot) return 3;
  return activity === undefined ? 1 : 2;
}

export function nodeStyle(info: NodeInfo, ctx: AppearanceContext): NodeStyle {
  const role = blastRole(ctx.blast, info.id);
  const activity = ctx.activity.nodes.get(info.id);
  const hot = activity !== undefined && isTwinkling(ctx.now - activity.lastTouchedAt);
  const dimmed = role.kind === "inactive" && !hot && isOutOfFocus(info.id, ctx.focus);
  const color = tintedColor(info, role, activity, ctx);
  const focused = role.kind === "origin" || ctx.focus?.node === info.id;
  const base = nodeSize(info.inDegree);
  return {
    color: dimmed ? mixColors(color, ctx.palette.background, FOCUS_DIM_MIX) : color,
    size: activity === undefined ? base : grownSize(base, activity, MAX_NODE_SIZE),
    label: info.label,
    zIndex: restingZIndex(role, dimmed, activity, hot),
    forceLabel: focused || hot,
    highlighted: focused,
  };
}

function depthOf(role: BlastRole): number | null {
  if (role.kind === "origin") return 0;
  return role.kind === "dependent" ? role.depth : null;
}

function blastEdgeColor(source: BlastRole, target: BlastRole, palette: Palette): string | null {
  if (source.kind !== "dependent") return null;
  return depthOf(target) === source.depth - 1 ? blastColor(palette, source.depth) : null;
}

export function edgeStyle(source: string, target: string, ctx: AppearanceContext): EdgeStyle {
  const { palette } = ctx;
  const sourceRole = blastRole(ctx.blast, source);
  if (sourceRole.kind !== "inactive") {
    const color = blastEdgeColor(sourceRole, blastRole(ctx.blast, target), palette);
    return color === null
      ? { color: withAlpha(palette.edge, OUTSIDE_EDGE_ALPHA), size: EDGE_SIZE, zIndex: 0 }
      : { color, size: ACTIVE_EDGE_SIZE, zIndex: 2 };
  }
  if (ctx.focus !== null) {
    const touches = ctx.focus.node === source || ctx.focus.node === target;
    return touches
      ? { color: palette.edgeActive, size: ACTIVE_EDGE_SIZE, zIndex: 2 }
      : { color: withAlpha(palette.edge, OUTSIDE_EDGE_ALPHA), size: EDGE_SIZE, zIndex: 0 };
  }
  return { color: withAlpha(palette.edge, DEFAULT_EDGE_ALPHA), size: EDGE_SIZE, zIndex: 1 };
}
