import { grownSize, isTwinkling, nodeBrightness } from "./activity-math";
import { activityColor, type ActivityPalette } from "./activity-palette";
import type { ActivityState, NodeActivity } from "./activity-state";
import { mixColors } from "./color-math";
import type { NodeKind } from "./graph-model";
import type { BlastState, ColorBy, GraphLevel } from "./graph-store";
import { hashString } from "./graph-paths";
import type { Language } from "./graph-types";
import { DUST_SIZE, growthCeiling, type SizeScale } from "./node-scale";
import type { Palette } from "./palette";
import type { Role } from "./roles";

export const FOCUS_DIM_MIX = 0.72;
const HUB_DIM_MIX = 0.55;
export const RECEDE_MIX = 0.16;
export const DUST_MIX = 0.42;
const HUB_RECEDE_MIX = 0.08;
export const FILES_LEVEL_HUB_SCALE = 0.72;

export interface Focus {
  readonly node: string;
  readonly neighbours: ReadonlySet<string>;
}

export interface AppearanceContext {
  readonly palette: Palette;
  readonly activityColors: ActivityPalette;
  readonly colorBy: ColorBy;
  readonly level: GraphLevel;
  readonly blast: BlastState | null;
  readonly activity: Pick<ActivityState, "nodes">;
  readonly now: number;
  readonly reducedMotion: boolean;
  readonly focus: Focus | null;
  readonly selected: string | null;
  readonly scale: SizeScale;
  /** Shrinks files in a crowded view; see fitSizeFactor. */
  readonly sizeFactor: number;
  /** The widest extent of the layout in layout units, to judge how long an edge is. */
  readonly layoutSpan: number;
  /** Alpha for a resting import edge; thinner for dense graphs. */
  readonly edgeAlpha: number;
  /** Whether import edges carry arrowheads; they only help while the graph is small. */
  readonly arrows: boolean;
}

export interface NodeInfo {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly language: Language | null;
  readonly role: Role;
  readonly hub: string;
  readonly folder: string;
  readonly size: number;
}

export interface NodeStyle {
  color: string;
  size: number;
  label: string;
  zIndex: number;
  hidden: boolean;
}

export type BlastRole =
  | { readonly kind: "inactive" }
  | { readonly kind: "origin" }
  | { readonly kind: "dependent"; readonly depth: number }
  | { readonly kind: "outside" };

const INACTIVE: BlastRole = { kind: "inactive" };
const ORIGIN: BlastRole = { kind: "origin" };
const OUTSIDE: BlastRole = { kind: "outside" };

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

export function folderColor(palette: Palette, hub: string): string {
  const index = hashString(hub) % palette.directories.length;
  return palette.directories[index] ?? palette.dim;
}

function groupColor(info: NodeInfo, ctx: AppearanceContext): string {
  const { palette } = ctx;
  if (ctx.colorBy === "directory") return folderColor(palette, info.hub);
  if (ctx.colorBy === "language") return info.language === null ? palette.labelDim : palette.language[info.language];
  return palette.roles[info.role];
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
      return groupColor(info, ctx);
  }
}

function isOutOfFocus(id: string, focus: Focus | null): boolean {
  return focus !== null && focus.node !== id && !focus.neighbours.has(id);
}

function inFocus(id: string, focus: Focus | null): boolean {
  return focus !== null && (focus.node === id || focus.neighbours.has(id));
}

function tintedColor(color: string, role: BlastRole, activity: NodeActivity | undefined, ctx: AppearanceContext): string {
  if (activity === undefined || role.kind !== "inactive") return color;
  const tint = activityColor(ctx.activityColors, activity.lastKind);
  return mixColors(color, tint, nodeBrightness(ctx.now - activity.lastTouchedAt, ctx.reducedMotion));
}

function restingZIndex(info: NodeInfo, flags: { dimmed: boolean; hot: boolean; touched: boolean }): number {
  if (flags.dimmed) return 0;
  if (flags.hot) return 3;
  if (flags.touched) return 2;
  return 1 + Math.min(info.size / 24, 0.9);
}

function isInvolved(info: NodeInfo, role: BlastRole, activity: NodeActivity | undefined, ctx: AppearanceContext): boolean {
  if (activity !== undefined || ctx.selected === info.id || inFocus(info.id, ctx.focus)) return true;
  return role.kind === "origin" || role.kind === "dependent";
}

function fileStyle(info: NodeInfo, ctx: AppearanceContext): NodeStyle {
  const role = blastRole(ctx.blast, info.id);
  const activity = ctx.activity.nodes.get(info.id);
  const hot = activity !== undefined && isTwinkling(ctx.now - activity.lastTouchedAt);
  const dust = ctx.level === "overview" && !isInvolved(info, role, activity, ctx);
  const dimmed = role.kind === "inactive" && !hot && isOutOfFocus(info.id, ctx.focus);
  const recede = mixColors(baseColor(info, role, ctx), ctx.palette.background, dust ? DUST_MIX : RECEDE_MIX);
  const color = tintedColor(recede, role, activity, ctx);
  const base = dust ? DUST_SIZE : info.size * ctx.sizeFactor;
  return {
    color: dimmed ? mixColors(color, ctx.palette.background, FOCUS_DIM_MIX) : color,
    size: activity === undefined ? base : grownSize(base, activity, growthCeiling(ctx.scale)),
    label: info.label,
    zIndex: restingZIndex(info, { dimmed, hot, touched: activity !== undefined || ctx.selected === info.id }),
    hidden: false,
  };
}

function folderStyle(info: NodeInfo, ctx: AppearanceContext): NodeStyle {
  const isHub = info.hub === info.folder;
  const dimmed = isOutOfFocus(info.id, ctx.focus);
  const color = mixColors(groupColor(info, ctx), ctx.palette.background, HUB_RECEDE_MIX);
  const size = ctx.level === "files" ? info.size * FILES_LEVEL_HUB_SCALE : info.size;
  return {
    color: dimmed ? mixColors(color, ctx.palette.background, HUB_DIM_MIX) : color,
    size,
    label: info.label,
    zIndex: ctx.focus?.node === info.id ? 4 : 2,
    hidden: !isHub,
  };
}

export function nodeStyle(info: NodeInfo, ctx: AppearanceContext): NodeStyle {
  return info.kind === "folder" ? folderStyle(info, ctx) : fileStyle(info, ctx);
}
