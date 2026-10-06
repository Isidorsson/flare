import { easeOutCubic, lerp } from "./activity-math";
import { clamp01 } from "./color-math";

export interface RingSpec {
  readonly fromRadius: number;
  readonly toRadius: number;
  readonly durationMs: number;
  readonly fromWidth: number;
  readonly toWidth: number;
  readonly peakAlpha: number;
}

export const TOUCH_RING: RingSpec = {
  fromRadius: 6,
  toRadius: 34,
  durationMs: 900,
  fromWidth: 2.5,
  toWidth: 0.5,
  peakAlpha: 0.8,
};

export const FINISH_RING: RingSpec = { ...TOUCH_RING, toRadius: 66, durationMs: 1400 };

export const PARTICLE_MS = 500;
export const MAX_EFFECTS = 64;

export interface RingEffect {
  readonly type: "ring";
  readonly nodeId: string;
  readonly color: string;
  readonly spec: RingSpec;
  readonly startedAt: number;
}

export interface ParticleEffect {
  readonly type: "particle";
  readonly fromId: string;
  readonly toId: string;
  readonly color: string;
  readonly startedAt: number;
}

export type Effect = RingEffect | ParticleEffect;

export interface RingFrame {
  readonly radius: number;
  readonly width: number;
  readonly alpha: number;
}

function durationOf(effect: Effect): number {
  return effect.type === "ring" ? effect.spec.durationMs : PARTICLE_MS;
}

export function isEffectActive(effect: Effect, now: number): boolean {
  return now - effect.startedAt < durationOf(effect);
}

export function pruneEffects(effects: readonly Effect[], now: number): Effect[] {
  return effects.filter((effect) => isEffectActive(effect, now)).slice(-MAX_EFFECTS);
}

export function ringFrame(effect: RingEffect, now: number): RingFrame {
  const { spec } = effect;
  const progress = clamp01((now - effect.startedAt) / spec.durationMs);
  return {
    radius: lerp(spec.fromRadius, spec.toRadius, easeOutCubic(progress)),
    width: lerp(spec.fromWidth, spec.toWidth, progress),
    alpha: lerp(spec.peakAlpha, 0, progress),
  };
}

export function particleProgress(effect: ParticleEffect, now: number): number {
  return clamp01((now - effect.startedAt) / PARTICLE_MS);
}

export type MoveRoute =
  | { readonly kind: "direct" }
  | { readonly kind: "edge"; readonly from: string; readonly to: string };

const DIRECT: MoveRoute = { kind: "direct" };

export type HasEdge = (source: string, target: string) => boolean;

/** A hop between two files that import each other (in either direction) travels along that edge. */
export function routeMove(hasEdge: HasEdge, from: string | null, to: string | null): MoveRoute {
  if (from === null || to === null || from === to) return DIRECT;
  const connected = hasEdge(from, to) || hasEdge(to, from);
  return connected ? { kind: "edge", from, to } : DIRECT;
}
