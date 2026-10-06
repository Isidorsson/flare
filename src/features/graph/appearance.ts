import { mixColors, withAlpha } from "./color-math";
import type { BlastState, ColorBy } from "./graph-store";
import { hashString } from "./graph-paths";
import type { Language } from "./graph-types";
import type { Palette } from "./palette";
import { pulseIntensity, type Pulse } from "./pulse";

export const MIN_NODE_SIZE = 3;
export const MAX_NODE_SIZE = 11;
const SIZE_PER_ROOT_DEGREE = 1.4;
const PULSE_SIZE_BOOST = 0.8;
const PULSE_BASE_MIX = 0.35;
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
  readonly colorBy: ColorBy;
  readonly blast: BlastState | null;
  readonly pulses: ReadonlyMap<string, Pulse>;
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

export function nodeStyle(info: NodeInfo, ctx: AppearanceContext): NodeStyle {
  const role = blastRole(ctx.blast, info.id);
  const color = baseColor(info, role, ctx);
  const dimmed = role.kind === "inactive" && isOutOfFocus(info.id, ctx.focus);
  const base: NodeStyle = {
    color: dimmed ? mixColors(color, ctx.palette.background, FOCUS_DIM_MIX) : color,
    size: nodeSize(info.inDegree),
    label: info.label,
    zIndex: role.kind === "outside" || dimmed ? 0 : 1,
    forceLabel: role.kind === "origin" || ctx.focus?.node === info.id,
    highlighted: role.kind === "origin" || ctx.focus?.node === info.id,
  };
  return withPulse(base, ctx.pulses.get(info.id), ctx);
}

function withPulse(style: NodeStyle, pulse: Pulse | undefined, ctx: AppearanceContext): NodeStyle {
  if (pulse === undefined) return style;
  const intensity = pulseIntensity(pulse, ctx.now, ctx.reducedMotion);
  if (intensity <= 0) return style;
  const mix = PULSE_BASE_MIX + (1 - PULSE_BASE_MIX) * intensity;
  return {
    ...style,
    color: mixColors(style.color, ctx.palette.pulse[pulse.kind], mix),
    size: ctx.reducedMotion ? style.size : style.size * (1 + PULSE_SIZE_BOOST * intensity),
    zIndex: 3,
    forceLabel: true,
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
