import { clamp } from "@/shared/lib/clamp";

import { clamp01 } from "./color-math";

const SMALL_PROJECT_FILES = 24;
const LARGE_PROJECT_FILES = 2400;
const SMALL_SIZES = { min: 4.4, max: 10.5 } as const;
const LARGE_SIZES = { min: 1.7, max: 6.2 } as const;
const OUT_DEGREE_WEIGHT = 0.4;
const SIZE_CURVE = 1.15;

export const DUST_SIZE = 1.25;
const HUB_BASE_SIZE = 3;
const HUB_SIZE_PER_DECADE = 1.7;
const MAX_HUB_SIZE = 9;
export const MAX_SIZE_HEADROOM = 1.5;

export interface SizeScale {
  readonly min: number;
  readonly max: number;
  /** The importance that earns the largest size; everything beyond it is capped. */
  readonly reference: number;
}

/** What a file means to the rest of the code: who imports it, and a little for how much it pulls in. */
export function importanceOf(inDegree: number, outDegree: number): number {
  return inDegree + outDegree * OUT_DEGREE_WEIGHT;
}

function interpolateLog(fileCount: number): number {
  const span = Math.log(LARGE_PROJECT_FILES / SMALL_PROJECT_FILES);
  return clamp01(Math.log(Math.max(fileCount, 1) / SMALL_PROJECT_FILES) / span);
}

/** Small projects get big, friendly nodes; large ones shrink so the picture stays readable. */
export function sizeScale(fileCount: number, maxImportance: number): SizeScale {
  const t = interpolateLog(fileCount);
  return {
    min: SMALL_SIZES.min + (LARGE_SIZES.min - SMALL_SIZES.min) * t,
    max: SMALL_SIZES.max + (LARGE_SIZES.max - SMALL_SIZES.max) * t,
    reference: Math.max(maxImportance, 1),
  };
}

export function fileSize(importance: number, scale: SizeScale): number {
  const t = clamp01(Math.log1p(Math.max(importance, 0)) / Math.log1p(scale.reference));
  return scale.min + (scale.max - scale.min) * Math.pow(t, SIZE_CURVE);
}

export function hubSize(fileCount: number): number {
  return Math.min(MAX_HUB_SIZE, HUB_BASE_SIZE + HUB_SIZE_PER_DECADE * Math.log10(1 + Math.max(fileCount, 0)));
}

/** Sizes the agent's activity can grow a node to: past the biggest hub, but not without limit. */
export function growthCeiling(scale: SizeScale): number {
  return clamp(scale.max * MAX_SIZE_HEADROOM, scale.min, MAX_HUB_SIZE * MAX_SIZE_HEADROOM);
}
