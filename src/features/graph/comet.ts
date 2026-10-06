import { clamp } from "@/shared/lib/clamp";

import { distanceBetween, frameFraction, lerpPoint } from "./activity-math";
import type { Point } from "./placement";

export const COMET_EASE_PER_FRAME = 0.09;
export const COMET_SETTLE_DISTANCE = 0.05;

export interface CometState {
  readonly position: Point;
  readonly trail: readonly Point[];
}

export function stepComet(
  comet: CometState | null,
  target: Point | null,
  dtMs: number,
  reducedMotion: boolean,
): CometState | null {
  if (target === null) {
    return comet === null ? null : { ...comet, trail: appendTrail(comet.trail, comet.position, false) };
  }
  if (comet === null || reducedMotion) return { position: target, trail: [target] };
  const gap = distanceBetween(comet.position, target);
  if (gap <= COMET_SETTLE_DISTANCE) {
    return { position: target, trail: appendTrail(comet.trail, target, false) };
  }
  const position = lerpPoint(comet.position, target, frameFraction(COMET_EASE_PER_FRAME, dtMs));
  return { position, trail: appendTrail(comet.trail, position, true) };
}

export function isCometAnimating(comet: CometState | null, target: Point | null): boolean {
  if (comet === null) return false;
  const travelling = target !== null && distanceBetween(comet.position, target) > COMET_SETTLE_DISTANCE;
  return travelling || comet.trail.length > 1;
}

export const TRAIL_LENGTH = 26;
export const TRAIL_MAX_WIDTH = 4;
export const TRAIL_MAX_ALPHA = 0.7;

export interface TrailSegment {
  readonly from: Point;
  readonly to: Point;
  readonly width: number;
  readonly alpha: number;
}

/** While the head moves the trail grows; once it rests the tail catches up until only the head is left. */
export function appendTrail(trail: readonly Point[], head: Point, moved: boolean): readonly Point[] {
  if (moved) return [...trail, head].slice(-TRAIL_LENGTH);
  return trail.length > 1 ? trail.slice(1) : [head];
}

export function trailSegments(points: readonly Point[]): TrailSegment[] {
  const segments: TrailSegment[] = [];
  const count = points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const taper = (index + 1) / count;
    segments.push({ from, to, width: TRAIL_MAX_WIDTH * taper, alpha: TRAIL_MAX_ALPHA * taper });
  }
  return segments;
}

export const PILL_OFFSET = 16;
export const PILL_MARGIN = 8;
export const PILL_TOP_INSET = 8;
export const PILL_BOTTOM_INSET = 8;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

function fitAxis(start: number, length: number, min: number, max: number): number {
  return clamp(start, min, Math.max(min, max - length));
}

/** Sits to the right of the comet, flips to its left near the edge, and stays inside the viewport. */
export function placePill(anchor: Point | null, size: Size, viewport: Size): Rect {
  if (anchor === null) return { x: PILL_MARGIN, y: PILL_TOP_INSET, ...size };
  const flip = anchor.x + PILL_OFFSET + size.width > viewport.width - PILL_MARGIN;
  const preferred = flip ? anchor.x - PILL_OFFSET - size.width : anchor.x + PILL_OFFSET;
  return {
    x: fitAxis(preferred, size.width, PILL_MARGIN, viewport.width - PILL_MARGIN),
    y: fitAxis(anchor.y - size.height / 2, size.height, PILL_TOP_INSET, viewport.height - PILL_BOTTOM_INSET),
    ...size,
  };
}
