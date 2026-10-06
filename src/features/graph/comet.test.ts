import { describe, expect, test } from "bun:test";

import { distanceBetween } from "./activity-math";
import {
  appendTrail,
  COMET_EASE_PER_FRAME,
  COMET_SETTLE_DISTANCE,
  isCometAnimating,
  PILL_BOTTOM_INSET,
  PILL_MARGIN,
  PILL_OFFSET,
  PILL_TOP_INSET,
  placePill,
  stepComet,
  TRAIL_LENGTH,
  TRAIL_MAX_ALPHA,
  TRAIL_MAX_WIDTH,
  trailSegments,
  type CometState,
} from "./comet";
import type { Point } from "./placement";

const FRAME = 1000 / 60;
const ORIGIN = { x: 0, y: 0 };

describe("stepComet", () => {
  test("appears on its target the first time there is one", () => {
    expect(stepComet(null, { x: 10, y: 4 }, FRAME, false)).toEqual({
      position: { x: 10, y: 4 },
      trail: [{ x: 10, y: 4 }],
    });
  });

  test("stays hidden with no target and no history", () => {
    expect(stepComet(null, null, FRAME, false)).toBeNull();
  });

  test("covers 9% of the remaining distance per frame", () => {
    const comet: CometState = { position: ORIGIN, trail: [ORIGIN] };
    const next = stepComet(comet, { x: 100, y: 0 }, FRAME, false);
    expect(next?.position.x).toBeCloseTo(100 * COMET_EASE_PER_FRAME, 9);
    const after = stepComet(next, { x: 100, y: 0 }, FRAME, false);
    expect(after?.position.x).toBeCloseTo(9 + 91 * COMET_EASE_PER_FRAME, 9);
  });

  test("is frame-rate independent", () => {
    const comet: CometState = { position: ORIGIN, trail: [ORIGIN] };
    const target = { x: 100, y: 0 };
    const twoShort = stepComet(stepComet(comet, target, 20, false), target, 20, false);
    const oneLong = stepComet(comet, target, 40, false);
    expect(twoShort?.position.x).toBeCloseTo(oneLong?.position.x ?? Number.NaN, 9);
  });

  test("leaves a trail that grows while flying and is capped", () => {
    let comet = stepComet(null, ORIGIN, FRAME, false);
    for (let frame = 0; frame < 60; frame += 1) comet = stepComet(comet, { x: 1000, y: 0 }, FRAME, false);
    expect(comet?.trail).toHaveLength(TRAIL_LENGTH);
  });

  test("settles on the target and its trail then catches up", () => {
    let comet = stepComet(null, ORIGIN, FRAME, false);
    const target = { x: 50, y: 0 };
    for (let frame = 0; frame < 400; frame += 1) comet = stepComet(comet, target, FRAME, false);
    expect(comet?.position).toEqual(target);
    expect(comet?.trail).toHaveLength(1);
    expect(isCometAnimating(comet, target)).toBe(false);
  });

  test("keeps its place and retracts the trail when the target disappears", () => {
    const comet: CometState = { position: { x: 5, y: 5 }, trail: [ORIGIN, { x: 3, y: 3 }, { x: 5, y: 5 }] };
    const next = stepComet(comet, null, FRAME, false);
    expect(next?.position).toEqual({ x: 5, y: 5 });
    expect(next?.trail).toHaveLength(2);
  });

  test("jumps straight to the target with no trail under reduced motion", () => {
    const comet: CometState = { position: ORIGIN, trail: [ORIGIN, { x: 1, y: 0 }] };
    expect(stepComet(comet, { x: 80, y: 20 }, FRAME, true)).toEqual({
      position: { x: 80, y: 20 },
      trail: [{ x: 80, y: 20 }],
    });
  });

  test("a tiny gap snaps instead of easing forever", () => {
    const target = { x: COMET_SETTLE_DISTANCE / 2, y: 0 };
    const next = stepComet({ position: ORIGIN, trail: [ORIGIN] }, target, FRAME, false);
    expect(next?.position).toEqual(target);
    expect(distanceBetween(next?.position ?? ORIGIN, target)).toBe(0);
  });
});

describe("isCometAnimating", () => {
  test("is false with no comet", () => {
    expect(isCometAnimating(null, { x: 1, y: 1 })).toBe(false);
  });

  test("is true while travelling or while a trail remains", () => {
    expect(isCometAnimating({ position: ORIGIN, trail: [ORIGIN] }, { x: 10, y: 0 })).toBe(true);
    expect(isCometAnimating({ position: ORIGIN, trail: [ORIGIN, ORIGIN] }, ORIGIN)).toBe(true);
    expect(isCometAnimating({ position: ORIGIN, trail: [ORIGIN] }, ORIGIN)).toBe(false);
  });
});

function line(count: number): Point[] {
  return Array.from({ length: count }, (_, index) => ({ x: index, y: 0 }));
}

describe("appendTrail", () => {
  test("grows by the new head while moving", () => {
    expect(appendTrail([{ x: 0, y: 0 }], { x: 1, y: 0 }, true)).toEqual(line(2));
  });

  test("keeps at most 26 points, dropping the oldest", () => {
    const trail = line(TRAIL_LENGTH);
    const next = appendTrail(trail, { x: 99, y: 0 }, true);
    expect(next).toHaveLength(TRAIL_LENGTH);
    expect(next.at(-1)).toEqual({ x: 99, y: 0 });
    expect(next[0]).toEqual({ x: 1, y: 0 });
  });

  test("retracts one point per frame while resting, down to just the head", () => {
    let trail: readonly Point[] = line(4);
    const head = { x: 3, y: 0 };
    trail = appendTrail(trail, head, false);
    expect(trail).toHaveLength(3);
    trail = appendTrail(appendTrail(trail, head, false), head, false);
    expect(trail).toEqual([head]);
    expect(appendTrail(trail, head, false)).toEqual([head]);
  });

  test("does not mutate its input", () => {
    const trail = line(3);
    appendTrail(trail, { x: 5, y: 5 }, true);
    expect(trail).toEqual(line(3));
  });
});

describe("trailSegments", () => {
  test("has no segments for fewer than two points", () => {
    expect(trailSegments([])).toEqual([]);
    expect(trailSegments(line(1))).toEqual([]);
  });

  test("tapers from the tail to the head, topping out at 4 px and 0.7 opacity", () => {
    const segments = trailSegments(line(TRAIL_LENGTH));
    expect(segments).toHaveLength(TRAIL_LENGTH - 1);
    const widths = segments.map((segment) => segment.width);
    const alphas = segments.map((segment) => segment.alpha);
    expect(Math.max(...widths)).toBeCloseTo(TRAIL_MAX_WIDTH, 9);
    expect(Math.max(...alphas)).toBeCloseTo(TRAIL_MAX_ALPHA, 9);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(widths[0]).toBeGreaterThan(0);
  });

  test("joins consecutive points", () => {
    const [first, second] = trailSegments(line(3));
    expect(first?.from).toEqual({ x: 0, y: 0 });
    expect(first?.to).toEqual({ x: 1, y: 0 });
    expect(second?.from).toEqual({ x: 1, y: 0 });
  });
});

const viewport = { width: 400, height: 300 };
const size = { width: 120, height: 20 };

describe("placePill", () => {
  test("sits to the right of the comet, centred on it vertically", () => {
    const rect = placePill({ x: 100, y: 150 }, size, viewport);
    expect(rect).toEqual({ x: 100 + PILL_OFFSET, y: 140, ...size });
  });

  test("flips to the left near the right edge", () => {
    const rect = placePill({ x: 380, y: 150 }, size, viewport);
    expect(rect.x).toBe(380 - PILL_OFFSET - size.width);
  });

  test("stays inside the viewport on every side", () => {
    const farLeft = placePill({ x: 0, y: 150 }, size, { width: 100, height: 300 });
    expect(farLeft.x).toBeGreaterThanOrEqual(PILL_MARGIN);
    const top = placePill({ x: 100, y: 0 }, size, viewport);
    expect(top.y).toBe(PILL_TOP_INSET);
    const bottom = placePill({ x: 100, y: 999 }, size, viewport);
    expect(bottom.y + size.height).toBe(viewport.height - PILL_BOTTOM_INSET);
  });

  test("parks in the corner when the comet has no position", () => {
    expect(placePill(null, size, viewport)).toEqual({ x: PILL_MARGIN, y: PILL_TOP_INSET, ...size });
  });
});
