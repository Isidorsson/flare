import { clamp01 } from "./color-math";
import type { Point } from "./placement";

export const HEAT_FLOOR = 0.38;
export const HEAT_TAU_MS = 300_000;
export const HEAT_SETTLED_MS = HEAT_TAU_MS * 6;

export const TWINKLE_MS = 8000;
export const TWINKLE_PERIOD_MS = 1100;
export const TWINKLE_MIN = 0.85;

const SIZE_PER_ROOT_LINE = 0.45;
const SIZE_PER_EDIT = 0.7;
const SIZE_PER_READ = 0.25;

export const FRAME_MS = 1000 / 60;

export interface ActivityCounts {
  readonly reads: number;
  readonly edits: number;
  readonly linesChanged: number;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function lerpPoint(from: Point, to: Point, amount: number): Point {
  return { x: lerp(from.x, to.x, amount), y: lerp(from.y, to.y, amount) };
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function easeOutCubic(amount: number): number {
  const rest = 1 - clamp01(amount);
  return 1 - rest * rest * rest;
}

/** Converts a per-frame easing fraction (tuned at 60 fps) into one that holds at any frame time. */
export function frameFraction(perFrame: number, dtMs: number): number {
  return 1 - Math.pow(1 - perFrame, Math.max(dtMs, 0) / FRAME_MS);
}

export function heatBrightness(elapsedMs: number): number {
  const elapsed = Math.max(elapsedMs, 0);
  return HEAT_FLOOR + (1 - HEAT_FLOOR) * Math.exp(-elapsed / HEAT_TAU_MS);
}

export function isTwinkling(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < TWINKLE_MS;
}

export function twinkleFactor(elapsedMs: number): number {
  if (!isTwinkling(elapsedMs)) return 1;
  const swing = (1 - TWINKLE_MIN) / 2;
  return TWINKLE_MIN + swing + swing * Math.sin((elapsedMs / TWINKLE_PERIOD_MS) * Math.PI * 2);
}

export function nodeBrightness(elapsedMs: number, reducedMotion: boolean): number {
  const twinkle = reducedMotion ? 1 : twinkleFactor(elapsedMs);
  return heatBrightness(elapsedMs) * twinkle;
}

export function activityBonus(counts: ActivityCounts): number {
  return (
    Math.sqrt(Math.max(counts.linesChanged, 0)) * SIZE_PER_ROOT_LINE +
    counts.edits * SIZE_PER_EDIT +
    counts.reads * SIZE_PER_READ
  );
}

export function grownSize(base: number, counts: ActivityCounts, max: number): number {
  return Math.min(max, base + activityBonus(counts));
}
